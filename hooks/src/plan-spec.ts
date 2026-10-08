import { access } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { deriveFeatureId } from "./feature-id.js";

/**
 * Which specification a plan implements.
 *
 * A plan was tied to its specification by file name alone, so a plan for one
 * feature could be filed under the name of another, trivially gated one, and a
 * decoy specification of the same name could clear it. The plan now names its
 * specification — a `Spec: <path>` line, as text, a Markdown link or in
 * backquotes — and the hook checks the gate record of that file. spec-kit's
 * `plan.md` and `tasks.md` implement the `spec.md` beside them.
 */

const SPEC_LINE = /^[ \t>*-]*\**[ \t]*Spec(?:ification)?[ \t]*\**[ \t]*:[ \t]*\**[ \t]*(.+?)[ \t]*$/im;
const MARKDOWN_LINK = /^\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/;
const BACKQUOTED = /^`([^`]+)`/;
const ANGLED = /^<([^>]+)>/;
const BARE = /^(\S+)/;
const SPEC_KIT_PLAN = /^(plan|tasks)\.md$/i;
const SPEC_KIT_SPEC = "spec.md";
/** `plan-foo.md`, `implementation-foo.md`: the role in front of the feature rather than behind it. */
const LEADING_ROLE = /^(plan|implementation)[-_]/i;
const NAME_BREAK = /^[-_]/;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The path a `Spec:` line names, or null when the text has none. */
export function specReference(text: string): string | null {
  const value = SPEC_LINE.exec(text)?.[1];
  if (value === undefined) return null;
  for (const form of [MARKDOWN_LINK, BACKQUOTED, ANGLED, BARE]) {
    const path = form.exec(value)?.[1];
    if (path !== undefined) return path;
  }
  return null;
}

/**
 * The specification the plan at `planAbs` names, as an absolute path, or null
 * when it names none. A relative reference is looked up beside the plan and
 * then at the repository root; `text` is null when the plan's content is unknown.
 */
export async function namedSpec(planAbs: string, text: string | null, repoRoot: string): Promise<string | null> {
  const sibling = join(dirname(planAbs), SPEC_KIT_SPEC);
  if (SPEC_KIT_PLAN.test(basename(planAbs)) && (await exists(sibling))) return sibling;
  const reference = text === null ? null : specReference(text);
  if (reference === null) return null;
  if (isAbsolute(reference)) return reference;
  const candidates = [resolve(dirname(planAbs), reference), resolve(repoRoot, reference)];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return candidates[0] ?? null;
}

/**
 * Whether the plan is filed under the feature of the specification it names:
 * its feature id is the specification's, or starts with it at a `-` or `_`
 * (`foo-implementation`, `foo-plan-v2`). Otherwise a plan for a feature gated
 * UNRESOLVED could name any cleanly gated specification and clear on its record.
 */
export function filedUnder(planAbs: string, specAbs: string): boolean {
  const plan = deriveFeatureId(planAbs).replace(LEADING_ROLE, "").toLowerCase();
  const spec = deriveFeatureId(specAbs).toLowerCase();
  return plan === spec || (plan.startsWith(spec) && NAME_BREAK.test(plan.slice(spec.length)));
}
