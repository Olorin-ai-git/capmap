import { join } from "node:path";
import type { RepoEntry } from "../config/schema.js";
import type { PackageEntry } from "../model/index-schema.js";
import { UNTRUSTED_NOTICE, fence, readExcerpt } from "./untrusted.js";

export const DOMAIN_SYSTEM_PROMPT = [
  "You group the packages of one repository into coherent capability domains",
  "for a reuse catalogue. Reply with JSON only:",
  '{"domains":[{"id":string,"title":string,"summary":string,"domainTags":string[],',
  '"packages":string[],"stack":string[],',
  '"proofOfLife":{"deployed":string|null,"testCount":number|null}}]}.',
  'Every id is "<repoId>/<kebab-case-domain>". Use only the package ids supplied.',
  "domainTags come exclusively from the supplied vocabulary, between one and six per domain.",
  "Prefer three to eight domains for a large repository, one or two for a small one.",
  UNTRUSTED_NOTICE,
].join(" ");

export async function buildDomainPrompt(
  repo: RepoEntry,
  repoRootAbs: string,
  packages: PackageEntry[],
  vocabulary: string[],
  maxExcerptChars: number,
): Promise<string> {
  const claude = await readExcerpt(repoRootAbs, join(repoRootAbs, "CLAUDE.md"), maxExcerptChars);
  const readme = await readExcerpt(repoRootAbs, join(repoRootAbs, "README.md"), maxExcerptChars);
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
    claude === "" ? "" : fence("CLAUDE.md", claude),
    readme === "" ? "" : fence("README.md", readme),
    `packages:\n${fence("PACKAGES", listed)}`,
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}
