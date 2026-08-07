/**
 * Read the dependency names a package manifest declares, for `package.json` and
 * `pyproject.toml`.
 *
 * Separate from its caller so that both stay inside the 200-line source ceiling
 * the repository applies to itself, and so this parsing can be exercised on its
 * own.
 *
 * Declarations are read from the dependency sections only. Searching a whole
 * TOML file for a quoted name would also match a URL, a description, or a tool
 * setting that happens to contain it — `[tool.ruff] select = ["olorin-email"]`
 * is not a dependency on `olorin-email`.
 */
import { readFileSync } from "node:fs";

export const NPM_MANIFEST = "package.json";
export const PYTHON_MANIFEST = "pyproject.toml";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
/** TOML tables whose every array is a dependency list. */
const DEPENDENCY_TABLES = ["project.optional-dependencies", "dependency-groups"];

/** The distribution name at the head of a PEP 508 requirement string. */
function addRequirement(names, requirement) {
  const match = /^\s*([A-Za-z0-9._-]+)/.exec(requirement);
  if (match !== null) names.add(match[1]);
}

/**
 * Distribution names declared in a pyproject's dependency sections.
 *
 * Both shapes in this estate are covered: PEP 621 arrays of requirement strings
 * under `dependencies` or an optional-dependency group, and poetry's
 * `[tool.poetry.dependencies]` table of bare keys. Requirement strings may carry
 * a version specifier, an extras list, an environment marker or an `@` direct
 * reference — `"olorin-shared @ file:///../packages/olorin-shared"` is one of
 * the edges in this estate, and a matcher that understood only version
 * specifiers called it false.
 */
export function tomlDependencyNames(text) {
  const names = new Set();
  let table = "";
  let inArray = false;
  for (const line of text.split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header !== null) {
      table = header[1];
      inArray = false;
      continue;
    }
    if (inArray) {
      for (const entry of line.matchAll(/["']([^"']+)["']/g)) addRequirement(names, entry[1]);
      if (line.includes("]")) inArray = false;
      continue;
    }
    const assignment = /^\s*(?:"([^"]+)"|([A-Za-z0-9_.-]+))\s*=\s*(.*)$/.exec(line);
    if (assignment === null) continue;
    const key = assignment[1] ?? assignment[2];
    const value = assignment[3];
    const isDependencyArray =
      value.trimStart().startsWith("[") &&
      (key === "dependencies" || DEPENDENCY_TABLES.includes(table));
    if (isDependencyArray) {
      for (const entry of value.matchAll(/["']([^"']+)["']/g)) addRequirement(names, entry[1]);
      if (!value.includes("]")) inArray = true;
      continue;
    }
    // Poetry: [tool.poetry.dependencies] and its group variants, where the KEY
    // is the distribution name and the value is a version or a path table.
    if (table.endsWith("dependencies")) names.add(key);
  }
  return names;
}

/** Every dependency name a manifest declares, whichever kind it is. */
export function declaredNames(file) {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(NPM_MANIFEST)) {
    const parsed = JSON.parse(text);
    const names = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(parsed[field] ?? {})) names.add(name);
    }
    return names;
  }
  return tomlDependencyNames(text);
}
