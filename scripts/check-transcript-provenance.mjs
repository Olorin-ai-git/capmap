/**
 * Assert the verification transcript still describes the code that is checked
 * out now.
 *
 * A transcript is a tracked artefact, so it can never name the commit that
 * contains it: committing it moves HEAD. The honest claim is therefore not
 * "generated at HEAD" but "generated at commit X, and nothing since X touches
 * code" — which is worth exactly as much as the check that proves it. Until
 * now it was a sentence in a header, so this makes it a gate: run it and the
 * transcript is either current or the run fails.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DOCUMENTATION_ONLY, codeDigest } from "./code-digest.mjs";

const TRANSCRIPT = "docs/operations/verification-transcript.txt";
const TESTED_COMMIT = /^\s*Code commit under test:\s*([0-9a-f]{40})\s*$/m;
/** Digest of the tested code, which a squash or rebase merge does not change. */
const TESTED_DIGEST = /^\s*Code tree digest:\s*([0-9a-f]{64})\s*$/m;
/**
 * Every commit the transcript names anywhere — the header, and the line each
 * platform section prints from inside its own clone.
 *
 * Reading only the header was enough while one script wrote the whole file, and
 * stopped being enough once a second script appended to it: a transcript whose
 * macOS and Linux halves describe different commits would still have satisfied a
 * check that looked at the first line and no further, while claiming on its face
 * to be two clean clones of ONE commit.
 */
const ANY_COMMIT = /^\s*(?:Code commit under test|commit):\s*([0-9a-f]{40})\s*$/gm;

const transcript = readFileSync(TRANSCRIPT, "utf8");
const stated = TESTED_COMMIT.exec(transcript);
if (stated === null) {
  process.stderr.write(`${TRANSCRIPT} does not state the commit it was generated at\n`);
  process.exit(1);
}
const tested = stated[1];

const named = [...transcript.matchAll(ANY_COMMIT)].map((match) => match[1]);
const disagreeing = [...new Set(named)].filter((commit) => commit !== tested);
if (disagreeing.length > 0) {
  process.stderr.write(
    `${TRANSCRIPT} names more than one commit: the header says ${tested}, ` +
    `while a section says ${disagreeing.join(", ")}. It cannot be two clean ` +
    `clones of one commit.\n`,
  );
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
// Not trimmed: porcelain lines begin with a two-character status column, and
// for an unstaged change the first of those characters is a space. Trimming the
// output removed it from the first line only, and took a character off that
// path with it.
const gitRaw = (...args) => execFileSync("git", args, { encoding: "utf8" });

let head;
try {
  head = git("rev-parse", "HEAD");
} catch {
  process.stderr.write("not a git repository, or git is unavailable\n");
  process.exit(1);
}

let present = true;
try {
  git("cat-file", "-e", `${tested}^{commit}`);
} catch {
  present = false;
}

// After a squash or rebase merge the tested commit is not in this history, but
// the code it held is: the digest of HEAD's code must equal the digest the
// transcript recorded, or the code has moved.
let changed;
if (present) {
  changed = head === tested
    ? []
    : git("diff", "--name-only", `${tested}..${head}`).split("\n").filter((line) => line !== "");
} else {
  const digest = TESTED_DIGEST.exec(transcript);
  if (digest === null) {
    process.stderr.write(
      `${TRANSCRIPT} names ${tested}, which is not a commit in this repository, ` +
      `and records no code tree digest to compare instead\n`,
    );
    process.exit(1);
  }
  changed = codeDigest("HEAD") === digest[1] ? [] : ["(code differs from the tested tree digest)"];
}
// An uncommitted edit to a source file makes the transcript just as stale as a
// committed one, and is the easier of the two to overlook.
const dirty = gitRaw("status", "--porcelain")
  .split("\n")
  .filter((line) => line !== "")
  // "XY path", and a rename is "XY old -> new"; the destination is what exists.
  .map((line) => line.slice(3).split(" -> ").pop());
const code = [...new Set([...changed, ...dirty])].filter((path) => !DOCUMENTATION_ONLY.test(path));

process.stdout.write(
  `transcript generated at: ${tested}\n` +
  `HEAD:                    ${head}\n` +
  `changed since, committed: ${changed.length} file(s); uncommitted now: ${dirty.length}\n` +
  `outside docs/:           ${code.length}\n` +
  (code.length === 0
    ? "the transcript still describes the code that is checked out\n"
    : `STALE — these are not documentation:\n${code.map((path) => `  ${path}\n`).join("")}`),
);
process.exit(code.length === 0 ? 0 : 1);
