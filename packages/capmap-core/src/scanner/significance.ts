import type { ScanConfig } from "../config/schema.js";

const MS_PER_DAY = 86_400_000;
const HALF = 0.5;

export type SignificanceConfig = ScanConfig["significance"];
export type WeightKey = keyof SignificanceConfig["weights"];

export interface SignificanceInput {
  publishedOrExported: boolean;
  consumerCount: number;
  hasDeployTarget: boolean;
  hasTests: boolean;
  hasReadme: boolean;
  loc: number;
  lastCommit: string | null;
}

export interface SignificanceBreakdown {
  total: number;
  parts: Record<WeightKey, number>;
}

/**
 * Diminishing-returns curve: reaches exactly 1 at the saturation point and
 * is clamped to 1 beyond it. Logarithmic so early signal counts for more
 * than the hundredth consumer or the five-thousandth line.
 */
function saturate(value: number, saturation: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log(1 + value) / Math.log(1 + saturation));
}

function recency(
  lastCommit: string | null,
  now: Date,
  halfLifeDays: number,
): number {
  if (lastCommit === null) return 0;
  const ageDays = (now.getTime() - new Date(lastCommit).getTime()) / MS_PER_DAY;
  if (Number.isNaN(ageDays)) return 0;
  return Math.pow(HALF, Math.max(0, ageDays) / halfLifeDays);
}

export function scoreSignificance(
  input: SignificanceInput,
  cfg: SignificanceConfig,
  now: Date,
): SignificanceBreakdown {
  const w = cfg.weights;
  const parts: Record<WeightKey, number> = {
    publishedOrExported: input.publishedOrExported ? w.publishedOrExported : 0,
    internalConsumers:
      saturate(input.consumerCount, cfg.consumerSaturation) *
      w.internalConsumers,
    deployTarget: input.hasDeployTarget ? w.deployTarget : 0,
    tests: input.hasTests ? w.tests : 0,
    readme: input.hasReadme ? w.readme : 0,
    sourceSize: saturate(input.loc, cfg.locSaturation) * w.sourceSize,
    commitRecency:
      recency(input.lastCommit, now, cfg.recencyHalfLifeDays) * w.commitRecency,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total: Math.min(1, total), parts };
}
