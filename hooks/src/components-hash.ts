import { createHash } from "node:crypto";

/**
 * A dependency-free mirror of the component extraction and hashing in
 * `@capmap/core`.
 *
 * The hook runs on every Write and Edit and has a 50 ms budget, so it must not
 * load the core bundle — that import would cost more than the whole decision.
 * The duplication is deliberate and is pinned by a conformance test that
 * imports both copies and asserts they agree; if they ever diverge, the hook
 * would silently start blocking on a hash the gate never writes.
 */

const DIGEST_ALGORITHM = "sha256";
const HEADING = /^##[ \t]+Components[ \t]*$/im;
/**
 * Closes the section at a level-one or level-two heading only, exactly as the
 * core extractor does. A level-three subheading groups components — "### Backend"
 * followed by more bullets — and treating it as the end of the section made the
 * two extractors disagree: the gate hashed every component, the hook hashed only
 * those above the subheading, and the hook then blocked every later write with
 * "the component set changed" on a document nobody had changed.
 */
const NEXT_HEADING = /^#{1,2}[ \t]+/m;
/** Bullet (`-`, `*`, `+`) or numbered (`1.`, `1)`) item; group 1 is the indentation. */
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.+)$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const VERDICTS_HEADING = /^##[ \t]+Reuse Verdicts[ \t]*$/im;
const TABLE_ROW = /^[ \t]*\|/;
const BOLD = /\*\*(.+?)\*\*/;
const DESCRIPTION_SEPARATOR = /\s+[—–-]\s+|:\s+/;
const WHITESPACE_RUN = /\s+/g;

export function normalise(names: string[]): string[] {
  const cleaned = names
    .map((name) => name.trim().toLowerCase().replace(WHITESPACE_RUN, " "))
    .filter((name) => name.length > 0);
  return [...new Set(cleaned)].sort();
}

export function componentsHash(names: string[]): string {
  const digest = createHash(DIGEST_ALGORITHM)
    .update(JSON.stringify(normalise(names)))
    .digest("hex");
  return `${DIGEST_ALGORITHM}:${digest}`;
}

function unixLines(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

/** Fenced blocks are examples, not declarations. */
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

/** Top-level list items under a `## Components` heading, or null when there is none. */
export function extractComponents(markdown: string): string[] | null {
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

/** Digest binding a gate record to its specification; see the core copy. */
export function specContentHash(markdown: string): string {
  let text = unixLines(markdown);
  const heading = VERDICTS_HEADING.exec(text);
  if (heading !== null) {
    const after = text.slice(heading.index + heading[0].length);
    const next = NEXT_HEADING.exec(after);
    // Only the copied table is exempt: any other line under the heading is
    // content, or scope could be added beneath it without a re-gate.
    const kept = (next === null ? after : after.slice(0, next.index))
      .split("\n")
      .filter((line) => line.trim() !== "" && !TABLE_ROW.test(line));
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
