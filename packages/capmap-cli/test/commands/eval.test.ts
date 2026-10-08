import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexStore, LabelledSetSchema, scoreSearchRecall } from "@capmap/core";
import { loadFixtureConfig } from "../../../capmap-core/test/support/fixture-estate.js";
import { runEval } from "../../src/commands/eval.js";
import { repoRoot } from "../support/paths.js";
import { makeDeps, type TestDeps } from "../support/deps.js";
import { writeFixtureIndex } from "../support/index-fixture.js";

/**
 * CM-7: `capmap eval` measures the gate and search against a labelled set and
 * records the accuracy, instead of the thresholds being taken on trust.
 */
const LABELS = {
  cases: [
    { component: "ui kit", expected: "REUSE", target: "alpha/ui-kit" },
    { component: "transactional email", expected: "REUSE", target: "alpha/mailer" },
    { component: "rocket telemetry", expected: "BUILD", target: null },
  ],
};

const SHORTLIST = JSON.stringify({
  selections: [
    { component: "ui kit", domains: ["alpha/design-system"] },
    { component: "transactional email", domains: ["alpha/design-system"] },
    { component: "rocket telemetry", domains: [] },
  ],
});
const rank = (rankings: unknown[]) => JSON.stringify({ rankings });

async function setup(responses: string[]): Promise<{ deps: TestDeps; labels: string }> {
  const indexDir = await mkdtemp(join(tmpdir(), "capmap-eval-"));
  await writeFixtureIndex(indexDir);
  const deps = await makeDeps({
    indexDir,
    headShaByRepo: { alpha: "sha-1" },
    modelResponses: responses,
  });
  const labels = join(await mkdtemp(join(tmpdir(), "capmap-labels-")), "labels.json");
  await writeFile(labels, JSON.stringify(LABELS));
  return { deps, labels };
}

describe("runEval (CM-7)", () => {
  it("records gate accuracy and search recall beside the labelled set", async () => {
    const { deps, labels } = await setup([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Same." }]),
      rank([{ packageId: "alpha/ui-kit", score: 0.8, rationale: "Wrong one." }]),
    ]);
    const code = await runEval(deps, { labelsPath: labels, outPath: null, gate: true });
    expect(code).toBe(0);

    const result = JSON.parse(
      await readFile(labels.replace(/\.json$/, ".result.json"), "utf8"),
    ) as {
      gate: { correct: number; total: number; confusion: Record<string, Record<string, number>> };
      search: { total: number };
      thresholds: { reuseThreshold: number };
    };
    expect(result.gate.total).toBe(3);
    expect(result.gate.correct).toBe(2);
    expect(result.gate.confusion["BUILD"]).toEqual({ BUILD: 1 });
    expect(result.search.total).toBe(2);
    expect(result.thresholds.reuseThreshold).toBe(deps.config.scan.verdicts.reuseThreshold);
    expect(deps.writer.lines.some((l) => l.startsWith("gate accuracy: 2/3"))).toBe(true);
  });

  it("records search recall alone without consulting the model", async () => {
    const { deps, labels } = await setup([SHORTLIST]);
    const out = join(await mkdtemp(join(tmpdir(), "capmap-out-")), "r.json");
    expect(await runEval(deps, { labelsPath: labels, outPath: out, gate: false })).toBe(0);
    expect(deps.model.calls).toBe(0);
    const result = JSON.parse(await readFile(out, "utf8")) as { gate: unknown };
    expect(result.gate).toBeNull();
  });

  it("fails and records nothing when the gate could not run at all", async () => {
    const { deps, labels } = await setup(["not json"]);
    const out = join(await mkdtemp(join(tmpdir(), "capmap-out-")), "r.json");
    expect(await runEval(deps, { labelsPath: labels, outPath: out, gate: true })).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses to write a real estate's result into this checkout (SP-3 audit)", async () => {
    const { deps, labels } = await setup([SHORTLIST]);
    deps.config = { ...deps.config, root: await mkdtemp(join(tmpdir(), "capmap-real-estate-")) };
    const out = join(repoRoot(), "example", "sp3-placement-probe.result.json");
    expect(await runEval(deps, { labelsPath: labels, outPath: out, gate: false })).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it("checks where it may write before paying for the gate (SP-3 audit)", async () => {
    const { deps, labels } = await setup([SHORTLIST]);
    deps.config = { ...deps.config, root: await mkdtemp(join(tmpdir(), "capmap-real-estate-")) };
    const out = join(repoRoot(), "example", "sp3-placement-probe.result.json");
    expect(await runEval(deps, { labelsPath: labels, outPath: out, gate: true })).toBe(1);
    expect(deps.model.calls).toBe(0);
  });

  it("rejects a malformed labelled set", async () => {
    const { deps, labels } = await setup([SHORTLIST]);
    await writeFile(labels, JSON.stringify({ cases: [{ component: "x", expected: "REUSE", target: null }] }));
    expect(await runEval(deps, { labelsPath: labels, outPath: null, gate: false })).toBe(1);
  });
});

describe("the committed example labelled set", () => {
  it("parses and finds every labelled capability in the committed index", async () => {
    const set = LabelledSetSchema.parse(
      JSON.parse(await readFile(join(repoRoot(), "example", "labels.json"), "utf8")),
    );
    const repos = await new IndexStore({ indexDirAbs: join(repoRoot(), "index") }).readAllRepos();
    const config = await loadFixtureConfig();
    const recall = scoreSearchRecall({
      set,
      repos,
      scoring: config.scan.search,
      k: config.scan.matching.maxCandidates,
    });
    expect(recall.cases.filter((c) => c.rank === null)).toEqual([]);
  });
});
