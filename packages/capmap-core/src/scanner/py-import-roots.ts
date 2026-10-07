import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { containedPath } from "./contained.js";

const INIT_FILE = "__init__.py";
const SRC_LAYOUT_DIR = "src";
const CURRENT_DIR = ".";

export type Table = Record<string, unknown>;

export function table(value: unknown): Table {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Table)
    : {};
}

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Top-level directories under `parent` that are Python packages, sorted. */
async function packageDirs(dir: string, parent: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(join(dir, parent), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const rel = (name: string): string =>
    parent === CURRENT_DIR ? name : `${parent}/${name}`;
  const found: string[] = [];
  for (const name of names) {
    if ((await containedPath(dir, `${rel(name)}/${INIT_FILE}`)) !== null) {
      found.push(rel(name));
    }
  }
  return found;
}

async function matching(
  dir: string,
  parent: string,
  include: string[],
  exclude: string[] = [],
): Promise<string[]> {
  const candidates = await packageDirs(dir, parent);
  const leaf = (rel: string): string => rel.split("/").pop() ?? rel;
  const excluded = exclude.map(globToRegExp);
  return include
    .map(globToRegExp)
    .flatMap((pattern) => candidates.filter((rel) => pattern.test(leaf(rel))))
    .filter((rel) => !excluded.some((pattern) => pattern.test(leaf(rel))));
}

/** Import packages the build configuration declares, in declaration order. */
async function declaredRoots(dir: string, raw: Table): Promise<string[]> {
  const tool = table(raw["tool"]);
  const roots: string[] = [];

  const poetryPackages = table(tool["poetry"])["packages"];
  for (const spec of Array.isArray(poetryPackages) ? poetryPackages : []) {
    const include = table(spec)["include"];
    const from = table(spec)["from"];
    if (typeof include !== "string") continue;
    roots.push(...(await matching(dir, typeof from === "string" ? from : CURRENT_DIR, [include])));
  }

  const setuptools = table(tool["setuptools"]);
  const listed = strings(setuptools["packages"]).filter((name) => !name.includes("."));
  roots.push(...listed);
  const find = table(table(setuptools["packages"])["find"]);
  if (Object.keys(find).length > 0) {
    const where = strings(find["where"]);
    const include = strings(find["include"]);
    for (const parent of where.length > 0 ? where : [CURRENT_DIR]) {
      roots.push(
        ...(await matching(dir, parent, include.length > 0 ? include : ["*"], strings(find["exclude"]))),
      );
    }
  }

  const hatchWheel = table(table(table(table(tool["hatch"])["build"])["targets"])["wheel"]);
  roots.push(...strings(hatchWheel["packages"]));
  return roots;
}

/**
 * The project's top-level import packages: what the build declares, else the
 * directory named after the distribution, else every top-level package
 * directory (plain and `src/` layout) not excluded from scanning. Each must be
 * a real package inside the project.
 */
export async function importRoots(
  dir: string,
  raw: Table,
  name: string,
  excludePaths: string[],
): Promise<string[]> {
  const exists = async (rel: string): Promise<boolean> =>
    (await containedPath(dir, `${rel}/${INIT_FILE}`)) !== null;
  const keep = async (rels: string[]): Promise<string[]> => {
    const out: string[] = [];
    for (const rel of [...new Set(rels.map((r) => r.replace(/^\.\//, "")))]) {
      if (await exists(rel)) out.push(rel);
    }
    return out;
  };

  const declared = await keep(await declaredRoots(dir, raw));
  if (declared.length > 0) return declared;

  const snake = name.replace(/-/g, "_");
  const named = await keep([snake, name, `${SRC_LAYOUT_DIR}/${snake}`]);
  if (named.length > 0) return named.slice(0, 1);

  const excluded = new Set(excludePaths);
  const found = [
    ...(await packageDirs(dir, CURRENT_DIR)),
    ...(await packageDirs(dir, SRC_LAYOUT_DIR)),
  ];
  return found.filter((rel) => !excluded.has(rel.split("/").pop() ?? rel));
}

