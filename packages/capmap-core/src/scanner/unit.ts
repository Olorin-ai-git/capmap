import { join } from "node:path";
import type { RepoEntry } from "../config/schema.js";
import { discoverCandidates, type Candidate } from "./discover.js";
import { assignUnitIds } from "./unit-id.js";
import { parseNpmManifest, type ParsedManifest } from "./manifest-npm.js";
import { parsePyManifest } from "./manifest-py.js";
import { extractTsExports, type ExportResult } from "./exports-ts.js";
import { extractPyExports } from "./exports-py.js";

/** A discovered manifest directory paired with its parsed manifest and stable id. */
export interface Unit {
  candidate: Candidate;
  manifest: ParsedManifest;
  id: string;
}

export interface BuildUnitsArgs {
  rootAbs: string;
  repo: RepoEntry;
  internalScopes: string[];
  excludePaths: string[];
  /** Repository-relative paths of configured repositories nested inside this one. */
  nestedRepoPaths?: string[];
}

const NPM_MANIFEST_FILE = "package.json";
const PY_PACKAGE_KIND = "py-package";
const PATH_SEPARATOR = "/";
/** A candidate at the repository root carries the relative path `.`. */
const REPO_ROOT_REL_PATH = ".";
const TRAILING_SELF_SEGMENT = /\/\.$/;

/**
 * Stable identifier for a scanned unit: `<repoId>/<directory leaf>`, with the
 * repository id standing in for the leaf when the unit is the repository root.
 * Derived from the directory rather than the manifest name so that a malformed
 * or nameless manifest still yields a usable id.
 */
function unitId(
  repoId: string,
  candidate: Candidate,
  manifest: ParsedManifest,
): string {
  const leaf =
    candidate.relPath === REPO_ROOT_REL_PATH
      ? repoId
      : (candidate.relPath.split(PATH_SEPARATOR).pop() ?? manifest.name);
  return `${repoId}${PATH_SEPARATOR}${leaf}`;
}

/** Estate-relative path of a unit, collapsing the repository-root `.` segment. */
export function unitPath(repoPath: string, relPath: string): string {
  return `${repoPath}${PATH_SEPARATOR}${relPath}`.replace(
    TRAILING_SELF_SEGMENT,
    "",
  );
}

async function parseCandidate(
  candidate: Candidate,
  internalScopes: string[],
): Promise<ParsedManifest> {
  return candidate.manifestFile === NPM_MANIFEST_FILE
    ? parseNpmManifest(candidate.absPath, internalScopes)
    : parsePyManifest(candidate.absPath, internalScopes);
}

/**
 * Export surface of a unit. A unit with no resolvable entry point has no
 * surface to read: that counts as a failed extraction unless the manifest
 * itself failed to parse, in which case the parse error is the reported cause.
 */
export async function extractExports(unit: Unit): Promise<ExportResult> {
  const { candidate, manifest } = unit;
  if (manifest.entryRelPath === null) {
    return { exports: [], extractionFailed: manifest.parseError === null };
  }
  const entryAbs = join(candidate.absPath, manifest.entryRelPath);
  return manifest.kind === PY_PACKAGE_KIND
    ? extractPyExports(entryAbs)
    : extractTsExports(entryAbs);
}

/** Discover every manifest in a repository and parse it into a scannable unit. */
export async function buildUnits(args: BuildUnitsArgs): Promise<Unit[]> {
  const candidates = await discoverCandidates({
    root: args.rootAbs,
    repo: args.repo,
    excludePaths: args.excludePaths,
    nestedRepoPaths: args.nestedRepoPaths ?? [],
  });
  // Ids are assigned across the whole repository at once, because uniqueness is
  // a property of the set rather than of any single unit.
  const ids = assignUnitIds(
    args.repo.id,
    candidates.map((candidate) => candidate.relPath),
  );

  const units: Unit[] = [];
  for (const candidate of candidates) {
    const manifest = await parseCandidate(candidate, args.internalScopes);
    units.push({
      candidate,
      manifest,
      id: ids.get(candidate.relPath) ?? unitId(args.repo.id, candidate, manifest),
    });
  }
  return units;
}
