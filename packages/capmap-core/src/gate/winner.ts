import type { ScanConfig } from "../config/schema.js";
import type { PackageEntry, RepoIndex } from "../model/index-schema.js";
import type { PackageRanking } from "./match-parse.js";
import { STRENGTH, applyVerdict } from "./verdict.js";

export interface Located {
  entry: PackageEntry;
  tier: RepoIndex["tier"];
}

export function locate(repos: RepoIndex[], packageId: string): Located | null {
  for (const repo of repos) {
    const entry = repo.packages.find((candidate) => candidate.id === packageId);
    if (entry !== undefined) {
      return { entry, tier: repo.tier };
    }
  }
  return null;
}

/**
 * The ranking the verdict is about: the one whose tier permits the strongest
 * verdict, highest score first among equals. Ranking order alone let an
 * `external` package at 0.95 decide a component that a `core` package at 0.90
 * could satisfy outright, and the reusable one was reduced to a footnote. The
 * capped one is still reported, as a competing implementation.
 */
export function pickWinner(
  rankings: PackageRanking[],
  repos: RepoIndex[],
  thresholds: ScanConfig["verdicts"],
): PackageRanking | undefined {
  const strength = (ranking: PackageRanking): number => {
    const located = locate(repos, ranking.packageId);
    if (located === null) return STRENGTH.UNRESOLVED;
    return STRENGTH[
      applyVerdict({
        score: ranking.score,
        tier: located.tier,
        verified: true,
        thresholds,
      })
    ];
  };
  let best: PackageRanking | undefined;
  let bestStrength = Number.NEGATIVE_INFINITY;
  for (const ranking of rankings) {
    const current = strength(ranking);
    const stronger = current > bestStrength;
    const higherAmongEquals =
      current === bestStrength && best !== undefined && ranking.score > best.score;
    if (stronger || higherAmongEquals) {
      best = ranking;
      bestStrength = current;
    }
  }
  return best;
}
