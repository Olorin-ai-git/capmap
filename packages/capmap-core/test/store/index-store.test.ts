import { describe, it, expect } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexStore } from "../../src/store/index-store.js";
import { computeDrift } from "../../src/store/drift.js";
import { INDEX_SCHEMA_VERSION } from "../../src/model/index-schema.js";
import type {
  IndexManifest,
  RepoIndex,
} from "../../src/model/index-schema.js";

const repoIndex: RepoIndex = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  repo: "alpha",
  tier: "core" as const,
  domains: [],
  packages: [],
  minor: [],
};

const manifest: IndexManifest = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  generatedAt: "2026-07-27T00:00:00.000Z",
  root: "/estate",
  repos: [
    {
      id: "alpha",
      path: "alpha",
      tier: "core" as const,
      vcs: "git" as const,
      available: true,
      scannedSha: "aaa",
      domainCount: 0,
      packageCount: 0,
      minorCount: 0,
      enrichedAt: null,
    },
    {
      id: "gamma",
      path: "gamma",
      tier: "archived" as const,
      vcs: "none" as const,
      available: true,
      scannedSha: null,
      domainCount: 0,
      packageCount: 0,
      minorCount: 0,
      enrichedAt: null,
    },
  ],
};

describe("IndexStore", () => {
  it("round-trips a repo index and the manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-idx-"));
    const store = new IndexStore({ indexDirAbs: dir });
    await store.writeRepo(repoIndex);
    await store.writeManifest(manifest);
    expect((await store.readRepo("alpha")).repo).toBe("alpha");
    expect((await store.readManifest()).repos).toHaveLength(2);
    expect(await readdir(join(dir, "repos"))).toEqual(["alpha.json"]);
  });

  it("rejects an index written with a different schema version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-idx-"));
    const store = new IndexStore({ indexDirAbs: dir });
    await store.writeRepo({
      ...repoIndex,
      schemaVersion: INDEX_SCHEMA_VERSION,
    });
    const bumped = new IndexStore({ indexDirAbs: dir, expectedVersion: 99 });
    await expect(bumped.readRepo("alpha")).rejects.toThrow(/schema version/i);
  });

  it("reports a missing manifest with an actionable message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-idx-"));
    await expect(
      new IndexStore({ indexDirAbs: dir }).readManifest(),
    ).rejects.toThrow(/capmap scan --all/);
  });

  it("reads every stored repo index in a stable order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-idx-"));
    const store = new IndexStore({ indexDirAbs: dir });
    await store.writeRepo({ ...repoIndex, repo: "zeta" });
    await store.writeRepo(repoIndex);
    expect((await store.readAllRepos()).map((r) => r.repo)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("reads no repo indexes before the first scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-idx-"));
    expect(await new IndexStore({ indexDirAbs: dir }).readAllRepos()).toEqual(
      [],
    );
  });
});

describe("computeDrift", () => {
  it("marks a repo drifted when HEAD differs from scannedSha", async () => {
    const git = {
      headSha: async (p: string) => (p.endsWith("alpha") ? "bbb" : null),
      lastCommitIso: async () => null,
    };
    const report = await computeDrift(manifest, git, "/estate");
    expect(report.drifted).toContain("alpha");
  });

  it("always marks a vcs:none repo drifted", async () => {
    const git = { headSha: async () => "aaa", lastCommitIso: async () => null };
    const report = await computeDrift(manifest, git, "/estate");
    expect(report.drifted).toContain("gamma");
  });

  it("segregates unavailable repos from drifted ones", async () => {
    const git = { headSha: async () => "aaa", lastCommitIso: async () => null };
    const offline = {
      ...manifest,
      repos: manifest.repos.map((repo: IndexManifest["repos"][number]) => ({ ...repo, available: false })),
    };
    const report = await computeDrift(offline, git, "/estate");
    expect(report.unavailable).toEqual(["alpha", "gamma"]);
    expect(report.drifted).toEqual([]);
    expect(report.headByRepo.size).toBe(0);
  });
});
