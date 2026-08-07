import type { IndexManifest } from "@capmap/core";
import { computeDrift } from "@capmap/core";
import type { CommandDeps } from "../composition.js";
import { renderTable } from "../render/table.js";

const EXIT_OK = 0;
const HEADERS = [
  "repo",
  "tier",
  "domains",
  "packages",
  "minor",
  "enriched",
  "state",
];
const STATE_UNAVAILABLE = "unavailable";
const STATE_DRIFTED = "drifted";
const STATE_CURRENT = "current";
const NEVER_ENRICHED = "never";

function state(
  repo: IndexManifest["repos"][number],
  drifted: Set<string>,
  unavailable: Set<string>,
): string {
  if (unavailable.has(repo.id)) return STATE_UNAVAILABLE;
  return drifted.has(repo.id) ? STATE_DRIFTED : STATE_CURRENT;
}

/**
 * Report what the stored index knows and how far it has fallen behind the
 * working tree. A repository without version control cannot be compared by
 * sha, so it is always reported as drifted rather than presumed current.
 */
export async function runStatus(deps: CommandDeps): Promise<number> {
  const manifest = await deps.store.readManifest();
  const drift = await computeDrift(manifest, deps.git, deps.config.root);
  const drifted = new Set(drift.drifted);
  const unavailable = new Set(drift.unavailable);

  deps.writer.line(
    `index generated ${manifest.generatedAt} for estate ${manifest.root}`,
  );
  deps.writer.line(
    renderTable({
      headers: HEADERS,
      rows: manifest.repos.map((repo) => [
        repo.id,
        repo.tier,
        String(repo.domainCount),
        String(repo.packageCount),
        String(repo.minorCount),
        repo.enrichedAt ?? NEVER_ENRICHED,
        state(repo, drifted, unavailable),
      ]),
    }),
  );
  deps.writer.line(
    `${String(drift.drifted.length)} of ${String(manifest.repos.length)} ` +
      `repositories drifted, ${String(drift.unavailable.length)} unavailable`,
  );

  return EXIT_OK;
}
