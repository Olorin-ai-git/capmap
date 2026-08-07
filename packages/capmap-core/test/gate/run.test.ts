import { describe, it, expect } from "vitest";
import { runGate } from "../../src/gate/run.js";
import { competingImplementations } from "../../src/gate/resolve.js";
import { INDEX_SCHEMA_VERSION } from "../../src/model/index-schema.js";
import type {
  IndexManifest,
  RepoIndex,
} from "../../src/model/index-schema.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";
import { fixedClock, scriptedModel, silentLogger } from "../support/doubles.js";

const NOW = new Date("2026-08-02T00:00:00.000Z");
const THRESHOLDS = {
  reuseThreshold: 0.7,
  extendThreshold: 0.5,
  duplicationThreshold: 0.3,
};
const MATCHING = {
  maxCandidates: 5,
  model: "m",
  effort: "high",
  selectMaxTokens: 4096,
  rankMaxTokens: 1024,
};

const uiKit = {
  id: "alpha/ui-kit",
  repo: "alpha",
  kind: "npm-package" as const,
  name: "@alpha/ui-kit",
  path: "alpha/packages/ui-kit",
  manifest: "package.json",
  entry: "src/index.ts",
  exports: ["Button", "Modal", "useTheme"],
  deps: { internal: [], external: [] },
  consumers: [],
  deployTarget: null,
  loc: 40,
  hasTests: true,
  hasReadme: true,
  lastCommit: null,
  significance: 0.7,
  maturity: "beta" as const,
  summary: "UI kit.",
  domainTags: ["ui-kit"],
  scannedSha: "abc",
  enrichmentFailed: false,
  extractionFailed: false,
};

const mailer = {
  ...uiKit,
  id: "alpha/mailer",
  name: "@alpha/mailer",
  path: "alpha/packages/mailer",
  exports: ["sendTemplated"],
  summary: "Email.",
  domainTags: ["email"],
};

function repoIndex(tier: "core" | "external" | "archived"): RepoIndex {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    repo: "alpha",
    tier,
    domains: [
      {
        id: "alpha/design-system",
        repo: "alpha",
        tier,
        title: "Design system",
        summary: "UI primitives.",
        domainTags: ["ui-kit"],
        packages: ["alpha/ui-kit", "alpha/mailer"],
        stack: ["react"],
        maturity: "ga" as const,
        proofOfLife: { deployed: null, testCount: null, lastCommit: null },
        scannedSha: "abc",
      },
    ],
    packages: [uiKit, mailer],
    minor: [],
  };
}

/** A second repository holding a rival implementation of the same capability. */
const rivalRepo: RepoIndex = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  repo: "epsilon",
  tier: "core",
  domains: [
    {
      id: "epsilon/design-system",
      repo: "epsilon",
      tier: "core",
      title: "Rival design system",
      summary: "Another UI kit.",
      domainTags: ["ui-kit"],
      packages: ["epsilon/ui-kit"],
      stack: ["react"],
      maturity: "ga" as const,
      proofOfLife: { deployed: null, testCount: null, lastCommit: null },
      scannedSha: "def",
    },
  ],
  packages: [
    {
      ...uiKit,
      id: "epsilon/ui-kit",
      repo: "epsilon",
      name: "@epsilon/beacon-lib",
      path: "epsilon",
      entry: "src/index.ts",
      exports: ["scoreRisk"],
      scannedSha: "def",
    },
  ],
  minor: [],
};

const manifest: IndexManifest = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  generatedAt: "2026-07-27T00:00:00.000Z",
  root: fixtureEstateRoot(),
  repos: [],
};

const base = {
  specPath: "docs/specs/2026-08-02-x-design.md",
  componentsSource: "document" as const,
  rootAbs: fixtureEstateRoot(),
  manifest,
  staleRepos: [] as string[],
  thresholds: THRESHOLDS,
  matching: MATCHING,
  selectMaxTokens: 2048,
  rankMaxTokens: 512,
  clock: fixedClock(NOW),
  logger: silentLogger(),
  maxRetries: 1,
};

const shortlist = (component: string, domains: string[]) =>
  JSON.stringify({ selections: [{ component, domains }] });

const rank = (rankings: unknown[]) => JSON.stringify({ rankings });

describe("runGate", () => {
  it("produces a verified REUSE verdict", async () => {
    const model = scriptedModel([
      shortlist("ui kit", ["alpha/design-system"]),
      rank([
        { packageId: "alpha/ui-kit", score: 0.9, rationale: "Exactly this." },
      ]),
    ]);
    const record = await runGate({
      ...base,
      components: ["ui kit"],
      repos: [repoIndex("core")],
      model,
    });
    expect(record.components[0]!.verdict).toBe("REUSE");
    expect(record.components[0]!.target).toBe("alpha/ui-kit");
    expect(record.components[0]!.verifiedSha).toBe("abc");
    expect(record.components[0]!.competing).toEqual([]);
  });

  it("caps an external-tier match at REFERENCE however high it scores", async () => {
    const model = scriptedModel([
      shortlist("ui kit", ["alpha/design-system"]),
      rank([
        { packageId: "alpha/ui-kit", score: 0.95, rationale: "Exactly this." },
      ]),
    ]);
    const record = await runGate({
      ...base,
      components: ["ui kit"],
      repos: [repoIndex("external")],
      model,
    });
    expect(record.components[0]!.verdict).toBe("REFERENCE");
  });

  it("returns BUILD with no target when nothing is shortlisted", async () => {
    const model = scriptedModel([JSON.stringify({ selections: [] })]);
    const record = await runGate({
      ...base,
      components: ["holography"],
      repos: [repoIndex("core")],
      model,
    });
    expect(record.components[0]!.verdict).toBe("BUILD");
    expect(record.components[0]!.score).toBe(0);
    expect(record.components[0]!.target).toBeNull();
  });

  it("downgrades to UNRESOLVED when verification fails, naming the check", async () => {
    const drifted = repoIndex("core");
    drifted.packages = [{ ...uiKit, exports: ["Button", "Vanished"] }, mailer];
    const model = scriptedModel([
      shortlist("ui kit", ["alpha/design-system"]),
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Close." }]),
    ]);
    const record = await runGate({
      ...base,
      components: ["ui kit"],
      repos: [drifted],
      model,
    });
    expect(record.components[0]!.verdict).toBe("UNRESOLVED");
    expect(record.components[0]!.failedChecks).toEqual(["exports"]);
    expect(record.components[0]!.bestCandidate).toBe("alpha/ui-kit");
    expect(record.components[0]!.target).toBeNull();
  });

  it("reports a rival implementation from another repository", async () => {
    const model = scriptedModel([
      shortlist("ui kit", ["alpha/design-system", "epsilon/design-system"]),
      rank([
        { packageId: "alpha/ui-kit", score: 0.9, rationale: "Best fit." },
        { packageId: "epsilon/ui-kit", score: 0.72, rationale: "Also fits." },
      ]),
    ]);
    const record = await runGate({
      ...base,
      components: ["ui kit"],
      repos: [repoIndex("core"), rivalRepo],
      model,
    });
    const verdict = record.components[0]!;
    expect(verdict.verdict).toBe("REUSE");
    expect(verdict.target).toBe("alpha/ui-kit");
    expect(verdict.competing).toEqual([
      { packageId: "epsilon/ui-kit", repo: "epsilon", score: 0.72 },
    ]);
  });

  it("records the component hash, generation time and stale repositories", async () => {
    const model = scriptedModel([JSON.stringify({ selections: [] })]);
    const record = await runGate({
      ...base,
      components: ["a", "b"],
      repos: [repoIndex("core")],
      model,
      staleRepos: ["alpha"],
    });
    expect(record.componentsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record.generatedAt).toBe(NOW.toISOString());
    expect(record.staleRepos).toEqual(["alpha"]);
    expect(record.feature).toBe("x");
    expect(record.components).toHaveLength(2);
  });
});

describe("competingImplementations", () => {
  const repos = [repoIndex("core"), rivalRepo];
  const winner = { packageId: "alpha/ui-kit", score: 0.9, rationale: "x" };

  it("reports a rival from a different repository above the threshold", () => {
    const out = competingImplementations(
      [winner, { packageId: "epsilon/ui-kit", score: 0.8, rationale: "y" }],
      winner,
      repos,
      0.5,
    );
    expect(out).toEqual([
      { packageId: "epsilon/ui-kit", repo: "epsilon", score: 0.8 },
    ]);
  });

  it("ignores a rival from the SAME repository, which is layering not duplication", () => {
    const out = competingImplementations(
      [winner, { packageId: "alpha/mailer", score: 0.8, rationale: "y" }],
      winner,
      repos,
      0.5,
    );
    expect(out).toEqual([]);
  });

  it("ignores a rival scoring below the extend threshold", () => {
    const out = competingImplementations(
      [winner, { packageId: "epsilon/ui-kit", score: 0.3, rationale: "y" }],
      winner,
      repos,
      0.5,
    );
    expect(out).toEqual([]);
  });

  it("returns nothing when the winner is the only ranking", () => {
    expect(competingImplementations([winner], winner, repos, 0.5)).toEqual([]);
  });

  it("ignores a ranking whose package is absent from the index", () => {
    const out = competingImplementations(
      [winner, { packageId: "ghost/thing", score: 0.9, rationale: "y" }],
      winner,
      repos,
      0.5,
    );
    expect(out).toEqual([]);
  });
});

/**
 * Duplication discovery is deliberately decoupled from the reuse thresholds.
 * "Is this worth adopting" and "does this already exist" are different
 * questions; answering only the first is how a genuine second implementation
 * stays invisible to the operator.
 */
describe("competing detection below the extend threshold", () => {
  const repos = [repoIndex("core"), rivalRepo];
  const winner = { packageId: "alpha/ui-kit", score: 0.9, rationale: "x" };
  const weakRival = {
    packageId: "epsilon/ui-kit",
    score: 0.4,
    rationale: "poor fit, but it exists",
  };

  it("reports a rival that would never be adopted", () => {
    const out = competingImplementations([winner, weakRival], winner, repos, 0.3);
    expect(out).toEqual([
      { packageId: "epsilon/ui-kit", repo: "epsilon", score: 0.4 },
    ]);
  });

  it("would have hidden that rival under the old extend threshold", () => {
    expect(competingImplementations([winner, weakRival], winner, repos, 0.5)).toEqual(
      [],
    );
  });

  it("still ignores a rival below the duplication threshold", () => {
    const noise = { ...weakRival, score: 0.1 };
    expect(competingImplementations([winner, noise], winner, repos, 0.3)).toEqual(
      [],
    );
  });

  it("still ignores a same-repository match, which is layering", () => {
    const sibling = { packageId: "alpha/mailer", score: 0.4, rationale: "y" };
    expect(competingImplementations([winner, sibling], winner, repos, 0.3)).toEqual(
      [],
    );
  });
});

/**
 * Existence and adoptability answer different questions and the ranker reports
 * them separately. A capability bundled inside a larger platform is unadoptable
 * — a low score — while still being a second implementation, which is the more
 * valuable finding. Judging duplication on the score alone hid exactly that:
 * live, the Angainor and TwoGates control planes score 0.15–0.20 for auth,
 * billing and email, and every one of them is a real duplicate.
 */
describe("duplication judged on existence, not adoptability", () => {
  const repos = [repoIndex("core"), rivalRepo];
  const winner = { packageId: "alpha/ui-kit", score: 0.9, rationale: "x" };

  it("reports an unadoptable rival that says it implements the capability", () => {
    const embedded = {
      packageId: "epsilon/ui-kit",
      score: 0.15,
      implementsIt: true,
      rationale: "Bundled inside a platform server; exists but not extractable.",
    };
    const out = competingImplementations([winner, embedded], winner, repos, 0.3);
    expect(out).toEqual([
      { packageId: "epsilon/ui-kit", repo: "epsilon", score: 0.15 },
    ]);
  });

  it("ignores a low-scoring rival that does NOT claim to implement it", () => {
    const unrelated = {
      packageId: "epsilon/ui-kit",
      score: 0.15,
      implementsIt: false,
      rationale: "Unrelated.",
    };
    expect(
      competingImplementations([winner, unrelated], winner, repos, 0.3),
    ).toEqual([]);
  });

  it("falls back to the score when the ranker omitted the flag", () => {
    const legacy = { packageId: "epsilon/ui-kit", score: 0.6, rationale: "y" };
    expect(
      competingImplementations([winner, legacy], winner, repos, 0.3),
    ).toHaveLength(1);
  });
});
