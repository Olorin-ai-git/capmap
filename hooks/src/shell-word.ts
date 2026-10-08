import { ansiC } from "./ansi-c.js";

/**
 * Reading one shell word: quote removal as the shell does it, plus the word's
 * "shape" for brace expansion (see brace-expand.ts), in which every quoted
 * character is escaped so only the braces the shell would expand stay bare.
 */

export interface Cursor {
  readonly source: string;
  i: number;
}

export interface Word {
  text: string;
  shape: string;
  /** Any part was quoted or escaped; a heredoc delimiter then suppresses expansion. */
  quoted: boolean;
}

const METACHARACTER = /[\s;|&<>()]/;
/** Escaped in front of the dollar, backquote, double quote, backslash and newline only. */
const DOUBLE_QUOTE_ESCAPABLE = /[$`"\\\n]/;
const SHAPE_SPECIAL = /[\\{},.$]/g;
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
  const word: Word = { text: "", shape: "", quoted: false };
  let seen = false;
  const take = (text: string, quoted: boolean): void => {
    seen = true;
    word.text += text;
    word.shape += quoted ? text.replace(SHAPE_SPECIAL, "\\$&") : text;
    word.quoted ||= quoted;
  };
  const substitution = (to: string, opener: number): void => {
    if (nested === null) throw new Error("a heredoc delimiter holds a substitution");
    cur.i += opener;
    take(SUBSTITUTION, true);
    nested(to);
  };

  while (cur.i < source.length) {
    const c = source[cur.i] as string;
    const d = source[cur.i + 1];
    if (METACHARACTER.test(c) || c === end) break;
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
      take(c, false);
      cur.i += 1;
    }
  }
  return seen ? word : null;
}
