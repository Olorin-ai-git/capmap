const PATH_SEPARATOR = "/";
const REPO_ROOT_REL_PATH = ".";

/**
 * Assign every unit in a repository an id that is unique within it.
 *
 * The obvious id — repository plus leaf directory name — collides in practice.
 * This estate holds `olorin-core/packages/glass-components` and
 * `olorin-media/bayit-plus/packages/ui/glass-components` in the same
 * repository, so both claimed `olorin/glass-components`. The index then carried
 * two entries under one id, `locate` silently returned whichever came first,
 * and a verdict could name a capability the operator did not get.
 *
 * On collision the id grows leftwards along the path — `ui-glass-components`,
 * then `packages-ui-glass-components` — until it is unique. The common case
 * keeps its short readable id, and the disambiguated ones read as what they
 * are. Assignment is deterministic in path order, so the same estate always
 * produces the same ids and the index stays diffable.
 */
export function assignUnitIds(
  repoId: string,
  relPaths: string[],
): Map<string, string> {
  const ordered = [...relPaths].sort((a, b) => a.localeCompare(b));
  const assigned = new Map<string, string>();
  const taken = new Set<string>();

  for (const relPath of ordered) {
    if (relPath === REPO_ROOT_REL_PATH) {
      const rootId = `${repoId}${PATH_SEPARATOR}${repoId}`;
      assigned.set(relPath, rootId);
      taken.add(rootId);
      continue;
    }

    const segments = relPath.split(PATH_SEPARATOR).filter((s) => s.length > 0);
    let candidate = "";
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const suffix = segments.slice(segments.length - depth).join("-");
      candidate = `${repoId}${PATH_SEPARATOR}${suffix}`;
      if (!taken.has(candidate)) break;
    }
    // Every segment consumed and still colliding means two identical paths,
    // which the caller cannot produce; guard anyway so ids stay unique.
    let unique = candidate;
    let counter = 2;
    while (taken.has(unique)) {
      unique = `${candidate}-${String(counter)}`;
      counter += 1;
    }
    assigned.set(relPath, unique);
    taken.add(unique);
  }

  return assigned;
}
