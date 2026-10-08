/**
 * A lexer for the part of shell syntax that decides what a command writes.
 *
 * Words are read with the shell's quoting (shell-word.ts) and brace-expanded
 * (`p{lans,x}` is `plans` and `px`); command and process substitutions,
 * backquotes and subshells become commands of their own, and stand in their
 * word as `$()`; redirect targets are kept apart from arguments; heredoc bodies
 * are data, except the substitutions an unquoted delimiter lets the shell
 * expand. The delimiter is read with the same quoting, so `<<E\;F` ends at the
 * line `E;F`, not at `E` — reading it differently hid every line in between.
 *
 * Heredoc bodies, here-strings and pipes are kept: a shell reads its input as a
 * script. Syntax whose `)` the shell may read differently (`case` patterns, zsh
 * glob qualifiers `*(e:…:)` and flags `${(e)…}`, `=( )`, `f()`) is `unmodelled`.
 *
 * ponytail: lexical, not a shell. Expansion of `$VAR` and globs is not
 * performed; aliases and functions are the caller's concern.
 */

import { expandBraces } from "./brace-expand.js";
import { readWord, SUBSTITUTION, type Cursor } from "./shell-word.js";

export { SUBSTITUTION };

export interface Command {
  words: string[];
  /** Targets of `>`, `>>`, `>|`, `>&file`, `&>` and `<>`. */
  writes: string[];
  /** Files read through `<`. */
  reads: string[];
  /** Heredoc bodies and here-strings: what the command reads as its input. */
  input: string[];
  /** Its output is piped into the next command. */
  piped: boolean;
}

export interface Lexed {
  commands: Command[];
  /** The command uses syntax whose nesting this lexer does not model. */
  unmodelled: boolean;
}

const BLANK = /[ \t]/;
const DIGITS = /^\d+$/;
const LEADING_TABS = /^\t+/;
/** Reserved words whose syntax (a `case` pattern's lone `)`) the lexer does not model. */
const UNMODELLED_WORDS = new Set(["case", "esac", "select", "coproc", "foreach", "repeat"]);
const command = (): Command => ({ words: [], writes: [], reads: [], input: [], piped: false });

/** Splits a command line into commands of dequoted, brace-expanded words; throws past `maxWords`. */
export function lex(source: string, maxWords: number): Lexed {
  const out: Command[] = [];
  const cur: Cursor = { source, i: 0 };
  let total = 0;
  let unmodelled = false;

  /** Scans one nesting level until `end`, appending its commands to `out`. */
  function level(end: string | null): void {
    let cmd = command();
    let word: string | null = null;
    let shape = "";
    let next: "word" | "write" | "read" | "input" | "skip" = "word";
    const heredocs: { delimiter: string; expands: boolean; stripTabs: boolean; owner: Command }[] = [];

    const endWord = (): void => {
      if (word === null) return;
      const words = shape.includes("{") ? expandBraces(shape, maxWords) : [word];
      total += words.length;
      if (total > maxWords) throw new Error(`the command has over ${String(maxWords)} words`);
      if (next === "write") cmd.writes.push(...words);
      else if (next === "read") cmd.reads.push(...words);
      else if (next === "input") cmd.input.push(...words);
      else if (next === "word") cmd.words.push(...words);
      unmodelled ||= next === "word" && words.some((w) => UNMODELLED_WORDS.has(w));
      next = "word";
      word = null;
      shape = "";
    };
    const endCommand = (): void => {
      endWord();
      if ([cmd.words, cmd.writes, cmd.reads, cmd.input].some((list) => list.length > 0)) out.push(cmd);
      cmd = command();
    };
    const redirect = (kind: "write" | "read" | "input" | "skip", width: number): void => {
      if (word !== null && DIGITS.test(word)) {
        word = null;
        shape = "";
      }
      endWord();
      next = kind;
      cur.i += width;
    };
    const nested = (to: string): void => {
      word = (word ?? "") + SUBSTITUTION;
      shape += `\\$()`;
      level(to);
    };
    const bodies = (): void => {
      for (const { delimiter, expands, stripTabs, owner } of heredocs.splice(0)) {
        const start = cur.i;
        let stop = source.length;
        while (cur.i < source.length) {
          const eol = source.indexOf("\n", cur.i);
          const lineEnd = eol === -1 ? source.length : eol;
          const line = source.slice(cur.i, lineEnd);
          if ((stripTabs ? line.replace(LEADING_TABS, "") : line) === delimiter) {
            stop = cur.i;
            cur.i = lineEnd;
            break;
          }
          cur.i = lineEnd + 1;
        }
        if (expands) substitutionsIn(start, Math.min(stop, source.length));
        owner.input.push(source.slice(start, Math.min(stop, source.length)));
        if (!out.includes(owner)) out.push(owner);
      }
    };
    const substitutionsIn = (from: number, to: number): void => {
      const resume = cur.i;
      for (cur.i = from; cur.i < to; ) {
        const c = source[cur.i];
        if (c === "\\") cur.i += 2;
        else if (c === "$" && source[cur.i + 1] === "(") { cur.i += 2; level(")"); }
        else if (c === "`") { cur.i += 1; level("`"); }
        else cur.i += 1;
      }
      cur.i = resume;
    };

    while (cur.i < source.length) {
      const c = source[cur.i] as string;
      const d = source[cur.i + 1];
      const after = source[cur.i + 2] ?? "";
      if (end !== null && c === end) { cur.i += 1; break; }
      if ((c === "<" || c === ">") && d === "(") {
        cur.i += 2;
        nested(")");
      } else if (c === "(" || c === ")") {
        // A word running into `(` is zsh's glob qualifier or `=( )`, or a function.
        unmodelled ||= c === "(" && word !== null;
        endCommand();
        cur.i += 1;
        if (c === "(") level(")");
      } else if (c === "#" && word === null) {
        while (cur.i < source.length && source[cur.i] !== "\n") cur.i += 1;
      } else if (BLANK.test(c)) {
        endWord();
        cur.i += 1;
      } else if (c === "\n") {
        endCommand();
        cur.i += 1;
        bodies();
      } else if (c === "|" && d !== "|") {
        cmd.piped = true;
        endCommand();
        cur.i += d === "&" ? 2 : 1;
      } else if (c === ";" || c === "|" || (c === "&" && d !== ">")) {
        endCommand();
        cur.i += c === "|" ? 2 : 1;
      } else if (c === "&") {
        redirect("write", after === ">" ? 3 : 2);
      } else if (c === ">" && d === "&" && /[\d-]/.test(after)) {
        redirect("skip", 3);
        next = "word";
      } else if (c === ">") {
        redirect("write", d === ">" || d === "|" || d === "&" ? 2 : 1);
      } else if (c === "<" && d === "<" && after !== "<") {
        endWord();
        cur.i += after === "-" ? 3 : 2;
        while (BLANK.test(source[cur.i] ?? "")) cur.i += 1;
        const delimiter = readWord(cur, null, null);
        heredocs.push({
          delimiter: delimiter?.text ?? "",
          expands: delimiter?.quoted !== true,
          stripTabs: after === "-",
          owner: cmd,
        });
      } else if (c === "<" && d === ">") {
        redirect("write", 2);
      } else if (c === "<" && d === "&") {
        redirect("skip", 3);
        next = "word";
      } else if (c === "<") {
        redirect(d === "<" ? "input" : "read", d === "<" ? 3 : 1);
      } else {
        const read = readWord(cur, end, level);
        if (read !== null) {
          word = (word ?? "") + read.text;
          shape += read.shape;
        }
      }
    }
    endCommand();
  }

  while (cur.i < source.length) level(null);
  return { commands: out, unmodelled };
}
