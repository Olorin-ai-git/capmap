import type { IndexManifest } from "@capmap/core";
import type { CommandDeps } from "../composition.js";
import type { ScanOptions } from "./scan.js";

/**
 * Fold this run's repositories into whatever the manifest already records.
 *
 * Scanning a subset must not orphan the rest. Each repository's entries live in
 * its own `index/repos/<id>.json`, and those files survive a partial scan — but
 * the manifest is the only thing that lists them, so replacing it wholesale
 * left every unscanned repository invisible while its data sat on disk. That is
 * exactly what `capmap scan <repo>` and a partially-completed full scan do, and
 * both are ordinary operations rather than edge cases.
 */
export async function mergeManifestRepos(
  store: CommandDeps["store"],
  scanned: IndexManifest["repos"],
): Promise<IndexManifest["repos"]> {
  let existing: IndexManifest["repos"] = [];
  try {
    existing = (await store.readManifest()).repos;
  } catch {
    // No manifest yet: this run is the first, and `scanned` is the whole truth.
    return scanned;
  }

  const merged = new Map(existing.map((repo) => [repo.id, repo]));
  for (const repo of scanned) merged.set(repo.id, repo);
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function warnOutsideBand(
  deps: CommandDeps,
  what: string,
  count: number,
  min: number,
  max: number,
  remedy: string,
): void {
  if (count >= min && count <= max) return;
  deps.writer.line(
    `warning: ${String(count)} ${what} entries is outside the configured band ` +
      `${String(min)}..${String(max)}; ${remedy}`,
  );
}

/**
 * Whether a scanned repository should go through the enrichment passes.
 *
 * Enrichment is the only part of a scan that spends money, so it is gated on
 * evidence that the description could have changed: a repository whose HEAD is
 * exactly what the index was built from already has current prose, and paying
 * to regenerate it buys nothing. Re-running a full scan over a settled estate
 * previously re-enriched all of it.
 *
 * A dry run writes nothing; an unavailable repository produced nothing to
 * describe; a repository with no stored sha, or without version control, has no
 * evidence either way and is enriched. `--force` overrides the gate.
 */
export function shouldEnrich(args: {
  opts: ScanOptions;
  available: boolean;
  headSha: string | null;
  previousSha: string | null;
}): boolean {
  if (args.opts.enrich === false || args.opts.dryRun || !args.available) {
    return false;
  }
  if (args.opts.force === true) return true;
  if (args.headSha === null || args.previousSha === null) return true;
  return args.headSha !== args.previousSha;
}
