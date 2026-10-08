import { access } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { BYPASS_ENV_VAR, BYPASS_VALUE, decide, type Decision } from "./decide.js";
import { deriveFeatureId } from "./feature-id.js";
import { bindingProblem, canonical, isGateRecordPath, parseGateRecord } from "./gate-record.js";
import { AMBIGUOUS_EDIT_HASH, pendingDocument, pendingHash } from "./pending-document.js";
import { namedSpec } from "./plan-spec.js";
import { readRegularFile } from "./read-regular.js";
import type { Target } from "./payload.js";

/** The decision for one path a tool call writes. */

const GATE_DIR = ".capmap";
const GIT_DIR = ".git";

export interface Context {
  /**
   * Paths only the operator or capmap itself may write: the gate's
   * configuration, its index, and the hook's own code, manifest and
   * dependency. Changing any of them steers or disables the gate as surely as
   * forging a record.
   */
  protectedDirs: string[];
  bypass: boolean;
  isSpec: (path: string) => boolean;
  isPlan: (path: string) => boolean;
  /** Neither specifications nor plans, whatever the globs say: Claude Code's own plan-mode files. */
  isExempt: (path: string) => boolean;
  /** The configured index's generation time, or null when there is no index. */
  indexGeneratedAt: string | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gate records live beside the repository they describe, so a specification and
 * its plan resolve to the same directory however deeply either is nested.
 */
async function gateDirFor(fileAbs: string): Promise<string> {
  let current = dirname(fileAbs);
  for (;;) {
    if (await exists(join(current, GIT_DIR))) return join(current, GATE_DIR);
    const parent = dirname(current);
    if (parent === current) return join(dirname(fileAbs), GATE_DIR);
    current = parent;
  }
}

export function blockUnlessBypassed(ctx: Context, what: string, path: string): Decision {
  return ctx.bypass
    ? { allow: true, warning: `${BYPASS_ENV_VAR}=${BYPASS_VALUE}: ${what} allowed` }
    : { allow: false, reason: `${what} is not allowed: ${path}\nBypass: ${BYPASS_ENV_VAR}=${BYPASS_VALUE}` };
}

const lower = (path: string): string => path.toLowerCase();
const within = (dir: string, path: string): boolean =>
  lower(path) === lower(dir) || lower(path).startsWith(lower(dir) + sep);

/** The record named for the specification at `specAbs`, parsed, or why it is no record. */
async function recordFor(specAbs: string): Promise<ReturnType<typeof parseGateRecord> | null> {
  const feature = deriveFeatureId(specAbs);
  const path = join(await gateDirFor(specAbs), `gate-${feature}.json`);
  return (await exists(path)) ? parseGateRecord(await readRegularFile(path), feature) : null;
}

async function decidePlan(target: Target, fileAbs: string, ctx: Context): Promise<Decision> {
  if (ctx.bypass) return { allow: true, warning: `${BYPASS_ENV_VAR}=${BYPASS_VALUE}: reuse gate bypassed` };
  const text = target.input === null ? null : (await pendingDocument(fileAbs, target.input)).text;
  const spec = await namedSpec(fileAbs, text, dirname(await gateDirFor(fileAbs)));
  if (spec === null) {
    return blockUnlessBypassed(
      ctx,
      text === null
        ? "Writing a plan whose content the hook cannot read (the shell, or an edit it cannot rebuild)"
        : `Writing a plan that names no specification — add a line "Spec: <the gated specification>" —`,
      fileAbs,
    );
  }
  const specAbs = await canonical(spec);
  const parsed = await recordFor(specAbs);
  const indexGeneratedAt = ctx.indexGeneratedAt ?? "";
  const problem =
    parsed === null
      ? null
      : parsed.problem ?? (await bindingProblem(parsed.record, { plan: specAbs, indexGeneratedAt }, ctx.isSpec));
  return decide({
    filePath: fileAbs,
    fileExists: await exists(fileAbs),
    isSpec: false,
    isPlan: true,
    record: parsed?.record ?? null,
    recordProblem: problem,
    currentComponentsHash: null,
    indexPresent: ctx.indexGeneratedAt !== null,
    bypass: ctx.bypass,
  });
}

export async function evaluate(target: Target, ctx: Context): Promise<Decision> {
  // Decided on the path as written and as it resolves, so a symbolic link
  // cannot carry a write into a guarded place under an unguarded name.
  const raw = target.fileAbs;
  const fileAbs = await canonical(raw);
  if (isGateRecordPath(raw) || isGateRecordPath(fileAbs)) {
    return blockUnlessBypassed(ctx, `Writing a gate record other than through "capmap gate"`, fileAbs);
  }
  if (ctx.protectedDirs.some((dir) => within(dir, fileAbs))) {
    return blockUnlessBypassed(ctx, "Changing the reuse gate's configuration, index or hook", fileAbs);
  }
  if (ctx.isExempt(raw) || ctx.isExempt(fileAbs)) return { allow: true, warning: null };
  const isSpec = ctx.isSpec(raw) || ctx.isSpec(fileAbs);
  const isPlan = ctx.isPlan(raw) || ctx.isPlan(fileAbs);
  if (!isSpec && !isPlan) return { allow: true, warning: null };

  const own = isSpec ? await recordFor(fileAbs) : null;
  const gatedItself =
    own?.record !== null && own?.record !== undefined && (await canonical(own.record.specPath)) === fileAbs;
  // A plan is a plan unless it was itself gated as a specification: spec-kit's
  // plan.md lies under specs/ and implements the spec.md beside it.
  if (isPlan && !gatedItself) return decidePlan(target, fileAbs, ctx);

  return decide({
    filePath: fileAbs,
    fileExists: await exists(fileAbs),
    isSpec,
    isPlan,
    record: own?.record ?? null,
    recordProblem:
      own === null ? null : own.problem ?? (await bindingProblem(own.record, { spec: fileAbs }, ctx.isSpec)),
    currentComponentsHash:
      target.input === null ? AMBIGUOUS_EDIT_HASH : await pendingHash(fileAbs, target.input),
    indexPresent: ctx.indexGeneratedAt !== null,
    bypass: ctx.bypass,
  });
}
