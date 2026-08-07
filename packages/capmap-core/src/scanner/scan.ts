import { access } from "node:fs/promises";
import { join } from "node:path";
import type { RepoEntry, ScanConfig } from "../config/schema.js";
import type { MinorEntry, PackageEntry } from "../model/index-schema.js";
import type { Clock, Git, Logger } from "../ports/index.js";
import { buildConsumerIndex } from "./consumers.js";
import { nestedRepoPaths } from "./discover.js";
import {
  exposesEntryPoint,
  reclassifyInternalDeps,
} from "./internal-deps.js";
import {
  scoreSignificance,
  type SignificanceBreakdown,
} from "./significance.js";
import { buildUnits } from "./unit.js";
import { gatherFacts, toPackageEntry } from "./unit-facts.js";

export interface ScanRepoArgs {
  rootAbs: string;
  repo: RepoEntry;
  /**
   * Every configured repository, so that repositories nested inside this one
   * can be pruned from its walk. Omitting it scans `repo` as if nothing were
   * nested inside it, which is correct only when nothing is.
   */
  allRepos?: RepoEntry[];
  scan: ScanConfig;
  git: Git;
  clock: Clock;
  logger: Logger;
}

export interface RepoScanResult {
  repo: RepoEntry;
  available: boolean;
  headSha: string | null;
  packages: PackageEntry[];
  minor: MinorEntry[];
  breakdowns: Map<string, SignificanceBreakdown>;
}

const GIT_VCS = "git";

function unavailable(args: ScanRepoArgs): RepoScanResult {
  args.logger.warn("repository path unavailable", {
    repo: args.repo.id,
    path: args.repo.path,
  });
  return {
    repo: args.repo,
    available: false,
    headSha: null,
    packages: [],
    minor: [],
    breakdowns: new Map(),
  };
}

/**
 * Scan one repository into a two-tier result: packages that clear the
 * configured significance threshold, and minor entries for everything else —
 * including every unit whose manifest failed to parse, so that a broken
 * manifest is recorded rather than silently dropped.
 *
 * Entries emerge unenriched: `summary` is null, `domainTags` empty and
 * `enrichmentFailed` false. A later enrichment pass fills them in.
 */
export async function scanRepo(args: ScanRepoArgs): Promise<RepoScanResult> {
  const repoRootAbs = join(args.rootAbs, args.repo.path);
  try {
    await access(repoRootAbs);
  } catch {
    return unavailable(args);
  }

  const isGit = args.repo.vcs === GIT_VCS;
  const headSha = isGit ? await args.git.headSha(repoRootAbs) : null;
  const discovered = await buildUnits({
    rootAbs: args.rootAbs,
    repo: args.repo,
    internalScopes: args.scan.internalScopes,
    excludePaths: args.scan.excludePaths,
    nestedRepoPaths: nestedRepoPaths(args.repo, args.allRepos ?? [args.repo]),
  });
  // Configured scopes cannot know every repository's own naming convention, so
  // an edge naming a package found in this same scan is promoted to internal
  // whatever it is called. Without this, an unlisted scope zeroes the
  // internalConsumers signal for a whole repository at once.
  const units = reclassifyInternalDeps(discovered);
  // Consumers are resolved across the whole repository before scoring, because
  // a package's significance depends on who depends on it.
  const consumerIndex = buildConsumerIndex(
    units.map((unit) => ({
      id: unit.id,
      name: unit.manifest.name,
      relPath: unit.candidate.relPath,
      internalDeps: unit.manifest.deps.internal,
    })),
  );
  if (consumerIndex.ambiguousNames.size > 0) {
    args.logger.warn("package names declared more than once in this repository", {
      repo: args.repo.id,
      names: [...consumerIndex.ambiguousNames].sort(),
    });
  }

  const packages: PackageEntry[] = [];
  const minor: MinorEntry[] = [];
  const breakdowns = new Map<string, SignificanceBreakdown>();
  const now = args.clock.now();

  for (const unit of units) {
    const facts = await gatherFacts({
      unit,
      repoPath: args.repo.path,
      repoRootAbs,
      excludePaths: args.scan.excludePaths,
      git: args.git,
      isGit,
    });
    const consumers = consumerIndex.byId.get(unit.id) ?? [];
    const breakdown = scoreSignificance(
      {
        publishedOrExported: exposesEntryPoint(unit.manifest),
        consumerCount: consumers.length,
        hasDeployTarget: facts.deployTarget !== null,
        hasTests: facts.hasTests,
        hasReadme: facts.metrics.hasReadme,
        loc: facts.metrics.loc,
        lastCommit: facts.lastCommit,
      },
      args.scan.significance,
      now,
    );
    breakdowns.set(unit.id, breakdown);

    if (
      unit.manifest.parseError !== null ||
      breakdown.total < args.scan.significance.threshold
    ) {
      args.logger.debug("unit demoted to minor", {
        id: unit.id,
        path: facts.path,
      });
      minor.push({
        id: unit.id,
        path: facts.path,
        kind: unit.manifest.kind,
        significance: breakdown.total,
        parseError: unit.manifest.parseError,
      });
      continue;
    }

    packages.push(
      toPackageEntry(unit, facts, {
        repo: args.repo,
        consumers,
        significance: breakdown.total,
        headSha,
        now,
        gaRecencyDays: args.scan.maturity.gaRecencyDays,
      }),
    );
  }

  args.logger.info("repository scanned", {
    repo: args.repo.id,
    packages: packages.length,
    minor: minor.length,
  });

  return {
    repo: args.repo,
    available: true,
    headSha,
    packages,
    minor,
    breakdowns,
  };
}
