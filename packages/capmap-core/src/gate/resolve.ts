import type { ScanConfig } from "../config/schema.js";
import type {
  CompetingImplementation,
  ComponentVerdict,
} from "../model/gate-schema.js";
import type { PackageEntry, RepoIndex } from "../model/index-schema.js";
import { verifyCapability } from "../verify/verify.js";
import type { PackageRanking } from "./match-parse.js";
import { applyVerdict } from "./verdict.js";
import { locate, pickWinner } from "./winner.js";

export { locate };

/** Every package belonging to any of the shortlisted domains. */
export function packagesForDomains(
  repos: RepoIndex[],
  domainIds: string[],
): PackageEntry[] {
  const wanted = new Set(domainIds);
  const ids = new Set(
    repos.flatMap((repo) =>
      repo.domains
        .filter((domain) => wanted.has(domain.id))
        .flatMap((domain) => domain.packages),
    ),
  );
  return repos.flatMap((repo) =>
    repo.packages.filter((entry) => ids.has(entry.id)),
  );
}

/**
 * Rivals worth reporting: implementations in a DIFFERENT repository from the
 * winner that still clear the extend threshold.
 *
 * The repository test separates duplication from structure. Two packages in one
 * repository that both match are normal layering — a service and the client
 * wrapping it. Two in different repositories are two teams having solved the
 * same problem twice, which is the finding this gate exists to surface.
 */
export function competingImplementations(
  rankings: PackageRanking[],
  winner: PackageRanking,
  repos: RepoIndex[],
  /**
   * Floor for reporting, deliberately lower than the reuse thresholds.
   * "Is this worth adopting" and "does this already exist" are different
   * questions, and answering only the first is how a second implementation
   * stays invisible.
   */
  duplicationThreshold: number,
): CompetingImplementation[] {
  const winnerRepoId = locate(repos, winner.packageId)?.entry.repo ?? null;

  return rankings
    .filter((ranking) => ranking.packageId !== winner.packageId)
    // Existence, not adoptability. A package the ranker says implements the
    // capability counts as a rival even when its score is far too low to adopt:
    // "we already built this, badly, over there" is precisely the finding this
    // catalogue exists to surface, and scoring alone hides it.
    .filter(
      (ranking) =>
        ranking.implementsIt === true || ranking.score >= duplicationThreshold,
    )
    .flatMap((ranking) => {
      const located = locate(repos, ranking.packageId);
      if (located === null || located.entry.repo === winnerRepoId) return [];
      return [
        {
          packageId: ranking.packageId,
          repo: located.entry.repo,
          score: ranking.score,
        },
      ];
    });
}

export interface ResolveComponentArgs {
  component: string;
  /** `null` means the matcher could not answer; `[]` means it found nothing. */
  rankings: PackageRanking[] | null;
  repos: RepoIndex[];
  rootAbs: string;
  thresholds: ScanConfig["verdicts"];
}

/**
 * Turn one component's rankings into a verdict, verifying the winner against
 * live source first. A verdict is only ever emitted for a capability that still
 * exists, still declares its indexed name, and still exports what the index
 * records — so a recommendation cannot outlive the code it points at.
 */
export async function resolveComponent(
  args: ResolveComponentArgs,
): Promise<ComponentVerdict> {
  // "Could not answer" must never read as "nothing exists". A BUILD verdict
  // permits construction; if the matcher was unavailable, permitting it would
  // let an outage authorise rebuilding something the estate already has, which
  // is the exact waste this gate exists to prevent. UNRESOLVED blocks, and
  // blocking is the safe direction to fail.
  if (args.rankings === null) {
    return {
      name: args.component,
      verdict: "UNRESOLVED",
      target: null,
      score: 0,
      bestCandidate: null,
      verifiedSha: null,
      failedChecks: ["matcher-unavailable"],
      competing: [],
      rationale:
        "The matcher could not be reached, so this component was never " +
        "compared against the estate. This is not evidence that nothing exists.",
    };
  }

  const winner = pickWinner(args.rankings, args.repos, args.thresholds);
  if (winner === undefined) {
    return {
      name: args.component,
      verdict: "BUILD",
      target: null,
      score: 0,
      bestCandidate: null,
      verifiedSha: null,
      failedChecks: [],
      competing: [],
      rationale: "No catalogued capability was shortlisted for this component.",
    };
  }

  const competing = competingImplementations(
    args.rankings,
    winner,
    args.repos,
    args.thresholds.duplicationThreshold,
  );

  const located = locate(args.repos, winner.packageId);
  if (located === null) {
    return {
      name: args.component,
      verdict: "UNRESOLVED",
      target: null,
      score: winner.score,
      bestCandidate: winner.packageId,
      verifiedSha: null,
      failedChecks: ["path"],
      competing,
      rationale: "The ranked capability is absent from the index.",
    };
  }

  const verification = await verifyCapability({
    entry: located.entry,
    rootAbs: args.rootAbs,
  });
  const verdict = applyVerdict({
    score: winner.score,
    tier: located.tier,
    verified: verification.ok,
    thresholds: args.thresholds,
  });
  const resolved = verdict !== "BUILD" && verdict !== "UNRESOLVED";

  return {
    name: args.component,
    verdict,
    target: resolved ? winner.packageId : null,
    score: winner.score,
    bestCandidate: winner.packageId,
    verifiedSha: verification.ok ? located.entry.scannedSha : null,
    failedChecks: verification.failed,
    competing,
    rationale: verification.ok
      ? winner.rationale
      : (verification.detail ?? winner.rationale),
  };
}
