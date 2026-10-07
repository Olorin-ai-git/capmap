import type { RepoEntry } from "@capmap/core";
import {
  INDEX_SCHEMA_VERSION,
  type IndexManifest,
  type RepoIndex,
} from "@capmap/core";
import { scanRepo } from "@capmap/core";
import type { CommandDeps } from "../composition.js";
import { renderExplain } from "../render/explain.js";
import { enrichRepo, type EnrichedRepo } from "./enrich-repo.js";
import { carryEnrichment } from "./carry-enrichment.js";
import {
  mergeManifestRepos,
  shouldEnrich,
  warnOutsideBand,
} from "./scan-report.js";

export interface ScanOptions {
  repoIds: string[] | null;
  dryRun: boolean;
  explain: boolean;
  /** Model-backed enrichment; on unless the caller passed `--no-enrich`. */
  enrich?: boolean;
  /** Re-enrich even a repository whose HEAD has not moved. */
  force?: boolean;
}

const EXIT_OK = 0;
const UNAVAILABLE_SUFFIX = " (unavailable)";
const ENRICHED_SUFFIX = ", enriched";

function select(deps: CommandDeps, repoIds: string[] | null): RepoEntry[] {
  const all = deps.config.repos.repos;
  if (repoIds === null) return all;
  const known = new Set(all.map((repo) => repo.id));
  for (const id of repoIds) {
    if (!known.has(id))
      deps.logger.warn("no such repository in repos.json", { repo: id });
  }
  return all.filter((repo) => repoIds.includes(repo.id));
}


/**
 * Scan the selected repositories into the index, then describe them.
 *
 * The deterministic layer is established first and never depends on the model:
 * a package exists, exports what it exports, and is depended on by whoever
 * depends on it whether or not enrichment runs. Enrichment only adds prose and
 * grouping on top, so `--no-enrich` degrades the index rather than breaking it.
 */
export async function runScan(
  deps: CommandDeps,
  opts: ScanOptions,
): Promise<number> {
  const { config, store, writer } = deps;
  // Read the shas the index was built from before anything is overwritten, so
  // drift can be judged per repository.
  const previousSha = new Map<string, string | null>();
  try {
    for (const repo of (await store.readManifest()).repos) {
      previousSha.set(repo.id, repo.scannedSha);
    }
  } catch {
    // No manifest yet: nothing has been enriched, so everything is enriched.
  }

  const manifestRepos: IndexManifest["repos"] = [];
  let domainTotal = 0;
  let packageTotal = 0;

  for (const repo of select(deps, opts.repoIds)) {
    const result = await scanRepo({
      rootAbs: config.root,
      repo,
      allRepos: config.repos.repos,
      scan: config.scan,
      git: deps.git,
      clock: deps.clock,
      logger: deps.logger,
    });

    if (opts.explain)
      writer.line(renderExplain(repo.id, result.breakdowns, config.scan));

    const enriched: EnrichedRepo | null = shouldEnrich({
      opts,
      available: result.available,
      headSha: result.headSha,
      previousSha: previousSha.get(repo.id) ?? null,
    })
      ? await enrichRepo(deps, {
          repo,
          packages: result.packages,
          scannedSha: result.headSha,
        })
      : null;

    // Skipping enrichment must not discard it. Without carrying it forward, a
    // --no-enrich rescan wiped every summary and the whole domain layer for
    // the repositories it touched, and the matcher reaches packages only
    // through domains.
    const carried =
      enriched === null
        ? await carryEnrichment(
            store,
            repo.id,
            deps.config.scan.enrichment.maxSummaryChars,
            result.packages,
          )
        : null;

    const index: RepoIndex = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      repo: repo.id,
      tier: repo.tier,
      domains: enriched?.domains ?? carried?.domains ?? [],
      packages: enriched?.packages ?? carried?.packages ?? result.packages,
      minor: result.minor,
    };
    if (!opts.dryRun) await store.writeRepo(index);

    domainTotal += index.domains.length;
    packageTotal += index.packages.length;
    manifestRepos.push({
      id: repo.id,
      path: repo.path,
      tier: repo.tier,
      vcs: repo.vcs,
      available: result.available,
      scannedSha: result.headSha,
      domainCount: index.domains.length,
      packageCount: index.packages.length,
      minorCount: index.minor.length,
      enrichedAt: enriched === null ? null : deps.clock.now().toISOString(),
    });
    writer.line(
      `${repo.id}: ${String(index.packages.length)} packages, ` +
        `${String(index.minor.length)} minor` +
        `${enriched === null ? "" : ENRICHED_SUFFIX}` +
        `${result.available ? "" : UNAVAILABLE_SUFFIX}`,
    );
  }

  const merged = await mergeManifestRepos(store, manifestRepos);
  if (!opts.dryRun) {
    await store.writeManifest({
      schemaVersion: INDEX_SCHEMA_VERSION,
      generatedAt: deps.clock.now().toISOString(),
      root: config.root,
      repos: merged,
    });
  }

  // Bands describe the whole estate, so they are judged against the whole
  // index rather than against this run. Judging the run instead meant every
  // single-repository scan warned that its own handful of entries fell short
  // of an estate-wide floor — noise that teaches an operator to ignore
  // warnings, which is worse than having none. A dry run has nothing merged to
  // measure, so it reports what it just scanned.
  const bands = config.scan.expectedCounts;
  const totals = opts.dryRun
    ? { packages: packageTotal, domains: domainTotal }
    : {
        packages: merged.reduce((sum, repo) => sum + repo.packageCount, 0),
        domains: merged.reduce((sum, repo) => sum + repo.domainCount, 0),
      };

  warnOutsideBand(
    deps,
    "package",
    totals.packages,
    bands.packagesMin,
    bands.packagesMax,
    'calibrate significance.threshold with "capmap scan --dry-run --explain"',
  );
  warnOutsideBand(
    deps,
    "domain",
    totals.domains,
    bands.domainsMin,
    bands.domainsMax,
    "run enrichment to populate the domain layer",
  );

  return EXIT_OK;
}
