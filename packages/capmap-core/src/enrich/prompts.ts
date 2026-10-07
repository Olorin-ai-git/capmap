import { join } from "node:path";
import type { PackageEntry } from "../model/index-schema.js";
import { UNTRUSTED_NOTICE, fence, readExcerpt } from "./untrusted.js";

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

  return [
    `name: ${entry.name}`,
    `kind: ${entry.kind}`,
    `path: ${entry.path}`,
    `exports: ${entry.exports.join(", ")}`,
    `external dependencies: ${entry.deps.external.join(", ")}`,
    `internal dependencies: ${entry.deps.internal.join(", ")}`,
    `consumers: ${entry.consumers.join(", ")}`,
    `deploy target: ${entry.deployTarget?.kind ?? "none"}`,
    `vocabulary: ${vocabulary.join(", ")}`,
    readme === "" ? "" : fence("README", readme),
    source === "" ? "" : fence("ENTRY FILE", source),
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}
