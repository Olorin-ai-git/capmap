import { describe, it, expect } from "vitest";
import {
  buildConsumerIndex,
  type ConsumerUnit,
} from "../../src/scanner/consumers.js";

function unit(
  id: string,
  name: string,
  relPath: string,
  internalDeps: string[] = [],
): ConsumerUnit {
  return { id, name, relPath, internalDeps };
}

describe("buildConsumerIndex with unique names", () => {
  it("maps each package id to the packages depending on it", () => {
    const index = buildConsumerIndex([
      unit("a/ui", "@a/ui", "packages/ui"),
      unit("a/mailer", "@a/mailer", "packages/mailer", ["@a/ui"]),
      unit("a/console", "@a/console", "apps/console", ["@a/ui", "@a/mailer"]),
    ]);
    expect(index.byId.get("a/ui")).toEqual(["a/console", "a/mailer"]);
    expect(index.byId.get("a/mailer")).toEqual(["a/console"]);
    expect(index.byId.get("a/console")).toBeUndefined();
    expect(index.ambiguousNames.size).toBe(0);
  });

  it("ignores a dependency naming nothing in this repository", () => {
    const index = buildConsumerIndex([
      unit("a/app", "@a/app", "apps/app", ["@external/thing"]),
    ]);
    expect(index.byId.size).toBe(0);
  });
});

/**
 * The estate contains three distinct packages all declaring `@olorin/glass-ui`
 * at version 2.0.0 — 7, 44 and 47 components — and they live in one repository,
 * so they are resolved in a single pass.
 */
describe("buildConsumerIndex with a name declared more than once", () => {
  const core = unit(
    "o/core-glass",
    "@olorin/glass-ui",
    "olorin-core/packages/glass-components",
  );
  const vendored = unit(
    "o/bayit-glass",
    "@olorin/glass-ui",
    "olorin-media/bayit-plus/packages/ui/glass-components",
  );

  it("attributes the edge to the nearest enclosing package, not to both", () => {
    const consumer = unit(
      "o/bayit-web",
      "@olorin/web",
      "olorin-media/bayit-plus/web",
      ["@olorin/glass-ui"],
    );
    const index = buildConsumerIndex([core, vendored, consumer]);

    expect(index.byId.get("o/bayit-glass")).toEqual(["o/bayit-web"]);
    expect(index.byId.get("o/core-glass")).toBeUndefined();
  });

  it("attributes a consumer next to the core package to the core package", () => {
    const consumer = unit(
      "o/cvplus-frontend",
      "@olorin/cvplus-frontend",
      "olorin-cv/cvplus/frontend",
      ["@olorin/glass-ui"],
    );
    const index = buildConsumerIndex([core, vendored, consumer]);
    // Neither candidate shares a first segment with olorin-cv, so the estate is
    // genuinely ambiguous here and the edge is attributed to nobody.
    expect(index.byId.get("o/core-glass")).toBeUndefined();
    expect(index.byId.get("o/bayit-glass")).toBeUndefined();
  });

  it("records the duplicated name so the condition is visible", () => {
    const index = buildConsumerIndex([core, vendored]);
    expect([...index.ambiguousNames]).toEqual(["@olorin/glass-ui"]);
  });

  it("never lets one package inherit another's consumers", () => {
    const nearCore = unit(
      "o/core-consumer",
      "@olorin/core-consumer",
      "olorin-core/packages/other",
      ["@olorin/glass-ui"],
    );
    const nearVendored = unit(
      "o/bayit-consumer",
      "@olorin/bayit-consumer",
      "olorin-media/bayit-plus/packages/ui/other",
      ["@olorin/glass-ui"],
    );
    const index = buildConsumerIndex([core, vendored, nearCore, nearVendored]);

    expect(index.byId.get("o/core-glass")).toEqual(["o/core-consumer"]);
    expect(index.byId.get("o/bayit-glass")).toEqual(["o/bayit-consumer"]);
  });

  it("attributes nothing when two candidates are equally close", () => {
    const left = unit("r/left", "@r/dup", "packages/left");
    const right = unit("r/right", "@r/dup", "packages/right");
    const consumer = unit("r/app", "@r/app", "apps/app", ["@r/dup"]);
    const index = buildConsumerIndex([left, right, consumer]);

    expect(index.byId.get("r/left")).toBeUndefined();
    expect(index.byId.get("r/right")).toBeUndefined();
    expect([...index.ambiguousNames]).toEqual(["@r/dup"]);
  });
});
