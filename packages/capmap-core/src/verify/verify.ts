import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { PackageEntry } from "../model/index-schema.js";
import { extractPyExports } from "../scanner/exports-py.js";
import { extractTsExports, type ExportResult } from "../scanner/exports-ts.js";

export type VerifyCheck = "path" | "manifest-name" | "entry" | "exports";

export interface VerifyResult {
  id: string;
  ok: boolean;
  failed: VerifyCheck[];
  detail: string | null;
}

export interface VerifyArgs {
  entry: PackageEntry;
  rootAbs: string;
}

/** Manifest file whose declared name is read as JSON; every other manifest is read as TOML. */
const JSON_MANIFEST_FILE = "package.json";
const DETAIL_SEPARATOR = "; ";

async function exists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** Read the name a manifest currently declares, or `null` when it cannot be read. */
/**
 * The name a manifest declares, applying the SAME directory-basename fallback
 * the scanner applies when a manifest declares none.
 *
 * Without the fallback the two disagree: the scanner records `olorin-auth` for
 * a pyproject.toml with no `[project] name`, and verification then reports the
 * manifest as declaring "no name" and fails a package that has not changed at
 * all. A verifier must model exactly what the scanner did, or it reports drift
 * that never happened — and an unresolved component blocks the operator.
 */
async function manifestName(
  dirAbs: string,
  manifestFile: string,
): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(dirAbs, manifestFile), "utf8");
  } catch {
    return null;
  }
  try {
    if (manifestFile === JSON_MANIFEST_FILE) {
      const raw = JSON.parse(text) as { name?: unknown };
      return typeof raw.name === "string" ? raw.name : basename(dirAbs);
    }
    const raw = parseToml(text) as { project?: { name?: unknown } };
    return typeof raw.project?.name === "string"
      ? raw.project.name
      : basename(dirAbs);
  } catch {
    return null;
  }
}

async function currentExports(
  entry: PackageEntry,
  entryAbs: string,
): Promise<ExportResult> {
  return entry.kind === "py-package"
    ? extractPyExports(entryAbs)
    : extractTsExports(entryAbs);
}

/**
 * Check an indexed capability against the working tree it was scanned from.
 *
 * Four checks run in order: the package directory still exists, the manifest
 * still declares the recorded name, the recorded entry file still exists, and
 * every recorded export is still part of the entry file's surface. A missing
 * directory short-circuits the rest, since nothing below it can be inspected.
 */
export async function verifyCapability(
  args: VerifyArgs,
): Promise<VerifyResult> {
  const { entry, rootAbs } = args;
  const dirAbs = join(rootAbs, entry.path);
  const failed: VerifyCheck[] = [];
  const details: string[] = [];

  if (!(await exists(dirAbs))) {
    return {
      id: entry.id,
      ok: false,
      failed: ["path"],
      detail: `${entry.path} is no longer present`,
    };
  }

  const declared = await manifestName(dirAbs, entry.manifest);
  if (declared !== entry.name) {
    failed.push("manifest-name");
    details.push(
      `manifest declares "${declared ?? "no name"}", index recorded "${entry.name}"`,
    );
  }

  if (entry.entry !== null) {
    const entryAbs = join(dirAbs, entry.entry);
    if (!(await exists(entryAbs))) {
      failed.push("entry");
      details.push(`entry file ${entry.entry} is no longer present`);
    } else if (entry.exports.length > 0) {
      const extracted = await currentExports(entry, entryAbs);
      const missing = entry.exports.filter(
        (name) => !extracted.exports.includes(name),
      );
      if (missing.length > 0) {
        failed.push("exports");
        details.push(`no longer exported: ${missing.join(", ")}`);
      }
    }
  }

  return {
    id: entry.id,
    ok: failed.length === 0,
    failed,
    detail: details.length > 0 ? details.join(DETAIL_SEPARATOR) : null,
  };
}
