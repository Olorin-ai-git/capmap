import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExportResult } from "./exports-ts.js";

const ALL_BLOCK = /^__all__\s*=\s*[[(]([\s\S]*?)[\])]/m;
const ALL_ITEM = /["']([^"']+)["']/g;
const TOP_LEVEL_DECL =
  /^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

/**
 * Extract the public export names of a Python entry module.
 *
 * A declared `__all__` is authoritative. Without one, the surface falls back to
 * top-level `def` and `class` declarations, excluding underscore-prefixed
 * private names.
 */
export async function extractPyExports(
  absEntryPath: string,
): Promise<ExportResult> {
  let text: string;
  try {
    text = await readFile(absEntryPath, "utf8");
  } catch {
    return { exports: [], extractionFailed: true };
  }

  const allMatch = ALL_BLOCK.exec(text);
  if (allMatch?.[1] !== undefined) {
    const names = [...allMatch[1].matchAll(ALL_ITEM)].map(
      (m) => m[1] as string,
    );
    return { exports: [...new Set(names)].sort(), extractionFailed: false };
  }

  const declared = [...text.matchAll(TOP_LEVEL_DECL)]
    .map((m) => m[1] as string)
    .filter((name) => !name.startsWith("_"));
  return { exports: [...new Set(declared)].sort(), extractionFailed: false };
}

const PY_MODULE = /^([A-Za-z][A-Za-z0-9_]*)\.py$/;
const INIT_FILE = "__init__.py";

/**
 * Export surface of a Python package, given its `__init__.py`.
 *
 * An `__init__.py` that declares nothing is the common shape of a package in a
 * service monolith: its surface is then its public modules and sub-packages,
 * which is what an importer actually reaches (`from app.services import x`).
 */
export async function extractPyPackageExports(
  absInitPath: string,
): Promise<ExportResult> {
  const declared = await extractPyExports(absInitPath);
  if (declared.extractionFailed || declared.exports.length > 0) return declared;
  const dir = dirname(absInitPath);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return declared;
  }
  const names: string[] = [];
  for (const entry of entries) {
    const module = PY_MODULE.exec(entry.name)?.[1];
    if (entry.isFile() && module !== undefined && entry.name !== INIT_FILE) {
      names.push(module);
    } else if (entry.isDirectory() && !entry.name.startsWith("_")) {
      try {
        await access(join(dir, entry.name, INIT_FILE));
        names.push(entry.name);
      } catch {
        continue;
      }
    }
  }
  return { exports: [...new Set(names)].sort(), extractionFailed: false };
}
