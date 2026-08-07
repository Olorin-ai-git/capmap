import type { RepoEntry, ScanConfig } from "../config/schema.js";
import type { DomainEntry, PackageEntry } from "../model/index-schema.js";
import type { Logger, ModelClient } from "../ports/index.js";
import { chunkPackagesForDomains } from "./domain-chunks.js";
import { enrichDomainChunk } from "./domain-chunk-pass.js";
import { ensureDomainCoverage } from "./domain-coverage.js";

export interface EnrichDomainsArgs {
  repo: RepoEntry;
  packages: PackageEntry[];
  repoRootAbs: string;
  vocabulary: string[];
  model: ModelClient;
  config: ScanConfig["enrichment"];
  logger: Logger;
  scannedSha: string | null;
}


/**
 * Group a repository's packages into calls small enough to answer, then merge
 * the domains each call produced.
 *
 * Ids are de-duplicated across chunks: two chunks of one repository can
 * independently propose the same domain id, and the first one wins rather than
 * the index carrying two entries that claim to be the same thing.
 */
export async function enrichDomains(
  args: EnrichDomainsArgs,
): Promise<DomainEntry[]> {
  const chunks = chunkPackagesForDomains(
    args.packages,
    args.config.maxPackagesPerDomainCall,
  );
  if (chunks.length === 0) return [];

  const merged: DomainEntry[] = [];
  const seen = new Set<string>();
  for (const packages of chunks) {
    const domains = await enrichDomainChunk({ ...args, packages });
    for (const domain of domains) {
      if (seen.has(domain.id)) continue;
      seen.add(domain.id);
      merged.push(domain);
    }
  }

  if (merged.length === 0) {
    args.logger.warn("repository produced no domains", {
      repo: args.repo.id,
      packages: args.packages.length,
      chunks: chunks.length,
    });
  }

  // A package no domain names is invisible to the matcher, however good a match
  // it would be. The domain pass does not always mention every package it was
  // shown, so coverage is guaranteed here rather than hoped for.
  const covered = ensureDomainCoverage({
    repo: args.repo,
    packages: args.packages,
    domains: merged,
    scannedSha: args.scannedSha,
  });
  if (covered.length > merged.length) {
    args.logger.warn("packages were not grouped into any named domain", {
      repo: args.repo.id,
      ungrouped: covered[covered.length - 1]?.packages.length ?? 0,
    });
  }
  return covered;
}
