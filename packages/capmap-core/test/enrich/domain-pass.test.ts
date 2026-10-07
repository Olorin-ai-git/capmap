import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { enrichDomains } from "../../src/enrich/domain-pass.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";
import { scriptedModel, silentLogger } from "../support/doubles.js";

const CFG = { model: "m", effort: "medium", maxRetries: 1, concurrency: 1,
  packageMaxTokens: 512,
  domainMaxTokens: 4096,
  maxPackagesPerDomainCall: 25,
  maxExcerptChars: 4000,
  maxSummaryChars: 600,
};
const REPO = {
  id: "alpha",
  path: "alpha",
  tier: "core" as const,
  vcs: "git" as const,
};

const pkg = (id: string) => ({
  id,
  repo: "alpha",
  kind: "npm-package" as const,
  name: `@alpha/${id.split("/")[1]}`,
  path: `alpha/packages/${id.split("/")[1]}`,
  manifest: "package.json",
  entry: "src/index.ts",
  exports: [],
  deps: { internal: [], external: [] },
  consumers: [],
  deployTarget: null,
  loc: 10,
  hasTests: true,
  hasReadme: true,
  lastCommit: "2026-07-01T00:00:00.000Z",
  significance: 0.6,
  maturity: "ga" as const,
  summary: "does a thing",
  domainTags: ["ui-kit"],
  scannedSha: "abc",
  enrichmentFailed: false,
  extractionFailed: false,
});

const base = {
  repo: REPO,
  repoRootAbs: join(fixtureEstateRoot(), "alpha"),
  vocabulary: ["ui-kit", "email"],
  config: CFG,
  logger: silentLogger(),
  scannedSha: "abc",
};

describe("enrichDomains", () => {
  it("groups packages into domains", async () => {
    const model = scriptedModel([
      JSON.stringify({
        domains: [
          {
            id: "alpha/design-system",
            title: "Design system",
            summary: "Shared UI primitives.",
            domainTags: ["ui-kit"],
            packages: ["alpha/ui-kit"],
            stack: ["react"],
            proofOfLife: { deployed: null, testCount: 12 },
          },
        ],
      }),
    ]);
    const domains = await enrichDomains({
      ...base,
      packages: [pkg("alpha/ui-kit")],
      model,
    });
    expect(domains).toHaveLength(1);
    expect(domains[0]!.packages).toEqual(["alpha/ui-kit"]);
    expect(domains[0]!.tier).toBe("core");
  });

  it("drops package ids the model invented", async () => {
    const model = scriptedModel([
      JSON.stringify({
        domains: [
          {
            id: "alpha/design-system",
            title: "Design system",
            summary: "Shared UI primitives.",
            domainTags: ["ui-kit"],
            packages: ["alpha/ui-kit", "alpha/imaginary"],
            stack: [],
            proofOfLife: { deployed: null, testCount: null },
          },
        ],
      }),
    ]);
    const domains = await enrichDomains({
      ...base,
      packages: [pkg("alpha/ui-kit")],
      model,
    });
    expect(domains[0]!.packages).toEqual(["alpha/ui-kit"]);
  });

  it("discards a domain whose packages are all invented", async () => {
    const model = scriptedModel([
      JSON.stringify({
        domains: [
          {
            id: "alpha/ghost",
            title: "Ghost",
            summary: "Nothing.",
            domainTags: ["ui-kit"],
            packages: ["alpha/imaginary"],
            stack: [],
            proofOfLife: { deployed: null, testCount: null },
          },
        ],
      }),
    ]);
    const domains = await enrichDomains({
      ...base,
      packages: [pkg("alpha/ui-kit")],
      model,
    });
    // The invented domain is discarded, but the real package must still be
    // reachable: the matcher reaches packages only through domains, so a
    // package no domain names is invisible to the gate however good a match it
    // would be.
    expect(domains.map((d) => d.id)).toEqual(["alpha/ungrouped"]);
    expect(domains[0]!.packages).toEqual(["alpha/ui-kit"]);
  });

  it("leaves no significant package unreachable by the matcher", async () => {
    const model = scriptedModel([
      JSON.stringify({
        domains: [
          {
            id: "alpha/design-system",
            title: "Design system",
            summary: "UI primitives.",
            domainTags: ["ui-kit"],
            packages: ["alpha/ui-kit"],
            stack: [],
            proofOfLife: { deployed: null, testCount: null },
          },
        ],
      }),
    ]);
    // The model mentions one package and silently omits the other. On the real
    // estate this orphaned seven capabilities in a single repository.
    const domains = await enrichDomains({
      ...base,
      packages: [pkg("alpha/ui-kit"), pkg("alpha/forgotten")],
      model,
    });
    const covered = new Set(domains.flatMap((d) => d.packages));
    expect(covered.has("alpha/ui-kit")).toBe(true);
    expect(covered.has("alpha/forgotten")).toBe(true);
  });

  it("returns no domains when the repository has no significant packages", async () => {
    const model = scriptedModel(['{"domains":[]}']);
    const domains = await enrichDomains({ ...base, packages: [], model });
    expect(domains).toEqual([]);
    expect(model.calls).toBe(0);
  });
});
