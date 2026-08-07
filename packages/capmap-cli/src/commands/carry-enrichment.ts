import type { DomainEntry, IndexStore, PackageEntry } from "@capmap/core";

export interface CarriedEnrichment {
  packages: PackageEntry[];
  domains: DomainEntry[];
}

/**
 * Carry a repository's existing enrichment forward across a scan that did not
 * pay for new model calls.
 *
 * `--no-enrich` means "do not spend model calls", not "discard what previous
 * calls produced". Without this, a fast rescan silently wiped every summary,
 * every tag and the whole domain layer for the repositories it touched — and
 * because the matcher reaches packages only through domains, those packages
 * became invisible to the gate. A cheap operation that quietly degrades the
 * index is worse than an expensive one.
 *
 * Enrichment is carried by package id. A package whose id is absent from the
 * stored index is genuinely new and stays unenriched, which is honest. A
 * domain is kept only if at least one of its packages still exists, so a
 * domain cannot outlive everything it described.
 */
export async function carryEnrichment(
  store: IndexStore,
  repoId: string,
  scanned: PackageEntry[],
): Promise<CarriedEnrichment> {
  let previousPackages: PackageEntry[] = [];
  let previousDomains: DomainEntry[] = [];
  try {
    const stored = await store.readRepo(repoId);
    previousPackages = stored.packages;
    previousDomains = stored.domains;
  } catch {
    // Nothing stored for this repository yet; there is nothing to carry.
    return { packages: scanned, domains: [] };
  }

  const byId = new Map(previousPackages.map((entry) => [entry.id, entry]));
  const packages = scanned.map((entry) => {
    const previous = byId.get(entry.id);
    if (previous === undefined || previous.summary === null) return entry;
    return {
      ...entry,
      summary: previous.summary,
      domainTags: previous.domainTags,
      enrichmentFailed: previous.enrichmentFailed,
    };
  });

  const surviving = new Set(packages.map((entry) => entry.id));
  const domains = previousDomains
    .map((domain) => ({
      ...domain,
      packages: domain.packages.filter((id) => surviving.has(id)),
    }))
    .filter((domain) => domain.packages.length > 0);

  return { packages, domains };
}
