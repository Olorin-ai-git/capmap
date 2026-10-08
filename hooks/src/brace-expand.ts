/**
 * Bash brace expansion over a word's "shape": the word with every quoted or
 * escaped character preceded by a backslash, so only the braces, commas and
 * dots the shell would act on are bare. `.c{apmap,x}` names `.capmap`, and
 * `.c{a..a}pmap` does too; matching the literal text let both writes through.
 *
 * `${…}` is a parameter expansion, not a brace expansion, and is copied whole.
 */

const SEQUENCE = /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(?:\.\.(-?\d+))?$/;
const ZERO_PADDED = /^-?0\d/;

/** The index of the `}` closing the `{` at `open`, and its top-level commas; null when unclosed. */
function scan(shape: string, open: number): { close: number; commas: number[] } | null {
  let depth = 0;
  const commas: number[] = [];
  for (let j = open + 1; j < shape.length; j += 1) {
    const c = shape[j];
    if (c === "\\" || (c === "$" && shape[j + 1] === "{")) {
      // An escape skips the next character; `${` opens a level that `}` closes.
      if (c === "$") depth += 1;
      j += 1;
    } else if (c === "{") depth += 1;
    else if (c === "}" && depth === 0) return { close: j, commas };
    else if (c === "}") depth -= 1;
    else if (c === "," && depth === 0) commas.push(j);
  }
  return null;
}

/** `{1..3}`, `{01..10..3}` or `{a..e}`; null when the body is no sequence. */
function sequence(body: string, limit: number): string[] | null {
  const match = SEQUENCE.exec(body);
  if (match === null) return null;
  const [, from = "", to = "", by] = match;
  const numeric = /\d/.test(from) && /\d/.test(to);
  if (!numeric && (/\d/.test(from) || /\d/.test(to))) return null;
  const start = numeric ? Number(from) : from.charCodeAt(0);
  const end = numeric ? Number(to) : to.charCodeAt(0);
  const step = Math.abs(Number(by ?? 1)) || 1;
  if (Math.abs(end - start) / step >= limit) throw new Error(`a brace expansion yields over ${String(limit)} words`);
  const width = numeric && (ZERO_PADDED.test(from) || ZERO_PADDED.test(to)) ? Math.max(from.length, to.length) : 0;
  const out: string[] = [];
  for (let n = start; start <= end ? n <= end : n >= end; n += start <= end ? step : -step) {
    out.push(numeric ? String(n).padStart(width, "0") : String.fromCharCode(n));
  }
  return out;
}

const unescape = (shape: string): string => shape.replace(/\\(.)/gs, "$1");

/** Re-escapes literal text produced by a sequence so it is not expanded again. */
const literal = (text: string): string => text.replace(/[\\{},.$]/g, "\\$&");

function expand(shape: string, limit: number, count: { words: number }): string[] {
  for (let i = 0; i < shape.length; i += 1) {
    const c = shape[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "$" && shape[i + 1] === "{") {
      const end = scan(shape, i + 1);
      if (end !== null) i = end.close;
      continue;
    }
    if (c !== "{") continue;
    const found = scan(shape, i);
    if (found === null) continue;
    const body = shape.slice(i + 1, found.close);
    const bounds = [i, ...found.commas, found.close];
    const alternatives =
      found.commas.length > 0
        ? bounds.slice(1).map((stop, k) => shape.slice((bounds[k] as number) + 1, stop))
        : sequence(unescape(body), limit)?.map(literal);
    if (alternatives === undefined) continue;
    const before = shape.slice(0, i);
    const after = shape.slice(found.close + 1);
    return alternatives.flatMap((alternative) => expand(before + alternative + after, limit, count));
  }
  count.words += 1;
  if (count.words > limit) throw new Error(`a brace expansion yields over ${String(limit)} words`);
  return [unescape(shape)];
}

/** The words a shape expands to; throws past `limit` words, so the hook fails closed. */
export function expandBraces(shape: string, limit: number): string[] {
  return expand(shape, limit, { words: 0 });
}
