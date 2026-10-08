import { basename } from "node:path";
import { SUBSTITUTION } from "./shell-lex.js";
import { BLANKS, CODE, positional, readsOnly } from "./shell-programs.js";

/** What a program does with the text it reads on standard input. */

/** Run commands read from standard input when given no script operand. */
export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const INTERPRETERS = new Set(["node", "python", "python3", "perl", "ruby", "php", "deno", "bun", "osascript", "lua"]);
const STDIN_OPERAND = "-";
const SHELL_STDIN_OPTION = /^-[a-zA-Z]*s/;
const XARGS = "xargs";
/** xargs options that take the next word as their value. */
const XARGS_VALUE_OPTION = /^-[IiLlnPsdEa]$/;

/** A word that may hold a script: blanks or shell syntax, beyond the stand-in for a substitution already lexed. */
export function mayBeScript(word: string): boolean {
  const own = word.split(SUBSTITUTION).join("");
  return BLANKS.test(own) || CODE.test(own);
}

/**
 * How the program treats what it reads on standard input: a shell without a
 * script operand runs it; an interpreter without one runs it as code it cannot
 * be lexed as, so only the paths in it are known; anything else reads data.
 */
function inputUse(program: string, args: string[]): "script" | "code" | "data" {
  const operands = positional(args);
  if (SHELLS.has(program)) {
    return operands.length === 0 || args.some((arg) => SHELL_STDIN_OPTION.test(arg)) ? "script" : "data";
  }
  if (INTERPRETERS.has(program) && operands.every((arg) => arg === STDIN_OPERAND)) return "code";
  return "data";
}

/**
 * Whether `xargs` hands what it reads to a program that only reads: the
 * program is its first operand, after options and their values.
 */
function xargsReadsOnly(args: string[]): boolean {
  let k = 0;
  while (k < args.length && (args[k] as string).startsWith("-")) k += XARGS_VALUE_OPTION.test(args[k] as string) ? 2 : 1;
  const inner = args[k];
  return inner === undefined || (!inner.includes("/") && readsOnly(inner, args.slice(k + 1)));
}

/** As `inputUse`, plus `paths` when the input becomes arguments of a program that may write. */
export function inputRole(program: string, args: string[]): "script" | "code" | "paths" | "data" {
  if (program === XARGS) return xargsReadsOnly(args) ? "data" : "paths";
  return inputUse(program, args);
}

/**
 * Whether piped text becomes code or arguments: a shell running it as a script,
 * or `xargs` handing it to a program that may write. What another program
 * printed is known only at run time, so the walk refuses it rather than read it.
 */
export function runsInput(prog: { program: string | undefined; args: string[]; trusted: boolean }): boolean {
  const words = [prog.program ?? "", ...prog.args];
  const at = prog.trusted ? 0 : words.findIndex((word) => SHELLS.has(basename(word)) || basename(word) === XARGS);
  if (at === -1) return false;
  const role = inputRole(basename(words[at] as string), words.slice(at + 1));
  return role === "script" || role === "paths";
}
