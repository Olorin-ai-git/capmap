import type {
  IndexManifest,
  RepoIndex,
} from "@capmap/core";
import { computeDrift } from "@capmap/core";
import type { CommandDeps } from "../composition.js";

export const STATE_UNAVAILABLE = "unavailable";
export const STATE_DRIFTED = "drifted";
export const STATE_CURRENT = "current";

/**
 * Everything the read-only query commands need from the stored index, resolved
 * once. Drift is recomputed here rather than trusted from the manifest, because
 * the persisted flag records what was true at scan time, not what is true now.
 */
export interface IndexContext {
  manifest: IndexManifest;
  repos: RepoIndex[];
  drifted: Set<string>;
  unavailable: Set<string>;
  tierByRepo: Map<string, RepoIndex["tier"]>;
}

export async function loadIndexContext(
  deps: CommandDeps,
): Promise<IndexContext> {
  const manifest = await deps.store.readManifest();
  const repos = await deps.store.readAllRepos();
  const drift = await computeDrift(manifest, deps.git, deps.config.root);

  return {
    manifest,
    repos,
    drifted: new Set(drift.drifted),
    unavailable: new Set(drift.unavailable),
    tierByRepo: new Map(repos.map((repo) => [repo.repo, repo.tier])),
  };
}

/** Drift state of one repository, in the vocabulary `capmap status` prints. */
export function repoState(context: IndexContext, repoId: string): string {
  if (context.unavailable.has(repoId)) return STATE_UNAVAILABLE;
  return context.drifted.has(repoId) ? STATE_DRIFTED : STATE_CURRENT;
}

/**
 * Repositories whose working tree has moved past the sha the index was built
 * from. Reported as a warning and never as an error: a stale index degrades
 * recall, but every capability the gate actually recommends is re-verified
 * against live source before a verdict is emitted.
 */
export function staleWarning(context: IndexContext): string | null {
  const stale = [...context.drifted].sort();
  if (stale.length === 0) return null;
  return (
    `warning: the index is stale for ${stale.join(", ")} — ` +
    `run "capmap refresh --stale" to rescan`
  );
}
