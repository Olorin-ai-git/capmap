import { describe, it, expect } from "vitest";
import { chunkPackagesForDomains } from "../../src/enrich/domain-chunks.js";
import type { PackageEntry } from "../../src/model/index-schema.js";

function pkg(path: string): PackageEntry {
  return {
    id: path,
    repo: "olorin",
    kind: "npm-package",
    name: `@olorin/${path.split("/").pop() ?? path}`,
    path,
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
    significance: 0.5,
    maturity: "beta",
    summary: null,
    domainTags: [],
    scannedSha: null,
    enrichmentFailed: false,
    extractionFailed: false,
  };
}

describe("chunkPackagesForDomains", () => {
  it("returns nothing for an empty repository", () => {
    expect(chunkPackagesForDomains([], 40)).toEqual([]);
  });

  it("returns one chunk when everything fits", () => {
    const packages = [pkg("olorin/a"), pkg("olorin/b")];
    expect(chunkPackagesForDomains(packages, 40)).toEqual([packages]);
  });

  it("groups by first subtree rather than slicing alphabetically", () => {
    const packages = [
      pkg("olorin/olorin-core/packages/ui"),
      pkg("olorin/olorin-media/web"),
      pkg("olorin/olorin-core/packages/email"),
      pkg("olorin/olorin-media/api"),
    ];
    const chunks = chunkPackagesForDomains(packages, 2);
    const subtrees = chunks.map(
      (chunk) => new Set(chunk.map((entry) => entry.path.split("/")[1])),
    );
    // Every chunk draws from exactly one subtree, so related packages are
    // described together rather than split across unrelated calls.
    for (const set of subtrees) expect(set.size).toBe(1);
  });

  it("splits a subtree larger than the limit", () => {
    const packages = Array.from({ length: 7 }, (_, i) =>
      pkg(`olorin/olorin-core/p${String(i)}`),
    );
    const chunks = chunkPackagesForDomains(packages, 3);
    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 3, 1]);
  });

  it("loses no package when chunking", () => {
    const packages = [
      ...Array.from({ length: 50 }, (_, i) => pkg(`olorin/core/p${String(i)}`)),
      ...Array.from({ length: 30 }, (_, i) =>
        pkg(`olorin/media/p${String(i)}`),
      ),
    ];
    const chunks = chunkPackagesForDomains(packages, 40);
    const ids = chunks.flat().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(packages.length);
  });

  it("keeps every chunk within the limit", () => {
    const packages = Array.from({ length: 169 }, (_, i) =>
      pkg(`olorin/sub${String(i % 5)}/p${String(i)}`),
    );
    for (const chunk of chunkPackagesForDomains(packages, 40)) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
  });

  it("handles the real shape that failed: 169 packages in one repository", () => {
    const packages = Array.from({ length: 169 }, (_, i) =>
      pkg(`olorin/olorin-core/packages/p${String(i)}`),
    );
    const chunks = chunkPackagesForDomains(packages, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(169);
  });
});
