import { describe, it, expect } from "vitest";
import {
  INDEX_SCHEMA_VERSION,
  PackageEntrySchema,
  DomainEntrySchema,
  IndexManifestSchema,
} from "../../src/model/index-schema.js";

const pkg = {
  id: "olorin/shared-email",
  repo: "olorin",
  kind: "npm-package",
  name: "@olorin/shared-email",
  path: "olorin/olorin-core/packages/shared-email",
  manifest: "package.json",
  entry: "src/index.ts",
  exports: ["sendTemplated"],
  deps: { internal: ["@olorin/shared-types"], external: ["mjml"] },
  consumers: ["angainor"],
  deployTarget: { kind: "firebase-functions", config: "firebase.json" },
  loc: 1840,
  hasTests: true,
  hasReadme: true,
  lastCommit: "2026-07-05T00:00:00.000Z",
  significance: 0.82,
  maturity: "ga",
  summary: "Templated transactional email delivery.",
  domainTags: ["email"],
  scannedSha: "a13c9e2",
  enrichmentFailed: false,
  extractionFailed: false,
};

describe("index schemas", () => {
  it("accepts a complete package entry", () => {
    expect(PackageEntrySchema.parse(pkg).id).toBe("olorin/shared-email");
  });

  it("accepts a package entry with a null deploy target and absent summary", () => {
    const bare = { ...pkg, deployTarget: null, summary: null, domainTags: [] };
    expect(PackageEntrySchema.parse(bare).deployTarget).toBeNull();
  });

  it("rejects a significance score outside 0..1", () => {
    expect(() =>
      PackageEntrySchema.parse({ ...pkg, significance: 1.4 }),
    ).toThrow();
  });

  it("rejects an unknown package kind", () => {
    expect(() =>
      PackageEntrySchema.parse({ ...pkg, kind: "binary" }),
    ).toThrow();
  });

  it("requires a domain entry to reference at least one package", () => {
    expect(() =>
      DomainEntrySchema.parse({
        id: "a/b",
        repo: "a",
        tier: "active",
        title: "T",
        summary: "S",
        domainTags: ["auth"],
        packages: [],
        stack: ["fastify"],
        maturity: "ga",
        proofOfLife: { deployed: null, testCount: null, lastCommit: null },
        scannedSha: "abc",
      }),
    ).toThrow();
  });

  it("pins the manifest schema version", () => {
    const manifest = IndexManifestSchema.parse({
      schemaVersion: INDEX_SCHEMA_VERSION,
      generatedAt: "2026-07-27T00:00:00.000Z",
      root: "/estate",
      repos: [],
    });
    expect(manifest.schemaVersion).toBe(1);
  });
});
