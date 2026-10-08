import type { Command } from "./shell-lex.js";
import type { Program } from "./shell-programs.js";

/**
 * Words whose value the shell computes at run time, where that value decides
 * what is written or run. The hook refuses them there rather than guess: a
 * lexer that reads `$(printf .capmap)` as the text `$()` cannot know the path,
 * and enumerating the ways to spell a path at run time never ends.
 *
 * Refused: a computed redirect target, a computed program, and a computed
 * argument of anything but a pure reader (a program that writes no file and
 * runs nothing through its arguments) or an environment builtin's value. Two
 * message options are let through, since a commit message or a PR body is
 * data however it was made: `git commit|tag|merge|stash -m` and `gh … --body`.
 */


/** Write no file and run nothing through their arguments, whatever those are. */
const PURE_READERS = new Set([
  "echo", "printf", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "ls", "stat", "pwd", "which",
  "type", "test", "[", "[[", "true", "false", "sleep", "date", "basename", "dirname", "cut", "tr", "nl",
  "seq", "expr", "read", "for", "realpath", "readlink", "cmp", "diff", "jq",
]);
/** Builtins whose arguments are assignments: a computed value is data, a computed name is not. */
const ENVIRONMENT_BUILTINS = new Set(["export", "declare", "typeset", "local", "readonly"]);
const STATIC_NAME = /^(-|[A-Za-z_][A-Za-z0-9_]*(\+?=|$))/;
const CHANGE_DIR = new Set(["cd", "pushd", "popd"]);
const MESSAGE_OPTIONS: Record<string, { commands: Set<string>; options: Set<string> }> = {
  git: { commands: new Set(["commit", "tag", "merge", "stash"]), options: new Set(["-m", "--message"]) },
  gh: { commands: new Set(["pr", "issue", "release"]), options: new Set(["--body", "-b", "--title", "-t", "--notes", "-n"]) },
};

/** Indexes of the arguments that are a message: the word after a message option. */
function messages(program: string, args: string[]): Set<number> {
  const rule = MESSAGE_OPTIONS[program];
  const at = new Set<number>();
  if (rule === undefined || !args.some((arg) => rule.commands.has(arg))) return at;
  args.forEach((arg, k) => {
    if (rule.options.has(arg)) at.add(k + 1);
  });
  return at;
}

/** Throws when the command computes at run time what it writes or runs. */
export function refuseRuntimeValues(cmd: Command, prog: Program): void {
  const runtime = (word: string): boolean => cmd.runtime.has(word);
  const computed = cmd.writes.find(runtime);
  if (computed !== undefined) throw new Error(`a redirect writes to a path computed at run time (${computed})`);
  const name = prog.program;
  if (name !== undefined && runtime(name)) throw new Error(`the program is computed at run time (${name})`);
  if (name !== undefined && CHANGE_DIR.has(name)) return;
  const bare = name !== undefined && prog.trusted && prog.assigned.length === 0;
  if (bare && PURE_READERS.has(name)) return;
  const message = bare ? messages(name, prog.args) : new Set<number>();
  prog.args.forEach((arg, k) => {
    if (!runtime(arg) || message.has(k)) return;
    // Builtins, so a tainted name resolution (`export PATH=…:$PATH`) does not change what they are.
    if (name !== undefined && ENVIRONMENT_BUILTINS.has(name) && STATIC_NAME.test(arg)) return;
    throw new Error(
      `${name ?? "the command"} is given a value computed at run time (${arg}) where it may name a path ` +
        `it writes; write the value out literally`,
    );
  });
}
