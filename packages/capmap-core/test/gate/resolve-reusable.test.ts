import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveComponent } from "../../src/gate/resolve.js";
import { RepoIndexSchema, type RepoIndex } from "../../src/model/index-schema.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const estate = join(repoRoot, "example", "estate");
const repos: RepoIndex[] = ["alpha", "beta", "vendor-toolkit"].map((id) =>
  RepoIndexSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "index", "repos", `${id}.json`), "utf8")),
  ),
);
const thresholds = { reuseThreshold: 0.7, extendThreshold: 0.5, duplicationThreshold: 0.3 };

/**
 * CM-6: only the top-ranked package decided the verdict, so an external
 * package scored 0.95 turned a reusable core package at 0.90 into
 * `REFERENCE vendor-toolkit`, and the core package appeared only as a note.
 */
describe("the verdict follows the best candidate the tier lets you reuse (CM-6)", () => {
  it("recommends the core package and reports the capped external one beside it", async () => {
    const verdict = await resolveComponent({
      component: "ledger import",
      rootAbs: estate,
      repos,
      thresholds,
      rankings: [
        { packageId: "vendor-toolkit/vendor-toolkit", score: 0.95, rationale: "vendor" },
        { packageId: "alpha/billing", score: 0.9, rationale: "core" },
      ],
    });
    expect(verdict.verdict).toBe("REUSE");
    expect(verdict.target).toBe("alpha/billing");
    expect(verdict.score).toBe(0.9);
    expect(verdict.competing).toContainEqual({
      packageId: "vendor-toolkit/vendor-toolkit",
      repo: "vendor-toolkit",
      score: 0.95,
    });
  });

  it("still answers REFERENCE when no reusable candidate does better", async () => {
    const verdict = await resolveComponent({
      component: "ledger import",
      rootAbs: estate,
      repos,
      thresholds,
      rankings: [
        { packageId: "vendor-toolkit/vendor-toolkit", score: 0.95, rationale: "vendor" },
        { packageId: "alpha/billing", score: 0.2, rationale: "weak" },
      ],
    });
    expect(verdict.verdict).toBe("REFERENCE");
    expect(verdict.target).toBe("vendor-toolkit/vendor-toolkit");
  });

  it("prefers the higher score when the tiers allow the same verdict", async () => {
    const verdict = await resolveComponent({
      component: "billing",
      rootAbs: estate,
      repos,
      thresholds,
      rankings: [
        { packageId: "alpha/billing", score: 0.9, rationale: "a" },
        { packageId: "beta/billing", score: 0.8, rationale: "b" },
      ],
    });
    expect(verdict.target).toBe("alpha/billing");
  });
});
