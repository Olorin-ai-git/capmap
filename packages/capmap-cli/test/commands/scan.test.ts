import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexStore } from "../../../capmap-core/src/store/index-store.js";
import { runScan } from "../../src/commands/scan.js";
import { runStatus } from "../../src/commands/status.js";
import { makeDeps } from "../support/deps.js";

// ts-morph rebuilds the default TypeScript lib files for every entry point, so
// a whole-estate scan runs for seconds and each test here scans the estate.
const SCAN_TIMEOUT_MS = 60_000;

describe(
  "runScan",
  () => {
    it("writes a repo index per repository plus a manifest", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-cli-"));
      const deps = await makeDeps({ indexDir });
      const code = await runScan(deps, {
        repoIds: null,
        dryRun: false,
        explain: false,
      });
      expect(code).toBe(0);
      const manifest = await new IndexStore({
        indexDirAbs: indexDir,
      }).readManifest();
      expect(manifest.repos.map((r) => r.id).sort()).toEqual([
        "alpha",
        "beta",
        "delta",
        "epsilon",
        "gamma",
      ]);
    });

    it("writes nothing on a dry run and prints score breakdowns with --explain", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-cli-"));
      const deps = await makeDeps({ indexDir });
      const code = await runScan(deps, {
        repoIds: ["alpha"],
        dryRun: true,
        explain: true,
      });
      expect(code).toBe(0);
      expect(deps.writer.lines.join("\n")).toMatch(/alpha\/ui-kit/);
      expect(deps.writer.lines.join("\n")).toMatch(/internalConsumers/);
      await expect(
        new IndexStore({ indexDirAbs: indexDir }).readManifest(),
      ).rejects.toThrow();
    });

    it("warns when entry counts fall outside the configured bands", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-cli-"));
      const deps = await makeDeps({ indexDir });
      await runScan(deps, { repoIds: null, dryRun: false, explain: false });
      expect(deps.writer.lines.join("\n")).toMatch(
        /outside the configured band/,
      );
    });
  },
  SCAN_TIMEOUT_MS,
);

describe(
  "runStatus",
  () => {
    it("reports drift for every repository after a scan", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-cli-"));
      const deps = await makeDeps({ indexDir });
      await runScan(deps, { repoIds: null, dryRun: false, explain: false });
      const code = await runStatus(deps);
      expect(code).toBe(0);
      expect(deps.writer.lines.join("\n")).toMatch(/gamma/);
    });
  },
  SCAN_TIMEOUT_MS,
);

describe("runScan manifest merging", () => {
  // These scan the whole fixture estate twice; v8 coverage instrumentation
  // pushes that past the default per-test budget.
  const SCAN_TWICE_TIMEOUT_MS = 60_000;

  it("keeps repositories that a partial scan did not touch", async () => {
    const indexDir = await mkdtemp(join(tmpdir(), "capmap-merge-"));
    const deps = await makeDeps({ indexDir });

    await runScan(deps, {
      repoIds: null,
      dryRun: false,
      explain: false,
      enrich: false,
    });
    const before = await new IndexStore({ indexDirAbs: indexDir }).readManifest();
    expect(before.repos.length).toBeGreaterThan(1);

    // Scanning one repository must not orphan the others: their index files
    // survive on disk, and the manifest is the only thing that lists them.
    await runScan(deps, {
      repoIds: ["alpha"],
      dryRun: false,
      explain: false,
      enrich: false,
    });
    const after = await new IndexStore({ indexDirAbs: indexDir }).readManifest();

    expect(after.repos.map((r) => r.id).sort()).toEqual(
      before.repos.map((r) => r.id).sort(),
    );
  }, SCAN_TWICE_TIMEOUT_MS);

  it("replaces the entry for a repository it did scan", async () => {
    const indexDir = await mkdtemp(join(tmpdir(), "capmap-merge-"));
    const deps = await makeDeps({ indexDir, headShaByRepo: { alpha: "sha-1" } });
    await runScan(deps, {
      repoIds: null,
      dryRun: false,
      explain: false,
      enrich: false,
    });

    const moved = await makeDeps({
      indexDir,
      headShaByRepo: { alpha: "sha-2" },
    });
    await runScan(moved, {
      repoIds: ["alpha"],
      dryRun: false,
      explain: false,
      enrich: false,
    });

    const after = await new IndexStore({ indexDirAbs: indexDir }).readManifest();
    expect(after.repos.find((r) => r.id === "alpha")?.scannedSha).toBe("sha-2");
  }, SCAN_TWICE_TIMEOUT_MS);
});
