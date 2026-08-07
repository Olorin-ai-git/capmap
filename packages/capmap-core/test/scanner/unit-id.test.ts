import { describe, it, expect } from "vitest";
import { assignUnitIds } from "../../src/scanner/unit-id.js";

describe("assignUnitIds", () => {
  it("uses the leaf directory when that is unique", () => {
    const ids = assignUnitIds("alpha", ["packages/ui-kit", "packages/mailer"]);
    expect(ids.get("packages/ui-kit")).toBe("alpha/ui-kit");
    expect(ids.get("packages/mailer")).toBe("alpha/mailer");
  });

  it("names the repository root after the repository", () => {
    const ids = assignUnitIds("alpha", ["."]);
    expect(ids.get(".")).toBe("alpha/alpha");
  });

  /**
   * The real collision: two glass-components directories in one repository,
   * which previously both claimed olorin/glass-components and left the index
   * carrying two entries under a single id.
   */
  it("disambiguates two directories sharing a leaf name", () => {
    const ids = assignUnitIds("olorin", [
      "olorin-core/packages/glass-components",
      "olorin-media/bayit-plus/packages/ui/glass-components",
    ]);
    const values = [...ids.values()];
    expect(new Set(values).size).toBe(2);
    expect(values).toContain("olorin/glass-components");
    expect(values.some((id) => id !== "olorin/glass-components")).toBe(true);
  });

  it("grows the id leftwards rather than appending a counter", () => {
    const ids = assignUnitIds("olorin", [
      "a/packages/glass-components",
      "b/ui/glass-components",
    ]);
    const second = ids.get("b/ui/glass-components");
    expect(second).toBe("olorin/ui-glass-components");
  });

  it("keeps every id unique across many collisions", () => {
    const paths = [
      "a/x/shared",
      "b/y/shared",
      "c/z/shared",
      "d/z/shared",
      "e/q/shared",
    ];
    const ids = assignUnitIds("repo", paths);
    expect(new Set(ids.values()).size).toBe(paths.length);
  });

  it("assigns the same ids regardless of input order", () => {
    const paths = ["b/ui/shared", "a/packages/shared", "c/shared"];
    const forward = assignUnitIds("repo", paths);
    const reverse = assignUnitIds("repo", [...paths].reverse());
    for (const path of paths) {
      expect(reverse.get(path)).toBe(forward.get(path));
    }
  });

  it("returns an id for every path it was given", () => {
    const paths = ["a/one", "b/two", ".", "c/d/three"];
    const ids = assignUnitIds("repo", paths);
    expect(ids.size).toBe(paths.length);
    for (const path of paths) expect(ids.get(path)).toBeTruthy();
  });
});
