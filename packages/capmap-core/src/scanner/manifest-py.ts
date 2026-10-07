import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { importRoots, strings, table, type Table } from "./py-import-roots.js";
import type { ParsedManifest } from "./manifest-npm.js";

/** PEP 508 separators that terminate a distribution name in a requirement string. */
const REQUIREMENT_SEPARATOR = /[<>=!~[;(\s]/;
const INIT_FILE = "__init__.py";
/** Poetry lists the interpreter among the dependencies; it is not a package. */
const POETRY_PYTHON_KEY = "python";

/**
 * The name a pyproject.toml declares: PEP 621 `[project] name`, then Poetry's
 * `[tool.poetry] name`, then the directory. The verifier calls this too, so
 * the two can never disagree about what a manifest is called.
 */
export function pyProjectName(raw: Table, dir: string): string {
  const pep621 = table(raw["project"])["name"];
  if (typeof pep621 === "string") return pep621;
  const poetry = table(table(raw["tool"])["poetry"])["name"];
  return typeof poetry === "string" ? poetry : basename(dir);
}

function collectDeps(raw: Table): string[] {
  const pep621 = strings(table(raw["project"])["dependencies"])
    .map((dep) => dep.split(REQUIREMENT_SEPARATOR)[0] ?? dep)
    .filter((dep) => dep.length > 0);
  const poetry = table(table(raw["tool"])["poetry"]);
  const poetryTables = [
    table(poetry["dependencies"]),
    ...Object.values(table(poetry["group"])).map((group) =>
      table(table(group)["dependencies"]),
    ),
  ];
  const fromPoetry = poetryTables
    .flatMap((deps) => Object.keys(deps))
    .filter((dep) => dep !== POETRY_PYTHON_KEY);
  return [...new Set([...pep621, ...fromPoetry])];
}

/** Translate an npm-style scope such as `@olorin/` into a python prefix such as `olorin-`. */
function scopeToPythonPrefix(scope: string): string {
  return scope.replace("@", "").replace("/", "-");
}

export async function parsePyManifest(
  dir: string,
  scopes: string[],
  excludePaths: string[] = [],
): Promise<ParsedManifest> {
  const fallback: ParsedManifest = {
    name: basename(dir),
    kind: "py-package",
    entryRelPath: null,
    deps: { internal: [], external: [] },
    isPrivate: false,
    hasTestScript: false,
    parseError: null,
    importRoots: [],
  };

  let raw: Table;
  try {
    raw = parseToml(await readFile(join(dir, "pyproject.toml"), "utf8")) as Table;
  } catch (error) {
    return {
      ...fallback,
      parseError: `pyproject.toml is not valid TOML: ${String(error)}`,
    };
  }

  const name = pyProjectName(raw, dir);
  const all = collectDeps(raw);
  const prefixes = scopes.map(scopeToPythonPrefix);
  const internal = all.filter((dep) =>
    prefixes.some((prefix) => dep.startsWith(prefix)),
  );
  const external = all.filter((dep) => !internal.includes(dep));
  const roots = await importRoots(dir, raw, name, excludePaths);
  const first = roots[0];

  return {
    name,
    kind: "py-package",
    entryRelPath: first === undefined ? null : `${first}/${INIT_FILE}`,
    deps: { internal: internal.sort(), external: external.sort() },
    isPrivate: false,
    hasTestScript: false,
    parseError: null,
    importRoots: roots,
  };
}
