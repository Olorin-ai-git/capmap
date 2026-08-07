import type { PackageEntry } from "../model/index-schema.js";

const PATH_SEPARATOR = "/";
/** Index of the segment after the repository directory itself. */
const SUBTREE_SEGMENT = 1;

/**
 * Split a repository's packages into groups small enough for one domain call.
 *
 * The first live run failed exactly here: `olorin` holds 169 significant
 * packages, all of their summaries went into a single prompt, and the reply hit
 * its token ceiling and arrived as truncated JSON. Three retries produced the
 * same truncation, so the largest repository in the estate — 169 packages —
 * ended up with **zero** domains, and since the matcher reaches packages only
 * through domains, every one of them was invisible to the gate.
 *
 * Grouping is by first subtree rather than by arbitrary slicing, because a
 * monorepo's top-level directories are already its subsystem boundaries
 * (`olorin-core`, `olorin-fraud`, `olorin-media`…). Packages that belong
 * together therefore stay together, and each call sees a coherent slice rather
 * than an alphabetical accident. A subtree larger than the limit is split
 * further, in path order, so grouping degrades gracefully instead of failing.
 */
export function chunkPackagesForDomains(
  packages: PackageEntry[],
  maxPerCall: number,
): PackageEntry[][] {
  if (packages.length <= maxPerCall)
    return packages.length === 0 ? [] : [packages];

  const bySubtree = new Map<string, PackageEntry[]>();
  for (const entry of [...packages].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const segments = entry.path.split(PATH_SEPARATOR);
    const key = segments[SUBTREE_SEGMENT] ?? segments[0] ?? entry.repo;
    const existing = bySubtree.get(key);
    if (existing === undefined) bySubtree.set(key, [entry]);
    else existing.push(entry);
  }

  const chunks: PackageEntry[][] = [];
  for (const group of bySubtree.values()) {
    for (let index = 0; index < group.length; index += maxPerCall) {
      chunks.push(group.slice(index, index + maxPerCall));
    }
  }
  return chunks;
}
