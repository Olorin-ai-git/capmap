import { join } from "node:path";
import type { PackageEntry } from "../model/index-schema.js";
import { UNTRUSTED_NOTICE, fence, readExcerpt, sanitiseModelText } from "./untrusted.js";

export const PACKAGE_SYSTEM_PROMPT = [
  "You summarise a software package for a reuse catalogue.",
  'Reply with JSON only: {"summary": string, "domainTags": string[]}.',
  "The summary is at most two sentences and states what the package does, not how.",
  "Choose between one and six domainTags, exclusively from the supplied vocabulary.",
  UNTRUSTED_NOTICE,
].join(" ");

export async function buildPackagePrompt(
  entry: PackageEntry,
  repoRootAbs: string,
  vocabulary: string[],
  maxExcerptChars: number,
): Promise<string> {
  const dirAbs = join(repoRootAbs, "..", entry.path);
  const readme = await readExcerpt(repoRootAbs, join(dirAbs, "README.md"), maxExcerptChars);
  const source =
    entry.entry === null
      ? ""
      : await readExcerpt(repoRootAbs, join(dirAbs, entry.entry), maxExcerptChars);

  // Names, paths, exports and dependency names are arbitrary strings from the
  // scanned repository, so they are data like the README: each flattened to one
  // line, the block capped, and fenced.
  const manifest = (
    [
      ["name", entry.name],
      ["path", entry.path],
      ["exports", entry.exports.join(", ")],
      ["external dependencies", entry.deps.external.join(", ")],
      ["internal dependencies", entry.deps.internal.join(", ")],
      ["consumers", entry.consumers.join(", ")],
    ] as const
  )
    .map(([label, value]) => `${label}: ${sanitiseModelText(value, maxExcerptChars)}`)
    .join("\n")
    .slice(0, maxExcerptChars);

  return [
    `kind: ${entry.kind}`,
    `deploy target: ${entry.deployTarget?.kind ?? "none"}`,
    `vocabulary: ${vocabulary.join(", ")}`,
    fence("MANIFEST", manifest),
    readme === "" ? "" : fence("README", readme),
    source === "" ? "" : fence("ENTRY FILE", source),
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}
