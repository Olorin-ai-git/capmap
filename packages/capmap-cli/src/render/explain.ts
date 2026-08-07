import type { ScanConfig } from "@capmap/core";
import type {
  SignificanceBreakdown,
  WeightKey,
} from "@capmap/core";
import { renderTable } from "./table.js";

/** Two decimals separate calibration candidates without implying false precision. */
const SCORE_DECIMALS = 2;
const UNIT_HEADER = "unit";
const SCORE_HEADER = "score";
const KEPT_HEADER = "kept";
const KEPT_YES = "yes";
const KEPT_NO = "no";
const LINE_TERMINATOR = "\n";

function score(value: number): string {
  return value.toFixed(SCORE_DECIMALS);
}

/**
 * Order by score descending so the calibration boundary is visible at a glance,
 * breaking ties by id so that repeated runs print identical output.
 */
function ordered(
  breakdowns: Map<string, SignificanceBreakdown>,
): [string, SignificanceBreakdown][] {
  return [...breakdowns.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      right.total - left.total || leftId.localeCompare(rightId),
  );
}

/**
 * Render every scored unit of a repository with the contribution of each
 * weighted signal, so that `significance.threshold` can be calibrated against
 * evidence rather than guessed at.
 */
export function renderExplain(
  repoId: string,
  breakdowns: Map<string, SignificanceBreakdown>,
  scan: ScanConfig,
): string {
  const weightKeys = Object.keys(scan.significance.weights) as WeightKey[];
  const threshold = scan.significance.threshold;
  const rows = ordered(breakdowns).map(([id, breakdown]) => [
    id,
    score(breakdown.total),
    breakdown.total >= threshold ? KEPT_YES : KEPT_NO,
    ...weightKeys.map((key) => score(breakdown.parts[key])),
  ]);

  return [
    `${repoId}: significance breakdown (threshold ${score(threshold)})`,
    renderTable({
      headers: [UNIT_HEADER, SCORE_HEADER, KEPT_HEADER, ...weightKeys],
      rows,
    }),
  ].join(LINE_TERMINATOR);
}
