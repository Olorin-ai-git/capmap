import type { Command } from "./shell-lex.js";
import type { Dirs } from "./shell-dirs.js";
import { positional, programOf, type Program } from "./shell-programs.js";

/** What a command's words say about it beyond the paths it names, and the walk's shapes. */

export interface ShellContext {
  cwd: string;
  home: string;
  /** CDPATH is set where the command runs, so a relative `cd` may go anywhere. */
  cdpath: boolean;
  /** Words, after brace expansion, beyond which the command is refused. */
  maxWords: number;
  /** Paths a glob, a moved directory or a patch may name, beyond which the command is refused. */
  maxPaths: number;
  /** The gate's configuration directory, as given and resolved: capmap pointed elsewhere is refused. */
  configDirs: string[];
}

export interface BashAnalysis {
  paths: string[];
  /** The command runs `capmap gate --resolve`, which only an operator may answer. */
  operator: boolean;
}

/** One command being walked, and what it inherits from the script around it. */
export interface Step {
  script: string;
  cmd: Command;
  dirs: Dirs;
  /** Names may not say what they run. */
  taint: boolean;
  /** The script is only possibly one: only the paths in unknown programs' words count. */
  guessing: boolean;
  /** Another command's output is piped into it. */
  fed: boolean;
}


/** Variables that change which program a name runs, or what a reading program executes. */
const RESOLUTION_VARIABLE = /^(PATH|BASH_ENV|ENV|LD_\w*|DYLD_\w*|GIT_\w*|PAGER|EDITOR|VISUAL|SHELLOPTS|BASHOPTS)\+?=/;
/** Builtins that redefine names or load definitions. */
const NAME_CHANGERS = new Set(["alias", "shopt", "hash", "enable", "source", "."]);
/** `set -k` turns any `NAME=value` argument into an assignment. */
const SET_KEYWORD = /^(-[a-zA-Z]*k|keyword)$/;
const FUNCTION_DEFINITION = /(^|[\s;&|(){}`])(function[ \t]+[^\s;&|()<>]+|[^\s;&|(){}<>'"`$]+[ \t]*\([ \t]*\))/;
const GATE_WORD = "gate";
const RESOLVE_OPTION = /^--resolve(=|$)/;
const PATCH = "patch";
const GIT = "git";
const GIT_PATCHING = new Set(["apply", "am"]);
const PATCH_FILE_OPTION = /^(-i|--input)(=|$)/;

/** The script may change what a name runs: a function, an alias, `PATH`, `set -k`. */
export function taintsNames(script: string, commands: Command[]): boolean {
  if (FUNCTION_DEFINITION.test(script)) return true;
  return commands.some((cmd) => {
    const { program, args } = programOf(cmd.words, false);
    return (
      cmd.words.some((word) => RESOLUTION_VARIABLE.test(word)) ||
      NAME_CHANGERS.has(program ?? "") ||
      (program === "set" && args.some((arg) => SET_KEYWORD.test(arg)))
    );
  });
}

/** `capmap gate … --resolve` among the tokens, however a program spells them. */
export function resolves(tokens: string[]): boolean {
  const gate = tokens.indexOf(GATE_WORD);
  return gate !== -1 && tokens.slice(gate + 1).some((token) => RESOLVE_OPTION.test(token));
}

/** The patch files a `patch`, `git apply` or `git am` reads, or null when it patches nothing. */
export function patchFiles(prog: Program, cmd: Command): string[] | null {
  const { program, args } = prog;
  if (program === PATCH) {
    const named = args.flatMap((arg, k) =>
      PATCH_FILE_OPTION.test(arg) ? [arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[k + 1] ?? ""] : []);
    return [...named, ...cmd.reads];
  }
  const sub = args.findIndex((arg) => GIT_PATCHING.has(arg));
  if (program !== GIT || sub === -1) return null;
  return [...positional(args.slice(sub + 1)), ...cmd.reads];
}
