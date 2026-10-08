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
  excludeRepoGlobs: z.array(z.string().min(1)),
  internalScopes: z.array(z.string().min(1)).min(1),
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
    effort: z.string().min(1),
    /** Token ceiling for the one call that shortlists domains for all components. */
    selectMaxTokens: z.number().int().positive(),
    /** Token ceiling for each per-component ranking call. */
    rankMaxTokens: z.number().int().positive(),
  }),
  enrichment: z.object({
    model: z.string().min(1),
    effort: z.string().min(1),
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
    /**
     * Neither specifications nor plans, whatever the other globs say. Claude
     * Code's plan mode writes `~/.claude/plans/<slug>.md`, which no gate could
     * ever clear.
     */
    exemptGlobs: z.array(z.string().min(1)),
    /**
     * The hook blocks once it has not decided within this time. Claude Code lets a
     * write through when its own hook timeout expires, so a hook that hangs — on a
     * FIFO, say — must answer before that.
     */
    deadlineMs: z.number().int().positive(),
    /**
     * A Bash command expanding to more words than this (brace expansion multiplies
     * them) is refused rather than lexed: `{1..9999999}` would exhaust memory and
     * crash the hook, and a crash is not a block.
     */
    maxShellWords: z.number().int().positive(),
    /**
     * Paths a glob, a moved or copied directory, or a patch in a Bash command may
     * name before the command is refused rather than walked.
     */
    maxShellPaths: z.number().int().positive(),
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
