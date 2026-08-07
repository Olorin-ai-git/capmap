import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoEntry } from "../config/schema.js";
import type { PackageEntry } from "../model/index-schema.js";

const MAX_EXCERPT_CHARS = 4000;

export const DOMAIN_SYSTEM_PROMPT = [
  "You group the packages of one repository into coherent capability domains",
  "for a reuse catalogue. Reply with JSON only:",
  '{"domains":[{"id":string,"title":string,"summary":string,"domainTags":string[],',
  '"packages":string[],"stack":string[],',
  '"proofOfLife":{"deployed":string|null,"testCount":number|null}}]}.',
  'Every id is "<repoId>/<kebab-case-domain>". Use only the package ids supplied.',
  "domainTags come exclusively from the supplied vocabulary, between one and six per domain.",
  "Prefer three to eight domains for a large repository, one or two for a small one.",
].join(" ");

async function excerpt(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).slice(0, MAX_EXCERPT_CHARS);
  } catch {
    return "";
  }
}

export async function buildDomainPrompt(
  repo: RepoEntry,
  repoRootAbs: string,
  packages: PackageEntry[],
  vocabulary: string[],
): Promise<string> {
  const claude = await excerpt(join(repoRootAbs, "CLAUDE.md"));
  const readme = await excerpt(join(repoRootAbs, "README.md"));
  const listed = packages
    .map(
      (p) =>
        `- ${p.id} (${p.kind}, ${p.maturity}) ${p.summary ?? "no summary available"}` +
        ` [tags: ${p.domainTags.join(", ")}] [deploy: ${p.deployTarget?.kind ?? "none"}]`,
    )
    .join("\n");

  return [
    `repository: ${repo.id} (tier ${repo.tier})`,
    `vocabulary: ${vocabulary.join(", ")}`,
    claude === "" ? "" : `CLAUDE.md:\n${claude}`,
    readme === "" ? "" : `README.md:\n${readme}`,
    `packages:\n${listed}`,
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}
