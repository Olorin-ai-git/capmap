import { join } from "node:path";
import type { RepoEntry } from "../../../capmap-core/src/config/schema.js";
import type {
  Git,
  ModelClient,
  Writer,
} from "../../../capmap-core/src/ports/index.js";
import { IndexStore } from "@capmap/core";
import {
  capturingWriter,
  fixedClock,
  scriptedModel,
  silentLogger,
} from "../../../capmap-core/test/support/doubles.js";
import { loadFixtureConfig } from "../../../capmap-core/test/support/fixture-estate.js";
import type { CommandDeps } from "../../src/composition.js";

/** Fixed instant so that recency scoring and manifest stamps are reproducible. */
export const FIXTURE_NOW = new Date("2026-07-27T00:00:00.000Z");
/** HEAD reported for every git fixture repository when none is specified. */
export const FIXTURE_HEAD_SHA = "fixture-head-sha";
/** Commit date reported for every scanned path in the fixture estate. */
export const FIXTURE_COMMIT_ISO = "2026-07-01T00:00:00.000Z";
/**
 * One response satisfying both enrichment passes: the package pass reads
 * `summary` and `domainTags`, the domain pass reads `domains`.
 */
const FIXTURE_MODEL_RESPONSE = JSON.stringify({
  summary: "Fixture package in the capability map test estate.",
  domainTags: ["ui-kit"],
  domains: [],
});

export interface MakeDepsOptions {
  indexDir: string;
  /** HEAD sha per repository id; repositories left out report no HEAD. */
  headShaByRepo?: Record<string, string>;
  /** Share one capturing writer with the other deps built in this test. */
  reuseWriter?: boolean;
  /** Scripted model replies, consumed in order; the last one repeats. */
  modelResponses?: string[];
}

export interface TestDeps extends CommandDeps {
  writer: Writer & { lines: string[] };
  model: ModelClient & { calls: number };
}

const sharedWriter = capturingWriter();

/** Git double keyed by absolute repository path, as the ports are called. */
export function estateGit(
  root: string,
  repos: RepoEntry[],
  headShaByRepo: Record<string, string> | undefined,
): Git {
  const shaByPath = new Map<string, string | null>(
    repos.map((repo) => [
      join(root, repo.path),
      headShaByRepo === undefined
        ? FIXTURE_HEAD_SHA
        : (headShaByRepo[repo.id] ?? null),
    ]),
  );
  return {
    headSha: async (repoAbsPath: string) => shaByPath.get(repoAbsPath) ?? null,
    lastCommitIso: async () => FIXTURE_COMMIT_ISO,
  };
}

/**
 * Build the dependency set the commands expect, over the committed fixture
 * estate and an index directory the caller owns. Every non-deterministic
 * source — clock, git, model, output — is a double, so command behaviour is
 * asserted rather than the environment's.
 */
export async function makeDeps(options: MakeDepsOptions): Promise<TestDeps> {
  const config = await loadFixtureConfig();
  return {
    config,
    store: new IndexStore({ indexDirAbs: options.indexDir }),
    git: estateGit(config.root, config.repos.repos, options.headShaByRepo),
    clock: fixedClock(FIXTURE_NOW),
    logger: silentLogger(),
    writer: options.reuseWriter === true ? sharedWriter : capturingWriter(),
    model: scriptedModel(options.modelResponses ?? [FIXTURE_MODEL_RESPONSE]),
    operatorTerminal: false,
  };
}
