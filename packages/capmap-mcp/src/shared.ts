import { computeDrift, type PackageEntry, type RepoIndex } from "@capmap/core";
import type { ToolDeps } from "./types.js";

export const DEFAULT_LIMIT = 20;

export interface Loaded {
  repos: RepoIndex[];
  drifted: string[];
  generatedAt: string;
}

/**
 * Drift is recomputed on every call rather than read from the manifest: the
 * persisted flag records what was true when the index was written, and a tool
 * answering "is this current?" must not answer from a stale note.
 */
export async function load(deps: ToolDeps): Promise<Loaded> {
  const manifest = await deps.store.readManifest();
  const repos = await deps.store.readAllRepos();
  const drift = await computeDrift(manifest, deps.git, deps.config.root);
  return { repos, drifted: drift.drifted, generatedAt: manifest.generatedAt };
}

export function allPackages(repos: RepoIndex[]): PackageEntry[] {
  return repos.flatMap((repo) => repo.packages);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
