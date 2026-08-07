import type { RepoEntry } from "../config/schema.js";
import type { DomainEntry, PackageEntry } from "../model/index-schema.js";

const UNGROUPED_SUFFIX = "ungrouped";
const UNGROUPED_TITLE = "Ungrouped capabilities";
const MAX_TAGS = 6;

/**
 * Guarantee that every significant package is reachable through some domain.
 *
 * The matcher reaches packages only through shortlisted domains, so a package
 * no domain names is invisible to the gate however good a match it would be.
 * The domain pass is model-generated and does not always mention every package
 * it was shown: on the real estate this silently orphaned seven capabilities,
 * including the Bayit+ media platform, its backend, and the shared voice and
 * avatar services. A specification asking for any of them could not have been
 * matched to the code that already implements them — the exact failure this
 * tool exists to prevent, produced by its own indexing step.
 *
 * Leftovers are collected into one deterministic per-repository domain rather
 * than dropped or re-sent to the model. It is honest about what it is: these
 * packages were not grouped, and a reader can see that, but they remain
 * reachable.
 */
export function ensureDomainCoverage(args: {
  repo: RepoEntry;
  packages: PackageEntry[];
  domains: DomainEntry[];
  scannedSha: string | null;
}): DomainEntry[] {
  const covered = new Set(args.domains.flatMap((domain) => domain.packages));
  const orphans = args.packages.filter((entry) => !covered.has(entry.id));
  if (orphans.length === 0) return args.domains;

  const tags = [...new Set(orphans.flatMap((entry) => entry.domainTags))].slice(
    0,
    MAX_TAGS,
  );

  const lastCommit = orphans
    .map((entry) => entry.lastCommit)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);

  return [
    ...args.domains,
    {
      id: `${args.repo.id}/${UNGROUPED_SUFFIX}`,
      repo: args.repo.id,
      tier: args.repo.tier,
      title: UNGROUPED_TITLE,
      summary:
        `Packages in ${args.repo.id} that the domain pass did not place in a ` +
        `named domain. They are grouped here so the matcher can still reach ` +
        `them; the grouping carries no meaning beyond that.`,
      domainTags: tags.length > 0 ? tags : ["agent-runtime"],
      packages: orphans.map((entry) => entry.id).sort(),
      stack: [],
      maturity: "prototype",
      proofOfLife: {
        deployed: null,
        testCount: null,
        lastCommit: lastCommit ?? null,
      },
      scannedSha: args.scannedSha,
    },
  ];
}
