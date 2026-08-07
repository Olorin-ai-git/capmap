import { describe, it, expect } from "vitest";
import {
  discoverCandidates,
  nestedRepoPaths,
} from "../../src/scanner/discover.js";
import type { RepoEntry } from "../../src/config/schema.js";
import {
  fixtureEstateRoot,
  loadFixtureConfig,
} from "../support/fixture-estate.js";

const olorin: RepoEntry = {
  id: "olorin",
  path: "olorin",
  tier: "core",
  vcs: "git",
};
const omen: RepoEntry = {
  id: "olorin-omen",
  path: "olorin/Omen",
  tier: "active",
  vcs: "git",
};
const onegate: RepoEntry = {
  id: "olorin-onegate",
  path: "olorin/onegate",
  tier: "active",
  vcs: "git",
};
const angainor: RepoEntry = {
  id: "angainor",
  path: "Angainor",
  tier: "active",
  vcs: "git",
};

describe("nestedRepoPaths", () => {
  it("returns the repository-relative path of each nested repository", () => {
    expect(nestedRepoPaths(olorin, [olorin, omen, onegate, angainor])).toEqual([
      "Omen",
      "onegate",
    ]);
  });

  it("returns nothing for a repository with no nested repositories", () => {
    expect(nestedRepoPaths(angainor, [olorin, omen, angainor])).toEqual([]);
  });

  it("does not treat a repository as nested inside itself", () => {
    expect(nestedRepoPaths(olorin, [olorin])).toEqual([]);
  });

  it("does not match a sibling whose path merely shares a prefix", () => {
    const lookalike: RepoEntry = {
      id: "olorin-ai",
      path: "olorin-ai",
      tier: "active",
      vcs: "git",
    };
    expect(nestedRepoPaths(olorin, [olorin, lookalike])).toEqual([]);
  });
});

describe("discoverCandidates with nested repositories", () => {
  it("prunes a nested repository from the parent walk", async () => {
    const cfg = await loadFixtureConfig();
    const alpha = cfg.repos.repos.find((r) => r.id === "alpha") as RepoEntry;

    const withoutPrune = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo: alpha,
      excludePaths: cfg.scan.excludePaths,
    });
    const withPrune = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo: alpha,
      excludePaths: cfg.scan.excludePaths,
      nestedRepoPaths: ["packages/ui-kit"],
    });

    expect(withoutPrune.map((c) => c.relPath)).toContain("packages/ui-kit");
    expect(withPrune.map((c) => c.relPath)).not.toContain("packages/ui-kit");
    expect(withPrune.map((c) => c.relPath)).toContain("packages/mailer");
  });

  it("still discovers the nested repository when scanned as itself", async () => {
    const cfg = await loadFixtureConfig();
    const nested: RepoEntry = {
      id: "alpha-ui-kit",
      path: "alpha/packages/ui-kit",
      tier: "active",
      vcs: "git",
    };
    const found = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo: nested,
      excludePaths: cfg.scan.excludePaths,
    });
    expect(found.map((c) => c.relPath)).toEqual(["."]);
  });

  it("prunes every nested repository, not only the first", async () => {
    const cfg = await loadFixtureConfig();
    const alpha = cfg.repos.repos.find((r) => r.id === "alpha") as RepoEntry;
    const found = await discoverCandidates({
      root: fixtureEstateRoot(),
      repo: alpha,
      excludePaths: cfg.scan.excludePaths,
      nestedRepoPaths: [
        "packages/ui-kit",
        "packages/mailer",
        "packages/nameless",
        "apps/console",
      ],
    });
    expect(found.map((c) => c.relPath)).toEqual(["."]);
  });
});
