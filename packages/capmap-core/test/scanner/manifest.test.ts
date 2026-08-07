import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseNpmManifest } from "../../src/scanner/manifest-npm.js";
import { parsePyManifest } from "../../src/scanner/manifest-py.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";

const SCOPES = ["@alpha/", "@olorin/"];
const estate = fixtureEstateRoot();

describe("parseNpmManifest", () => {
  it("splits internal from external dependencies by scope", async () => {
    const parsed = await parseNpmManifest(
      join(estate, "alpha/packages/mailer"),
      SCOPES,
    );
    expect(parsed.name).toBe("@alpha/mailer");
    expect(parsed.deps.internal).toEqual(["@alpha/ui-kit"]);
    expect(parsed.deps.external).not.toContain("@alpha/ui-kit");
    expect(parsed.kind).toBe("npm-package");
  });

  it("classifies a private manifest with no entry point as an app", async () => {
    const parsed = await parseNpmManifest(
      join(estate, "alpha/apps/console"),
      SCOPES,
    );
    expect(parsed.isPrivate).toBe(true);
    expect(parsed.kind).toBe("app");
  });

  it("resolves the entry point from exports before main", async () => {
    const parsed = await parseNpmManifest(
      join(estate, "alpha/packages/ui-kit"),
      SCOPES,
    );
    expect(parsed.entryRelPath).toBe("src/index.ts");
  });

  it("records a parse error instead of throwing on malformed JSON", async () => {
    const parsed = await parseNpmManifest(join(estate, "delta"), SCOPES);
    expect(parsed.parseError).toMatch(/JSON/i);
    expect(parsed.name).toBe("delta");
  });
});

describe("parsePyManifest", () => {
  it("reads the project name and package directory", async () => {
    const parsed = await parsePyManifest(join(estate, "beta"), SCOPES);
    expect(parsed.name).toBe("beta-service");
    expect(parsed.kind).toBe("py-package");
    expect(parsed.entryRelPath).toBe("beta_service/__init__.py");
  });
});
