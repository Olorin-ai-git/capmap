import { readFile } from "node:fs/promises";
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
