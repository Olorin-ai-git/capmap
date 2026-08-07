import { describe, it, expect } from "vitest";
import { buildConsumerIndex } from "../../src/scanner/consumers.js";
import { deriveMaturity } from "../../src/scanner/maturity.js";
import { scoreSignificance } from "../../src/scanner/significance.js";

const SIG = {
  threshold: 0.45,
  weights: {
    publishedOrExported: 0.2,
    internalConsumers: 0.2,
    deployTarget: 0.15,
    tests: 0.15,
    readme: 0.1,
    sourceSize: 0.1,
    commitRecency: 0.1,
  },
  consumerSaturation: 8,
  locSaturation: 5000,
  recencyHalfLifeDays: 365,
};
const NOW = new Date("2026-07-27T00:00:00.000Z");

describe("buildConsumerIndex", () => {
  it("maps a package id to every package depending on it", () => {
    const index = buildConsumerIndex([
      { id: "a/ui", name: "@a/ui", relPath: "packages/ui", internalDeps: [] },
      {
        id: "a/mailer",
        name: "@a/mailer",
        relPath: "packages/mailer",
        internalDeps: ["@a/ui"],
      },
      {
        id: "a/console",
        name: "@a/console",
        relPath: "apps/console",
        internalDeps: ["@a/ui", "@a/mailer"],
      },
    ]);
    // Keyed by id rather than name: three packages in this estate declare the
    // name @olorin/glass-ui, and keying on name pooled their consumers.
    expect(index.byId.get("a/ui")).toEqual(["a/console", "a/mailer"]);
    expect(index.byId.get("a/mailer")).toEqual(["a/console"]);
    expect(index.byId.get("a/console")).toBeUndefined();
  });
});

describe("deriveMaturity", () => {
  const base = {
    tier: "active" as const,
    hasDeployTarget: true,
    hasTests: true,
    hasReadme: true,
    lastCommit: "2026-06-01T00:00:00.000Z",
    now: NOW,
    gaRecencyDays: 180,
  };
  it("returns archived for an archived tier regardless of other signals", () => {
    expect(deriveMaturity({ ...base, tier: "archived" })).toBe("archived");
  });
  it("returns ga when every signal is present and the commit is recent", () => {
    expect(deriveMaturity(base)).toBe("ga");
  });
  it("drops to beta when the commit is older than the recency window", () => {
    expect(
      deriveMaturity({ ...base, lastCommit: "2024-01-01T00:00:00.000Z" }),
    ).toBe("beta");
  });
  it("returns prototype without a readme", () => {
    expect(
      deriveMaturity({ ...base, hasReadme: false, hasDeployTarget: false }),
    ).toBe("prototype");
  });
});

describe("scoreSignificance", () => {
  const bare = {
    publishedOrExported: false,
    consumerCount: 0,
    hasDeployTarget: false,
    hasTests: false,
    hasReadme: false,
    loc: 0,
    lastCommit: null,
  };
  it("scores an empty candidate at zero", () => {
    expect(scoreSignificance(bare, SIG, NOW).total).toBe(0);
  });
  it("scores a fully-signalled recent candidate at one", () => {
    const full = {
      publishedOrExported: true,
      consumerCount: 8,
      hasDeployTarget: true,
      hasTests: true,
      hasReadme: true,
      loc: 5000,
      lastCommit: NOW.toISOString(),
    };
    expect(scoreSignificance(full, SIG, NOW).total).toBeCloseTo(1, 5);
  });
  it("weights each signal independently", () => {
    const onlyTests = scoreSignificance({ ...bare, hasTests: true }, SIG, NOW);
    expect(onlyTests.total).toBeCloseTo(0.15, 5);
    expect(onlyTests.parts.tests).toBeCloseTo(0.15, 5);
  });
  it("halves the recency contribution at one half-life", () => {
    const aged = new Date(NOW.getTime() - 365 * 24 * 3600 * 1000).toISOString();
    const scored = scoreSignificance({ ...bare, lastCommit: aged }, SIG, NOW);
    expect(scored.parts.commitRecency).toBeCloseTo(0.05, 5);
  });
  it("saturates the consumer contribution beyond the saturation point", () => {
    const many = scoreSignificance({ ...bare, consumerCount: 50 }, SIG, NOW);
    expect(many.parts.internalConsumers).toBeCloseTo(0.2, 5);
  });
});
