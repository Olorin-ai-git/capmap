export interface ConsumerUnit {
  id: string;
  name: string;
  /** Repository-relative directory of the unit, used to disambiguate names. */
  relPath: string;
  internalDeps: string[];
}

export interface ConsumerIndex {
  /** Consumer ids per package **id** — never per name, which is not unique. */
  byId: Map<string, string[]>;
  /** Names declared by more than one package in this repository. */
  ambiguousNames: Set<string>;
}

const PATH_SEPARATOR = "/";
const REPO_ROOT_REL_PATH = ".";

function segments(relPath: string): string[] {
  if (relPath === REPO_ROOT_REL_PATH || relPath === "") return [];
  return relPath.split(PATH_SEPARATOR);
}

/** Length of the directory prefix two units share. */
function sharedDepth(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  let depth = 0;
  while (
    depth < left.length &&
    depth < right.length &&
    left[depth] === right[depth]
  ) {
    depth += 1;
  }
  return depth;
}

/**
 * Pick which package a dependency name refers to when several declare it.
 *
 * This estate really does contain three distinct packages all declaring
 * `@olorin/glass-ui` at version 2.0.0, with 7, 44 and 47 components. Keying the
 * index on name alone hands each of them the union of the others' consumers,
 * which is wrong on its face and additionally inflates `internalConsumers` —
 * the joint-largest significance signal — for all three at once.
 *
 * Resolution follows what Node would actually do: the candidate sharing the
 * longest directory prefix with the consumer wins, because that is the nearest
 * enclosing workspace. A tie means the estate is genuinely ambiguous, and the
 * edge is attributed to nobody rather than to everybody — an invented consumer
 * is worse than a missing one, because it inflates a score silently.
 */
function resolveTarget(
  candidates: ConsumerUnit[],
  consumer: ConsumerUnit,
): ConsumerUnit | null {
  if (candidates.length === 1) return candidates[0] ?? null;

  let best: ConsumerUnit | null = null;
  let bestDepth = -1;
  let tied = false;
  for (const candidate of candidates) {
    const depth = sharedDepth(candidate.relPath, consumer.relPath);
    if (depth > bestDepth) {
      best = candidate;
      bestDepth = depth;
      tied = false;
    } else if (depth === bestDepth) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export function buildConsumerIndex(units: ConsumerUnit[]): ConsumerIndex {
  const byName = new Map<string, ConsumerUnit[]>();
  for (const unit of units) {
    const existing = byName.get(unit.name);
    if (existing === undefined) byName.set(unit.name, [unit]);
    else existing.push(unit);
  }

  const ambiguousNames = new Set(
    [...byName.entries()]
      .filter(([, declared]) => declared.length > 1)
      .map(([name]) => name),
  );

  const byId = new Map<string, string[]>();
  for (const unit of units) {
    for (const dep of unit.internalDeps) {
      const candidates = byName.get(dep);
      if (candidates === undefined) continue;
      const target = resolveTarget(candidates, unit);
      if (target === null) continue;
      const existing = byId.get(target.id);
      if (existing === undefined) byId.set(target.id, [unit.id]);
      else existing.push(unit.id);
    }
  }

  for (const [id, consumers] of byId) {
    byId.set(id, [...new Set(consumers)].sort());
  }

  return { byId, ambiguousNames };
}
