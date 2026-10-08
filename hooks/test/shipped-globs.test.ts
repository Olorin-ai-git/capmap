import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";
import { HOOK_GLOB_OPTIONS } from "../src/classify.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * CM-10: `specs/**` matched every file under a specs folder, so editing an
 * existing `specs/openapi.yaml` was blocked as if it were a specification.
 * Gated documents are Markdown, in every configuration this repository ships.
 */
describe.each([
  join(here, "..", "..", "config", "scan.config.json"),
  join(here, "..", "..", "packages", "capmap-core", "test", "fixtures", "estate-config", "scan.config.json"),
])("hook globs in %s", (path) => {
  const hook = (JSON.parse(readFileSync(path, "utf8")) as {
    hook: { specGlobs: string[]; planGlobs: string[] };
  }).hook;
  const gated = picomatch([...hook.specGlobs, ...hook.planGlobs]);

  it("gates Markdown specifications and plans, including spec-kit folders", () => {
    expect(gated("/repo/specs/029-x/spec.md")).toBe(true);
    expect(gated("/repo/specs/029-x/plan.md")).toBe(true);
    expect(gated("/repo/docs/superpowers/plans/2026-08-02-x.md")).toBe(true);
  });

  /**
   * SP-3 audit: picomatch is case-sensitive, so `plan.MD` or `x.markdown` was
   * not gated, and on a case-insensitive disk a Write to `x.MD` overwrote the
   * gated `x.md` with no gate check. The hook matches without regard to case.
   */
  it("gates Markdown whatever the extension's case or spelling", () => {
    const hookGated = picomatch([...hook.specGlobs, ...hook.planGlobs], HOOK_GLOB_OPTIONS);
    for (const path of [
      "/repo/docs/superpowers/plans/x.MD",
      "/repo/specs/029-x/spec.Md",
      "/repo/plans/x.markdown",
      "/repo/docs/superpowers/specs/x.MARKDOWN",
    ]) {
      expect(hookGated(path)).toBe(true);
    }
  });

  /** SP-3 audit round 5: `**` did not cross a dot-directory such as `.claude/worktrees/`. */
  it("gates documents under a dot-directory or with a dot-file name", () => {
    const hookGated = picomatch([...hook.specGlobs, ...hook.planGlobs], HOOK_GLOB_OPTIONS);
    for (const path of [
      "/repo/.claude/worktrees/a/docs/superpowers/plans/x.md",
      "/repo/.claude/worktrees/a/specs/029-x/spec.md",
      "/repo/plans/.x.md",
    ]) {
      expect(hookGated(path)).toBe(true);
    }
  });

  it("leaves non-Markdown files under a specs folder alone", () => {
    expect(gated("/repo/specs/openapi.yaml")).toBe(false);
  });

  /**
   * SP-3 audit round 3: narrowing the plan globs to Markdown let a plan in
   * any other format (`.txt`, `.rst`, no extension) skip the gate. Plans
   * fail closed whatever their format; only specifications were narrowed.
   */
  it("gates every file under a plans folder, whatever its format", () => {
    for (const path of ["/repo/plans/x.txt", "/repo/docs/superpowers/plans/x.rst", "/repo/plans/x"]) {
      expect(gated(path)).toBe(true);
    }
  });
});
