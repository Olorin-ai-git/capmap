import { resolve } from "node:path";

/**
 * Paths a Bash command may write, so the gate also covers shell writes.
 *
 * A redirect such as `cat > plans/x.md <<EOF` never reached a Write/Edit-only
 * hook. Shell cannot be parsed exactly here, so this errs towards inclusion:
 * every path-like word of every segment is a candidate, except in segments that
 * start with a known read-only command and redirect nothing. The caller treats
 * each candidate as a write of unknown content.
 *
 * A `cd`/`pushd` moves the directory later segments resolve against.
 *
 * ponytail: lexical, not a shell parser. Paths built at run time (`$DIR/x.md`,
 * a subshell's own `cd`, a script file that writes) are not seen; a
 * real parser or an OS-level write guard is the upgrade if that matters.
 */

const SEGMENT_BREAK = /\|\||&&|[;|&\n]/;
/** Redirections that write nothing a gate cares about: fd duplication and the null device. */
const HARMLESS_REDIRECT = /\d*>&\d+|&>\s*\/dev\/null|\d*>>?\s*\/dev\/null/g;
const TOKEN_BREAK = /[\s'"`=(),;<>|&{}]+/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HOME_PREFIX = "~/";
const READ_ONLY = new Set([
  "cat", "less", "more", "head", "tail", "grep", "egrep", "fgrep", "rg",
  "ls", "wc", "stat", "file", "diff", "cmp", "shasum", "sha256sum", "md5",
]);
const GIT_READ_ONLY = new Set([
  "add", "blame", "diff", "grep", "log", "ls-files", "show", "status",
]);
/** `capmap` itself reads specifications and writes only its own gate records. */
const CAPMAP_COMMAND = /(^|\/)capmap$|capmap-cli\/dist\/bin\.js$/;
const WRAPPERS = new Set(["node", "npx", "pnpm", "exec", "env"]);
const CHANGE_DIR = new Set(["cd", "pushd"]);

function commandWords(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "" && !ASSIGNMENT.test(word));
}

function isReadOnly(segment: string): boolean {
  if (segment.includes(">")) return false;
  const words = commandWords(segment);
  const first = words[0]?.split("/").pop() ?? "";
  if (READ_ONLY.has(first)) return true;
  if (first === "git") return GIT_READ_ONLY.has(words[1] ?? "");
  const program = words.find((word) => !WRAPPERS.has(word)) ?? "";
  return CAPMAP_COMMAND.test(program);
}

function resolveFrom(token: string, dir: string, home: string): string {
  return token.startsWith(HOME_PREFIX)
    ? resolve(home, token.slice(HOME_PREFIX.length))
    : resolve(dir, token);
}

/** Absolute candidate paths the command could write, de-duplicated. */
export function bashTargets(command: string, cwd: string, home: string): string[] {
  const paths = new Set<string>();
  let dir = cwd;
  for (const segment of command.replace(HARMLESS_REDIRECT, " ").split(SEGMENT_BREAK)) {
    const words = commandWords(segment);
    if (CHANGE_DIR.has(words[0] ?? "") && !segment.includes(">")) {
      const to = words.find((word, index) => index > 0 && !word.startsWith("-"));
      dir = to === undefined ? home : resolveFrom(to, dir, home);
      continue;
    }
    if (isReadOnly(segment)) continue;
    for (const token of segment.split(TOKEN_BREAK)) {
      if (token === "" || token.startsWith("-")) continue;
      paths.add(resolveFrom(token, dir, home));
    }
  }
  return [...paths];
}
