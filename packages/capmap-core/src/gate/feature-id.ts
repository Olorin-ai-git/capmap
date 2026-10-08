/**
 * Feature identifier derivation for `@capmap/core`.
 *
 * The PreToolUse hook keeps a byte-identical copy at `hooks/src/feature-id.ts`, because it
 * must start inside a 50 ms budget and cannot afford to load this package. The two copies
 * are pinned together by `test/gate/feature-id.test.ts`, which imports both and asserts
 * they agree; that test is the reason the duplication is safe rather than a liability.
 *
 * It lives here rather than being re-exported across the package boundary because
 * `hooks/src` sits outside this package's `rootDir`, and TypeScript refuses to emit a
 * project whose sources escape it.
 */

const PATH_SEPARATOR = /[/\\]/;
const MARKDOWN_EXTENSION = /\.md$/i;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const ROLE_SUFFIX = /-(design|plan)$/;
/** spec-kit names the files of a feature `spec.md`, `plan.md` and `tasks.md` inside its directory. */
const SPEC_KIT_FILE = /^(spec|plan|tasks)\.md$/i;

/**
 * Map a specification or plan path to the shared feature identifier that names its gate
 * record: the basename, minus the `.md` extension, minus a leading `YYYY-MM-DD-` date and
 * minus a trailing `-design` or `-plan` role; spec-kit's `spec.md`, `plan.md` and `tasks.md`
 * take their directory's name. A spec and its plan must derive to the same
 * id, or the hook could never link them.
 */
export function deriveFeatureId(filePath: string): string {
  const segments = filePath.split(PATH_SEPARATOR);
  const last = segments[segments.length - 1] ?? filePath;
  const parent = segments[segments.length - 2];
  // Named by its directory, or every spec-kit feature would share one record.
  const base = SPEC_KIT_FILE.test(last) && parent !== undefined && parent !== "" ? `${parent}.md` : last;
  return base
    .replace(MARKDOWN_EXTENSION, "")
    .replace(DATE_PREFIX, "")
    .replace(ROLE_SUFFIX, "");
}
