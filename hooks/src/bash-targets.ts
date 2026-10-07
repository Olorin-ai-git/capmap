import { basename, join, resolve } from "node:path";
import { lex, QUOTING } from "./shell-lex.js";

/**
 * Paths a Bash command may write, so the gate also covers shell writes.
 *
 * A redirect such as `cat > plans/x.md <<EOF` never reached a Write/Edit-only
 * hook. The command is lexed the way the shell reads it (see shell-lex.ts). Redirect
 * targets are always writes. Arguments are writes unless the command is known
 * to write nothing (`cat`, `git log`, `sed` without `-i`, `find` without
 * `-exec`) or to write only its destination (`cp`, `install`, `rsync`).
 *
 * A `cd`/`pushd` moves the directory later commands resolve against.
 *
 * ponytail: lexical, not a shell. Paths built at run time (`$DIR/x.md`, `xargs`,
 * a script file that writes) are not seen; an OS-level write guard is the
 * upgrade if that matters.
 */

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HOME_PREFIX = "~/";
const NULL_DEVICE = "/dev/null";
/** Splits a word once more, for scripts passed as one argument (`node -e`, `sh -c`). */
const PIECE_BREAK = /[\s'"`=(),;<>|&{}]+/;

/** Reserved words that may precede a command in the same segment. */
const KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "do", "done", "while", "until",
  "case", "esac", "time", "!", "{", "}", "coproc",
]);
/** Words before the program that do not name it. */
const WRAPPERS = new Set([
  "node", "npx", "pnpm", "exec", "env", "command", "nice", "nohup", "time",
  "sudo", "script",
]);
/** Write no file through their arguments. */
const READ_ONLY = new Set([
  "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "ls", "wc", "stat",
  "diff", "cmp", "shasum", "sha256sum", "md5", "echo", "printf", "pwd",
  "which", "test", "[", "true", "false", "sleep", "mkdir", "rmdir", "find", "sed",
]);
const GIT_READ_ONLY = new Set([
  "add", "blame", "branch", "cat-file", "commit", "describe", "diff", "fetch",
  "grep", "log", "ls-files", "ls-tree", "push", "rev-list", "rev-parse",
  "shortlog", "show", "show-ref", "status",
]);
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c"]);
/** Options that make a reading command write or run something. */
const WRITING_OPTION = /^--(output|pre|open-files-in-pager)(=|$)/;
const GIT_PAGER_OPTION = /^-O/;
const FIND_ACTION = /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/;
const SED_IN_PLACE = /^(-[a-zA-Z]*[iI]|--in-place)/;
const SED_WRITE_COMMAND = /(^|[;/}\s])[wW]\s/;
/** Write only their last argument (or `-t`), plus each source's name inside it. */
const DESTINATION_WRITERS = new Set(["cp", "install", "rsync", "scp", "ditto"]);
/** Every argument is affected: a moved source is removed, a linked one aliased. */
const ALL_ARGUMENT_WRITERS = new Set(["mv", "ln"]);
const TARGET_DIRECTORY = /^(-t|--target-directory)(=|$)/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "eval"]);
/** `capmap` itself reads specifications and writes only its own gate records. */
const CAPMAP_COMMAND = /(^|\/)capmap$|capmap-cli\/dist\/bin\.js$/;
const CHANGE_DIR = new Set(["cd", "pushd"]);
/** Interactive resolution is the operator's; an agent driving it clears the gate unseen. */
const OPERATOR_ONLY = [/capmap/, /\bgate\b/, /--resolve/];

function resolveFrom(token: string, dir: string, home: string): string {
  return token.startsWith(HOME_PREFIX)
    ? resolve(home, token.slice(HOME_PREFIX.length))
    : resolve(dir, token);
}

/** The words from the program onwards: keywords, assignments and wrappers dropped. */
function programWords(words: string[]): string[] {
  let start = 0;
  while (start < words.length) {
    const word = words[start] as string;
    if (KEYWORDS.has(word) || ASSIGNMENT.test(word) || WRAPPERS.has(word) || (start > 0 && word.startsWith("-"))) {
      start += 1;
    } else break;
  }
  return words.slice(start);
}

function gitIsReadOnly(args: string[]): boolean {
  let index = 0;
  while (index < args.length && (args[index] as string).startsWith("-")) {
    index += GIT_GLOBAL_WITH_VALUE.has(args[index] as string) ? 2 : 1;
  }
  return (
    GIT_READ_ONLY.has(args[index] ?? "") &&
    !args.some((arg) => WRITING_OPTION.test(arg) || GIT_PAGER_OPTION.test(arg))
  );
}

function readsOnly(name: string, args: string[]): boolean {
  if (name === "git") return gitIsReadOnly(args);
  if (!READ_ONLY.has(name)) return false;
  if (args.some((arg) => WRITING_OPTION.test(arg))) return false;
  if (name === "find") return !args.some((arg) => FIND_ACTION.test(arg));
  if (name === "sed") {
    return !args.some((arg) => SED_IN_PLACE.test(arg) || SED_WRITE_COMMAND.test(arg));
  }
  return true;
}

const positional = (args: string[]): string[] => args.filter((arg) => !arg.startsWith("-"));

/** What a destination writer writes: its destination, and each source's name inside it. */
function destinations(args: string[]): string[] {
  const flagged = args.findIndex((arg) => TARGET_DIRECTORY.test(arg));
  const plain = positional(args);
  if (flagged !== -1) {
    const option = args[flagged] as string;
    const dir = option.includes("=") ? option.slice(option.indexOf("=") + 1) : args[flagged + 1] ?? "";
    return [dir, ...plain.filter((p) => p !== dir).map((p) => join(dir, basename(p)))];
  }
  const dest = plain[plain.length - 1];
  if (dest === undefined) return [];
  return [dest, ...plain.slice(0, -1).map((source) => join(dest, basename(source)))];
}

/** Every piece of every argument, for commands whose writes cannot be told apart. */
function pieces(args: string[]): string[] {
  return args.flatMap((arg) => arg.split(PIECE_BREAK)).filter((p) => p !== "" && !p.startsWith("-"));
}

function argumentWrites(words: string[]): string[] {
  const [program, ...args] = programWords(words);
  if (program === undefined) return [];
  const name = program.split("/").pop() ?? "";
  if (CAPMAP_COMMAND.test(program) || readsOnly(name, args)) return [];
  if (DESTINATION_WRITERS.has(name)) return destinations(args);
  if (ALL_ARGUMENT_WRITERS.has(name)) return [...positional(args), ...destinations(args)];
  if (SHELLS.has(name)) {
    return lex(args.filter((arg) => arg !== "-c").join(" ")).flatMap((cmd) => [
      ...cmd.writes,
      ...argumentWrites(cmd.words),
    ]);
  }
  return pieces([program, ...args]);
}

/** Absolute candidate paths the command could write, de-duplicated. */
export function bashTargets(command: string, cwd: string, home: string): string[] {
  const paths = new Set<string>();
  let dir = cwd;
  for (const cmd of lex(command)) {
    const words = programWords(cmd.words);
    if (CHANGE_DIR.has(words[0] ?? "") && cmd.writes.length === 0) {
      const to = words.find((word, index) => index > 0 && !word.startsWith("-"));
      dir = to === undefined ? home : resolveFrom(to, dir, home);
      continue;
    }
    for (const target of [...cmd.writes, ...argumentWrites(cmd.words)]) {
      if (target !== "" && target !== NULL_DEVICE) paths.add(resolveFrom(target, dir, home));
    }
  }
  return [...paths];
}

/** True when the command runs `capmap gate --resolve`, which only an operator may answer. */
export function runsOperatorCommand(command: string): boolean {
  const flat = command.replace(QUOTING, "");
  return OPERATOR_ONLY.every((pattern) => pattern.test(flat));
}
