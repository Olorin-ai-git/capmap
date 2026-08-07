import { readFile, access } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PackageKind } from "../model/index-schema.js";

export interface ParsedManifest {
  name: string;
  kind: PackageKind;
  entryRelPath: string | null;
  deps: { internal: string[]; external: string[] };
  isPrivate: boolean;
  hasTestScript: boolean;
  parseError: string | null;
}

const ENTRY_FIELDS = ["exports", "main", "module", "types"] as const;
const SOURCE_CANDIDATES = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "index.ts",
  "index.js",
];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "devDependencies",
];
const LEADING_RELATIVE = /^\.\//;

function firstStringLeaf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = firstStringLeaf(nested);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Resolve an entry point that will still be there when verification looks.
 *
 * Source candidates are probed first. A manifest field is accepted only if the
 * file it names actually exists: a `main` of `dist/index.js` is the normal way
 * to declare a build output, and recording it as the entry point produced eight
 * capabilities that could never verify — the directory is excluded from
 * scanning and is absent in a clean checkout, so the entry check failed
 * permanently on packages that had not changed at all.
 *
 * An unresolvable entry is recorded as null, which is honest: the package
 * exposes nothing this scanner can read without a build.
 */
async function resolveEntry(
  dir: string,
  raw: Record<string, unknown>,
): Promise<string | null> {
  for (const candidate of SOURCE_CANDIDATES) {
    try {
      await access(join(dir, candidate));
      return candidate;
    } catch {
      continue;
    }
  }
  for (const field of ENTRY_FIELDS) {
    const leaf = firstStringLeaf(raw[field]);
    if (leaf === null) continue;
    const declared = leaf.replace(LEADING_RELATIVE, "");
    try {
      await access(join(dir, declared));
      return declared;
    } catch {
      continue;
    }
  }
  return null;
}

function splitDeps(
  raw: Record<string, unknown>,
  scopes: string[],
): { internal: string[]; external: string[] } {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const map = raw[field];
    if (map === null || typeof map !== "object") continue;
    for (const key of Object.keys(map as Record<string, unknown>)) {
      names.add(key);
    }
  }
  const internal: string[] = [];
  const external: string[] = [];
  for (const name of [...names].sort()) {
    if (scopes.some((scope) => name.startsWith(scope))) internal.push(name);
    else external.push(name);
  }
  return { internal, external };
}

export async function parseNpmManifest(
  dir: string,
  scopes: string[],
): Promise<ParsedManifest> {
  const fallback: ParsedManifest = {
    name: basename(dir),
    kind: "npm-package",
    entryRelPath: null,
    deps: { internal: [], external: [] },
    isPrivate: false,
    hasTestScript: false,
    parseError: null,
  };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch (error) {
    return {
      ...fallback,
      parseError: `package.json is not valid JSON: ${String(error)}`,
    };
  }

  const isPrivate = raw["private"] === true;
  const entryRelPath = await resolveEntry(dir, raw);
  const scripts = raw["scripts"];
  const hasTestScript =
    typeof scripts === "object" &&
    scripts !== null &&
    typeof (scripts as Record<string, unknown>)["test"] === "string";
  const kind: PackageKind =
    isPrivate && entryRelPath === null ? "app" : "npm-package";

  return {
    name: typeof raw["name"] === "string" ? raw["name"] : basename(dir),
    kind,
    entryRelPath,
    deps: splitDeps(raw, scopes),
    isPrivate,
    hasTestScript,
    parseError: null,
  };
}
