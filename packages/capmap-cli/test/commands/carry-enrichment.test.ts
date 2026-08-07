import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexStore, INDEX_SCHEMA_VERSION } from "@capmap/core";
import type { DomainEntry, PackageEntry, RepoIndex } from "@capmap/core";
import { carryEnrichment } from "../../src/commands/carry-enrichment.js";

function pkg(id: string, enriched: boolean): PackageEntry {
  return {
    id,
    repo: "alpha",
    kind: "npm-package",
    name: `@alpha/${id.split("/")[1] ?? id}`,
    path: `alpha/packages/${id.split("/")[1] ?? id}`,
    manifest: "package.json",
    entry: "src/index.ts",
    exports: [],
    deps: { internal: [], external: [] },
    consumers: [],
    deployTarget: null,
    loc: 10,
    hasTests: false,
    hasReadme: false,
    lastCommit: null,
    significance: 0.6,
    maturity: "beta",
    summary: enriched ? "A described package." : null,
    domainTags: enriched ? ["ui-kit"] : [],
    scannedSha: null,
    enrichmentFailed: false,
    extractionFailed: false,
  };
}

const domain: DomainEntry = {
  id: "alpha/design-system",
  repo: "alpha",
  tier: "core",
  title: "Design system",
  summary: "UI primitives.",
  domainTags: ["ui-kit"],
  packages: ["alpha/ui-kit", "alpha/gone"],
  stack: [],
  maturity: "beta",
  proofOfLife: { deployed: null, testCount: null, lastCommit: null },
  scannedSha: null,
};

async function storeWith(index: Partial<RepoIndex>): Promise<IndexStore> {
  const dir = await mkdtemp(join(tmpdir(), "capmap-carry-"));
  const store = new IndexStore({ indexDirAbs: dir });
  await store.writeRepo({
    schemaVersion: INDEX_SCHEMA_VERSION,
    repo: "alpha",
    tier: "core",
    domains: [],
    packages: [],
    minor: [],
    ...index,
  });
  return store;
}

describe("carryEnrichment", () => {
  it("carries summary and tags forward by package id", async () => {
    const store = await storeWith({ packages: [pkg("alpha/ui-kit", true)] });
    const { packages } = await carryEnrichment(store, "alpha", [
      pkg("alpha/ui-kit", false),
    ]);
    expect(packages[0]!.summary).toBe("A described package.");
    expect(packages[0]!.domainTags).toEqual(["ui-kit"]);
  });

  it("keeps the freshly scanned deterministic fields", async () => {
    const previous = {
      ...pkg("alpha/ui-kit", true),
      loc: 999,
      significance: 0.1,
    };
    const store = await storeWith({ packages: [previous] });
    const scanned = pkg("alpha/ui-kit", false);
    const { packages } = await carryEnrichment(store, "alpha", [scanned]);
    // Enrichment is prose about the code; the measurements come from this scan.
    expect(packages[0]!.loc).toBe(scanned.loc);
    expect(packages[0]!.significance).toBe(scanned.significance);
  });

  it("leaves a newly discovered package unenriched", async () => {
    const store = await storeWith({ packages: [pkg("alpha/ui-kit", true)] });
    const { packages } = await carryEnrichment(store, "alpha", [
      pkg("alpha/brand-new", false),
    ]);
    expect(packages[0]!.summary).toBeNull();
    expect(packages[0]!.domainTags).toEqual([]);
  });

  it("carries domains forward, dropping members that no longer exist", async () => {
    const store = await storeWith({
      packages: [pkg("alpha/ui-kit", true)],
      domains: [domain],
    });
    const { domains } = await carryEnrichment(store, "alpha", [
      pkg("alpha/ui-kit", false),
    ]);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.packages).toEqual(["alpha/ui-kit"]);
  });

  it("discards a domain whose every package is gone", async () => {
    const store = await storeWith({
      packages: [pkg("alpha/ui-kit", true)],
      domains: [{ ...domain, packages: ["alpha/vanished"] }],
    });
    const { domains } = await carryEnrichment(store, "alpha", [
      pkg("alpha/ui-kit", false),
    ]);
    expect(domains).toEqual([]);
  });

  it("returns the scan untouched when nothing is stored yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-carry-"));
    const store = new IndexStore({ indexDirAbs: dir });
    const scanned = [pkg("alpha/ui-kit", false)];
    const result = await carryEnrichment(store, "alpha", scanned);
    expect(result.packages).toEqual(scanned);
    expect(result.domains).toEqual([]);
  });
});
