import type { ScanConfig } from "../config/schema.js";
import type { PackageEntry, RepoIndex } from "../model/index-schema.js";
import type { Logger, ModelClient } from "../ports/index.js";
import {
  RANK_SYSTEM_PROMPT,
  SELECT_SYSTEM_PROMPT,
} from "./match-prompts.js";
import {
  RankingsSchema,
  SelectionSchema,
  extractJson,
  renderCatalogue,
  type PackageRanking,
} from "./match-parse.js";

/** Number of a package's exported symbols shown to the ranker. Purely a prompt-shaping slice. */
const EXPORTS_SHOWN = 12;

export interface SelectCandidatesArgs {
  components: string[];
  repos: RepoIndex[];
  model: ModelClient;
  config: ScanConfig["matching"];
  logger: Logger;
  /** Response ceiling for the single shortlist call, supplied by the caller from configuration. */
  maxTokens: number;
}

/**
 * One model call shortlists domains for every component at once. Domain ids the model
 * invents are dropped, and components the model invents are ignored, so the returned map
 * always has exactly the requested components as its keys.
 */
export async function selectCandidateDomains(
  args: SelectCandidatesArgs,
): Promise<Map<string, string[]> | null> {
  const result = new Map<string, string[]>(args.components.map((c) => [c, []]));
  if (result.size === 0) return result;

  const known = new Set(args.repos.flatMap((r) => r.domains.map((d) => d.id)));

  // A thrown call is treated as an unusable answer rather than propagated. The
  // model is a remote service that rate-limits and has outages; when it is
  // unavailable every component should fall through to BUILD with an empty
  // shortlist, which is honest, instead of the gate dying and blocking the
  // operator behind an error that has nothing to do with their specification.
  let raw: string;
  try {
    raw = await args.model.complete({
      system: SELECT_SYSTEM_PROMPT,
      user: [
        `components:\n${args.components.map((c) => `- ${c}`).join("\n")}`,
        `catalogue:\n${renderCatalogue(args.repos)}`,
        `Return at most ${args.config.maxCandidates} domains per component.`,
      ].join("\n\n"),
      model: args.config.model,
      effort: args.config.effort,
      maxTokens: args.maxTokens,
    });
  } catch (error) {
    // null rather than an empty shortlist: an unreachable model must not be
    // reported as an estate containing nothing.
    args.logger.error("candidate selection call failed", {
      components: args.components.length,
      error: String(error),
    });
    return null;
  }

  const parsed = SelectionSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    args.logger.warn("candidate selection produced invalid output", {
      components: args.components.length,
    });
    return null;
  }

  for (const selection of parsed.data.selections) {
    if (!result.has(selection.component)) continue;
    const domains = [
      ...new Set(selection.domains.filter((id) => known.has(id))),
    ].slice(0, args.config.maxCandidates);
    result.set(selection.component, domains);
  }
  return result;
}

export interface RankArgs {
  component: string;
  candidates: PackageEntry[];
  model: ModelClient;
  config: ScanConfig["matching"];
  logger: Logger;
  maxRetries: number;
  /** Response ceiling for each ranking call, supplied by the caller from configuration. */
  maxTokens: number;
}

function renderCandidates(candidates: PackageEntry[]): string {
  return candidates
    .map(
      (p) =>
        `- ${p.id} [${p.kind}, ${p.maturity}] ${p.name}: ${p.summary ?? "no summary available"}` +
        ` (exports: ${p.exports.slice(0, EXPORTS_SHOWN).join(", ")})`,
    )
    .join("\n");
}

/**
 * One model call per component ranks the packages of its shortlisted domains. A package id
 * outside the supplied candidate set is rejected and the call retried; exhausting the
 * retries yields null, which the caller reads as "nothing in the estate matched".
 */
/**
 * Rank the shortlisted packages for one component.
 *
 * Returns `[]` when the model answered and nothing matched, and `null` when it
 * could not answer at all. The distinction is the difference between "build
 * this, the estate has nothing" and "the gate does not know" — collapsing them
 * would let an outage silently green-light building a capability that already
 * exists, which is the one outcome this tool is for preventing.
 */
export async function rankPackagesForComponent(
  args: RankArgs,
): Promise<PackageRanking[] | null> {
  if (args.candidates.length === 0) return [];
  const known = new Set(args.candidates.map((p) => p.id));

  const user = [
    `component: ${args.component}`,
    `candidates:\n${renderCandidates(args.candidates)}`,
  ].join("\n\n");

  let failed = false;
  for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
    let raw: string;
    try {
      raw = await args.model.complete({
        system: RANK_SYSTEM_PROMPT,
        user,
        model: args.config.model,
        effort: args.config.effort,
        maxTokens: args.maxTokens,
      });
    } catch (error) {
      args.logger.warn("package ranking call failed", {
        component: args.component,
        attempt,
        error: String(error),
      });
      failed = true;
      continue;
    }
    const parsed = RankingsSchema.safeParse(extractJson(raw));
    if (parsed.success) {
      // Ids the model invented are dropped rather than failing the attempt: a
      // response that is right about three candidates and hallucinates a fourth
      // still carries the three.
      const seen = new Set<string>();
      const kept = parsed.data.rankings
        .filter((ranking) => known.has(ranking.packageId))
        .filter((ranking) => {
          if (seen.has(ranking.packageId)) return false;
          seen.add(ranking.packageId);
          return true;
        })
        .sort((a, b) => b.score - a.score || a.packageId.localeCompare(b.packageId));
      if (kept.length > 0) return kept;
    }
    args.logger.warn("package ranking produced an unusable result", {
      component: args.component,
      attempt,
      // Length and tail make a truncated reply obvious. Without them a reply cut
      // off by the token ceiling is indistinguishable from a refusal, which is
      // exactly how a too-small rankMaxTokens went unnoticed until a live run.
      replyLength: raw.length,
      replyTail: raw.slice(-80),
      maxTokens: args.maxTokens,
      candidates: args.candidates.length,
    });
    failed = true;
  }
  return failed ? null : [];
}
