import { describe, it, expect } from "vitest";
import { scanRepo } from "../../src/scanner/scan.js";
import {
  loadFixtureConfig,
  fixtureEstateRoot,
} from "../support/fixture-estate.js";
import { silentLogger, fixedClock, nullGit } from "../support/doubles.js";

const NOW = new Date("2026-07-27T00:00:00.000Z");

// ts-morph builds a fresh Project — and recompiles the default TypeScript lib
// files — for every entry point, so a whole-estate scan runs for seconds. The
// default 5s vitest timeout leaves no headroom on a loaded CI runner.
const SCAN_TIMEOUT_MS = 60_000;

async function scanFixture(id: string) {
  const cfg = await loadFixtureConfig();
  return scanRepo({
    rootAbs: fixtureEstateRoot(),
    repo: cfg.repos.repos.find((r) => r.id === id)!,
    scan: cfg.scan,
    git: nullGit(),
    clock: fixedClock(NOW),
    logger: silentLogger(),
  });
}

describe(
  "scanRepo",
  () => {
    it("promotes significant packages and demotes the rest to minor", async () => {
      const result = await scanFixture("alpha");
      const ids = result.packages.map((p) => p.id);
      expect(ids).toContain("alpha/ui-kit");
      expect(result.minor.map((m) => m.id)).toContain("alpha/console");
    });

    it("records consumers from internal dependencies", async () => {
      const result = await scanFixture("alpha");
      const uiKit = result.packages.find((p) => p.id === "alpha/ui-kit")!;
      expect(uiKit.consumers).toEqual(["alpha/console", "alpha/mailer"]);
    });

    it("carries a manifest parse error into a minor entry", async () => {
      const result = await scanFixture("delta");
      expect(result.minor[0]!.parseError).toMatch(/JSON/i);
      expect(result.packages).toHaveLength(0);
    });

    it("marks a repository unavailable when its path is missing", async () => {
      const cfg = await loadFixtureConfig();
      const result = await scanRepo({
        rootAbs: fixtureEstateRoot(),
        repo: { id: "ghost", path: "ghost", tier: "active", vcs: "git" },
        scan: cfg.scan,
        git: nullGit(),
        clock: fixedClock(NOW),
        logger: silentLogger(),
      });
      expect(result.available).toBe(false);
    });

    it("produces a stable snapshot for the whole fixture estate", async () => {
      const cfg = await loadFixtureConfig();
      const all = [];
      for (const repo of cfg.repos.repos) {
        const result = await scanRepo({
          rootAbs: fixtureEstateRoot(),
          repo,
          scan: cfg.scan,
          git: nullGit(),
          clock: fixedClock(NOW),
          logger: silentLogger(),
        });
        all.push({
          repo: repo.id,
          packages: result.packages.map((p) => ({
            id: p.id,
            kind: p.kind,
            exports: p.exports,
            consumers: p.consumers,
            maturity: p.maturity,
            significance: Number(p.significance.toFixed(4)),
          })),
          minor: result.minor.map((m) => m.id),
        });
      }
      expect(all).toMatchSnapshot();
    });
  },
  SCAN_TIMEOUT_MS,
);
