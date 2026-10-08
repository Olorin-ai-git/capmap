import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/load.js";

async function fixtureConfigDir(overrides: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "capmap-cfg-"));
  await mkdir(dir, { recursive: true });
  const scan = {
    root: null,
    excludePaths: ["node_modules"],
    internalScopes: ["@olorin/"],
    python: { subpackageMaxDepth: 3 },
    search: { minTermOverlap: 0.5, minPartialTermLength: 4, minQueryTermLength: 2, stopwords: ["the"] },
    significance: {
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
    },
    maturity: { gaRecencyDays: 180 },
    verdicts: {
      reuseThreshold: 0.7,
      extendThreshold: 0.5,
      duplicationThreshold: 0.3,
    },
    matching: {
      maxCandidates: 5,
      model: "claude-opus-5",
      selectMaxTokens: 4096,
      rankMaxTokens: 1024,
      maxRationaleChars: 400,
    },
    enrichment: {
      model: "claude-sonnet-5",
      maxRetries: 2,
      concurrency: 8,
      packageMaxTokens: 512,
      domainMaxTokens: 4096,
      maxPackagesPerDomainCall: 25,
      maxExcerptChars: 4000,
      maxSummaryChars: 600,
    },
    hook: {
      specGlobs: ["**/specs/**"],
      planGlobs: ["**/plans/**"],
      exemptGlobs: ["**/.claude/plans/*.md"],
      deadlineMs: 5000,
      maxShellWords: 4096,
      maxShellPaths: 10000,
    },
    index: { dir: "index" },
    expectedCounts: {
      domainsMin: 60,
      domainsMax: 140,
      packagesMin: 150,
      packagesMax: 260,
    },
    ...overrides,
  };
  await writeFile(join(dir, "scan.config.json"), JSON.stringify(scan));
  await writeFile(
    join(dir, "repos.json"),
    JSON.stringify({
      repos: [{ id: "olorin", path: "olorin", tier: "core", vcs: "git" }],
    }),
  );
  await writeFile(
    join(dir, "domain-vocabulary.json"),
    JSON.stringify({ tags: ["billing", "auth"] }),
  );
  return dir;
}

describe("loadConfig", () => {
  it("resolves root from CAPMAP_ROOT when scan.root is null", async () => {
    const dir = await fixtureConfigDir();
    const cfg = await loadConfig({
      configDir: dir,
      env: { CAPMAP_ROOT: "/estate" },
    });
    expect(cfg.root).toBe("/estate");
    expect(cfg.repos.repos[0]!.tier).toBe("core");
    expect(cfg.vocabulary).toContain("billing");
  });

  it("throws when no root can be resolved", async () => {
    const dir = await fixtureConfigDir();
    await expect(loadConfig({ configDir: dir, env: {} })).rejects.toThrow(
      /CAPMAP_ROOT/,
    );
  });

  it("throws when significance weights do not sum to 1", async () => {
    const dir = await fixtureConfigDir({
      significance: {
        threshold: 0.45,
        weights: {
          publishedOrExported: 0.9,
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
      },
    });
    await expect(
      loadConfig({ configDir: dir, env: { CAPMAP_ROOT: "/e" } }),
    ).rejects.toThrow(/sum to 1/);
  });

  it("rejects a repo entry with an unknown tier", async () => {
    const dir = await fixtureConfigDir();
    await writeFile(
      join(dir, "repos.json"),
      JSON.stringify({
        repos: [{ id: "x", path: "x", tier: "wat", vcs: "git" }],
      }),
    );
    await expect(
      loadConfig({ configDir: dir, env: { CAPMAP_ROOT: "/e" } }),
    ).rejects.toThrow();
  });
});
