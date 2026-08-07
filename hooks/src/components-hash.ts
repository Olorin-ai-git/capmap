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
const LIST_ITEM = /^\s*[-*]\s+(.+)$/;
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

/** List items under a `## Components` heading, or null when there is none. */
export function extractComponents(markdown: string): string[] | null {
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
