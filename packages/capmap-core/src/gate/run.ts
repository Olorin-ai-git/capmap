import type { ScanConfig } from "../config/schema.js";
import {
  GATE_SCHEMA_VERSION,
  type ComponentVerdict,
  type GateRecord,
} from "../model/gate-schema.js";
import type { IndexManifest, RepoIndex } from "../model/index-schema.js";
import type { Clock, Logger, ModelClient } from "../ports/index.js";
import { hashComponents, normaliseComponents } from "./components.js";
import { deriveFeatureId } from "./feature-id.js";
import { rankPackagesForComponent, selectCandidateDomains } from "./match.js";
import { packagesForDomains, resolveComponent } from "./resolve.js";

export interface RunGateArgs {
  specPath: string;
  /**
   * Path the feature id is derived from: the specification's path inside its
   * repository, as the hook reads it. specPath when the caller has no repository.
   */
  featurePath?: string;
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
    const rankings =
      shortlists === null
        ? null
        : await rankPackagesForComponent({
            component,
            candidates: packagesForDomains(
              args.repos,
              shortlists.get(component) ?? [],
            ),
            model: args.model,
            config: args.matching,
            logger: args.logger,
            maxRetries: args.maxRetries,
            maxTokens: args.rankMaxTokens,
          });
    verdicts.push(
      await resolveComponent({
        component,
        rankings,
        repos: args.repos,
        rootAbs: args.rootAbs,
        thresholds: args.thresholds,
      }),
    );
  }

  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    specPath: args.specPath,
    feature: deriveFeatureId(args.featurePath ?? args.specPath),
    componentsHash: hashComponents(components),
    componentsSource: args.componentsSource,
    generatedAt: args.clock.now().toISOString(),
    indexGeneratedAt: args.manifest.generatedAt,
    staleRepos: args.staleRepos,
    components: verdicts,
  };
}
