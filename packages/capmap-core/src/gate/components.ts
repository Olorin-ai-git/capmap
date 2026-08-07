import { createHash } from "node:crypto";

const HEADING = /^##[ \t]+Components[ \t]*$/im;
/**
 * A level-one or level-two heading closes the Components section. Deeper headings do not,
 * because their list items are still nested under Components.
 */
const NEXT_HEADING = /^#{1,2}[ \t]+/m;
const LIST_ITEM = /^\s*[-*][ \t]+(.+)$/;
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

/**
 * List items under a `## Components` heading in document order, or null when the document
 * has no such heading. Names keep their original case; normalisation is a separate step.
 */
export function extractComponentsFromMarkdown(
  markdown: string,
): string[] | null {
  const heading = HEADING.exec(markdown);
  if (heading === null) return null;

  const after = markdown.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING.exec(after);
  const section = next === null ? after : after.slice(0, next.index);

  const items: string[] = [];
  for (const line of section.split("\n")) {
    const match = LIST_ITEM.exec(line);
    if (match?.[1] === undefined) continue;
    const bold = BOLD.exec(match[1]);
    const text = bold?.[1] ?? match[1];
    const name = (text.split(DESCRIPTION_SEPARATOR)[0] ?? text).trim();
    if (name.length > 0) items.push(name);
  }
  return items;
}
