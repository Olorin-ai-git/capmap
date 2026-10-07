/**
 * A lexer for the part of shell syntax that decides what a command writes.
 *
 * Quotes and escapes are removed (`pl""ans` is `plans`); command and process
 * substitutions, backquotes and subshells become commands of their own;
 * redirect targets are kept apart from arguments; heredoc bodies are data,
 * except the substitutions an unquoted delimiter lets the shell expand.
 *
 * ponytail: lexical, not a shell. Expansion of `$VAR`, globs, aliases and
 * functions is not performed.
 */

export interface Command {
  words: string[];
  /** Targets of `>`, `>>`, `>|`, `>&file`, `&>` and `<>`. */
  writes: string[];
}

const BLANK = /[ \t]/;
const DIGITS = /^\d+$/;
export const QUOTING = /["'\\]/g;

/** Splits a command line into commands of dequoted words. */
export function lex(source: string): Command[] {
  const out: Command[] = [];
  let i = 0;

  /** Scans one nesting level until `end`, appending its commands to `out`. */
  function level(end: string | null): void {
    let cmd: Command = { words: [], writes: [] };
    let word: string | null = null;
    let next: "word" | "write" | "skip" = "word";
    const heredocs: { delimiter: string; expands: boolean }[] = [];

    const endWord = (): void => {
      if (word === null) return;
      if (next === "write") cmd.writes.push(word);
      else if (next === "word") cmd.words.push(word);
      next = "word";
      word = null;
    };
    const endCommand = (): void => {
      endWord();
      if (cmd.words.length > 0 || cmd.writes.length > 0) out.push(cmd);
      cmd = { words: [], writes: [] };
    };
    const redirect = (kind: "write" | "skip"): void => {
      if (word !== null && DIGITS.test(word)) word = null;
      endWord();
      next = kind;
    };
    const nested = (to: string): void => {
      word ??= "";
      level(to);
    };
    const bodies = (): void => {
      for (const { delimiter, expands } of heredocs.splice(0)) {
        const start = i;
        let stop = source.length;
        while (i < source.length) {
          const eol = source.indexOf("\n", i);
          const lineEnd = eol === -1 ? source.length : eol;
          if (source.slice(i, lineEnd).replace(/^\t+/, "") === delimiter) {
            stop = i;
            i = lineEnd;
            break;
          }
          i = lineEnd + 1;
        }
        if (expands) substitutionsIn(start, Math.min(stop, source.length));
      }
    };
    const substitutionsIn = (from: number, to: number): void => {
      const resume = i;
      for (i = from; i < to; ) {
        const c = source[i];
        if (c === "\\") i += 2;
        else if (c === "$" && source[i + 1] === "(") { i += 2; level(")"); }
        else if (c === "`") { i += 1; level("`"); }
        else i += 1;
      }
      i = resume;
    };

    while (i < source.length) {
      const c = source[i] as string;
      const d = source[i + 1];
      if (end !== null && c === end) { i += 1; break; }
      if (c === "\\") {
        if (d !== "\n" && d !== undefined) word = (word ?? "") + d;
        i += 2;
      } else if (c === "'") {
        const close = source.indexOf("'", i + 1);
        const stop = close === -1 ? source.length : close;
        word = (word ?? "") + source.slice(i + 1, stop);
        i = stop + 1;
      } else if (c === '"') {
        word ??= "";
        i += 1;
        while (i < source.length && source[i] !== '"') {
          const q = source[i] as string;
          if (q === "\\" && i + 1 < source.length) { word += source[i + 1]; i += 2; }
          else if (q === "$" && source[i + 1] === "(") { i += 2; nested(")"); }
          else if (q === "`") { i += 1; nested("`"); }
          else { word += q; i += 1; }
        }
        i += 1;
      } else if (c === "$" && d === "(") {
        i += 2;
        nested(")");
      } else if (c === "`") {
        i += 1;
        nested("`");
      } else if ((c === "<" || c === ">") && d === "(") {
        i += 2;
        nested(")");
      } else if (c === "(") {
        endCommand();
        i += 1;
        level(")");
      } else if (c === ")") {
        endCommand();
        i += 1;
      } else if (c === "#" && word === null) {
        while (i < source.length && source[i] !== "\n") i += 1;
      } else if (BLANK.test(c)) {
        endWord();
        i += 1;
      } else if (c === "\n") {
        endCommand();
        i += 1;
        bodies();
      } else if (c === ";" || c === "|") {
        endCommand();
        i += 1;
      } else if (c === "&" && d === ">") {
        redirect("write");
        i += source[i + 2] === ">" ? 3 : 2;
      } else if (c === "&") {
        endCommand();
        i += 1;
      } else if (c === ">") {
        const after = source[i + 1];
        if (after === "&" && /[\d-]/.test(source[i + 2] ?? "")) {
          redirect("skip");
          next = "word";
          i += 3;
        } else {
          redirect("write");
          i += after === ">" || after === "|" || after === "&" ? 2 : 1;
        }
      } else if (c === "<") {
        if (d === "<" && source[i + 2] === "<") {
          redirect("skip");
          i += 3;
        } else if (d === "<") {
          endWord();
          i += source[i + 2] === "-" ? 3 : 2;
          while (BLANK.test(source[i] ?? "")) i += 1;
          const from = i;
          while (i < source.length && !/[\s;|&<>()]/.test(source[i] as string)) i += 1;
          const raw = source.slice(from, i);
          heredocs.push({ delimiter: raw.replace(QUOTING, ""), expands: raw === raw.replace(QUOTING, "") });
        } else if (d === ">") {
          redirect("write");
          i += 2;
        } else if (d === "&") {
          redirect("skip");
          next = "word";
          i += 3;
        } else {
          redirect("skip");
          i += 1;
        }
      } else {
        word = (word ?? "") + c;
        i += 1;
      }
    }
    endCommand();
  }

  while (i < source.length) level(null);
  return out;
}
