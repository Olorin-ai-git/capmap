import { access } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { classifyPath } from "./classify.js";
import { BYPASS_ENV_VAR, BYPASS_VALUE, decide, type Decision } from "./decide.js";
import { deriveFeatureId } from "./feature-id.js";
import { bindingProblem, canonical, isGateRecordPath, parseGateRecord } from "./gate-record.js";
import { AMBIGUOUS_EDIT_HASH, pendingDocument, pendingHash } from "./pending-document.js";
import { filedUnder, namedSpec } from "./plan-spec.js";
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
 * The repository a file belongs to (the nearest folder holding `.git`), or the
 * file's own folder outside any. Gate records live beside it, so a
 * specification and its plan resolve to the same directory however deeply
 * either is nested; `capmap gate` finds it the same way.
 */
async function repoRootFor(fileAbs: string): Promise<{ root: string; inRepo: boolean }> {
  let current = dirname(fileAbs);
  for (;;) {
    if (await exists(join(current, GIT_DIR))) return { root: current, inRepo: true };
    const parent = dirname(current);
    if (parent === current) return { root: dirname(fileAbs), inRepo: false };
    current = parent;
  }
}

const gateDirFor = async (fileAbs: string): Promise<string> => join((await repoRootFor(fileAbs)).root, GATE_DIR);

/**
 * The path inside its repository, which classification and feature ids are
 * read from, so folders above the checkout (`/work/specs/100-acme/repo`,
 * `/x/plans/repo`) never decide what a file is. Outside any repository it is
 * the path itself.
 */
async function repoPath(fileAbs: string): Promise<string> {
  const { root, inRepo } = await repoRootFor(fileAbs);
  return inRepo ? relative(root, fileAbs) : fileAbs;
}

async function kindOf(path: string, ctx: Context): Promise<{ isSpec: boolean; isPlan: boolean }> {
  return classifyPath(await repoPath(path), { spec: ctx.isSpec, plan: ctx.isPlan });
}
const specFile = async (path: string, ctx: Context): Promise<boolean> => (await kindOf(path, ctx)).isSpec;

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
  const feature = deriveFeatureId(await repoPath(specAbs));
  const path = join(await gateDirFor(specAbs), `gate-${feature}.json`);
  return (await exists(path)) ? parseGateRecord(await readRegularFile(path), feature) : null;
}

async function decidePlan(target: Target, fileAbs: string, ctx: Context): Promise<Decision> {
  if (ctx.bypass) return { allow: true, warning: `${BYPASS_ENV_VAR}=${BYPASS_VALUE}: reuse gate bypassed` };
  const text = target.input === null ? null : (await pendingDocument(fileAbs, target.input)).text;
  const planPath = await repoPath(fileAbs);
  const spec = await namedSpec(fileAbs, planPath, text, dirname(await gateDirFor(fileAbs)));
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
  const specPath = await repoPath(specAbs);
  if (!filedUnder(planPath, specPath)) {
    return blockUnlessBypassed(
      ctx,
      `Writing a plan of feature "${deriveFeatureId(planPath)}" that names the specification of feature ` +
        `"${deriveFeatureId(specPath)}" (${spec}) — name the plan after the specification it implements —`,
      fileAbs,
    );
  }
  const parsed = await recordFor(specAbs);
  const indexGeneratedAt = ctx.indexGeneratedAt ?? "";
  const problem =
    parsed === null
      ? null
      : parsed.problem ?? (await bindingProblem(parsed.record, { plan: specAbs, indexGeneratedAt }, (path) => specFile(path, ctx)));
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
  // An exempt name is exempt only where the write lands too: `.claude/plans/x.md`
  // linked to `plans/foo-plan.md` writes a plan.
  const kinds = await Promise.all([raw, fileAbs].filter((path) => !ctx.isExempt(path)).map((path) => kindOf(path, ctx)));
  const isSpec = kinds.some((kind) => kind.isSpec);
  const isPlan = kinds.some((kind) => kind.isPlan);
  if (!isSpec && !isPlan) return { allow: true, warning: null };

  const found = isSpec ? await recordFor(fileAbs) : null;
  const gatedItself =
    found?.record !== null && found?.record !== undefined && (await canonical(found.record.specPath)) === fileAbs;
  const fileExists = await exists(fileAbs);
  // A new specification that derives another one's feature id has no record of its
  // own yet; it cannot borrow that one (plans are bound to the record's own file).
  const own = found?.record !== null && found?.record !== undefined && !gatedItself && !fileExists ? null : found;
  // A plan is a plan unless it was itself gated as a specification: spec-kit's
  // plan.md lies under specs/ and implements the spec.md beside it.
  if (isPlan && !gatedItself) return decidePlan(target, fileAbs, ctx);

  return decide({
    filePath: fileAbs,
    fileExists,
    isSpec,
    isPlan,
    record: own?.record ?? null,
    recordProblem:
      own === null ? null : own.problem ?? (await bindingProblem(own.record, { spec: fileAbs }, (path) => specFile(path, ctx))),
    currentComponentsHash:
      target.input === null ? AMBIGUOUS_EDIT_HASH : await pendingHash(fileAbs, target.input),
    indexPresent: ctx.indexGeneratedAt !== null,
    bypass: ctx.bypass,
  });
}
