import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadConfig, type LoadedConfig } from "../../src/config/load.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Nested `.git` directories cannot be committed to the outer repository, so each
 * fixture repository that is meant to be under version control carries a marker
 * directory of this name. `materialiseEstate` turns those markers into real git
 * repositories in a throwaway copy.
 */
const GIT_MARKER_DIR = "dot-git";
const FIXTURE_COMMIT_ISO = "2026-06-01T12:00:00+00:00";
const FIXTURE_COMMIT_MESSAGE = "fixture estate snapshot";
const GIT_OVERRIDES = [
  "-c",
  "init.defaultBranch=main",
  "-c",
  "user.name=capmap fixtures",
  "-c",
  "user.email=fixtures@capmap.test",
  "-c",
  "commit.gpgsign=false",
];

export function fixtureEstateRoot(): string {
  return join(here, "..", "fixtures", "estate");
}

export function fixtureConfigDir(): string {
  return join(here, "..", "fixtures", "estate-config");
}

export async function loadFixtureConfig(): Promise<LoadedConfig> {
  return loadConfig({
    configDir: fixtureConfigDir(),
    env: { CAPMAP_ROOT: fixtureEstateRoot() },
  });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", [...GIT_OVERRIDES, ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: FIXTURE_COMMIT_ISO,
      GIT_COMMITTER_DATE: FIXTURE_COMMIT_ISO,
    },
  });
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ["init", "--quiet"]);
  await git(dir, ["add", "--all", "--force"]);
  await git(dir, [
    "commit",
    "--quiet",
    "--no-verify",
    "--message",
    FIXTURE_COMMIT_MESSAGE,
  ]);
}

async function materialiseGitDirs(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (entry.name === GIT_MARKER_DIR) {
      await rm(full, { recursive: true, force: true });
      await initRepo(dir);
      continue;
    }
    await materialiseGitDirs(full);
  }
}

/** Copy the fixture estate to a temporary directory with real git repositories. */
export async function materialiseEstate(): Promise<string> {
  const dest = await mkdtemp(join(tmpdir(), "capmap-estate-"));
  await cp(fixtureEstateRoot(), dest, { recursive: true });
  await materialiseGitDirs(dest);
  return dest;
}
