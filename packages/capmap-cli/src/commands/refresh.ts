import type { RepoEntry } from "@capmap/core";
import {
  INDEX_SCHEMA_VERSION,
  type IndexManifest,
  type RepoIndex,
} from "@capmap/core";
import { scanRepo } from "@capmap/core";
import { computeDrift } from "@capmap/core";
import type { CommandDeps } from "../composition.js";
import { enrichRepo, type EnrichedRepo } from "./enrich-repo.js";

export interface RefreshOptions {
  /** Consider only repositories whose HEAD moved away from the scanned sha. */
  stale: boolean;
  repoIds: string[] | null;
  /** Refresh the selection whether or not it drifted. */
  force: boolean;
}

type ManifestEntry = IndexManifest["repos"][number];

const EXIT_OK = 0;
const NOTHING_TO_DO = "no repositories drifted; index is up to date";
const ENRICHED_SUFFIX = ", enriched";
const UNAVAILABLE_SUFFIX = " (unavailable)";

/**
 * The repositories this run will rebuild.
 *
 * Without `--force` only drifted repositories are eligible, because rebuilding
 * a repository that has not moved would spend enrichment tokens to reproduce
 * the entries already on disk. `--stale` narrows the selection to drifted
 * repositories even under `--force`.
 */
function selectTargets(
  manifest: IndexManifest,
  opts: RefreshOptions,
  drifted: Set<string>,
): ManifestEntry[] {
  const ids = opts.repoIds;
  const selected =
    ids === null
      ? manifest.repos
      : manifest.repos.filter((repo) => ids.includes(repo.id));
  const eligible = opts.force
    ? selected
    : selected.filter((repo) => drifted.has(repo.id));
  return opts.stale
    ? eligible.filter((repo) => drifted.has(repo.id))
    : eligible;
}

function configured(deps: CommandDeps, id: string): RepoEntry | null {
  return deps.config.repos.repos.find((repo) => repo.id === id) ?? null;
}

/** Rebuild one repository's index, returning its replacement manifest entry. */
async function refreshRepo(
  deps: CommandDeps,
  repo: RepoEntry,
  previous: ManifestEntry,
): Promise<ManifestEntry> {
  const result = await scanRepo({
    rootAbs: deps.config.root,
    repo,
    allRepos: deps.config.repos.repos,
    scan: deps.config.scan,
    git: deps.git,
    clock: deps.clock,
    logger: deps.logger,
  });

  const enriched: EnrichedRepo | null = result.available
    ? await enrichRepo(deps, {
        repo,
        packages: result.packages,
        scannedSha: result.headSha,
      })
    : null;

  const index: RepoIndex = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    repo: repo.id,
    tier: repo.tier,
    domains: enriched?.domains ?? [],
    packages: enriched?.packages ?? result.packages,
    minor: result.minor,
  };
  await deps.store.writeRepo(index);

  deps.writer.line(
    `${repo.id}: ${String(index.packages.length)} packages, ` +
      `${String(index.domains.length)} domains, ` +
      `${String(index.minor.length)} minor` +
      `${enriched === null ? "" : ENRICHED_SUFFIX}` +
      `${result.available ? "" : UNAVAILABLE_SUFFIX}`,
  );

  return {
    id: repo.id,
    path: repo.path,
    tier: repo.tier,
    vcs: repo.vcs,
    available: result.available,
    scannedSha: result.headSha,
    domainCount: index.domains.length,
    packageCount: index.packages.length,
    minorCount: index.minor.length,
    enrichedAt:
      enriched === null ? previous.enrichedAt : deps.clock.now().toISOString(),
  };
}

/**
 * Bring drifted repositories back in line with their working trees.
 *
 * Scanning is deterministic and always reruns for a targeted repository;
 * enrichment reruns with it, so a refreshed repository never keeps prose
 * describing code that has since changed. Repositories outside the target set
 * keep the index and the `enrichedAt` stamp they already had.
 */
export async function runRefresh(
  deps: CommandDeps,
  opts: RefreshOptions,
): Promise<number> {
  const manifest = await deps.store.readManifest();
  const drift = await computeDrift(manifest, deps.git, deps.config.root);
  const targets = selectTargets(manifest, opts, new Set(drift.drifted));

  if (targets.length === 0) {
    deps.writer.line(NOTHING_TO_DO);
    return EXIT_OK;
  }

  const replacements = new Map<string, ManifestEntry>();
  for (const target of targets) {
    const repo = configured(deps, target.id);
    if (repo === null) {
      deps.logger.warn("indexed repository is no longer configured", {
        repo: target.id,
      });
      continue;
    }
    replacements.set(target.id, await refreshRepo(deps, repo, target));
  }

  await deps.store.writeManifest({
    schemaVersion: INDEX_SCHEMA_VERSION,
    generatedAt: deps.clock.now().toISOString(),
    root: deps.config.root,
    repos: manifest.repos.map((repo) => replacements.get(repo.id) ?? repo),
  });

  return EXIT_OK;
}
