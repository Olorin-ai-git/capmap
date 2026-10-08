import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchIndex } from "../../src/search/search.js";
import {
  INDEX_SCHEMA_VERSION,
  type RepoIndex,
} from "../../src/model/index-schema.js";

const repos: RepoIndex[] = [
  {
    schemaVersion: INDEX_SCHEMA_VERSION,
    repo: "angainor",
    tier: "active" as const,
    domains: [
      {
        id: "angainor/multi-tenant-billing",
        repo: "angainor",
        tier: "active" as const,
        title: "Multi-org onboarding and Stripe billing",
        summary: "Organization signup and subscription billing.",
        domainTags: ["billing", "auth"],
        packages: ["angainor/billing"],
        stack: ["stripe"],
        maturity: "ga" as const,
        proofOfLife: {
          deployed: "console.angainor.ai",
          testCount: 408,
          lastCommit: null,
        },
        scannedSha: null,
      },
    ],
    packages: [
      {
        id: "angainor/billing",
        repo: "angainor",
        kind: "service" as const,
        name: "billing",
        path: "Angainor/control-plane/src/billing",
        manifest: "package.json",
        entry: null,
        exports: ["createSubscription"],
        deps: { internal: [], external: ["stripe"] },
        consumers: [],
        deployTarget: null,
        loc: 900,
        hasTests: true,
        hasReadme: true,
        lastCommit: null,
        significance: 0.8,
        maturity: "ga" as const,
        summary: "Stripe subscription lifecycle.",
        domainTags: ["billing"],
        scannedSha: null,
        enrichmentFailed: false,
        extractionFailed: false,
      },
    ],
    minor: [
      {
        id: "angainor/billing-fixtures",
        path: "Angainor/test/fixtures",
        kind: "npm-package" as const,
        significance: 0.1,
        parseError: null,
      },
    ],
  },
];

const SCORING = {
  minTermOverlap: 0.5,
  minPartialTermLength: 4,
  minQueryTermLength: 2,
  stopwords: ["for", "the", "via", "of"],
};

describe("searchIndex", () => {
  it("ranks the matching domain above its packages", () => {
    const hits = searchIndex({ scoring: SCORING, repos, query: "billing", limit: 10 });
    expect(hits[0]!.id).toBe("angainor/multi-tenant-billing");
    expect(hits[0]!.layer).toBe("domain");
  });

  it("matches on exported symbol names", () => {
    const hits = searchIndex({ scoring: SCORING, repos, query: "createSubscription", limit: 10 });
    expect(hits.map((h) => h.id)).toContain("angainor/billing");
  });

  it("floors minor entries below real entries", () => {
    const hits = searchIndex({ scoring: SCORING, repos, query: "billing", limit: 10 });
    expect(hits.at(-1)!.layer).toBe("minor");
  });

  it("returns nothing for a query with no term overlap", () => {
    expect(searchIndex({ scoring: SCORING, repos, query: "holography", limit: 10 })).toEqual([]);
  });

  it("honours the limit", () => {
    expect(searchIndex({ scoring: SCORING, repos, query: "billing", limit: 1 })).toHaveLength(1);
  });
});

/**
 * CM-13: two-way substring matching let any short token match inside any word,
 * so "kubernetes operator" returned five hits and the skill's "nothing covers
 * this" branch could never fire.
 */
const here = dirname(fileURLToPath(import.meta.url));

describe("search can answer nothing (CM-13)", () => {
  const example: RepoIndex[] = ["alpha", "beta", "vendor-toolkit"].map(
    (id) =>
      JSON.parse(
        readFileSync(join(here, "..", "..", "..", "..", "index", "repos", `${id}.json`), "utf8"),
      ) as RepoIndex,
  );
  const search = (query: string): string[] =>
    searchIndex({ scoring: SCORING, repos: example, query, limit: 10 }).map((hit) => hit.id);

  it.each(["kubernetes operator", "x y", "a", "audit log"])(
    "returns nothing for %s, which the example estate does not hold",
    (query) => {
      expect(search(query)).toEqual([]);
    },
  );

  it("still finds what is there, including by a meaningful prefix", () => {
    expect(search("authentication")).toContain("alpha/auth");
    expect(search("auth")).toContain("beta/auth");
    expect(search("billing stripe")).toContain("alpha/billing");
  });
});

/**
 * SP-3 audit round 3: removing the overlap floor left the suite green, and the
 * floor counted stopwords and unmatched words against the query, so a real
 * capability vanished from "stripe billing integration" and the skill reported
 * that nothing covers the need. A whole-word match on a meaningful term is a
 * hit; substring credit alone still has to clear the floor.
 */
describe("the overlap floor (SP-3 audit)", () => {
  const shipped = (
    JSON.parse(
      readFileSync(join(here, "..", "..", "..", "..", "config", "scan.config.json"), "utf8"),
    ) as { search: typeof SCORING }
  ).search;
  const example: RepoIndex[] = ["alpha", "beta", "vendor-toolkit"].map(
    (id) =>
      JSON.parse(
        readFileSync(join(here, "..", "..", "..", "..", "index", "repos", `${id}.json`), "utf8"),
      ) as RepoIndex,
  );
  const search = (query: string): string[] =>
    searchIndex({ scoring: shipped, repos: example, query, limit: 10 }).map((hit) => hit.id);

  it("drops an entry whose only credit is a substring match below the floor", () => {
    expect(search("authentic kubernetes")).toEqual([]);
  });

  it("finds a capability named by one word of a longer query", () => {
    expect(search("stripe billing integration")).toContain("alpha/billing");
  });

  it("ignores stopwords, so they neither match nor dilute the query", () => {
    expect(search("billing for the tenants")).toContain("alpha/billing");
    expect(search("for the via")).toEqual([]);
  });
});