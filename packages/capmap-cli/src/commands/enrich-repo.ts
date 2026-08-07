import { join } from "node:path";
import type { RepoEntry } from "@capmap/core";
import { enrichDomains } from "@capmap/core";
import { enrichPackages } from "@capmap/core";
import type {
  DomainEntry,
  PackageEntry,
} from "@capmap/core";
import type { CommandDeps } from "../composition.js";

export interface EnrichRepoArgs {
  repo: RepoEntry;
  packages: PackageEntry[];
  scannedSha: string | null;
}

export interface EnrichedRepo {
  packages: PackageEntry[];
  domains: DomainEntry[];
}

/**
 * Run both enrichment passes over one freshly scanned repository.
 *
 * The package pass runs first because the domain pass groups packages using the
 * summaries and tags the package pass produced: grouping unenriched packages
 * would ask the model to infer capabilities from paths alone.
 */
export async function enrichRepo(
  deps: CommandDeps,
  args: EnrichRepoArgs,
): Promise<EnrichedRepo> {
  const repoRootAbs = join(deps.config.root, args.repo.path);
  const shared = {
    repoRootAbs,
    vocabulary: deps.config.vocabulary,
    model: deps.model,
    config: deps.config.scan.enrichment,
    logger: deps.logger,
  };

  const packages = await enrichPackages({ ...shared, packages: args.packages });
  const domains = await enrichDomains({
    ...shared,
    repo: args.repo,
    packages,
    scannedSha: args.scannedSha,
  });

  deps.logger.info("repository enriched", {
    repo: args.repo.id,
    packages: packages.length,
    domains: domains.length,
  });

  return { packages, domains };
}
