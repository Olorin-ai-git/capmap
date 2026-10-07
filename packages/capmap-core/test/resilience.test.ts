import { describe, it, expect } from "vitest";
import { enrichPackages } from "../src/enrich/package-pass.js";
import { enrichDomains } from "../src/enrich/domain-pass.js";
import {
  rankPackagesForComponent,
  selectCandidateDomains,
} from "../src/gate/match.js";
import { runGate } from "../src/gate/run.js";
import { INDEX_SCHEMA_VERSION } from "../src/model/index-schema.js";
import type { PackageEntry, RepoIndex } from "../src/model/index-schema.js";
import type { ModelClient } from "../src/ports/index.js";
import { fixedClock, silentLogger } from "./support/doubles.js";
import { fixtureEstateRoot } from "./support/fixture-estate.js";

/**
 * A model that is reachable but refusing — the shape of a rate limit, an
 * outage, or a lapsed billing account. Every one of those is a normal
 * production condition rather than an exceptional one, and none of them should
 * destroy work whose deterministic half already succeeded.
 */
function refusingModel(message: string): ModelClient & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    complete: () => {
      state.calls += 1;
      return Promise.reject(new Error(message));
    },
  };
}

const BILLING = "400 credit balance is too low to access the Anthropic API";
const RATE_LIMIT = "429 rate limit exceeded";

const NOW = new Date("2026-08-02T00:00:00.000Z");
const ENRICH_CONFIG = {
  model: "m",
  maxRetries: 2,
  concurrency: 2,
  packageMaxTokens: 512,
  domainMaxTokens: 4096,
  maxPackagesPerDomainCall: 25,
  maxExcerptChars: 4000,
  maxSummaryChars: 600,
};

const entry: PackageEntry = {
  id: "alpha/ui-kit",
  repo: "alpha",
  kind: "npm-package",
  name: "@alpha/ui-kit",
  path: "alpha/packages/ui-kit",
  manifest: "package.json",
  entry: "src/index.ts",
  exports: ["Button"],
  deps: { internal: [], external: [] },
  consumers: [],
  deployTarget: null,
  loc: 40,
  hasTests: true,
  hasReadme: true,
  lastCommit: null,
  significance: 0.6,
  maturity: "beta",
  summary: null,
  domainTags: [],
  scannedSha: "abc",
  enrichmentFailed: false,
  extractionFailed: false,
};

const repoIndex: RepoIndex = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  repo: "alpha",
  tier: "core",
  domains: [
    {
      id: "alpha/design-system",
      repo: "alpha",
      tier: "core",
      title: "Design system",
      summary: "UI primitives.",
      domainTags: ["ui-kit"],
      packages: ["alpha/ui-kit"],
      stack: ["react"],
      maturity: "ga",
      proofOfLife: { deployed: null, testCount: null, lastCommit: null },
      scannedSha: "abc",
    },
  ],
  packages: [entry],
  minor: [],
};

describe("enrichment survives a refusing model", () => {
  it("flags the package rather than throwing", async () => {
    const model = refusingModel(BILLING);
    const out = await enrichPackages({
      packages: [entry],
      repoRootAbs: `${fixtureEstateRoot()}/alpha`,
      vocabulary: ["ui-kit"],
      model,
      config: ENRICH_CONFIG,
      logger: silentLogger(),
    });
    expect(out[0]!.enrichmentFailed).toBe(true);
    expect(out[0]!.summary).toBeNull();
    expect(out[0]!.id).toBe("alpha/ui-kit");
  });

  it("retries the configured number of times before giving up", async () => {
    const model = refusingModel(RATE_LIMIT);
    await enrichPackages({
      packages: [entry],
      repoRootAbs: `${fixtureEstateRoot()}/alpha`,
      vocabulary: ["ui-kit"],
      model,
      config: ENRICH_CONFIG,
      logger: silentLogger(),
    });
    expect(model.calls).toBe(ENRICH_CONFIG.maxRetries + 1);
  });

  it("keeps every deterministic field intact", async () => {
    const out = await enrichPackages({
      packages: [entry],
      repoRootAbs: `${fixtureEstateRoot()}/alpha`,
      vocabulary: ["ui-kit"],
      model: refusingModel(BILLING),
      config: ENRICH_CONFIG,
      logger: silentLogger(),
    });
    expect(out[0]!.exports).toEqual(["Button"]);
    expect(out[0]!.significance).toBe(0.6);
    expect(out[0]!.path).toBe("alpha/packages/ui-kit");
  });

  it("keeps packages reachable rather than throwing or dropping them", async () => {
    const domains = await enrichDomains({
      repo: { id: "alpha", path: "alpha", tier: "core", vcs: "git" },
      packages: [entry],
      repoRootAbs: `${fixtureEstateRoot()}/alpha`,
      vocabulary: ["ui-kit"],
      model: refusingModel(BILLING),
      config: ENRICH_CONFIG,
      logger: silentLogger(),
      scannedSha: "abc",
    });
    // A refused model must not make a repository's packages invisible to the
    // matcher. No named domain can be produced, but coverage is preserved.
    expect(domains.map((d) => d.id)).toEqual(["alpha/ungrouped"]);
    expect(domains[0]!.packages).toEqual(["alpha/ui-kit"]);
  });
});

describe("the gate survives a refusing model", () => {
  it("reports unavailable rather than an empty shortlist", async () => {
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos: [repoIndex],
      model: refusingModel(BILLING),
      config: {
  maxCandidates: 5,
  model: "m",
  selectMaxTokens: 4096,
  rankMaxTokens: 1024,
  maxRationaleChars: 400,
},
      logger: silentLogger(),
      maxTokens: 2048,
    });
    // null, not an empty map: an unreachable model must not be reported as an
    // estate that contains nothing.
    expect(result).toBeNull();
  });

  it("reports unavailable rather than no rankings", async () => {
    const rankings = await rankPackagesForComponent({
      component: "billing",
      candidates: [entry],
      model: refusingModel(RATE_LIMIT),
      config: {
  maxCandidates: 5,
  model: "m",
  selectMaxTokens: 4096,
  rankMaxTokens: 1024,
  maxRationaleChars: 400,
},
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: 512,
    });
    expect(rankings).toBeNull();
  });

  it("blocks with UNRESOLVED when the model is down, never BUILD", async () => {
    const record = await runGate({
      specPath: "docs/specs/2026-08-02-x-design.md",
      componentsSource: "document" as const,
      components: ["billing", "auth"],
      repos: [repoIndex],
      manifest: {
        schemaVersion: INDEX_SCHEMA_VERSION,
        generatedAt: "2026-07-27T00:00:00.000Z",
        root: fixtureEstateRoot(),
        repos: [],
      },
      staleRepos: [],
      rootAbs: fixtureEstateRoot(),
      thresholds: {
  reuseThreshold: 0.7,
  extendThreshold: 0.5,
  duplicationThreshold: 0.3,
},
      matching: {
  maxCandidates: 5,
  model: "m",
  selectMaxTokens: 4096,
  rankMaxTokens: 1024,
  maxRationaleChars: 400,
},
      selectMaxTokens: 2048,
      rankMaxTokens: 512,
      model: refusingModel(BILLING),
      clock: fixedClock(NOW),
      logger: silentLogger(),
      maxRetries: 1,
    });

    expect(record.components).toHaveLength(2);
    expect(record.componentsHash).toMatch(/^sha256:/);
    // BUILD would authorise construction. When the matcher never ran, the gate
    // has no evidence that the estate lacks the capability, and authorising a
    // rebuild on no evidence is the precise waste this tool exists to stop.
    expect(record.components.every((c) => c.verdict === "UNRESOLVED")).toBe(true);
    expect(record.components.every((c) => c.target === null)).toBe(true);
    expect(
      record.components.every((c) => c.failedChecks.includes("matcher-unavailable")),
    ).toBe(true);
  });
});
