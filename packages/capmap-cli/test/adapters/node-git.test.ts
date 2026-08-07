import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { NodeGit } from "../../src/adapters/node-git.js";
import {
  loadFixtureConfig,
  materialiseEstate,
} from "../../../capmap-core/test/support/fixture-estate.js";

/** Length of a full git object name in hexadecimal characters. */
const SHA_LENGTH = 40;
/** A path deliberately absent from every fixture repository. */
const UNTRACKED_REL = "src/never-committed-by-the-fixture.ts";

const git = new NodeGit();

let estateRoot: string;
let versionedAbs: string;
let plainAbs: string;
let trackedRel: string;

beforeAll(async () => {
  const config = await loadFixtureConfig();
  const versioned = config.repos.repos.find((repo) => repo.vcs === "git");
  const plain = config.repos.repos.find((repo) => repo.vcs === "none");
  if (versioned === undefined || plain === undefined) {
    throw new Error(
      "fixture estate must declare one git repository and one non-git repository",
    );
  }
  estateRoot = await materialiseEstate();
  versionedAbs = join(estateRoot, versioned.path);
  plainAbs = join(estateRoot, plain.path);
  const entries = await readdir(versionedAbs, { withFileTypes: true });
  const file = entries.find((entry) => entry.isFile());
  if (file === undefined) {
    throw new Error(`no committed file at the root of ${versionedAbs}`);
  }
  trackedRel = file.name;
});

afterAll(async () => {
  // Only if setup got that far. Without the guard a failing beforeAll — git
  // missing from the image, say — is followed by a TypeError about an undefined
  // path, which is the error a reader sees first and the one that explains
  // nothing.
  if (estateRoot === undefined) return;
  await rm(estateRoot, { recursive: true, force: true });
});

describe("NodeGit", () => {
  it("returns the full HEAD sha for a versioned repository", async () => {
    const sha = await git.headSha(versionedAbs);
    expect(sha).toMatch(new RegExp(`^[0-9a-f]{${SHA_LENGTH}}$`));
  });

  it("returns null for a directory that is not a git repository", async () => {
    expect(await git.headSha(plainAbs)).toBeNull();
    expect(await git.lastCommitIso(plainAbs, trackedRel)).toBeNull();
  });

  it("dates a tracked path and reports null for an untracked one", async () => {
    const tracked = await git.lastCommitIso(versionedAbs, trackedRel);
    expect(tracked).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(Date.parse(tracked ?? ""))).toBe(false);
    expect(await git.lastCommitIso(versionedAbs, UNTRACKED_REL)).toBeNull();
  });
});
