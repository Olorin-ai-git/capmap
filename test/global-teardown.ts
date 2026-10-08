import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Give the suite a temporary directory of its own, and remove it when the run ends.
 *
 * Roughly ninety `mkdtemp` directories are made per run, across a dozen test
 * files, and nothing removed them; a session of repeated runs left ten thousand
 * behind. Fixing it in one place beats an `afterAll` in every file.
 *
 * The first fix swept every `capmap-*` directory in the SHARED system temporary
 * directory created after the run began. That deleted the live directories of
 * anything else working there at the same moment — a run in another worktree,
 * or scripts/check-negative-controls.mjs inside verify.sh — which then failed
 * with ENOENT. Pointing TMPDIR at a private directory before any worker starts
 * confines the suite, and every process it spawns, to a tree only it owns.
 */
const ENV_VARS = ["TMPDIR", "TMP", "TEMP"] as const;

let suiteDir: string | null = null;

export function setup(): void {
  suiteDir = mkdtempSync(join(tmpdir(), "capmap-suite-"));
  for (const name of ENV_VARS) process.env[name] = suiteDir;
}

export function teardown(): void {
  if (suiteDir !== null) rmSync(suiteDir, { recursive: true, force: true });
}
