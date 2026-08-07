import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageEntry } from "../model/index-schema.js";

const MAX_EXCERPT_CHARS = 4000;

export const PACKAGE_SYSTEM_PROMPT = [
  "You summarise a software package for a reuse catalogue.",
  'Reply with JSON only: {"summary": string, "domainTags": string[]}.',
  "The summary is at most two sentences and states what the package does, not how.",
  "Choose between one and six domainTags, exclusively from the supplied vocabulary.",
].join(" ");

/**
 * Reads the head of a file for inclusion in a prompt.
 * Unreadable paths yield an empty string so prompt construction never throws.
 */
export async function excerpt(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).slice(0, MAX_EXCERPT_CHARS);
  } catch {
    return "";
  }
}

export async function buildPackagePrompt(
  entry: PackageEntry,
  repoRootAbs: string,
  vocabulary: string[],
): Promise<string> {
  const dirAbs = join(repoRootAbs, "..", entry.path);
  const readme = await excerpt(join(dirAbs, "README.md"));
  const source =
    entry.entry === null ? "" : await excerpt(join(dirAbs, entry.entry));

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
    readme === "" ? "" : `README:\n${readme}`,
    source === "" ? "" : `ENTRY FILE:\n${source}`,
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}
