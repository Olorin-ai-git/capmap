import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { extractTsExports } from "../../src/scanner/exports-ts.js";
import { extractPyExports } from "../../src/scanner/exports-py.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";

const estate = fixtureEstateRoot();

describe("extractTsExports", () => {
  it("extracts exported consts, classes and functions", async () => {
    const result = await extractTsExports(
      join(estate, "alpha/packages/ui-kit/src/index.ts"),
    );
    expect(result.exports).toEqual(["Button", "Modal", "useTheme"]);
    expect(result.extractionFailed).toBe(false);
  });

  it("flags extraction failure for a missing entry file", async () => {
    const result = await extractTsExports(
      join(estate, "alpha/packages/ui-kit/src/absent.ts"),
    );
    expect(result.extractionFailed).toBe(true);
    expect(result.exports).toEqual([]);
  });
});

describe("extractPyExports", () => {
  it("prefers __all__ when declared", async () => {
    const result = await extractPyExports(
      join(estate, "beta/beta_service/__init__.py"),
    );
    expect(result.exports).toEqual(["Settings", "run"]);
  });

  it("falls back to public top-level declarations", async () => {
    const result = await extractPyExports(
      join(estate, "beta/beta_service/core.py"),
    );
    expect(result.exports).not.toContain("_private_helper");
  });
});
