import { describe, it, expect } from "vitest";
import { discoverCandidates } from "../../src/scanner/discover.js";
import {
  loadFixtureConfig,
  fixtureEstateRoot,
} from "../support/fixture-estate.js";

describe("discoverCandidates", () => {
  it("finds every manifest in a workspace monorepo", async () => {
    const cfg = await loadFixtureConfig();
    const repo = cfg.repos.repos.find((r) => r.id === "alpha")!;
    const found = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo,
      excludePaths: cfg.scan.excludePaths,
    });
    expect(found.map((c) => c.relPath)).toEqual([
      ".",
      "apps/console",
      "packages/mailer",
      "packages/nameless",
      "packages/ui-kit",
    ]);
  });

  it("finds pyproject.toml manifests", async () => {
    const cfg = await loadFixtureConfig();
    const repo = cfg.repos.repos.find((r) => r.id === "beta")!;
    const found = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo,
      excludePaths: cfg.scan.excludePaths,
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.manifestFile).toBe("pyproject.toml");
  });

  it("does not descend into excluded paths", async () => {
    const cfg = await loadFixtureConfig();
    const repo = cfg.repos.repos.find((r) => r.id === "alpha")!;
    const found = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo,
      excludePaths: [...cfg.scan.excludePaths, "packages"],
    });
    expect(found.map((c) => c.relPath)).toEqual([".", "apps/console"]);
  });

  it("returns an empty list for a repository path that does not exist", async () => {
    const cfg = await loadFixtureConfig();
    const found = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo: { id: "ghost", path: "ghost", tier: "active", vcs: "git" },
      excludePaths: cfg.scan.excludePaths,
    });
    expect(found).toEqual([]);
  });
});
