import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { containedPath } from "./contained.js";
import type { Candidate } from "./discover.js";
import type { ParsedManifest } from "./manifest-npm.js";
import { TEST_DIR_NAMES } from "./metrics.js";
import { packageImports } from "./py-imports.js";

const INIT_FILE = "__init__.py";
const REPO_ROOT_REL_PATH = ".";

export interface SubpackageArgs {
  /** The Python project's own candidate and parsed manifest. */
  project: Candidate;
  manifest: ParsedManifest;
  /** Levels below each import root to descend; the root itself is level 0. */
  maxDepth: number;
  excludePaths: string[];
  /**
   * Repository-relative paths that are units in their own right — another
   * manifest, or a nested repository. Each is skipped with everything beneath.
   */
  stopRelPaths: Set<string>;
}

export interface Subpackage {
  candidate: Candidate;
  manifest: ParsedManifest;
}

export interface SubpackageResult {
  subpackages: Subpackage[];
  /** Sub-packages the project's own modules (outside every sub-package) import. */
  projectImports: string[];
}

function repoRel(project: Candidate, rel: string): string {
  return project.relPath === REPO_ROOT_REL_PATH ? rel : `${project.relPath}/${rel}`;
}

/**
 * The stop paths strictly beneath the project. A Poetry `packages` entry may
 * reach into a sibling project's directory (`from = "voice-pipeline"`); that
 * project indexes its own packages, so everything at or beneath it is skipped
 * here rather than listed a second time under the same path and id.
 */
function stopsBeneath(project: Candidate, stopRelPaths: Set<string>): string[] {
  const prefix = project.relPath === REPO_ROOT_REL_PATH ? "" : `${project.relPath}/`;
  return [...stopRelPaths].filter(
    (stop) => stop !== project.relPath && stop !== REPO_ROOT_REL_PATH && stop.startsWith(prefix),
  );
}

/**
 * The Python packages inside a project, so that a monolith is indexed as the
 * services it holds rather than as one directory name.
 *
 * Every import root except the one already serving as the project's entry, and
 * every package beneath a root down to `maxDepth`, becomes a unit of kind
 * `py-subpackage`, named by its dotted import path. Whether each is significant
 * enough to index is then decided by the same scoring as any other unit.
 *
 * Imports between them are their dependency edges. Without them every
 * sub-package had no consumers, so the `internalConsumers` signal was always
 * zero and a service inside a monolith could not clear the threshold.
 */
export async function discoverSubpackages(
  args: SubpackageArgs,
): Promise<SubpackageResult> {
  const { project, manifest } = args;
  const exclude = new Set(args.excludePaths);
  const stops = stopsBeneath(project, args.stopRelPaths);
  const out: Subpackage[] = [];

  const visit = async (rel: string, dotted: string, depth: number): Promise<void> => {
    const relRepo = repoRel(project, rel);
    if (stops.some((stop) => relRepo === stop || relRepo.startsWith(`${stop}/`))) return;
    // A test package exercises capabilities; it is never one to reuse.
    if (TEST_DIR_NAMES.has(rel.split("/").pop() ?? rel)) return;
    if ((await containedPath(project.absPath, `${rel}/${INIT_FILE}`)) === null) return;
    if (depth > 0 || manifest.entryRelPath !== `${rel}/${INIT_FILE}`) {
      out.push({
        candidate: {
          repoId: project.repoId,
          absPath: join(project.absPath, rel),
          relPath: repoRel(project, rel),
          manifestFile: INIT_FILE,
        },
        manifest: {
          name: dotted,
          kind: "py-subpackage",
          entryRelPath: INIT_FILE,
          deps: { internal: [], external: [] },
          isPrivate: false,
          hasTestScript: false,
          parseError: null,
          importRoots: [],
        },
      });
    }
    if (depth >= args.maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await readdir(join(project.absPath, rel), { withFileTypes: true });
    } catch {
      return;
    }
    const children = entries
      .filter((entry) => entry.isDirectory() && !exclude.has(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const child of children) {
      await visit(`${rel}/${child}`, `${dotted}.${child}`, depth + 1);
    }
  };

  for (const root of manifest.importRoots) {
    await visit(root, root.split("/").pop() ?? root, 0);
  }

  const known = new Set(out.map((sub) => sub.manifest.name));
  const skipDirsAbs = new Set(out.map((sub) => sub.candidate.absPath));
  const importsOf = (dirAbs: string, dotted: string, self: string | null): Promise<string[]> =>
    packageImports({ scope: { dirAbs, dotted }, self, known, skipDirsAbs, exclude });
  for (const sub of out) {
    sub.manifest.deps.internal = await importsOf(
      sub.candidate.absPath,
      sub.manifest.name,
      sub.manifest.name,
    );
  }
  const projectImports = new Set<string>();
  for (const root of manifest.importRoots) {
    const dirAbs = join(project.absPath, root);
    if (skipDirsAbs.has(dirAbs)) continue;
    for (const name of await importsOf(dirAbs, root.split("/").pop() ?? root, null)) {
      projectImports.add(name);
    }
  }
  return { subpackages: out, projectImports: [...projectImports].sort() };
}
