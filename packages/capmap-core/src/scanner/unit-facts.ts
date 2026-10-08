import type { RepoEntry } from "../config/schema.js";
import type { PackageEntry } from "../model/index-schema.js";
import { sanitiseModelText } from "../enrich/untrusted.js";
import type { Git } from "../ports/index.js";
import { detectDeployTarget, type DeployTarget } from "./deploy-target.js";
import { collectMetrics, type PackageMetrics } from "./metrics.js";
import { deriveMaturity } from "./maturity.js";
import { extractExports, unitPath, type Unit } from "./unit.js";

/** Everything the filesystem and git can tell us about a single unit. */
export interface UnitFacts {
  path: string;
  exports: string[];
  extractionFailed: boolean;
  deployTarget: DeployTarget | null;
  metrics: PackageMetrics;
  hasTests: boolean;
  lastCommit: string | null;
}

export interface GatherFactsArgs {
  unit: Unit;
  repoPath: string;
  repoRootAbs: string;
  excludePaths: string[];
  git: Git;
  isGit: boolean;
}

/**
 * Read the deterministic evidence for a unit. A repository declared as having
 * no version control is never asked for commit history, so a non-git checkout
 * scores as if it had never been committed rather than erroring.
 */
export async function gatherFacts(args: GatherFactsArgs): Promise<UnitFacts> {
  const { unit } = args;
  const extracted = await extractExports(unit);
  const deployTarget = await detectDeployTarget(
    unit.candidate.absPath,
    args.repoRootAbs,
  );
  const metrics = await collectMetrics(
    unit.candidate.absPath,
    args.excludePaths,
  );
  const lastCommit = args.isGit
    ? await args.git.lastCommitIso(args.repoRootAbs, unit.candidate.relPath)
    : null;
  return {
    path: unitPath(args.repoPath, unit.candidate.relPath),
    exports: extracted.exports,
    extractionFailed: extracted.extractionFailed,
    deployTarget,
    metrics,
    hasTests: metrics.hasTests || unit.manifest.hasTestScript,
    lastCommit,
  };
}

export interface EntryContext {
  repo: RepoEntry;
  consumers: string[];
  significance: number;
  headSha: string | null;
  now: Date;
  gaRecencyDays: number;
}

/**
 * A manifest-sourced name as one printable line. Names are arbitrary strings
 * from the scanned repository, and `show` and MCP print what is stored.
 */
function flatten(text: string): string {
  return sanitiseModelText(text, Number.POSITIVE_INFINITY);
}

/**
 * Project a unit and its facts onto an index entry. Model-supplied fields stay
 * empty here: a later enrichment pass owns `summary` and `domainTags`.
 */
export function toPackageEntry(
  unit: Unit,
  facts: UnitFacts,
  ctx: EntryContext,
): PackageEntry {
  return {
    id: unit.id,
    repo: ctx.repo.id,
    kind: unit.manifest.kind,
    name: flatten(unit.manifest.name),
    path: facts.path,
    manifest: unit.candidate.manifestFile,
    entry: unit.manifest.entryRelPath,
    exports: facts.exports,
    deps: {
      internal: unit.manifest.deps.internal.map(flatten),
      external: unit.manifest.deps.external.map(flatten),
    },
    consumers: ctx.consumers,
    deployTarget: facts.deployTarget,
    loc: facts.metrics.loc,
    hasTests: facts.hasTests,
    hasReadme: facts.metrics.hasReadme,
    lastCommit: facts.lastCommit,
    significance: ctx.significance,
    maturity: deriveMaturity({
      tier: ctx.repo.tier,
      hasDeployTarget: facts.deployTarget !== null,
      hasTests: facts.hasTests,
      hasReadme: facts.metrics.hasReadme,
      lastCommit: facts.lastCommit,
      now: ctx.now,
      gaRecencyDays: ctx.gaRecencyDays,
    }),
    summary: null,
    domainTags: [],
    scannedSha: ctx.headSha,
    enrichmentFailed: false,
    extractionFailed: facts.extractionFailed,
  };
}
