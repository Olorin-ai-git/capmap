import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { detectDeployTarget } from "../../src/scanner/deploy-target.js";
import { collectMetrics } from "../../src/scanner/metrics.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";

const estate = fixtureEstateRoot();
const EXCLUDES = ["node_modules", "dist", ".git"];

describe("detectDeployTarget", () => {
  it("detects firebase functions from a co-located firebase.json", async () => {
    const found = await detectDeployTarget(
      join(estate, "alpha/packages/mailer"),
      join(estate, "alpha"),
    );
    expect(found?.kind).toBe("firebase-functions");
  });

  it("detects docker from a Dockerfile", async () => {
    const found = await detectDeployTarget(
      join(estate, "beta"),
      join(estate, "beta"),
    );
    expect(found?.kind).toBe("docker");
  });

  it("returns null when no deploy configuration is reachable", async () => {
    const found = await detectDeployTarget(
      join(estate, "alpha/packages/ui-kit"),
      join(estate, "alpha"),
    );
    expect(found).toBeNull();
  });
});

describe("collectMetrics", () => {
  it("counts source lines and detects tests and readme", async () => {
    const m = await collectMetrics(
      join(estate, "alpha/packages/ui-kit"),
      EXCLUDES,
    );
    expect(m.loc).toBeGreaterThan(0);
    expect(m.hasTests).toBe(true);
    expect(m.hasReadme).toBe(true);
    expect(m.testCount).toBeGreaterThanOrEqual(1);
  });

  it("reports no tests and no readme when neither exists", async () => {
    const m = await collectMetrics(join(estate, "gamma"), EXCLUDES);
    expect(m.hasTests).toBe(false);
    expect(m.hasReadme).toBe(false);
  });
});
