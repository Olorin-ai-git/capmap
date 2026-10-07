import type { RepoTier, ScanConfig } from "../config/schema.js";
import type { Verdict } from "../model/gate-schema.js";

/**
 * The strongest verdict a capability from each tier may ever receive.
 *
 * This is a policy boundary, not a tunable: `archived` and `external` capabilities
 * are owned elsewhere or deliberately retired, so they may be read for reference
 * but never imported. It is intentionally not sourced from configuration, because
 * a configurable intellectual-property boundary is not a boundary.
 */
export const TIER_CAP: Record<RepoTier, Verdict> = {
  core: "REUSE",
  active: "REUSE",
  archived: "REFERENCE",
  external: "REFERENCE",
};

/** Relative ordering used to clamp a scored verdict down to a cap. */
export const STRENGTH: Record<Verdict, number> = {
  UNRESOLVED: -1,
  BUILD: 0,
  REFERENCE: 1,
  EXTEND: 2,
  REUSE: 3,
};

export interface ApplyVerdictArgs {
  score: number;
  tier: RepoTier;
  verified: boolean;
  thresholds: ScanConfig["verdicts"];
}

/**
 * The single choke point every verdict passes through.
 *
 * Order is load-bearing: a failed verification short-circuits to UNRESOLVED before
 * any score is read, and the tier cap is applied after scoring so that no score,
 * however high, can lift a capability above what its tier permits.
 */
export function applyVerdict(args: ApplyVerdictArgs): Verdict {
  if (!args.verified) return "UNRESOLVED";

  const raw: Verdict =
    args.score >= args.thresholds.reuseThreshold
      ? "REUSE"
      : args.score >= args.thresholds.extendThreshold
        ? "EXTEND"
        : "BUILD";

  const cap: Verdict = TIER_CAP[args.tier];
  return STRENGTH[raw] > STRENGTH[cap] ? cap : raw;
}
