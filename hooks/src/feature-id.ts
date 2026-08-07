/**
 * Feature identifier derivation, shared by the PreToolUse hook and `@capmap/core`.
 *
 * This module is deliberately dependency-free — not even `node:path` — because the hook
 * loads it inside a 50 ms budget and must not pull in the core bundle. It is a copy of
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

/**
 * Map a specification or plan path to the shared feature identifier that names its gate
 * record: the basename, minus the `.md` extension, minus a leading `YYYY-MM-DD-` date and
 * minus a trailing `-design` or `-plan` role. A spec and its plan must derive to the same
 * id, or the hook could never link them.
 */
export function deriveFeatureId(filePath: string): string {
  const segments = filePath.split(PATH_SEPARATOR);
  const base = segments[segments.length - 1] ?? filePath;
  return base
    .replace(MARKDOWN_EXTENSION, "")
    .replace(DATE_PREFIX, "")
    .replace(ROLE_SUFFIX, "");
}
