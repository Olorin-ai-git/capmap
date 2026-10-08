import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TEST_DIR_NAMES } from "./metrics.js";

const PY_FILE = /\.py$/;
/** Test modules exercise a package; importing it does not make them a consumer. */
const TEST_MODULE = /^test_.*\.py$|_test\.py$/;
const DOT = ".";
const FROM_IMPORT = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#;]+)/gm;
const PLAIN_IMPORT = /^[ \t]*import[ \t]+([^\n#;]+)/gm;
const ALIAS = /\s+as\s+\w+$/;
const LEADING_DOTS = /^\.*/;
const LINE_CONTINUATION = /[()\\]/g;

/** One directory of Python source and the dotted package name it holds. */
export interface ImportScope {
  dirAbs: string;
  dotted: string;
}

function names(list: string): string[] {
  return list
    .replace(LINE_CONTINUATION, " ")
    .split(",")
    .map((item) => item.trim().replace(ALIAS, "").trim())
    .filter((item) => item !== "");
}

/**
 * The dotted modules a Python file imports, with relative imports resolved
 * against the package the file lives in. `from a import b` yields `a.b`, which
 * resolves to the sub-package `a.b` when there is one and to `a` otherwise.
 */
export function importedModules(text: string, filePackage: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(FROM_IMPORT)) {
    const source = match[1] ?? "";
    const level = (LEADING_DOTS.exec(source)?.[0] ?? "").length;
    const rest = source.slice(level);
    let base = rest;
    if (level > 0) {
      const parts = filePackage.split(DOT);
      if (level - 1 >= parts.length) continue;
      const anchor = parts.slice(0, parts.length - (level - 1)).join(DOT);
      base = rest === "" ? anchor : `${anchor}${DOT}${rest}`;
    }
    for (const name of names(match[2] ?? "")) out.push(`${base}${DOT}${name}`);
  }
  for (const match of text.matchAll(PLAIN_IMPORT)) out.push(...names(match[1] ?? ""));
  return out;
}

/** The longest dotted prefix of `module` that names one of `known`, or null. */
export function resolveModule(module: string, known: ReadonlySet<string>): string | null {
  const parts = module.split(DOT);
  for (let length = parts.length; length > 0; length -= 1) {
    const prefix = parts.slice(0, length).join(DOT);
    if (known.has(prefix)) return prefix;
  }
  return null;
}

/**
 * Which of `known` the Python source in `scope` imports, excluding `self`.
 *
 * Directories in `skipDirsAbs` belong to other units and are not walked; test
 * packages and excluded directory names are skipped too, since a test that
 * imports a service is not a consumer of it. Symbolic links are not followed.
 */
export async function packageImports(args: {
  scope: ImportScope;
  self: string | null;
  known: ReadonlySet<string>;
  skipDirsAbs: ReadonlySet<string>;
  exclude: ReadonlySet<string>;
}): Promise<string[]> {
  const found = new Set<string>();
  const walk = async (dirAbs: string, dotted: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (args.skipDirsAbs.has(full) || args.exclude.has(entry.name)) continue;
        if (TEST_DIR_NAMES.has(entry.name)) continue;
        await walk(full, `${dotted}${DOT}${entry.name}`);
        continue;
      }
      if (!PY_FILE.test(entry.name) || TEST_MODULE.test(entry.name)) continue;
      let text: string;
      try {
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
      // Relative imports resolve against the module's package, its directory.
      for (const module of importedModules(text, dotted)) {
        const target = resolveModule(module, args.known);
        if (target !== null && target !== args.self) found.add(target);
      }
    }
  };
  await walk(args.scope.dirAbs, args.scope.dotted);
  return [...found].sort();
}
