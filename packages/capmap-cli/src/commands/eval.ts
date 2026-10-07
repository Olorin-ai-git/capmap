import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  LabelledSetSchema,
  runGate,
  scoreGateRecord,
  scoreSearchRecall,
  type GateAccuracy,
  type LabelledSet,
} from "@capmap/core";
import { assertPlacement, type CommandDeps } from "../composition.js";
import { loadIndexContext } from "./index-context.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const JSON_INDENT = 2;
const PERCENT = 100;
const JSON_SUFFIX = /\.json$/i;
const RESULT_SUFFIX = ".result.json";

export interface EvalOptions {
  labelsPath: string;
  outPath: string | null;
  /** Run the model-backed gate as well as the deterministic search recall. */
  gate: boolean;
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function pct(value: number): string {
  return `${(value * PERCENT).toFixed(1)}%`;
}

async function readLabels(deps: CommandDeps, path: string): Promise<LabelledSet | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    deps.writer.line(`cannot read the labelled set at ${path}: ${String(error)}`);
    return null;
  }
  const parsed = LabelledSetSchema.safeParse(raw);
  if (!parsed.success) {
    deps.writer.line(`${path} is not a labelled set: ${parsed.error.message}`);
    return null;
  }
  return parsed.data;
}

/**
 * Measure the index and the gate against a labelled set of real duplicates and
 * write the result beside it, so the thresholds are judged against outcomes
 * rather than taken on trust (CM-7).
 *
 * Search recall needs no model. The gate does; when every case comes back
 * UNRESOLVED the gate did not run (no credential, no enrichment, an outage),
 * and recording that as an accuracy of zero would be a false measurement, so
 * nothing is written and the command fails.
 */
export async function runEval(deps: CommandDeps, opts: EvalOptions): Promise<number> {
  const labelsAbs = absolute(opts.labelsPath);
  const set = await readLabels(deps, labelsAbs);
  if (set === null) return EXIT_ERROR;

  const context = await loadIndexContext(deps);
  const search = scoreSearchRecall({
    set,
    repos: context.repos,
    scoring: deps.config.scan.search,
    k: deps.config.scan.matching.maxCandidates,
  });
  deps.writer.line(
    `search recall@${String(search.k)}: ${String(search.found)}/${String(search.total)} ` +
      `(${pct(search.recall)})`,
  );

  let gate: GateAccuracy | null = null;
  if (opts.gate) {
    const record = await runGate({
      specPath: labelsAbs,
      components: set.cases.map((c) => c.component),
      componentsSource: "flags",
      repos: context.repos,
      manifest: context.manifest,
      staleRepos: [...context.drifted].sort(),
      rootAbs: deps.config.root,
      thresholds: deps.config.scan.verdicts,
      matching: deps.config.scan.matching,
      selectMaxTokens: deps.config.scan.matching.selectMaxTokens,
      rankMaxTokens: deps.config.scan.matching.rankMaxTokens,
      model: deps.model,
      clock: deps.clock,
      logger: deps.logger,
      maxRetries: deps.config.scan.enrichment.maxRetries,
    });
    gate = scoreGateRecord(set, record);
    if (gate.unresolved === gate.total) {
      deps.writer.line(
        `every case came back UNRESOLVED, so the gate did not run against this ` +
          `index (check the model credential and that the index is enriched); ` +
          `no accuracy was recorded`,
      );
      return EXIT_ERROR;
    }
    deps.writer.line(
      `gate accuracy: ${String(gate.correct)}/${String(gate.total)} (${pct(gate.accuracy)}), ` +
        `${String(gate.unresolved)} unresolved`,
    );
  }

  const outAbs =
    opts.outPath === null
      ? labelsAbs.replace(JSON_SUFFIX, "") + RESULT_SUFFIX
      : absolute(opts.outPath);
  try {
    assertPlacement(outAbs, deps.config);
  } catch (error) {
    deps.writer.line(String(error instanceof Error ? error.message : error));
    return EXIT_ERROR;
  }
  const result = {
    measuredAt: deps.clock.now().toISOString(),
    labels: labelsAbs,
    indexGeneratedAt: context.manifest.generatedAt,
    staleRepos: [...context.drifted].sort(),
    thresholds: deps.config.scan.verdicts,
    rankingModel: opts.gate ? deps.config.scan.matching.model : null,
    search,
    gate,
  };
  await writeFile(outAbs, JSON.stringify(result, null, JSON_INDENT) + "\n", "utf8");
  deps.writer.line(`result written to ${outAbs}`);
  return EXIT_OK;
}
