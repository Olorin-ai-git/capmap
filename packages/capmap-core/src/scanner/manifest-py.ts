import { readFile, access } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { ParsedManifest } from "./manifest-npm.js";

/** PEP 508 separators that terminate a distribution name in a requirement string. */
const REQUIREMENT_SEPARATOR = /[<>=!~[;\s]/;
const INIT_FILE = "__init__.py";
const SRC_LAYOUT_PREFIX = "src/";

function collectDeps(project: Record<string, unknown>): string[] {
  const raw = project["dependencies"];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((dep): dep is string => typeof dep === "string")
    .map((dep) => dep.split(REQUIREMENT_SEPARATOR)[0] ?? dep)
    .filter((dep) => dep.length > 0);
}

/** Translate an npm-style scope such as `@olorin/` into a python prefix such as `olorin-`. */
function scopeToPythonPrefix(scope: string): string {
  return scope.replace("@", "").replace("/", "-");
}

async function resolvePackageDir(
  dir: string,
  name: string,
): Promise<string | null> {
  const snake = name.replace(/-/g, "_");
  for (const candidate of [snake, name, SRC_LAYOUT_PREFIX + snake]) {
    try {
      await access(join(dir, candidate, INIT_FILE));
      return `${candidate}/${INIT_FILE}`;
    } catch {
      continue;
    }
  }
  return null;
}

export async function parsePyManifest(
  dir: string,
  scopes: string[],
): Promise<ParsedManifest> {
  const fallback: ParsedManifest = {
    name: basename(dir),
    kind: "py-package",
    entryRelPath: null,
    deps: { internal: [], external: [] },
    isPrivate: false,
    hasTestScript: false,
    parseError: null,
  };

  let raw: Record<string, unknown>;
  try {
    raw = parseToml(
      await readFile(join(dir, "pyproject.toml"), "utf8"),
    ) as Record<string, unknown>;
  } catch (error) {
    return {
      ...fallback,
      parseError: `pyproject.toml is not valid TOML: ${String(error)}`,
    };
  }

  const project = (raw["project"] ?? {}) as Record<string, unknown>;
  const name =
    typeof project["name"] === "string" ? project["name"] : basename(dir);
  const all = collectDeps(project);
  const prefixes = scopes.map(scopeToPythonPrefix);
  const internal = all.filter((dep) =>
    prefixes.some((prefix) => dep.startsWith(prefix)),
  );
  const external = all.filter((dep) => !internal.includes(dep));

  return {
    name,
    kind: "py-package",
    entryRelPath: await resolvePackageDir(dir, name),
    deps: { internal: internal.sort(), external: external.sort() },
    isPrivate: false,
    hasTestScript: false,
    parseError: null,
  };
}
