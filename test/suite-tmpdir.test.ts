import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The suite's temporary trees live in a directory of their own.
 *
 * The teardown used to sweep every `capmap-*` directory in the shared system
 * temporary directory created after the run began. A second run, or a
 * verification script, working there at the same time — another worktree,
 * scripts/check-negative-controls.mjs inside verify.sh — lost its directory
 * mid-run and failed with ENOENT.
 */
describe("suite temporary directory", () => {
  it("is private to this run", () => {
    expect(basename(tmpdir())).toMatch(/^capmap-suite-/);
    expect(basename(dirname(tmpdir()))).not.toMatch(/^capmap-suite-/);
  });
});
