import type { GateRecord } from "@capmap/core";
import { copiedVerdictRows, normalise } from "./components-hash.js";

const SCORE_PRECISION = 2;
const NO_TARGET = "—";
const DUPLICATION_MARKER = "DUPLICATION";

/** What `capmap gate` prints, and the record holds, for one component: the only text a copied row may carry. */
function recordedCells(component: GateRecord["components"][number]): Set<string> {
  const rivals = component.competing.map((rival) => `${rival.packageId} (${rival.score.toFixed(SCORE_PRECISION)})`);
  const target = component.target ?? (component.bestCandidate === null ? NO_TARGET : `(best: ${component.bestCandidate})`);
  return new Set([
    "", NO_TARGET, target, component.target ?? "", component.bestCandidate ?? "", component.verifiedSha ?? "",
    component.score.toFixed(SCORE_PRECISION), String(component.score),
    rivals.length === 0 ? "" : `${DUPLICATION_MARKER}: also in ${rivals.join(", ")}`,
  ]);
}

/**
 * The copied verdict table is exempt from the content hash, so its cells are
 * held to the record: a row's verdict is the record's, and every other cell is
 * a value the record holds for that component. Free text in a cell
 * (`| billing | BUILD | ALSO IN SCOPE: … |`) would otherwise add scope unseen.
 */
export function verdictRowsProblem(text: string, record: GateRecord): string | null {
  const byName = new Map(record.components.map((c) => [normalise([c.name])[0] ?? "", c]));
  for (const [name = "", verdict = "", ...rest] of copiedVerdictRows(text)) {
    const component = byName.get(normalise([name])[0] ?? "");
    const recorded = component === undefined ? new Set<string>() : recordedCells(component);
    if (verdict !== component?.verdict || !rest.every((cell) => recorded.has(cell))) {
      return `its specification's Reuse Verdicts row for "${name}" says other than the record`;
    }
  }
  return null;
}
