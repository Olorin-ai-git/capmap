import { join } from "node:path";
import type { IndexManifest } from "../model/index-schema.js";
import type { Git } from "../ports/index.js";

export interface DriftReport {
  drifted: string[];
  unavailable: string[];
  headByRepo: Map<string, string | null>;
}

/**
 * Compare the sha each repository was scanned at against its current HEAD.
 *
 * A repository declared `vcs: "none"` has no sha to compare, so it is always
 * reported drifted: only a rescan can tell whether its contents changed.
 */
export async function computeDrift(
  manifest: IndexManifest,
  git: Git,
  rootAbs: string,
): Promise<DriftReport> {
  const drifted: string[] = [];
  const unavailable: string[] = [];
  const headByRepo = new Map<string, string | null>();

  for (const repo of manifest.repos) {
    if (!repo.available) {
      unavailable.push(repo.id);
      continue;
    }
    if (repo.vcs === "none") {
      headByRepo.set(repo.id, null);
      drifted.push(repo.id);
      continue;
    }
    const head = await git.headSha(join(rootAbs, repo.path));
    headByRepo.set(repo.id, head);
    if (head === null || head !== repo.scannedSha) drifted.push(repo.id);
  }

  return {
    drifted: drifted.sort(),
    unavailable: unavailable.sort(),
    headByRepo,
  };
}
