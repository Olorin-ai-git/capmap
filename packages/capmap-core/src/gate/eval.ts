import { z } from "zod";
import type { ScanConfig } from "../config/schema.js";
import { VerdictSchema, type GateRecord, type Verdict } from "../model/gate-schema.js";
import type { RepoIndex } from "../model/index-schema.js";
import { searchIndex } from "../search/search.js";
import { normaliseComponents } from "./components.js";

/** Verdicts a labeller may expect; UNRESOLVED is a failure to decide, never a correct answer. */
const ExpectedVerdictSchema = VerdictSchema.exclude(["UNRESOLVED"]);

export const LabelledCaseSchema = z
  .object({
    /** A component exactly as a specification would list it. */
    component: z.string().min(1),
    expected: ExpectedVerdictSchema,
    /** The capability a correct gate adopts; null exactly when `expected` is BUILD. */
    target: z.string().min(1).nullable(),
    /** Why a human labelled it so: the duplicate it was taken from. */
    note: z.string().optional(),
  })
  .refine((c) => (c.expected === "BUILD") === (c.target === null), {
    message: "target must be null for BUILD and set for every other verdict",
  });
export type LabelledCase = z.infer<typeof LabelledCaseSchema>;

export const LabelledSetSchema = z.object({
  cases: z.array(LabelledCaseSchema).min(1),
});
export type LabelledSet = z.infer<typeof LabelledSetSchema>;

export interface GateCaseResult {
  component: string;
  expected: Verdict;
  expectedTarget: string | null;
  verdict: Verdict;
  target: string | null;
  score: number;
  correct: boolean;
}

export interface GateAccuracy {
  correct: number;
  total: number;
  accuracy: number;
  unresolved: number;
  /** expected verdict → verdict given → count. */
  confusion: Record<string, Record<string, number>>;
  /** Every case with the score that produced its verdict, for calibrating the thresholds. */
  cases: GateCaseResult[];
}

export interface SearchCaseResult {
  component: string;
  target: string;
  /** 1-based rank of the target among the hits, null when it is not among them. */
  rank: number | null;
}

export interface SearchRecall {
  k: number;
  found: number;
  total: number;
  recall: number;
  cases: SearchCaseResult[];
}

function key(component: string): string {
  return normaliseComponents([component])[0] ?? component;
}

/**
 * Score a gate record against a labelled set. A case is correct when the gate
 * gave the expected verdict and, for every verdict other than BUILD, adopted
 * the expected capability. A component the record does not carry counts as
 * UNRESOLVED, so a gate that skipped a case cannot score it.
 */
export function scoreGateRecord(set: LabelledSet, record: GateRecord): GateAccuracy {
  const byName = new Map(record.components.map((c) => [c.name, c]));
  const confusion: Record<string, Record<string, number>> = {};
  const cases = set.cases.map((labelled): GateCaseResult => {
    const got = byName.get(key(labelled.component));
    const verdict: Verdict = got?.verdict ?? "UNRESOLVED";
    const target = got?.target ?? null;
    const row = (confusion[labelled.expected] ??= {});
    row[verdict] = (row[verdict] ?? 0) + 1;
    return {
      component: labelled.component,
      expected: labelled.expected,
      expectedTarget: labelled.target,
      verdict,
      target,
      score: got?.score ?? 0,
      correct: verdict === labelled.expected && target === labelled.target,
    };
  });
  const correct = cases.filter((c) => c.correct).length;
  return {
    correct,
    total: cases.length,
    accuracy: correct / cases.length,
    unresolved: cases.filter((c) => c.verdict === "UNRESOLVED").length,
    confusion,
    cases,
  };
}

/**
 * Deterministic recall of `capmap search`: how often the labelled capability is
 * among the first `k` hits for the component's own wording. Needs no model, so
 * it can be recorded for any index.
 */
export function scoreSearchRecall(args: {
  set: LabelledSet;
  repos: RepoIndex[];
  scoring: ScanConfig["search"];
  k: number;
}): SearchRecall {
  const cases: SearchCaseResult[] = [];
  for (const labelled of args.set.cases) {
    if (labelled.target === null) continue;
    const hits = searchIndex({
      repos: args.repos,
      query: labelled.component,
      limit: args.k,
      scoring: args.scoring,
    });
    const index = hits.findIndex((hit) => hit.id === labelled.target);
    cases.push({
      component: labelled.component,
      target: labelled.target,
      rank: index === -1 ? null : index + 1,
    });
  }
  const found = cases.filter((c) => c.rank !== null).length;
  return {
    k: args.k,
    found,
    total: cases.length,
    recall: cases.length === 0 ? 0 : found / cases.length,
    cases,
  };
}
