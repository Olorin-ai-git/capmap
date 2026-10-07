import { z } from "zod";
import type { DomainEntry, PackageEntry } from "../model/index-schema.js";
import { DOMAIN_SYSTEM_PROMPT, buildDomainPrompt } from "./domain-prompts.js";
import type { EnrichDomainsArgs } from "./domain-pass.js";
import { sanitiseModelText } from "./untrusted.js";


const MAX_TAGS = 6;

/** Ordered weakest to strongest; a domain reports the strongest maturity it contains. */
const MATURITY_ORDER: readonly DomainEntry["maturity"][] = [
  "archived",
  "prototype",
  "beta",
  "ga",
];

const DomainResponseSchema = z.object({
  domains: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().min(1),
      domainTags: z.array(z.string()),
      packages: z.array(z.string()),
      stack: z.array(z.string()),
      proofOfLife: z.object({
        deployed: z.string().nullable(),
        testCount: z.number().int().nonnegative().nullable(),
      }),
    }),
  ),
});

function newestCommit(packages: PackageEntry[]): string | null {
  const dates = packages
    .map((p) => p.lastCommit)
    .filter((d): d is string => d !== null)
    .sort();
  return dates.at(-1) ?? null;
}

function bestMaturity(packages: PackageEntry[]): DomainEntry["maturity"] {
  let best: DomainEntry["maturity"] = "archived";
  for (const entry of packages) {
    if (MATURITY_ORDER.indexOf(entry.maturity) > MATURITY_ORDER.indexOf(best)) {
      best = entry.maturity;
    }
  }
  return best;
}

function parseDomains(
  raw: string,
): z.infer<typeof DomainResponseSchema> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return DomainResponseSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function toDomains(
  parsed: z.infer<typeof DomainResponseSchema>,
  args: EnrichDomainsArgs,
): DomainEntry[] {
  const known = new Set(args.packages.map((p) => p.id));
  const allowed = new Set(args.vocabulary);
  const domains: DomainEntry[] = [];

  for (const candidate of parsed.domains) {
    const packages = [
      ...new Set(candidate.packages.filter((id) => known.has(id))),
    ];
    const domainTags = [
      ...new Set(candidate.domainTags.filter((t) => allowed.has(t))),
    ].slice(0, MAX_TAGS);
    if (packages.length === 0 || domainTags.length === 0) continue;
    if (sanitiseModelText(candidate.title, 1) === "" || sanitiseModelText(candidate.summary, 1) === "") continue;
    const members = args.packages.filter((p) => packages.includes(p.id));
    domains.push({
      id: candidate.id,
      repo: args.repo.id,
      tier: args.repo.tier,
      title: sanitiseModelText(candidate.title, args.config.maxSummaryChars),
      summary: sanitiseModelText(candidate.summary, args.config.maxSummaryChars),
      domainTags,
      packages,
      stack: candidate.stack,
      maturity: bestMaturity(members),
      proofOfLife: {
        ...candidate.proofOfLife,
        lastCommit: newestCommit(members),
      },
      scannedSha: args.scannedSha,
    });
  }
  return domains;
}

export async function enrichDomainChunk(
  args: EnrichDomainsArgs,
): Promise<DomainEntry[]> {
  if (args.packages.length === 0) return [];

  const user = await buildDomainPrompt(
    args.repo,
    args.repoRootAbs,
    args.packages,
    args.vocabulary,
    args.config.maxExcerptChars,
  );

  for (let attempt = 0; attempt <= args.config.maxRetries; attempt += 1) {
    // A thrown error is treated as an unusable attempt, so a remote failure
    // degrades the domain layer rather than aborting the whole refresh.
    let raw: string;
    try {
      raw = await args.model.complete({
      system: DOMAIN_SYSTEM_PROMPT,
      user,
      model: args.config.model,
      effort: args.config.effort,
      maxTokens: args.config.domainMaxTokens,
      });
    } catch (error) {
      args.logger.warn("domain enrichment call failed", {
        repo: args.repo.id,
        attempt,
        error: String(error),
      });
      continue;
    }
    const parsed = parseDomains(raw);
    if (parsed === null) {
      args.logger.warn("domain enrichment produced invalid output", {
        repo: args.repo.id,
        attempt,
      });
      continue;
    }
    return toDomains(parsed, args);
  }

  args.logger.error("domain enrichment failed after retries", {
    repo: args.repo.id,
  });
  return [];
}
