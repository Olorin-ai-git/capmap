/**
 * Feature identifier derivation for `@capmap/core`.
 *
 * The PreToolUse hook keeps a byte-identical copy at `hooks/src/feature-id.ts`, because it
 * must start inside a 100 ms budget and cannot afford to load this package. The two copies
 * are pinned together by `test/gate/feature-id.test.ts`, which imports both and asserts
 * they agree; that test is the reason the duplication is safe rather than a liability.
 *
 * It lives here rather than being re-exported across the package boundary because
 * `hooks/src` sits outside this package's `rootDir`, and TypeScript refuses to emit a
 * project whose sources escape it.
 */

const PATH_SEPARATOR = /[/\\]/;
const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const ROLE_SUFFIX = /-(design|plan)$/;
/** A spec-kit feature folder: `specs/029-tenant-portal/`. */
const SPEC_KIT_FEATURE_DIR = /^\d{3}-[^/\\]+$/;
/** The folder that holds spec-kit feature folders; only its children name a feature. */
const SPEC_KIT_PARENT = /^specs$/i;
/** File names that say what role a document plays, not which feature it is for. */
const ROLE_FILE = /^(spec|plan|tasks|research|data-model|quickstart|design|checklist|readme)$/i;

/**
 * Map a specification or plan path to the shared feature identifier that names its gate
 * record: the basename, minus the `.md` or `.markdown` extension, minus a leading `YYYY-MM-DD-` date and
 * minus a trailing `-design` or `-plan` role. A spec and its plan must derive to the same
 * id, or the hook could never link them.
 *
 * Inside a spec-kit feature folder (`specs/029-x/spec.md`, `plan.md`, `contracts/...`) the
 * folder is the feature, and a file named only for its role (`spec.md`) takes its
 * directory's name; otherwise every such file in the estate would share one record.
 */
export function deriveFeatureId(filePath: string): string {
  const segments = filePath.split(PATH_SEPARATOR);
  const folders = segments.slice(0, -1);
  // Only a numbered folder directly under `specs/` is a spec-kit feature; a
  // numbered ancestor elsewhere (`/work/100-acme/repo`) would give every
  // document beneath it one shared gate record.
  for (let i = folders.length - 1; i >= 1; i -= 1) {
    const folder = folders[i] ?? "";
    if (SPEC_KIT_FEATURE_DIR.test(folder) && SPEC_KIT_PARENT.test(folders[i - 1] ?? "")) {
      return folder;
    }
  }
  const base = (segments[segments.length - 1] ?? filePath).replace(MARKDOWN_EXTENSION, "");
  const parent = folders[folders.length - 1];
  const named = ROLE_FILE.test(base) && parent !== undefined && parent !== "" ? parent : base;
  return named.replace(DATE_PREFIX, "").replace(ROLE_SUFFIX, "");
}
