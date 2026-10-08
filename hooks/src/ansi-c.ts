/**
 * Bash's `$'…'` quoting: the body with its backslash escapes decoded, and the
 * index just past the closing quote. `$'.capmap'` names `.capmap`, and
 * `$'\x2ecapmap'` does too; reading them as `$.capmap` let a write through.
 */

const SIMPLE: Record<string, string> = {
  a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t",
  v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?",
};
/** Escape letter, and the digits it takes: octal up to three, hex up to two, four or eight. */
const NUMERIC: [RegExp, number][] = [
  [/^[0-7]{1,3}/, 8],
  [/^x[0-9a-fA-F]{1,2}/, 16],
  [/^u[0-9a-fA-F]{1,4}/, 16],
  [/^U[0-9a-fA-F]{1,8}/, 16],
];
const CONTROL = /^c(.)/;
const CONTROL_MASK = 0x1f;

export function ansiC(source: string, open: number): { text: string; end: number } {
  let text = "";
  let i = open;
  while (i < source.length && source[i] !== "'") {
    if (source[i] !== "\\") {
      text += source[i];
      i += 1;
      continue;
    }
    const rest = source.slice(i + 1, i + 10);
    const simple = SIMPLE[rest[0] ?? ""];
    const numeric = NUMERIC.map(([pattern, radix]) => [pattern.exec(rest)?.[0], radix] as const)
      .find(([match]) => match !== undefined);
    const control = CONTROL.exec(rest);
    if (simple !== undefined) {
      text += simple;
      i += 2;
    } else if (numeric?.[0] !== undefined) {
      const [match, radix] = numeric;
      const digits = radix === 8 ? match : match.slice(1);
      text += String.fromCodePoint(parseInt(digits, radix));
      i += 1 + match.length;
    } else if (control?.[1] !== undefined) {
      text += String.fromCharCode(control[1].charCodeAt(0) & CONTROL_MASK);
      i += 3;
    } else {
      text += "\\";
      i += 1;
    }
  }
  return { text, end: i + 1 };
}
