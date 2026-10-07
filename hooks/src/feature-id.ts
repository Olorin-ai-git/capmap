/**
 * Feature identifier derivation, shared by the PreToolUse hook and `@capmap/core`.
 *
 * This module is deliberately dependency-free — not even `node:path` — because the hook
 * loads it inside a 100 ms budget and must not pull in the core bundle. It is a copy of
 * `packages/capmap-core/src/gate/feature-id.ts` rather than an import of it, because that
 * file sits outside this package and TypeScript will not emit a project whose sources
 * escape its `rootDir`. The copies cannot silently diverge: the core suite
 * `test/gate/feature-id.test.ts` imports both and asserts they agree on every shape of
 * path, and a disagreement means the hook looks for a record the CLI never wrote.
 */

const PATH_SEPARATOR = /[/\\]/;
const MARKDOWN_EXTENSION = /\.md$/i;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const ROLE_SUFFIX = /-(design|plan)$/;
/** A spec-kit feature folder: `specs/029-tenant-portal/`. */
const SPEC_KIT_FEATURE_DIR = /^\d{3}-[^/\\]+$/;
/** File names that say what role a document plays, not which feature it is for. */
const ROLE_FILE = /^(spec|plan|tasks|research|data-model|quickstart|design|checklist|readme)$/i;

/**
 * Map a specification or plan path to the shared feature identifier that names its gate
 * record: the basename, minus the `.md` extension, minus a leading `YYYY-MM-DD-` date and
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
  for (let i = folders.length - 1; i >= 0; i -= 1) {
    const folder = folders[i] ?? "";
    if (SPEC_KIT_FEATURE_DIR.test(folder)) return folder;
  }
  const base = (segments[segments.length - 1] ?? filePath).replace(MARKDOWN_EXTENSION, "");
  const parent = folders[folders.length - 1];
  const named = ROLE_FILE.test(base) && parent !== undefined && parent !== "" ? parent : base;
  return named.replace(DATE_PREFIX, "").replace(ROLE_SUFFIX, "");
}
