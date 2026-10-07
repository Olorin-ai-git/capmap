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
  "specs/029-x/spec.md",
  "specs/029-x/plan.md",
  "specs/029-x/contracts/api.md",
  "C:\\work\\specs\\030-y\\tasks.md",
  "docs/feature-a/spec.md",
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

/**
 * CM-10: the spec-kit layout names every file `spec.md`, `plan.md`, ... inside
 * a numbered feature folder, so the basename alone made every specification
 * one feature called "spec", and a plan never linked to its specification.
 */
describe("feature id from the spec folder (CM-10)", () => {
  it("names a spec-kit feature by its numbered folder, for every file in it", () => {
    for (const file of ["spec.md", "plan.md", "tasks.md", "research.md", "contracts/api.md"]) {
      expect(deriveFeatureId(`/repo/specs/029-x/${file}`)).toBe("029-x");
    }
  });

  it("keeps two spec-kit features apart", () => {
    expect(deriveFeatureId("specs/029-x/spec.md")).not.toBe(
      deriveFeatureId("specs/030-y/spec.md"),
    );
  });

  it("names a generically named file by its directory", () => {
    expect(deriveFeatureId("docs/feature-a/spec.md")).toBe("feature-a");
    expect(deriveFeatureId("docs/feature-a/plan.md")).toBe("feature-a");
  });
});

describe("hook and core feature id derivation", () => {
  it.each(PATHS)("agrees on %s", (path) => {
    expect(deriveInHook(path)).toBe(deriveFeatureId(path));
  });
});
