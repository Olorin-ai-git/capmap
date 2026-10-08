import { basename, join } from "node:path";

/**
 * What a command's program is, and what it writes through its arguments.
 *
 * A name decides anything only when it surely names the program the shell
 * runs: a bare name, reached through wrappers that carry no options, with no
 * assignment in front of it and nothing in the command line that changes how
 * names resolve (see `taintsNames` in bash-targets.ts). Otherwise the command
 * is unknown and every piece of every argument is a possible write.
 */

/** Reserved words that may precede a command in the same segment. */
const KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "do", "done", "while", "until",
  "case", "esac", "time", "!", "{", "}", "coproc",
]);
/** Run the rest of their words as a command. Their options are not parsed: one makes the command unknown. */
export const WRAPPERS = new Set(["exec", "env", "command", "builtin", "nice", "nohup", "time", "sudo"]);
/** Run a program found through node_modules, where a reader's name may be anything. */
const PACKAGE_RUNNERS = new Set(["npx", "pnpm"]);
export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const CONFIG_ASSIGNMENT = "CAPMAP_CONFIG_DIR=";
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
/** Global options that neither run a command nor load configuration from the command line. */
const GIT_PLAIN_GLOBAL = /^(--no-pager|-P|--no-optional-locks|--literal-pathspecs|--no-replace-objects|--bare)$/;
/** Options with which a reading git subcommand writes or runs a command of the caller's. */
const GIT_RUNS_OR_WRITES = /^(--(upload-pack|receive-pack|exec|ext-diff|textconv|output|open-files-in-pager)(=|$)|-O)/;
/** Options that make a reading command write or run something. */
const WRITING_OPTION = /^--(output|pre|open-files-in-pager)(=|$)/;
const FIND_ACTION = /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/;
const SED_IN_PLACE = /^(-[a-zA-Z]*[iI]|--in-place)/;
const SED_SCRIPT_FILE = /^(-[a-zA-Z]*f|--file)/;
/** A `w`, `W` or `e` command: after an address, a separator or a block, and before a blank or the end. */
const SED_COMMAND = /(^|[\s;{}!0-9$/,])[wWe]([\s;}]|$)/;
/** The flags of an `s` command that write (`w`) or execute (`e`). */
const SED_S_FLAGS = /s(.)(?:\\.|(?!\1)[^\\])*\1(?:\\.|(?!\1)[^\\])*\1[gpiImM0-9]*[wWe]/;
/** Write only their last argument (or `-t`), plus each source's name inside it. */
export const DESTINATION_WRITERS = new Set(["cp", "install", "rsync", "scp", "ditto"]);
/** Every argument is affected: a moved source is removed, a linked one aliased. */
export const ALL_ARGUMENT_WRITERS = new Set(["mv", "ln"]);
const TARGET_DIRECTORY = /^(-t|--target-directory)(=|$)/;
/** `capmap` itself reads specifications and writes only its own gate records; `./capmap` may be anything. */
export const CAPMAP_NAME = "capmap";
export const CAPMAP_SCRIPT = /capmap-cli\/dist\/bin\.js$/;
/** Splits a word once more, for scripts passed as one argument (`node -e`, `sh -c`). */
export const PIECE_BREAK = /[\s'"`=(),;:<>|&{}[\]]+/;
/** Characters of code rather than prose; a word with blanks and none of them is a sentence. */
export const CODE = /[(){}[\]=;'"`$<>|&\\]/;
export const BLANKS = /\s/;
const PATH_LIKE = /[./]/;

/** A cluster of single-letter options, and whatever is attached after it. */
const SHORT_OPTIONS = /^-([A-Za-z]+)(.*)$/s;

export interface Program {
  /** The program's word; undefined when a wrapper's options hide which word it is. */
  program: string | undefined;
  args: string[];
  /** Values assigned in front of it: `GIT_EXTERNAL_DIFF='cp …' git diff` runs one. */
  assigned: string[];
  /** Its name may be trusted to say what it writes. */
  trusted: boolean;
  capmap: boolean;
}

/** The program and its arguments: keywords, assignments and option-free wrappers dropped. */
export function programOf(words: string[], taint: boolean): Program {
  let viaRunner = false;
  const assigned: string[] = [];
  let k = 0;
  for (; k < words.length; k += 1) {
    const word = words[k] as string;
    // The gate's own configuration is checked where it is assigned (bash-targets.ts), not run.
    if (ASSIGNMENT.test(word)) {
      if (!word.startsWith(CONFIG_ASSIGNMENT)) assigned.push(word.slice(word.indexOf("=") + 1));
    }
    else if (WRAPPERS.has(word) || PACKAGE_RUNNERS.has(word)) {
      viaRunner ||= PACKAGE_RUNNERS.has(word);
      if (words[k + 1]?.startsWith("-") === true) {
        return { program: undefined, args: words.slice(k + 1), assigned, trusted: false, capmap: false };
      }
    } else if (!KEYWORDS.has(word)) break;
  }
  const trusted = !taint && assigned.length === 0;
  const program = words[k];
  const args = words.slice(k + 1);
  const capmap =
    !taint && program !== undefined &&
    (program === CAPMAP_NAME || (program === "node" && CAPMAP_SCRIPT.test(args[0] ?? "")));
  return { program, args, assigned, trusted: trusted && !viaRunner && !(program ?? "/").includes("/"), capmap };
}

function gitIsReadOnly(args: string[]): boolean {
  let index = 0;
  while (index < args.length && (args[index] as string).startsWith("-")) {
    const option = args[index] as string;
    if (option === "-C") index += 2;
    else if (GIT_PLAIN_GLOBAL.test(option)) index += 1;
    else return false;
  }
  return GIT_READ_ONLY.has(args[index] ?? "") && !args.slice(index + 1).some((arg) => GIT_RUNS_OR_WRITES.test(arg));
}

function sedIsReadOnly(args: string[]): boolean {
  return !args.some(
    (arg) =>
      SED_IN_PLACE.test(arg) || SED_SCRIPT_FILE.test(arg) || SED_COMMAND.test(arg) || SED_S_FLAGS.test(arg),
  );
}

export function readsOnly(name: string, args: string[]): boolean {
  if (name === "git") return gitIsReadOnly(args);
  if (!READ_ONLY.has(name)) return false;
  if (args.some((arg) => WRITING_OPTION.test(arg))) return false;
  if (name === "find") return !args.some((arg) => FIND_ACTION.test(arg));
  if (name === "sed") return sedIsReadOnly(args);
  return true;
}

/** What may follow a short option as its attached value: `-o.capmap/x` holds `.capmap/x`. */
export function attachedValues(option: string): string[] {
  const match = option.startsWith("--") ? null : SHORT_OPTIONS.exec(option);
  if (match === null) return [];
  const [, letters = "", rest = ""] = match;
  return [...letters].map((_, k) => letters.slice(k + 1) + rest).filter((value) => value !== "");
}

export const positional = (args: string[]): string[] => args.filter((arg) => !arg.startsWith("-"));

/** Each place a destination writer's destination may be: its last argument, `-t`, or an attached value. */
export function places(args: string[]): string[] {
  const flagged = args.findIndex((arg) => TARGET_DIRECTORY.test(arg));
  const option = args[flagged] ?? "";
  const named =
    flagged === -1
      ? positional(args).slice(-1)
      : [option.includes("=") ? option.slice(option.indexOf("=") + 1) : args[flagged + 1] ?? ""];
  return [...named, ...args.filter((arg) => arg.startsWith("-")).flatMap(attachedValues)];
}

/** What a destination writer writes: each place its destination may be, and each source's name inside it. */
export function destinations(args: string[]): string[] {
  const plain = positional(args);
  return places(args).flatMap((dir) => [
    dir,
    ...plain.filter((source) => source !== dir).map((source) => join(dir, basename(source))),
  ]);
}

/**
 * Every piece of every argument, for commands whose writes cannot be told apart.
 * Only path-like pieces count where the text may not be a command at all — a
 * sentence (`--body "updates plans"`), or any word when `guessing` — so prose
 * naming a guarded directory is not a write; a path in it still is.
 */
export function pieces(args: string[], guessing = false): string[] {
  return args
    .flatMap((arg) => {
      const split = arg.split(PIECE_BREAK);
      return guessing || (BLANKS.test(arg) && !CODE.test(arg)) ? split.filter((p) => PATH_LIKE.test(p)) : split;
    })
    .flatMap((piece) => (piece.startsWith("-") ? attachedValues(piece) : [piece]))
    .filter((piece) => piece !== "");
}
