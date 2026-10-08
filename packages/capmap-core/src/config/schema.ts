import { z } from "zod";

export const RepoTierSchema = z.enum([
  "core",
  "active",
  "archived",
  "external",
]);
export type RepoTier = z.infer<typeof RepoTierSchema>;

export const VcsSchema = z.enum(["git", "none"]);
export type Vcs = z.infer<typeof VcsSchema>;

const WeightsSchema = z.object({
  publishedOrExported: z.number().min(0).max(1),
  internalConsumers: z.number().min(0).max(1),
  deployTarget: z.number().min(0).max(1),
  tests: z.number().min(0).max(1),
  readme: z.number().min(0).max(1),
  sourceSize: z.number().min(0).max(1),
  commitRecency: z.number().min(0).max(1),
});

const WEIGHT_SUM_TOLERANCE = 1e-6;

export const ScanConfigSchema = z.object({
  root: z.string().min(1).nullable(),
  excludePaths: z.array(z.string().min(1)).min(1),
  internalScopes: z.array(z.string().min(1)).min(1),
  python: z.object({
    /**
     * Levels of Python packages indexed below each import root of a project.
     * A monolith's services sit two or three levels down (`app/services/x`).
     */
    subpackageMaxDepth: z.number().int().nonnegative(),
  }),
  significance: z.object({
    threshold: z.number().min(0).max(1),
    weights: WeightsSchema.refine(
      (w) =>
        Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) <
        WEIGHT_SUM_TOLERANCE,
      { message: "significance weights must sum to 1" },
    ),
    consumerSaturation: z.number().positive(),
    locSaturation: z.number().positive(),
    recencyHalfLifeDays: z.number().positive(),
  }),
  maturity: z.object({ gaRecencyDays: z.number().positive() }),
  search: z.object({
    /**
     * Fraction of the query's terms an entry must match, before layer
     * weighting, to be a hit at all — so "nothing covers this" is answerable.
     */
    minTermOverlap: z.number().min(0).max(1),
    /**
     * Shortest token that may earn substring credit. Without it "a" or "op"
     * matched inside every longer word and every query returned something.
     */
    minPartialTermLength: z.number().int().positive(),
    /** Query words shorter than this ("a", "x") carry no meaning and are ignored. */
    minQueryTermLength: z.number().int().positive(),
    /**
     * Query words that carry no meaning ("for", "the", "via"). They are dropped
     * before matching, so they neither match every summary nor count against
     * the floor. Lower case; the list is the query language's.
     */
    stopwords: z.array(z.string()),
  }),
  verdicts: z
    .object({
      reuseThreshold: z.number().min(0).max(1),
      extendThreshold: z.number().min(0).max(1),
      /**
       * Floor for REPORTING a rival implementation, deliberately below
       * extendThreshold. Whether a capability is worth adopting and whether it
       * exists are different questions: an implementation scoring 0.4 is a poor
       * fit but still a second implementation, and staying silent about it is
       * exactly the blindness this catalogue exists to remove.
       */
      duplicationThreshold: z.number().min(0).max(1),
    })
    .refine((v) => v.reuseThreshold > v.extendThreshold, {
      message: "reuseThreshold must exceed extendThreshold",
    }),
  matching: z.object({
    maxCandidates: z.number().int().positive(),
    model: z.string().min(1),
    /** Token ceiling for the one call that shortlists domains for all components. */
    selectMaxTokens: z.number().int().positive(),
    /** Token ceiling for each per-component ranking call. */
    rankMaxTokens: z.number().int().positive(),
    /** Longest ranking rationale kept; it is printed and stored. */
    maxRationaleChars: z.number().int().positive(),
  }),
  enrichment: z.object({
    model: z.string().min(1),
    maxRetries: z.number().int().nonnegative(),
    concurrency: z.number().int().positive(),
    /** Response ceiling for one package summary. */
    packageMaxTokens: z.number().int().positive(),
    /** Response ceiling for one domain-grouping call. */
    domainMaxTokens: z.number().int().positive(),
    /**
     * Packages described in a single domain call. Too many and the reply is
     * truncated and parses as invalid, which is how the largest repository in
     * the estate once ended up with no domains at all.
     */
    maxPackagesPerDomainCall: z.number().int().positive(),
    /** Characters of each README, CLAUDE.md or entry file shown to the model. */
    maxExcerptChars: z.number().int().positive(),
    /** Longest package or domain summary or title stored in the index. */
    maxSummaryChars: z.number().int().positive(),
  }),
  hook: z.object({
    /**
     * Specifications. Creating one is allowed without a gate record, because a
     * specification cannot be gated before it has content.
     */
    specGlobs: z.array(z.string().min(1)).min(1),
    /**
     * Plans. Creating one is NEVER allowed without a resolved gate record: a
     * plan is downstream of a gated specification by definition, and allowing
     * first creation let a caller write an entire implementation plan in a
     * single Write and bypass the gate completely.
     */
    planGlobs: z.array(z.string().min(1)).min(1),
  }),
  index: z.object({ dir: z.string().min(1) }),
  expectedCounts: z.object({
    domainsMin: z.number().int().nonnegative(),
    domainsMax: z.number().int().positive(),
    packagesMin: z.number().int().nonnegative(),
    packagesMax: z.number().int().positive(),
  }),
});
export type ScanConfig = z.infer<typeof ScanConfigSchema>;

export const RepoEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  path: z.string().min(1),
  tier: RepoTierSchema,
  vcs: VcsSchema,
});
export type RepoEntry = z.infer<typeof RepoEntrySchema>;

export const ReposConfigSchema = z
  .object({
    repos: z.array(RepoEntrySchema).min(1),
  })
  .refine((c) => new Set(c.repos.map((r) => r.id)).size === c.repos.length, {
    message: "repo ids must be unique",
  });
export type ReposConfig = z.infer<typeof ReposConfigSchema>;

export const VocabularySchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
});
