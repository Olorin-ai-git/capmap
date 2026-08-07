import { describe, it, expect } from "vitest";
import { verifyCapability } from "../../src/verify/verify.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";

const entry = {
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
  summary: null,
  domainTags: [],
  scannedSha: null,
  enrichmentFailed: false,
  extractionFailed: false,
};

describe("verifyCapability", () => {
  const rootAbs = fixtureEstateRoot();

  it("passes every check for an unchanged package", async () => {
    const result = await verifyCapability({ entry, rootAbs });
    expect(result).toEqual({
      id: "alpha/ui-kit",
      ok: true,
      failed: [],
      detail: null,
    });
  });

  it("fails the path check when the directory is gone", async () => {
    const result = await verifyCapability({
      entry: { ...entry, path: "alpha/packages/gone" },
      rootAbs,
    });
    expect(result.failed).toEqual(["path"]);
  });

  it("fails the manifest-name check when the package was renamed", async () => {
    const result = await verifyCapability({
      entry: { ...entry, name: "@alpha/renamed" },
      rootAbs,
    });
    expect(result.failed).toEqual(["manifest-name"]);
  });

  it("fails the entry check when the entry file is gone", async () => {
    const result = await verifyCapability({
      entry: { ...entry, entry: "src/gone.ts" },
      rootAbs,
    });
    expect(result.failed).toEqual(["entry"]);
  });

  it("fails the exports check and names the missing export", async () => {
    const result = await verifyCapability({
      entry: { ...entry, exports: ["Button", "Vanished"] },
      rootAbs,
    });
    expect(result.failed).toEqual(["exports"]);
    expect(result.detail).toMatch(/Vanished/);
  });
});

describe("verifyCapability name fallback", () => {
  const rootAbs = fixtureEstateRoot();

  it("accepts a manifest with no name, matching the scanner's fallback", async () => {
    // beta/pyproject.toml declares a name; gamma's package.json declares one
    // too. The case that broke in production was a pyproject.toml with no
    // [project] name, where the scanner recorded the directory basename and
    // verification then reported "no name" and failed an unchanged package.
    const result = await verifyCapability({
      entry: {
        ...entry,
        id: "alpha/nameless",
        // What the scanner records for a manifest with no name: the basename.
        name: "nameless",
        path: "alpha/packages/nameless",
        entry: "src/index.js",
        exports: ["computeTotal"],
      },
      rootAbs,
    });
    expect(result.failed).not.toContain("manifest-name");
  });
});
