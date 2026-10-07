/**
 * Digest of the code in a commit: every tracked path outside documentation,
 * with the blob it holds.
 *
 * A transcript names the commit it was generated at, but the estate lands pull
 * requests by squash, and a squash merge leaves that commit out of main's
 * history. The code is what the transcript vouches for, and a squash, rebase or
 * cherry-pick keeps the code byte-identical while changing every commit id, so
 * the digest of the code is what survives the merge and what is compared.
 *
 * Usage:  node scripts/code-digest.mjs [revision]   (defaults to HEAD)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Paths that may change without invalidating a transcript: `docs/` and
 * top-level prose. Deliberately not "any .md anywhere": a skill's `SKILL.md` is
 * behaviour, it has a test asserting its frontmatter, and a transcript
 * generated before an edit to one no longer describes what runs.
 */
export const DOCUMENTATION_ONLY = /^(docs\/|[^/]+\.md$)/;
const ENTRY_SEPARATOR = "\0";
const PATH_SEPARATOR = "\t";

export function codeDigest(revision) {
  const entries = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", revision], {
    encoding: "utf8",
  })
    .split(ENTRY_SEPARATOR)
    .filter((entry) => entry !== "")
    .filter((entry) => !DOCUMENTATION_ONLY.test(entry.slice(entry.indexOf(PATH_SEPARATOR) + 1)));
  return createHash("sha256").update(entries.join(ENTRY_SEPARATOR)).digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${codeDigest(process.argv[2] ?? "HEAD")}\n`);
}
