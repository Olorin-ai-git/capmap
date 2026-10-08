import { RepoTierSchema } from "@capmap/core";
import { PackageKindSchema } from "@capmap/core";
import { searchIndex } from "@capmap/core";
import type { CommandDeps } from "../composition.js";
import { renderTable } from "../render/table.js";
import { loadIndexContext, staleWarning } from "./index-context.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const HEADERS = ["layer", "tier", "id", "title", "score"];
const SCORE_PRECISION = 2;

/**
 * How many hits are shown when the caller does not say. A presentation default
 * rather than a tuning knob: it bounds terminal output only, and never affects
 * which capabilities the gate considers.
 */
const DEFAULT_LIMIT = 20;

export interface SearchOptions {
  query: string;
  limit: string | null;
  tier: string | null;
  kind: string | null;
}

type Parsed = Parameters<typeof searchIndex>[0];

function fail(deps: CommandDeps, message: string): number {
  deps.writer.line(message);
  return EXIT_ERROR;
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Search the stored index. Ranking is deterministic term overlap, so the same
 * index and query always produce the same ordering — no model is consulted.
 */
export async function runSearch(
  deps: CommandDeps,
  options: SearchOptions,
): Promise<number> {
  const limit = parseLimit(options.limit);
  if (limit === null) {
    return fail(
      deps,
      `--limit must be a positive integer, received "${options.limit ?? ""}"`,
    );
  }

  const tier =
    options.tier === null ? null : RepoTierSchema.safeParse(options.tier);
  if (tier !== null && !tier.success) {
    return fail(
      deps,
      `unknown tier "${options.tier ?? ""}"; expected one of ` +
        RepoTierSchema.options.join(", "),
    );
  }

  const kind =
    options.kind === null ? null : PackageKindSchema.safeParse(options.kind);
  if (kind !== null && !kind.success) {
    return fail(
      deps,
      `unknown kind "${options.kind ?? ""}"; expected one of ` +
        PackageKindSchema.options.join(", "),
    );
  }

  const context = await loadIndexContext(deps);
  const args: Parsed = {
    repos: context.repos,
    query: options.query,
    limit,
    scoring: deps.config.scan.search,
  };
  if (tier !== null && tier.success) args.tier = tier.data;
  if (kind !== null && kind.success) args.kind = kind.data;

  const hits = searchIndex(args);
  const warning = staleWarning(context);
  if (warning !== null) deps.writer.line(warning);

  if (hits.length === 0) {
    deps.writer.line(`no capability matches "${options.query}"`);
    return EXIT_OK;
  }

  deps.writer.line(
    renderTable({
      headers: HEADERS,
      rows: hits.map((hit) => [
        hit.layer,
        hit.tier,
        hit.id,
        hit.title,
        hit.score.toFixed(SCORE_PRECISION),
      ]),
    }),
  );
  return EXIT_OK;
}
