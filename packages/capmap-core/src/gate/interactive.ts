import type { ScanConfig } from "../config/schema.js";
import type { ComponentVerdict, GateRecord } from "../model/gate-schema.js";
import type { RepoIndex } from "../model/index-schema.js";
import type { Prompt } from "../ports/index.js";
import { verifyCapability } from "../verify/verify.js";
import { locate } from "./resolve.js";
import { applyVerdict } from "./verdict.js";

export const CHOICE_BUILD = 0;
export const CHOICE_RECHECK = 1;
export const CHOICE_PICK = 2;

const OPTIONS = [
  "Accept BUILD — nothing in the estate fits, write it new",
  "Re-check the candidate against live source",
  "Point at a different capability by id",
];

const UNRESOLVED = "UNRESOLVED";

/**
 * Failed checks meaning the component was never compared against the estate. Accepting
 * BUILD for one of these would turn a matcher outage into permission to rebuild, so only
 * a fresh gate run or a named capability can clear it.
 */
const NEVER_MATCHED = new Set(["matcher-unavailable", "matcher-unanswered"]);

export interface ResolveInteractiveArgs {
  record: GateRecord;
  repos: RepoIndex[];
  rootAbs: string;
  thresholds: ScanConfig["verdicts"];
  prompt: Prompt;
}

function asBuild(component: ComponentVerdict): ComponentVerdict {
  return {
    ...component,
    verdict: "BUILD",
    target: null,
    verifiedSha: null,
    failedChecks: [],
    rationale:
      "Operator accepted BUILD: no catalogued capability was adopted for " +
      "this component.",
  };
}

/** Weight carried by an operator's explicit choice, as distinct from a model score. */
const OPERATOR_SELECTED_SCORE = 1;

/**
 * Re-derive a verdict for one capability id, always through the same
 * verification and the same `applyVerdict`.
 *
 * Resolution therefore cannot promote anything the gate would have refused: an
 * archived or employer-owned capability stays capped at REFERENCE no matter
 * which id the operator supplies, and an unverifiable one stays UNRESOLVED. The
 * operator chooses what to consider, never what the rules are.
 */
async function reconsider(
  component: ComponentVerdict,
  packageId: string,
  args: ResolveInteractiveArgs,
  /** True when the operator named this capability rather than re-checking the ranked one. */
  operatorChose: boolean,
): Promise<ComponentVerdict> {
  const located = locate(args.repos, packageId);
  if (located === null) {
    return {
      ...component,
      verdict: "UNRESOLVED",
      target: null,
      bestCandidate: packageId,
      verifiedSha: null,
      failedChecks: ["path"],
      rationale: `"${packageId}" is not in the index.`,
    };
  }

  const verification = await verifyCapability({
    entry: located.entry,
    rootAbs: args.rootAbs,
  });
  // A score belongs to the capability it was computed for. Re-using the
  // ranked candidate's score for a package the operator named instead would
  // decide the verdict from evidence about a different capability entirely —
  // and could silently promote something the matcher never rated.
  //
  // Re-checking the original candidate keeps its own score. An explicit
  // operator choice carries its own weight: they are asserting the fit, so the
  // remaining questions are whether it verifies and whether its tier permits
  // reuse, both of which still bind.
  const score = operatorChose ? OPERATOR_SELECTED_SCORE : component.score;
  const verdict = applyVerdict({
    score,
    tier: located.tier,
    verified: verification.ok,
    isMinor: located.isMinor,
    thresholds: args.thresholds,
  });
  const resolved = verdict !== "BUILD" && verdict !== "UNRESOLVED";

  return {
    ...component,
    verdict,
    score,
    target: resolved ? packageId : null,
    bestCandidate: packageId,
    verifiedSha: verification.ok ? located.entry.scannedSha : null,
    failedChecks: verification.failed,
    rationale: verification.ok
      ? `Operator selected ${packageId}; verified at current HEAD.`
      : (verification.detail ?? component.rationale),
  };
}

async function resolveOne(
  component: ComponentVerdict,
  args: ResolveInteractiveArgs,
): Promise<ComponentVerdict> {
  const detail =
    component.failedChecks.length === 0
      ? component.rationale
      : `${component.rationale} [failed: ${component.failedChecks.join(", ")}]`;
  const choice = await args.prompt.choose(
    `${component.name}: ${detail}`,
    OPTIONS,
  );

  if (choice === CHOICE_BUILD) {
    const neverMatched = component.failedChecks.some((c) => NEVER_MATCHED.has(c));
    return neverMatched ? component : asBuild(component);
  }

  if (choice === CHOICE_RECHECK) {
    // Nothing to re-check is not a decision: the component stays unresolved.
    if (component.bestCandidate === null) return component;
    return reconsider(component, component.bestCandidate, args, false);
  }

  if (choice === CHOICE_PICK) {
    const packageId = (
      await args.prompt.text(`capability id for "${component.name}"`)
    ).trim();
    if (packageId === "") return component;
    return reconsider(component, packageId, args, true);
  }

  return component;
}

/**
 * Walk every unresolved component to a decision. Components already resolved
 * are returned untouched, so running this twice is harmless.
 */
export async function resolveInteractively(
  args: ResolveInteractiveArgs,
): Promise<GateRecord> {
  const components: ComponentVerdict[] = [];
  for (const component of args.record.components) {
    components.push(
      component.verdict === UNRESOLVED
        ? await resolveOne(component, args)
        : component,
    );
  }
  return { ...args.record, components };
}
