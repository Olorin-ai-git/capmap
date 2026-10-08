import { createHash } from "node:crypto";

const HEADING = /^##[ \t]+Components[ \t]*$/im;
/**
 * A level-one or level-two heading closes the Components section. Deeper headings do not,
 * because their list items are still nested under Components.
 */
const NEXT_HEADING = /^#{1,2}[ \t]+/m;
/** Bullet (`-`, `*`, `+`) or numbered (`1.`, `1)`) item; group 1 is the indentation. */
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.+)$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const VERDICTS_HEADING = /^##[ \t]+Reuse Verdicts[ \t]*$/im;
const TABLE_ROW = /^[ \t]*\|(.*?)\|?[ \t]*$/;
const SEPARATOR_ROW = /^[\s:|-]*-[\s:|-]*$/;
const HEADER_CELL = /^component$/i;
const VERDICT_WORDS = new Set(["REUSE", "EXTEND", "REFERENCE", "BUILD", "UNRESOLVED"]);
const BOLD = /\*\*(.+?)\*\*/;
const DESCRIPTION_SEPARATOR = /\s+[—–-]\s+|:\s+/;
const WHITESPACE_RUN = /\s+/g;
const DIGEST_ALGORITHM = "sha256";

/** Trim, lowercase, collapse internal whitespace, drop empties, de-duplicate and sort. */
export function normaliseComponents(names: string[]): string[] {
  const cleaned = names
    .map((n) => n.trim().toLowerCase().replace(WHITESPACE_RUN, " "))
    .filter((n) => n.length > 0);
  return [...new Set(cleaned)].sort();
}

/**
 * Digest of the normalised component list, so a gate record can be matched against a
 * specification that may have been reordered or re-cased but not materially changed.
 */
export function hashComponents(names: string[]): string {
  const digest = createHash(DIGEST_ALGORITHM)
    .update(JSON.stringify(normaliseComponents(names)))
    .digest("hex");
  return `${DIGEST_ALGORITHM}:${digest}`;
}

/** LF line endings, so a CRLF document reads exactly like its LF twin. */
function unixLines(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

/** The document with every fenced block removed: examples are not declarations. */
function withoutFences(markdown: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of unixLines(markdown).split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === null && marker !== undefined) fence = marker;
    else if (fence !== null && marker?.startsWith(fence) === true) fence = null;
    else if (fence === null) kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Top-level list items under a `## Components` heading in document order, or null when the
 * document has no such heading. Names keep their original case; normalisation is separate.
 * Items indented deeper than the section's shallowest item are sub-notes, not components.
 */
export function extractComponentsFromMarkdown(
  markdown: string,
): string[] | null {
  const text = withoutFences(markdown);
  const heading = HEADING.exec(text);
  if (heading === null) return null;

  const after = text.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING.exec(after);
  const section = next === null ? after : after.slice(0, next.index);

  const items: { depth: number; name: string }[] = [];
  for (const line of section.split("\n")) {
    const match = LIST_ITEM.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const bold = BOLD.exec(match[2]);
    const label = bold?.[1] ?? match[2];
    const name = (label.split(DESCRIPTION_SEPARATOR)[0] ?? label).trim();
    if (name.length > 0) items.push({ depth: match[1].length, name });
  }
  const top = Math.min(...items.map((item) => item.depth));
  return items.filter((item) => item.depth === top).map((item) => item.name);
}

/**
 * A row of the copied verdict table: its header, its separator, or a verdict of a
 * component the specification declares. Any other row — `| NEW SCOPE: … |`, or a
 * verdict for an undeclared component — is content, or scope could be added there
 * without a re-gate.
 */
function isCopiedVerdictRow(line: string, declared: Set<string>): boolean {
  const inner = TABLE_ROW.exec(line)?.[1];
  if (inner === undefined) return false;
  if (SEPARATOR_ROW.test(inner)) return true;
  const cells = inner.split("|").map((cell) => cell.trim());
  const [name = "", verdict = ""] = cells;
  if (HEADER_CELL.test(name)) return true;
  return declared.has(normaliseComponents([name])[0] ?? "") && VERDICT_WORDS.has(verdict);
}

/**
 * Digest of the specification a gate record was produced from, binding the record to that
 * content. Line endings are normalised, and the table rows of a `## Reuse Verdicts` section are excluded
 * because the reuse-gate skill copies the verdicts into the specification after gating.
 */
export function specContentHash(markdown: string): string {
  let text = unixLines(markdown);
  const heading = VERDICTS_HEADING.exec(text);
  if (heading !== null) {
    const declared = new Set(normaliseComponents(extractComponentsFromMarkdown(markdown) ?? []));
    const after = text.slice(heading.index + heading[0].length);
    const next = NEXT_HEADING.exec(after);
    // Only the copied table is exempt: any other line under the heading is
    // content, or scope could be added beneath it without a re-gate.
    const kept = (next === null ? after : after.slice(0, next.index))
      .split("\n")
      .filter((line) => line.trim() !== "" && !isCopiedVerdictRow(line, declared));
    text =
      text.slice(0, heading.index) +
      kept.map((line) => `${line}\n`).join("") +
      (next === null ? "" : after.slice(next.index));
  }
  // Trailing whitespace is not content; appending a section adds a blank line.
  const digest = createHash(DIGEST_ALGORITHM)
    .update(text.replace(/\s+$/, ""))
    .digest("hex");
  return `${DIGEST_ALGORITHM}:${digest}`;
}
