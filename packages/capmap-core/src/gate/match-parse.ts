import { z } from "zod";
import type { RepoIndex } from "../model/index-schema.js";

/**
 * Response shapes for the two matching calls, the tolerant JSON reader that
 * feeds them, and the catalogue rendering they share. Kept apart from the
 * matcher so parsing can be revised without touching call sequencing.
 */

export const SelectionSchema = z.object({
  selections: z.array(
    z.object({
      component: z.string(),
      domains: z.array(z.string()),
    }),
  ),
});

export const RankingSchema = z.object({
  packageId: z.string().min(1),
  /** Adoptability: how usable this package is for the component as it stands. */
  score: z.number().min(0).max(1),
  /**
   * Existence: whether this package already implements the capability at all,
   * regardless of how adoptable it is. Defaults from the score for a model that
   * omits it, so an older reply still parses.
   */
  implementsIt: z.boolean().optional(),
  rationale: z.string().min(1),
});

export const RankingsSchema = z.object({
  rankings: z.array(RankingSchema),
});

export interface PackageRanking {
  packageId: string;
  score: number;
  implementsIt?: boolean | undefined;
  rationale: string;
}

/**
 * Read the first complete JSON object out of a reply, tolerating any prose the
 * model wrapped around it. Returns null rather than throwing, so an unusable
 * reply is handled on the same path as a refused call.
 */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The entire domain layer, verbatim. There is no embedding step and no vector
 * store: the catalogue is small enough to sit in one prompt, which keeps
 * shortlisting auditable — you can read exactly what the model was shown.
 */
export function renderCatalogue(repos: RepoIndex[]): string {
  return repos
    .flatMap((repo) =>
      repo.domains.map(
        (domain) =>
          `- ${domain.id} [tier ${domain.tier}, ${domain.maturity}] ` +
          `${domain.title}: ${domain.summary}` +
          ` (tags: ${domain.domainTags.join(", ")}; ` +
          `stack: ${domain.stack.join(", ")})`,
      ),
    )
    .join("\n");
}
