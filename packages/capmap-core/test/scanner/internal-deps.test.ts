import { describe, it, expect } from "vitest";
import {
  exposesEntryPoint,
  reclassifyInternalDeps,
} from "../../src/scanner/internal-deps.js";
import type { ParsedManifest } from "../../src/scanner/manifest-npm.js";

function manifest(
  name: string,
  internal: string[],
  external: string[],
  overrides: Partial<ParsedManifest> = {},
): ParsedManifest {
  return {
    name,
    kind: "npm-package",
    entryRelPath: "src/index.ts",
    deps: { internal, external },
    isPrivate: false,
    hasTestScript: false,
    parseError: null,
    importRoots: [],
    ...overrides,
  };
}

describe("reclassifyInternalDeps", () => {
  it("promotes a dependency naming a package discovered in the same scan", () => {
    const units = [
      { manifest: manifest("@gov/adapters", [], []) },
      {
        manifest: manifest("onboarding-api", [], ["@gov/adapters", "fastify"]),
      },
    ];
    const out = reclassifyInternalDeps(units);
    expect(out[1]!.manifest.deps.internal).toEqual(["@gov/adapters"]);
    expect(out[1]!.manifest.deps.external).toEqual(["fastify"]);
  });

  it("leaves a genuine third-party dependency external", () => {
    const units = [
      { manifest: manifest("@gov/adapters", [], ["fastify", "zod"]) },
    ];
    const out = reclassifyInternalDeps(units);
    expect(out[0]!.manifest.deps.internal).toEqual([]);
    expect(out[0]!.manifest.deps.external).toEqual(["fastify", "zod"]);
  });

  it("keeps edges the configured scopes already classified", () => {
    const units = [
      { manifest: manifest("@olorin/ui", [], []) },
      { manifest: manifest("app", ["@olorin/ui"], ["react"]) },
    ];
    const out = reclassifyInternalDeps(units);
    expect(out[1]!.manifest.deps.internal).toEqual(["@olorin/ui"]);
  });

  it("does not duplicate an edge already marked internal", () => {
    const units = [
      { manifest: manifest("@gov/logger", [], []) },
      { manifest: manifest("@gov/policy", ["@gov/logger"], ["@gov/logger"]) },
    ];
    const out = reclassifyInternalDeps(units);
    expect(out[1]!.manifest.deps.internal).toEqual(["@gov/logger"]);
    expect(out[1]!.manifest.deps.external).toEqual([]);
  });

  it("returns the same unit object when nothing is promoted", () => {
    const units = [{ manifest: manifest("solo", [], ["react"]) }];
    expect(reclassifyInternalDeps(units)[0]).toBe(units[0]);
  });

  it("promotes across every unit that names a discovered package", () => {
    const units = [
      { manifest: manifest("@gov/adapters", [], []) },
      { manifest: manifest("onboarding-api", [], ["@gov/adapters"]) },
      { manifest: manifest("gateway-shim", [], ["@gov/adapters"]) },
    ];
    const out = reclassifyInternalDeps(units);
    expect(out[1]!.manifest.deps.internal).toEqual(["@gov/adapters"]);
    expect(out[2]!.manifest.deps.internal).toEqual(["@gov/adapters"]);
  });
});

describe("exposesEntryPoint", () => {
  it("is true for a private package that resolves an entry point", () => {
    expect(
      exposesEntryPoint(manifest("@gov/ui-kit", [], [], { isPrivate: true })),
    ).toBe(true);
  });

  it("is true for a public package that resolves an entry point", () => {
    expect(exposesEntryPoint(manifest("@gov/ui-kit", [], []))).toBe(true);
  });

  it("is false for an application shell with no entry point", () => {
    expect(
      exposesEntryPoint(
        manifest("console", [], [], { isPrivate: true, entryRelPath: null }),
      ),
    ).toBe(false);
  });
});
