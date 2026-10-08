import type { RepoTier, ScanConfig } from "../config/schema.js";
import type { PackageKind, RepoIndex } from "../model/index-schema.js";

export type SearchLayer = "domain" | "package" | "minor";

export interface SearchHit {
  id: string;
  layer: SearchLayer;
  tier: RepoTier;
  title: string;
  score: number;
}

export interface SearchArgs {
  repos: RepoIndex[];
  query: string;
  limit: number;
  tier?: RepoTier;
  kind?: PackageKind;
  scoring: ScanConfig["search"];
}

/**
 * Layer precedence of the ranking function itself, not tunable configuration: a
 * domain always outranks an equally matching package, and minor entries are
 * floored so they can only ever appear beneath real entries.
 */
export const LAYER_WEIGHT: Record<SearchLayer, number> = {
  domain: 1,
  package: 0.85,
  minor: 0.2,
};

/** Credit for a substring match, half of the credit for an exact term match. */
const PARTIAL_MATCH_CREDIT = 0.5;
const TOKEN = /[a-z0-9]+/g;

function tokenise(value: string): string[] {
  return value.toLowerCase().match(TOKEN) ?? [];
}

/**
 * Fraction of the query terms present in a haystack, counting substrings at
 * half credit — only where the shorter side is long enough. An entry that
 * contains a query term as a whole word is a hit at whatever fraction, so one
 * word of a longer query still finds the capability it names; one whose only
 * credit is substrings scores zero below the configured floor, so a query the
 * index does not hold can still answer nothing.
 */
function overlap(queryTerms: string[], haystack: string, scoring: ScanConfig["search"]): number {
  const terms = new Set(tokenise(haystack));
  if (terms.size === 0) return 0;
  let matched = 0;
  let exact = 0;
  for (const term of queryTerms) {
    if (terms.has(term)) {
      matched += 1;
      exact += 1;
      continue;
    }
    for (const candidate of terms) {
      if (Math.min(candidate.length, term.length) < scoring.minPartialTermLength) continue;
      if (candidate.includes(term) || term.includes(candidate)) {
        matched += PARTIAL_MATCH_CREDIT;
        break;
      }
    }
  }
  const fraction = matched / queryTerms.length;
  return exact > 0 || fraction >= scoring.minTermOverlap ? fraction : 0;
}

function compareHits(a: SearchHit, b: SearchHit): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function collect(
  repo: RepoIndex,
  args: SearchArgs,
  terms: string[],
): SearchHit[] {
  const hits: SearchHit[] = [];

  for (const domain of repo.domains) {
    const haystack = [
      domain.id,
      domain.title,
      domain.summary,
      domain.domainTags.join(" "),
      domain.stack.join(" "),
    ].join(" ");
    const score = overlap(terms, haystack, args.scoring) * LAYER_WEIGHT.domain;
    if (score > 0) {
      hits.push({
        id: domain.id,
        layer: "domain",
        tier: repo.tier,
        title: domain.title,
        score,
      });
    }
  }

  for (const pkg of repo.packages) {
    if (args.kind !== undefined && pkg.kind !== args.kind) continue;
    const haystack = [
      pkg.id,
      pkg.name,
      pkg.summary ?? "",
      pkg.domainTags.join(" "),
      pkg.exports.join(" "),
      pkg.path,
    ].join(" ");
    const score = overlap(terms, haystack, args.scoring) * LAYER_WEIGHT.package;
    if (score > 0) {
      hits.push({
        id: pkg.id,
        layer: "package",
        tier: repo.tier,
        title: pkg.name,
        score,
      });
    }
  }

  for (const entry of repo.minor) {
    const score =
      overlap(terms, `${entry.id} ${entry.path}`, args.scoring) *
      LAYER_WEIGHT.minor;
    if (score > 0) {
      hits.push({
        id: entry.id,
        layer: "minor",
        tier: repo.tier,
        title: entry.path,
        score,
      });
    }
  }

  return hits;
}

/**
 * Rank indexed capabilities against a free-text query.
 *
 * Scoring is deterministic term overlap across ids, titles, summaries, tags,
 * names, exports and paths, scaled by layer precedence. Ties break on id so the
 * same index and query always produce the same ordering.
 */
export function searchIndex(args: SearchArgs): SearchHit[] {
  const stopwords = new Set(args.scoring.stopwords);
  const terms = tokenise(args.query).filter(
    (term) => term.length >= args.scoring.minQueryTermLength && !stopwords.has(term),
  );
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const repo of args.repos) {
    if (args.tier !== undefined && repo.tier !== args.tier) continue;
    hits.push(...collect(repo, args, terms));
  }

  return hits.sort(compareHits).slice(0, args.limit);
}
