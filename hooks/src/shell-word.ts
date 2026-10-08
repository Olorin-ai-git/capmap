import { ansiC } from "./ansi-c.js";

/**
 * Reading one shell word: quote removal as the shell does it, plus the word's
 * "shape" for brace expansion (see brace-expand.ts), in which every quoted
 * character is escaped so only the braces the shell would expand stay bare.
 */

export interface Cursor {
  readonly source: string;
  i: number;
  /** The first construct read whose expansion the lexer does not model, if any. */
  odd?: string;
}

export interface Word {
  text: string;
  shape: string;
  /** Any part was quoted or escaped; a heredoc delimiter then suppresses expansion. */
  quoted: boolean;
  /** Part of it is computed at run time: a parameter, a substitution, `~+`, `~user` or zsh's `=cmd`. */
  runtime: boolean;
}

const METACHARACTER = /[\s;|&<>()]/;
/** Escaped in front of the dollar, backquote, double quote, backslash and newline only. */
const DOUBLE_QUOTE_ESCAPABLE = /[$`"\\\n]/;
const SHAPE_SPECIAL = /[\\{},.$]/g;
/** After a `$`, anything but a blank may start an expansion (zsh adds `$=x`, `$~x`, `$^x`, `$+x`). */
const PARAMETER_START = /\S/;
/** A leading `~` the shell expands to something other than the home directory. */
const OTHER_TILDE = /^~[^/\s;|&<>()]/;
/** `${NAME}` alone; any operator inside the braces (`${x:-…}`, `${x/a/…}`, zsh flags) is not modelled. */
const PLAIN_PARAMETER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
/** Stands for a substitution's output, which is known only at run time. */
export const SUBSTITUTION = "$()";

/**
 * Reads the word at the cursor, stopping at a metacharacter or at `end`. Each
 * command substitution adds `$()` to the word and is handed to `nested` with the
 * cursor just past its opener. Without `nested` the word is literal text that a
 * substitution cannot appear in — a heredoc delimiter — and one is refused rather
 * than guessed, since a wrong delimiter decides which lines run. Null when the
 * cursor held only line continuations.
 */
export function readWord(
  cur: Cursor,
  end: string | null,
  nested: ((to: string) => void) | null,
): Word | null {
  const { source } = cur;
  const word: Word = { text: "", shape: "", quoted: false, runtime: false };
  let seen = false;
  const take = (text: string, quoted: boolean): void => {
    seen = true;
    word.text += text;
    word.shape += quoted ? text.replace(SHAPE_SPECIAL, "\\$&") : text;
    word.quoted ||= quoted;
  };
  const odd = (what: string): void => {
    cur.odd ??= what;
  };
  /** Expansions whose nesting or reading the lexer does not model. */
  const unmodelled = (c: string, d: string | undefined): void => {
    if (c === "`") odd("backquotes");
    else if (c === "$" && d === "(" && source[cur.i + 2] === "(") odd("arithmetic expansion");
    else if (c === "$" && d === "[") odd("arithmetic expansion");
    else if (c === "$" && d === "{" && !PLAIN_PARAMETER.test(source.slice(cur.i))) odd("a ${…} expansion with an operator");
  };
  const substitution = (to: string, opener: number): void => {
    if (nested === null) throw new Error("a heredoc delimiter holds a substitution");
    cur.i += opener;
    word.runtime = true;
    take(SUBSTITUTION, true);
    nested(to);
  };

  while (cur.i < source.length) {
    const c = source[cur.i] as string;
    const d = source[cur.i + 1];
    if (METACHARACTER.test(c) || c === end) break;
    if (nested !== null) unmodelled(c, d);
    if (!seen && (OTHER_TILDE.test(source.slice(cur.i, cur.i + 2)) || c === "=")) word.runtime = true;
    if (c === "\\") {
      if (d !== undefined && d !== "\n") take(d, true);
      cur.i += 2;
    } else if (c === "'") {
      const close = source.indexOf("'", cur.i + 1);
      const stop = close === -1 ? source.length : close;
      take(source.slice(cur.i + 1, stop), true);
      cur.i = stop + 1;
    } else if (c === "$" && d === "'") {
      const decoded = ansiC(source, cur.i + 2);
      take(decoded.text, true);
      cur.i = decoded.end;
    } else if (c === '"' || (c === "$" && d === '"')) {
      cur.i += c === "$" ? 2 : 1;
      take("", true);
      while (cur.i < source.length && source[cur.i] !== '"') {
        const q = source[cur.i] as string;
        const r = source[cur.i + 1] ?? "";
        if (nested !== null) unmodelled(q, r);
        if (q === "$" && PARAMETER_START.test(r)) word.runtime = true;
        if (q === "\\" && DOUBLE_QUOTE_ESCAPABLE.test(r)) {
          if (r !== "\n") take(r, true);
          cur.i += 2;
        } else if (q === "$" && r === "(") substitution(")", 2);
        else if (q === "`") substitution("`", 1);
        else if (q === "$" && r === "{" && nested === null) substitution("}", 2);
        else {
          take(q, true);
          cur.i += 1;
        }
      }
      cur.i += 1;
    } else if (c === "$" && (d === "(" || (d === "{" && nested === null))) substitution(")", 2);
    else if (c === "`") substitution("`", 1);
    else {
      if (c === "$" && d !== undefined && PARAMETER_START.test(d)) word.runtime = true;
      take(c, false);
      cur.i += 1;
    }
  }
  return seen ? word : null;
}

/** Reserved words whose syntax (a `case` pattern's lone `)`, zsh's `always`) the lexer does not model. */
const UNMODELLED_WORDS = new Set(["case", "esac", "select", "coproc", "foreach", "repeat", "function", "always"]);
/** Words after which the next word is again a command's first. */
const COMMAND_PREFIXES = new Set(["if", "then", "else", "elif", "while", "until", "do", "!", "{", "}", "time"]);

/**
 * Why a word read as part of a command is syntax the lexer does not model, or
 * null: an unmodelled reserved word where a command starts, or a bare `}` after
 * arguments, which zsh reads as closing a brace group and bash as an argument.
 */
export function statementProblem(word: string, before: string[]): string | null {
  const first = before.every((w) => COMMAND_PREFIXES.has(w));
  if (first && UNMODELLED_WORDS.has(word)) return `a "${word}" statement`;
  return !first && word === "}" ? "a brace that zsh reads as closing a group" : null;
}
