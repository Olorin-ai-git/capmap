import { describe, it, expect } from "vitest";
import { deriveFeatureId } from "../../src/gate/feature-id.js";
import { deriveFeatureId as deriveInHook } from "../../../../hooks/src/feature-id.js";

/**
 * The hook keeps its own dependency-free copy so it can start inside its 50 ms budget
 * without loading `@capmap/core`. These paths are the contract between the two copies:
 * if they ever disagree, the hook looks for a gate record the CLI never wrote.
 */
const PATHS = [
  "docs/superpowers/specs/2026-08-02-tenant-portal-design.md",
  "docs/superpowers/plans/2026-08-02-tenant-portal.md",
  "docs/superpowers/plans/2026-08-02-tenant-portal-plan.md",
  "specs/tenant-portal.md",
  "tenant-portal.md",
  "tenant-portal",
  "C:\\work\\specs\\2026-08-02-tenant-portal-design.md",
  "/abs/2026-08-02-x.MD",
  "docs/2026-08-02-redesign.md",
  "docs/2026-08-02-plan.md",
  "",
];

describe("deriveFeatureId", () => {
  it.each([
    ["docs/superpowers/specs/2026-08-02-tenant-portal-design.md"],
    ["docs/superpowers/plans/2026-08-02-tenant-portal.md"],
    ["docs/superpowers/plans/2026-08-02-tenant-portal-plan.md"],
    ["specs/tenant-portal.md"],
  ])("derives %s to the shared feature id", (path) => {
    expect(deriveFeatureId(path)).toBe("tenant-portal");
  });

  it("maps a spec and its plan to the same feature id", () => {
    expect(deriveFeatureId("a/2026-08-02-x-design.md")).toBe(
      deriveFeatureId("b/2026-08-02-x.md"),
    );
  });

  it("handles Windows separators", () => {
    expect(deriveFeatureId("C:\\work\\specs\\2026-08-02-x-plan.md")).toBe("x");
  });

  it("strips the extension case-insensitively", () => {
    expect(deriveFeatureId("/abs/2026-08-02-x.MD")).toBe("x");
  });

  it("only strips a role suffix that is its own trailing segment", () => {
    expect(deriveFeatureId("docs/2026-08-02-redesign.md")).toBe("redesign");
  });
});

describe("hook and core feature id derivation", () => {
  it.each(PATHS)("agrees on %s", (path) => {
    expect(deriveInHook(path)).toBe(deriveFeatureId(path));
  });
});
