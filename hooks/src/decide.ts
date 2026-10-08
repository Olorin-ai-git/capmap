import type { GateRecord } from "@capmap/core";

/** Environment variable that disables the gate, and the single value that does it. */
export const BYPASS_ENV_VAR = "CAPMAP_GATE";
export const BYPASS_VALUE = "off";

const GATE_COMMAND = "capmap gate";
const SCAN_COMMAND = "capmap scan --all";
const REFRESH_COMMAND = "capmap refresh --stale";
const BLOCKING_VERDICT = "UNRESOLVED";
const NAME_COLUMN_WIDTH = 24;
const VERDICT_COLUMN_WIDTH = 11;
const NO_TARGET = "—";

export interface DecideInput {
  /** Path the tool call is about to write, as it should be echoed back to the caller. */
  filePath: string;
  fileExists: boolean;
  /** Set when the path matches the configured specification globs. */
  isSpec: boolean;
  /** Set when it matches the plan globs. Both may be true; neither means unguarded. */
  isPlan: boolean;
  record: GateRecord | null;
  /**
   * Hash of the components the document will declare after this call, or null
   * when it will declare none.
   */
  currentComponentsHash: string | null;
  indexPresent: boolean;
  bypass: boolean;
}

export type Decision =
  | { allow: true; warning: string | null }
  | { allow: false; reason: string };

function bypassHint(): string {
  return `Bypass: ${BYPASS_ENV_VAR}=${BYPASS_VALUE}`;
}

function verdictTable(record: GateRecord): string {
  return record.components
    .map(
      (c) =>
        `  ${c.name.padEnd(NAME_COLUMN_WIDTH)} ` +
        `${c.verdict.padEnd(VERDICT_COLUMN_WIDTH)} ${c.target ?? NO_TARGET}`,
    )
    .join("\n");
}

function staleWarning(record: GateRecord): string | null {
  if (record.staleRepos.length === 0) return null;
  return (
    `capmap index is stale for: ${record.staleRepos.join(", ")} ` +
    `(run "${REFRESH_COMMAND}"); recorded verdicts were verified at the ` +
    `commit each repository was last scanned at`
  );
}

/**
 * No gate record exists for this file.
 *
 * The first-creation allowance applies to SPECIFICATIONS only. A specification
 * genuinely cannot be gated before it has content, so refusing to create one
 * would make the gate impossible to satisfy.
 *
 * A plan gets no such allowance. A plan is downstream of a gated specification
 * by definition, and extending the allowance to plans left the gate wide open:
 * a caller could write an entire implementation plan in a single Write to a new
 * path and never be stopped. That is the whole thing this hook exists to
 * prevent, so plans fail closed.
 */
function decideWithoutRecord(input: DecideInput): Decision {
  if (!input.indexPresent) {
    return {
      allow: false,
      reason:
        `capmap index not found. Run "${SCAN_COMMAND}" before writing ` +
        `specifications or plans.`,
    };
  }
  // Creating a specification is allowed because it cannot be gated before it
  // has content. A plan gets no such allowance, and a path that is both is
  // treated as a plan here — the stricter rule wins.
  if (!input.fileExists && input.isSpec && !input.isPlan) {
    return { allow: true, warning: null };
  }
  const what = input.isPlan ? "plan" : "document";
  return {
    allow: false,
    reason: [
      `No reuse gate has been run for this ${what}: ${input.filePath}`,
      input.isPlan
        ? "A plan may not be written before its specification is gated."
        : "",
      `Run: ${GATE_COMMAND} <the specification this ${what} implements>`,
      bypassHint(),
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

/**
 * The whole PreToolUse policy, as a pure function of already-gathered facts, so the
 * hook shell stays a thin reader and every branch is directly testable.
 */
export function decide(input: DecideInput): Decision {
  if (!input.isSpec && !input.isPlan) return { allow: true, warning: null };
  if (input.bypass) {
    return {
      allow: true,
      warning: `${BYPASS_ENV_VAR}=${BYPASS_VALUE}: reuse gate bypassed`,
    };
  }

  if (input.record === null) return decideWithoutRecord(input);

  // A null hash means the document will declare no component list at all.
  //
  // When the record was gated FROM the document, that is a deletion of the very
  // list the record describes, and allowing it let a specification be rewritten
  // with no gated components and then proceed to planning against a stale
  // record. When the record came from --component flags the document never had
  // a section, so its absence is normal and carries no information.
  // Specifications only. A plan never carries a `## Components` section — that
  // lives in the specification it implements — so a null hash on a plan means
  // "nothing to compare", not "the list was deleted". Applying the removal rule
  // to plans blocked every plan write that had a perfectly good gate record.
  // Applies whenever the path is a specification, even if it also matches a
  // plan glob: a document that carries a gated component list must not be able
  // to shed it by also looking like a plan.
  const removedFromDocument =
    input.isSpec &&
    input.currentComponentsHash === null &&
    input.record.componentsSource === "document";

  if (
    removedFromDocument ||
    (input.currentComponentsHash !== null &&
      input.currentComponentsHash !== input.record.componentsHash)
  ) {
    return {
      allow: false,
      reason: [
        removedFromDocument
          ? "The gated component list has been removed from this document."
          : "The component set changed since the reuse gate last ran.",
        `Re-run: ${GATE_COMMAND} ${input.filePath}`,
        bypassHint(),
      ].join("\n"),
    };
  }

  // Filtered here rather than through the core helper: the hook has a 100 ms budget
  // and must not pull the schema module, and its dependencies, into its start-up.
  const unresolved = input.record.components.filter(
    (c) => c.verdict === BLOCKING_VERDICT,
  );
  if (unresolved.length > 0) {
    return {
      allow: false,
      reason: [
        `Reuse gate not satisfied: ${unresolved.length} unresolved component(s).`,
        verdictTable(input.record),
        `Each row above names the check that failed. Fix the drift or amend`,
        `the specification, then run: ${GATE_COMMAND} ${input.filePath}`,
        bypassHint(),
      ].join("\n"),
    };
  }

  return { allow: true, warning: staleWarning(input.record) };
}
