import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexStore } from "../../../capmap-core/src/store/index-store.js";
import { runScan } from "../../src/commands/scan.js";
import { runRefresh } from "../../src/commands/refresh.js";
import { FIXTURE_NOW, makeDeps } from "../support/deps.js";

// ts-morph rebuilds the default TypeScript lib files for every entry point, so
// a whole-estate scan runs for seconds and each test here scans the estate.
const SCAN_TIMEOUT_MS = 120_000;

describe(
  "runRefresh",
  () => {
    it("re-enriches only the repositories that drifted", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-ref-"));
      const deps = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-1", beta: "sha-1" },
      });
      await runScan(deps, {
        repoIds: null,
        dryRun: false,
        explain: false,
        enrich: false,
      });

      const moved = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-2", beta: "sha-1" },
        reuseWriter: false,
      });
      const before = await new IndexStore({
        indexDirAbs: indexDir,
      }).readManifest();
      await runRefresh(moved, { stale: true, repoIds: null, force: false });
      const after = await new IndexStore({
        indexDirAbs: indexDir,
      }).readManifest();

      const enrichedAt = (m: typeof before, id: string) =>
        m.repos.find((r) => r.id === id)?.enrichedAt ?? null;
      expect(enrichedAt(after, "alpha")).not.toBe(enrichedAt(before, "alpha"));
      expect(enrichedAt(after, "beta")).toBe(enrichedAt(before, "beta"));
    });

    it("re-enriches everything when forced", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-ref-"));
      const deps = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-1" },
      });
      await runScan(deps, {
        repoIds: null,
        dryRun: false,
        explain: false,
        enrich: false,
      });
      const code = await runRefresh(deps, {
        stale: false,
        repoIds: ["alpha"],
        force: true,
      });
      expect(code).toBe(0);
      expect(deps.writer.lines.join("\n")).toMatch(/alpha/);
      const alpha = await new IndexStore({ indexDirAbs: indexDir }).readRepo(
        "alpha",
      );
      expect(alpha.packages.every((p) => p.summary !== null)).toBe(true);
    });

    it("reports that nothing drifted when the index is current", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-ref-"));
      const deps = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-1" },
      });
      await runScan(deps, {
        repoIds: ["alpha"],
        dryRun: false,
        explain: false,
        enrich: false,
      });
      deps.writer.lines.length = 0;
      await runRefresh(deps, {
        stale: true,
        repoIds: ["alpha"],
        force: false,
      });
      expect(deps.writer.lines.join("\n")).toMatch(
        /no repositories drifted|up to date/i,
      );
    });
  },
  SCAN_TIMEOUT_MS,
);

describe(
  "runScan enrichment wiring",
  () => {
    it("enriches by default and stamps enrichedAt from the injected clock", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-scan-enrich-"));
      const deps = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-1" },
      });
      await runScan(deps, {
        repoIds: ["alpha"],
        dryRun: false,
        explain: false,
      });

      const store = new IndexStore({ indexDirAbs: indexDir });
      const manifest = await store.readManifest();
      expect(manifest.repos[0]?.enrichedAt).toBe(FIXTURE_NOW.toISOString());
      const alpha = await store.readRepo("alpha");
      expect(alpha.packages.length).toBeGreaterThan(0);
      expect(alpha.packages.every((p) => p.summary !== null)).toBe(true);
      expect(deps.model.calls).toBeGreaterThan(0);
    });

    it("leaves the index unenriched when --no-enrich is passed", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-scan-plain-"));
      const deps = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-1" },
      });
      await runScan(deps, {
        repoIds: ["alpha"],
        dryRun: false,
        explain: false,
        enrich: false,
      });

      const store = new IndexStore({ indexDirAbs: indexDir });
      const manifest = await store.readManifest();
      expect(manifest.repos[0]?.enrichedAt).toBeNull();
      const alpha = await store.readRepo("alpha");
      expect(alpha.packages.every((p) => p.summary === null)).toBe(true);
      expect(deps.model.calls).toBe(0);
    });

    it("enriches units the index never described even when HEAD has not moved", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-scan-new-units-"));
      const deps = await makeDeps({ indexDir, headShaByRepo: { alpha: "sha-1" } });
      const opts = { repoIds: ["alpha"], dryRun: false, explain: false };
      await runScan(deps, { ...opts, enrich: false });
      expect(deps.model.calls).toBe(0);
      await runScan(deps, opts);
      const alpha = await new IndexStore({ indexDirAbs: indexDir }).readRepo("alpha");
      expect(deps.model.calls).toBeGreaterThan(0);
      expect(alpha.packages.every((p) => p.summary !== null)).toBe(true);
    });

    it("does not spend enrichment calls on a dry run", async () => {
      const indexDir = await mkdtemp(join(tmpdir(), "capmap-scan-dry-"));
      const deps = await makeDeps({
        indexDir,
        headShaByRepo: { alpha: "sha-1" },
      });
      await runScan(deps, { repoIds: ["alpha"], dryRun: true, explain: false });
      expect(deps.model.calls).toBe(0);
    });
  },
  SCAN_TIMEOUT_MS,
);
