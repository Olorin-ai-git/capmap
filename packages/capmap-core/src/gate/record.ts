import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GATE_SCHEMA_VERSION,
  GateRecordSchema,
  type GateRecord,
} from "../model/gate-schema.js";

/**
 * Re-exported so callers of `@capmap/core` name gate records exactly as the hook does. The
 * hook carries its own copy at `hooks/src/feature-id.ts`; `test/gate/feature-id.test.ts`
 * holds the two implementations to the same behaviour.
 */
export { deriveFeatureId } from "./feature-id.js";

const GATE_DIR_NAME = ".capmap";
const GIT_DIR_NAME = ".git";
const JSON_INDENT = 2;
const WRITE_SUFFIX = ".writing";
const MISSING_FILE_CODE = "ENOENT";

/**
 * The repository a document belongs to: the nearest ancestor that contains a
 * `.git` entry, or null outside any. Feature ids are derived from the path
 * inside it, exactly as the hook does, so folders above the checkout never
 * name a record.
 */
export async function resolveRepoRoot(fileAbsPath: string): Promise<string | null> {
  let current = dirname(fileAbsPath);
  for (;;) {
    try {
      await access(join(current, GIT_DIR_NAME));
      return current;
    } catch {
      /* not a repository root — keep walking up */
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Directory holding gate records for a document: `.capmap` under its repository root,
 * falling back to `.capmap` beside the document itself.
 */
export async function resolveGateDir(fileAbsPath: string): Promise<string> {
  return join((await resolveRepoRoot(fileAbsPath)) ?? dirname(fileAbsPath), GATE_DIR_NAME);
}

function recordPath(dirAbs: string, feature: string): string {
  return join(dirAbs, `gate-${feature}.json`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === MISSING_FILE_CODE
  );
}

/** The canonical path, or null when nothing exists there. */
async function existingPath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/**
 * Refuse to replace the record of another specification that derives the same feature id.
 * Records are named by feature, so gating a decoy such as `decoy/specs/foo.md` used to
 * overwrite the record of `specs/foo.md` — an UNRESOLVED verdict replaced by the decoy's
 * BUILD. A record whose specification no longer exists (it moved) may be replaced.
 */
async function assertNotGatedElsewhere(path: string, record: GateRecord): Promise<void> {
  let previous: unknown;
  try {
    previous = (JSON.parse(await readFile(path, "utf8")) as { specPath?: unknown }).specPath;
  } catch {
    return;
  }
  if (typeof previous !== "string") return;
  const [before, now] = await Promise.all([existingPath(previous), existingPath(record.specPath)]);
  if (before !== null && before !== now) {
    throw new Error(
      `feature "${record.feature}" is already gated for ${previous}; rename ${record.specPath} ` +
        `so its feature id differs, or gate ${previous}`,
    );
  }
}

/**
 * Persist a gate record, returning its path. The write lands on a sibling staging file and
 * is renamed into place, so a reader never observes a half-written record.
 */
export async function writeGateRecord(
  dirAbs: string,
  record: GateRecord,
): Promise<string> {
  await mkdir(dirAbs, { recursive: true });
  const path = recordPath(dirAbs, record.feature);
  await assertNotGatedElsewhere(path, record);
  const staging = `${path}${WRITE_SUFFIX}`;
  await writeFile(
    staging,
    JSON.stringify(record, null, JSON_INDENT) + "\n",
    "utf8",
  );
  await rename(staging, path);
  return path;
}

/**
 * Read a gate record, or null when none has been written for the feature. A record written
 * by a different schema version is an error rather than a silent miss: the caller must
 * regenerate it instead of reasoning over a format this build does not understand.
 */
export async function readGateRecord(
  dirAbs: string,
  feature: string,
): Promise<GateRecord | null> {
  let text: string;
  try {
    text = await readFile(recordPath(dirAbs, feature), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  const raw = JSON.parse(text) as { schemaVersion?: unknown };
  if (raw.schemaVersion !== GATE_SCHEMA_VERSION) {
    throw new Error(
      `gate record for "${feature}" uses schema version ${String(raw.schemaVersion)}, ` +
        `expected ${GATE_SCHEMA_VERSION}; re-run "capmap gate"`,
    );
  }
  return GateRecordSchema.parse(raw);
}
