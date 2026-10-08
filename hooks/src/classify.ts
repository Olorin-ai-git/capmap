import { specKitLocation } from "./feature-id.js";

/**
 * Glob matching for the gated-document globs ignores case — on a
 * case-insensitive disk `plan.MD` is the same file as `plan.md` — and lets `**`
 * and `*` match dot-names, so a plan under `.claude/worktrees/` or named
 * `.x.md` is gated like any other.
 */
export const HOOK_GLOB_OPTIONS = { nocase: true, dot: true } as const;

/**
 * What the target document is.
 *
 * Deliberately two independent flags rather than one exclusive kind. The glob
 * sets can overlap — a specification living under a `plans/` tree, or any file
 * caught by the plan-prefixed-filename glob — and collapsing that to one winner
 * meant whichever set was tested first silently disabled the other's protection. A
 * path that is both gets BOTH rules: it may not be created ungated, and it may
 * not shed its gated component list.
 */
export interface GuardedPath {
  isSpec: boolean;
  isPlan: boolean;
}

/** The one specification of a spec-kit feature folder. */
const SPEC_KIT_SPEC = /^spec\.(md|markdown)$/i;
const SPEC_KIT_SPEC_FILE = "spec.md";
/** Quality checklists written while specifying, before anything can be gated. */
const SPEC_KIT_CHECKLISTS = /^checklists\//i;
/** Only documents take a spec-kit role; code and data in the folder are left to the globs. */
const DOCUMENT = /\.(md|markdown)$/i;

/**
 * Classify a path against the spec and plan globs, with the spec-kit layout
 * applied on top wherever the globs gate a feature folder's `spec.md`.
 *
 * In `specs/029-x/` only `spec.md` is the specification; `plan.md`, `tasks.md`,
 * `research.md`, `data-model.md`, `quickstart.md` and `contracts/` implement
 * it and share its gate record. Treated as specifications they were blocked
 * once `spec.md` was gated (no component list of their own reads as the list
 * removed), and they were written ungated before it, which is the hole plans
 * fail closed to prevent. They are plans. `checklists/` is written while
 * specifying, so it is neither. Only Markdown takes a role: an
 * `openapi.yaml`, `package.json` or `.ts` beside the documents is code, and
 * blocking it brought back CM-10.
 *
 * The caller passes the path relative to its repository, so a folder above the
 * checkout (`/work/specs/100-acme/repo`) cannot make every file in it a plan.
 */
export function classifyPath(
  filePath: string,
  matches: { spec: (path: string) => boolean; plan: (path: string) => boolean },
): GuardedPath {
  const specKit = specKitLocation(filePath);
  if (
    specKit !== null &&
    DOCUMENT.test(specKit.within) &&
    matches.spec(`${specKit.dir}/${SPEC_KIT_SPEC_FILE}`)
  ) {
    if (SPEC_KIT_SPEC.test(specKit.within)) return { isSpec: true, isPlan: false };
    if (SPEC_KIT_CHECKLISTS.test(specKit.within)) return { isSpec: false, isPlan: false };
    return { isSpec: false, isPlan: true };
  }
  return { isSpec: matches.spec(filePath), isPlan: matches.plan(filePath) };
}

