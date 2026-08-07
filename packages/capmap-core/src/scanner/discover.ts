import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { RepoEntry } from "../config/schema.js";

export type ManifestFile = "package.json" | "pyproject.toml";

export interface Candidate {
  repoId: string;
  absPath: string;
  relPath: string;
  manifestFile: ManifestFile;
}

export interface DiscoverArgs {
  root: string;
  repo: RepoEntry;
  excludePaths: string[];
  /**
   * Repository-relative paths of other configured repositories nested inside
   * this one. Each is pruned, because a nested repository is scanned as itself
   * and must not also be swept up by its parent.
   */
  nestedRepoPaths?: string[];
}

/** Probed in order; the first manifest present in a directory wins. */
const MANIFEST_FILES: ManifestFile[] = ["package.json", "pyproject.toml"];

const REPO_ROOT_REL_PATH = ".";

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

async function walk(
  dir: string,
  repoRoot: string,
  repoId: string,
  exclude: Set<string>,
  nested: Set<string>,
  out: Candidate[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  for (const manifestFile of MANIFEST_FILES) {
    if (!names.has(manifestFile)) continue;
    const rel = toPosix(relative(repoRoot, dir));
    out.push({
      repoId,
      absPath: dir,
      relPath: rel === "" ? REPO_ROOT_REL_PATH : rel,
      manifestFile,
    });
    break;
  }

  for (const entry of entries) {
    // `readdir` does not follow links, so a symlinked directory reports
    // `isSymbolicLink()` and never `isDirectory()`; skipping non-directories
    // therefore also prevents traversal through symlink cycles.
    if (!entry.isDirectory()) continue;
    if (exclude.has(entry.name)) continue;
    const child = join(dir, entry.name);
    if (nested.has(toPosix(relative(repoRoot, child)))) continue;
    await walk(child, repoRoot, repoId, exclude, nested, out);
  }
}

/**
 * Repository-relative paths of the configured repositories nested inside
 * `repo`. A nested repository carries its own `.git`, and a nested `.git` is
 * opaque to the parent's `git log`, so the parent could not date those files
 * correctly even if it indexed them. Scanning it from both sides would enter
 * every nested manifest into the index twice under two different ids.
 */
export function nestedRepoPaths(repo: RepoEntry, all: RepoEntry[]): string[] {
  const prefix = `${repo.path}/`;
  return all
    .filter((other) => other.id !== repo.id && other.path.startsWith(prefix))
    .map((other) => other.path.slice(prefix.length));
}

export async function discoverCandidates(
  args: DiscoverArgs,
): Promise<Candidate[]> {
  const repoRoot = join(args.root, args.repo.path);
  const out: Candidate[] = [];
  await walk(
    repoRoot,
    repoRoot,
    args.repo.id,
    new Set(args.excludePaths),
    new Set(args.nestedRepoPaths ?? []),
    out,
  );
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
