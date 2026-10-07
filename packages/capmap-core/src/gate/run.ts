import type { ScanConfig } from "../config/schema.js";
import {
  GATE_SCHEMA_VERSION,
  type ComponentVerdict,
  type GateRecord,
} from "../model/gate-schema.js";
import type { IndexManifest, RepoIndex } from "../model/index-schema.js";
import type { Clock, Logger, ModelClient } from "../ports/index.js";
import {
  hashComponents,
  normaliseComponents,
  specContentHash,
} from "./components.js";
import { deriveFeatureId } from "./feature-id.js";
import { rankPackagesForComponent, selectCandidateDomains } from "./match.js";
import { packagesForDomains, resolveComponent } from "./resolve.js";

/** Failed check naming a component the shortlisting model returned no answer for. */
export const UNANSWERED_CHECK = "matcher-unanswered";
const UNANSWERED =
  "The matcher answered without this component, so it was never compared " +
  "against the estate. This is not evidence that nothing exists.";

/**
 * A repository with packages but no domains is invisible to matching, so every component
 * would come back BUILD. That is an unenriched index, not an empty estate: refuse it.
 */
function refuseDomainlessIndex(repos: RepoIndex[]): void {
  const blind = repos
    .filter((repo) => repo.packages.length > 0 && repo.domains.length === 0)
    .map((repo) => repo.repo);
  if (blind.length > 0 || repos.every((repo) => repo.domains.length === 0)) {
    throw new Error(
      `the index has no domains for: ${blind.join(", ") || "any repository"}; ` +
        `matching cannot see those packages. Re-run "capmap scan" with enrichment ` +
        `before gating`,
    );
  }
}

export interface RunGateArgs {
  specPath: string;
  /** The specification's text, which the record is bound to; null when none was read. */
  specText: string | null;
  components: string[];
  /** Whether `components` was read from the document or supplied as flags. */
  componentsSource: "document" | "flags";
  repos: RepoIndex[];
  manifest: IndexManifest;
  staleRepos: string[];
  rootAbs: string;
  thresholds: ScanConfig["verdicts"];
  matching: ScanConfig["matching"];
  selectMaxTokens: number;
  rankMaxTokens: number;
  model: ModelClient;
  clock: Clock;
  logger: Logger;
  maxRetries: number;
}

/**
 * Score every component of a draft specification against the index.
 *
 * Two model calls shape the answer — one shortlists domains for all components
 * at once, one ranks packages within each shortlist — and everything after that
 * is deterministic: verification opens the files, and the tier cap is applied
 * unconditionally. The model decides what a component resembles; it never
 * decides whether the capability exists or whether it may be recommended.
 */
export async function runGate(args: RunGateArgs): Promise<GateRecord> {
  refuseDomainlessIndex(args.repos);
  const components = normaliseComponents(args.components);
  const shortlists = await selectCandidateDomains({
    components,
    repos: args.repos,
    model: args.model,
    config: args.matching,
    logger: args.logger,
    maxTokens: args.selectMaxTokens,
  });

  const verdicts: ComponentVerdict[] = [];
  for (const component of components) {
    // A failed shortlist is not an empty shortlist. Passing null through means
    // every component reports UNRESOLVED rather than BUILD, so an outage blocks
    // instead of authorising construction.
    const shortlist = shortlists?.get(component) ?? null;
    const rankings =
      shortlist === null
        ? null
        : await rankPackagesForComponent({
            component,
            candidates: packagesForDomains(args.repos, shortlist),
            model: args.model,
            config: args.matching,
            logger: args.logger,
            maxRetries: args.maxRetries,
            maxTokens: args.rankMaxTokens,
          });
    const verdict = await resolveComponent({
      component,
      rankings,
      repos: args.repos,
      rootAbs: args.rootAbs,
      thresholds: args.thresholds,
    });
    // The model answered but not for this component: unanswered, not absent.
    verdicts.push(
      shortlists !== null && shortlist === null
        ? { ...verdict, failedChecks: [UNANSWERED_CHECK], rationale: UNANSWERED }
        : verdict,
    );
  }

  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    specPath: args.specPath,
    feature: deriveFeatureId(args.specPath),
    componentsHash: hashComponents(components),
    specContentHash:
      args.specText === null ? null : specContentHash(args.specText),
    componentsSource: args.componentsSource,
    generatedAt: args.clock.now().toISOString(),
    indexGeneratedAt: args.manifest.generatedAt,
    staleRepos: args.staleRepos,
    components: verdicts,
  };
}
