import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = ["check-transcript-provenance.mjs", "code-digest.mjs"];
const TRANSCRIPT = "docs/operations/verification-transcript.txt";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function check(cwd: string): number {
  try {
    execFileSync(process.execPath, ["scripts/check-transcript-provenance.mjs"], { cwd, stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

/**
 * A repository whose feature commit was verified, then landed on main by a
 * squash merge: the verified commit is gone from history, the code is not.
 */
function squashMerged(changeCodeInSquash: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "capmap-provenance-"));
  git(dir, "init", "-q", "-b", "feature");
  mkdirSync(join(dir, "scripts"));
  for (const script of SCRIPTS) copyFileSync(join(repoRoot, "scripts", script), join(dir, "scripts", script));
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "feature");
  const tested = git(dir, "rev-parse", "HEAD");
  const digest = execFileSync(process.execPath, ["scripts/code-digest.mjs", tested], { cwd: dir, encoding: "utf8" }).trim();
  mkdirSync(join(dir, dirname(TRANSCRIPT)), { recursive: true });
  writeFileSync(join(dir, TRANSCRIPT), `  Code commit under test: ${tested}\n  Code tree digest: ${digest}\n`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "transcript");

  git(dir, "checkout", "-q", "--orphan", "main");
  if (changeCodeInSquash) writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "squash");
  git(dir, "branch", "-q", "-D", "feature");
  git(dir, "reflog", "expire", "--expire=now", "--all");
  git(dir, "gc", "-q", "--prune=now");
  expect(() => git(dir, "cat-file", "-e", `${tested}^{commit}`)).toThrow();
  return dir;
}

/**
 * SP-3 audit: the transcript was pinned to a branch commit, so after the
 * estate's squash merge the provenance check failed with "not a commit in
 * this repository" although the code was exactly what had been verified.
 */
describe("transcript provenance survives a squash merge", () => {
  it("passes when the tested commit is gone but the code is identical", () => {
    expect(check(squashMerged(false))).toBe(0);
  });

  it("still fails when the squash carries code the transcript never saw", () => {
    expect(check(squashMerged(true))).toBe(1);
  });
});
