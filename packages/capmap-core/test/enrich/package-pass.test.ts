import { describe, it, expect } from "vitest";
import { enrichPackages } from "../../src/enrich/package-pass.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";
import { scriptedModel, silentLogger } from "../support/doubles.js";
import { join } from "node:path";

const VOCAB = ["ui-kit", "email", "auth"];
const CFG = { model: "m", effort: "medium", maxRetries: 2, concurrency: 2,
  packageMaxTokens: 512,
  domainMaxTokens: 4096,
  maxPackagesPerDomainCall: 25,
  maxExcerptChars: 4000,
  maxSummaryChars: 600,
};

const entry = {
  id: "alpha/ui-kit",
  repo: "alpha",
  kind: "npm-package" as const,
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
  maturity: "beta" as const,
  summary: null,
  domainTags: [],
  scannedSha: null,
  enrichmentFailed: false,
  extractionFailed: false,
};

describe("enrichPackages", () => {
  it("populates summary and vocabulary-constrained tags", async () => {
    const model = scriptedModel([
      JSON.stringify({
        summary: "Glass UI component kit.",
        domainTags: ["ui-kit"],
      }),
    ]);
    const [out] = await enrichPackages({
      packages: [entry],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(out!.summary).toBe("Glass UI component kit.");
    expect(out!.domainTags).toEqual(["ui-kit"]);
    expect(out!.enrichmentFailed).toBe(false);
  });

  it("drops tags outside the controlled vocabulary", async () => {
    const model = scriptedModel([
      JSON.stringify({
        summary: "A kit.",
        domainTags: ["ui-kit", "quantum-blockchain"],
      }),
    ]);
    const [out] = await enrichPackages({
      packages: [entry],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(out!.domainTags).toEqual(["ui-kit"]);
  });

  it("retries invalid output then flags enrichmentFailed", async () => {
    const model = scriptedModel(["not json", "still not json", '{"bad":true}']);
    const [out] = await enrichPackages({
      packages: [entry],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(out!.enrichmentFailed).toBe(true);
    expect(out!.summary).toBeNull();
    expect(model.calls).toBe(3);
  });

  it("respects the concurrency bound", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...entry,
      id: `alpha/p${i}`,
    }));
    const model = scriptedModel([
      JSON.stringify({ summary: "x.", domainTags: ["ui-kit"] }),
    ]);
    const out = await enrichPackages({
      packages: many,
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(out).toHaveLength(6);
    expect(out.every((p) => p.summary === "x.")).toBe(true);
  });

  it("treats a brace-wrapped non-JSON response as invalid and retries", async () => {
    const model = scriptedModel([
      "{ this is not json }",
      JSON.stringify({ summary: "Recovered.", domainTags: ["ui-kit"] }),
    ]);
    const [out] = await enrichPackages({
      packages: [entry],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(model.calls).toBe(2);
    expect(out!.summary).toBe("Recovered.");
  });

  it("rejects a response whose tags all fall outside the vocabulary", async () => {
    const model = scriptedModel([
      JSON.stringify({ summary: "A kit.", domainTags: ["quantum-blockchain"] }),
      JSON.stringify({ summary: "A kit.", domainTags: ["auth"] }),
    ]);
    const [out] = await enrichPackages({
      packages: [entry],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(model.calls).toBe(2);
    expect(out!.domainTags).toEqual(["auth"]);
  });

  it("enriches a package that has neither a README nor an entry file", async () => {
    const model = scriptedModel([
      JSON.stringify({ summary: "Console app.", domainTags: ["ui-kit"] }),
    ]);
    const [out] = await enrichPackages({
      packages: [
        {
          ...entry,
          id: "alpha/console",
          name: "console",
          path: "alpha/apps/console",
          entry: null,
          deployTarget: {
            kind: "firebase-hosting" as const,
            config: "firebase.json",
          },
        },
      ],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(out!.summary).toBe("Console app.");
    expect(out!.enrichmentFailed).toBe(false);
  });

  it("returns an empty list when there is nothing to enrich", async () => {
    const model = scriptedModel([]);
    const out = await enrichPackages({
      packages: [],
      repoRootAbs: join(fixtureEstateRoot(), "alpha"),
      vocabulary: VOCAB,
      model,
      config: CFG,
      logger: silentLogger(),
    });
    expect(out).toEqual([]);
    expect(model.calls).toBe(0);
  });
});
