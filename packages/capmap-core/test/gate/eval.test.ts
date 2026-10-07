import { describe, it, expect } from "vitest";
import {
  LabelledSetSchema,
  scoreGateRecord,
  scoreSearchRecall,
} from "../../src/gate/eval.js";
import { GATE_SCHEMA_VERSION, type GateRecord } from "../../src/model/gate-schema.js";
import { INDEX_SCHEMA_VERSION, type RepoIndex } from "../../src/model/index-schema.js";

/**
 * CM-7: the gate's 0.7 and 0.5 thresholds were applied to whatever number the
 * ranker emitted, and nothing measured whether the resulting verdicts were
 * right. A labelled set and its scoring make that measurable.
 */
const SCORING = { minTermOverlap: 0.5, minPartialTermLength: 4, minQueryTermLength: 2 };

const set = LabelledSetSchema.parse({
  cases: [
    { component: "Transactional email", expected: "REUSE", target: "alpha/mailer" },
    { component: "Billing ledger", expected: "EXTEND", target: "alpha/billing" },
    { component: "Quantum scheduler", expected: "BUILD", target: null },
  ],
});

function verdict(
  name: string,
  v: GateRecord["components"][number]["verdict"],
  target: string | null,
  score: number,
): GateRecord["components"][number] {
  return {
    name,
    verdict: v,
    target,
    score,
    bestCandidate: target,
    verifiedSha: null,
    failedChecks: [],
    competing: [],
    rationale: "",
  };
}

const record: GateRecord = {
  schemaVersion: GATE_SCHEMA_VERSION,
  specPath: "/s/spec.md",
  feature: "x",
  componentsHash: `sha256:${"0".repeat(64)}`,
  componentsSource: "flags",
  generatedAt: "2026-10-07T00:00:00Z",
  indexGeneratedAt: "2026-10-07T00:00:00Z",
  staleRepos: [],
  components: [
    verdict("transactional email", "REUSE", "alpha/mailer", 0.9),
    verdict("billing ledger", "REUSE", "alpha/billing", 0.72),
  ],
};

describe("labelled-set scoring (CM-7)", () => {
  it("rejects a label whose target disagrees with its verdict", () => {
    expect(
      LabelledSetSchema.safeParse({
        cases: [{ component: "x", expected: "BUILD", target: "alpha/x" }],
      }).success,
    ).toBe(false);
    expect(
      LabelledSetSchema.safeParse({
        cases: [{ component: "x", expected: "REUSE", target: null }],
      }).success,
    ).toBe(false);
  });

  it("counts a case correct only for the right verdict and the right target", () => {
    const result = scoreGateRecord(set, record);
    expect(result.correct).toBe(1);
    expect(result.total).toBe(3);
    expect(result.accuracy).toBeCloseTo(1 / 3);
    expect(result.confusion).toEqual({
      REUSE: { REUSE: 1 },
      EXTEND: { REUSE: 1 },
      BUILD: { UNRESOLVED: 1 },
    });
    expect(result.unresolved).toBe(1);
    expect(result.cases.map((c) => c.score)).toEqual([0.9, 0.72, 0]);
  });

  it("does not credit the right verdict on the wrong capability", () => {
    const wrongTarget = {
      ...record,
      components: [verdict("transactional email", "REUSE", "beta/mailer", 0.9)],
    };
    expect(scoreGateRecord(set, wrongTarget).cases[0]?.correct).toBe(false);
  });

  it("records the rank of each labelled capability among the search hits", () => {
    const repo: RepoIndex = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      repo: "alpha",
      tier: "core",
      domains: [],
      packages: [],
      minor: [
        { id: "alpha/mailer", path: "alpha/email", kind: "npm-package", significance: 0.1, parseError: null },
        { id: "alpha/ledger", path: "alpha/ledger", kind: "npm-package", significance: 0.1, parseError: null },
      ],
    };
    const recall = scoreSearchRecall({ set, repos: [repo], scoring: SCORING, k: 5 });
    expect(recall.total).toBe(2);
    expect(recall.cases).toEqual([
      { component: "Transactional email", target: "alpha/mailer", rank: 1 },
      { component: "Billing ledger", target: "alpha/billing", rank: null },
    ]);
    expect(recall.recall).toBe(0.5);
  });
});
