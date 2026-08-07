import type { GateRecord } from "@capmap/core";
import { renderTable } from "./table.js";

const HEADERS = ["component", "verdict", "target", "score", "note"];
const SCORE_PRECISION = 2;
const NO_TARGET = "—";
const DUPLICATION_MARKER = "DUPLICATION";
const LINE_TERMINATOR = "\n";

function target(component: GateRecord["components"][number]): string {
  if (component.target !== null) return component.target;
  if (component.bestCandidate === null) return NO_TARGET;
  return `(best: ${component.bestCandidate})`;
}

/**
 * Rendered beside the verdict rather than instead of it. A component can be
 * REUSE and duplicated at once, and that pairing is the most important thing
 * the gate can report: the capability exists, is reusable, and has already been
 * built more than once, so the open question is not whether to build but which
 * implementation is canonical.
 */
function note(component: GateRecord["components"][number]): string {
  if (component.competing.length === 0) return "";
  const rivals = component.competing
    .map(
      (rival) => `${rival.packageId} (${rival.score.toFixed(SCORE_PRECISION)})`,
    )
    .join(", ");
  return `${DUPLICATION_MARKER}: also in ${rivals}`;
}

export function renderVerdictTable(record: GateRecord): string {
  const table = renderTable({
    headers: HEADERS,
    rows: record.components.map((component) => [
      component.name,
      component.verdict,
      target(component),
      component.score.toFixed(SCORE_PRECISION),
      note(component),
    ]),
  });

  const detail = record.components
    .filter((component) => component.rationale !== "")
    .map((component) => {
      const checks =
        component.failedChecks.length === 0
          ? ""
          : ` [failed: ${component.failedChecks.join(", ")}]`;
      return `  ${component.name}: ${component.rationale}${checks}`;
    });

  const duplicated = record.components.filter((c) => c.competing.length > 0);
  const summary =
    duplicated.length === 0
      ? []
      : [
          "",
          `${String(duplicated.length)} component(s) have more than one ` +
            `implementation in the estate. Decide which is canonical before ` +
            `accepting these verdicts — the gate deliberately does not choose ` +
            `for you, because that is a judgement about ownership and roadmap ` +
            `rather than about code.`,
        ];

  return [table, "", ...detail, ...summary].join(LINE_TERMINATOR);
}
