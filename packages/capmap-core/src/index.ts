/**
 * Public surface of @capmap/core.
 *
 * The CLI, the MCP adapter and the PreToolUse hook consume the library only
 * through this barrel. Anything not exported here is an implementation detail
 * and may change without a version bump.
 */

export * from "./config/schema.js";
export * from "./config/load.js";

export * from "./model/index-schema.js";
export * from "./model/gate-schema.js";

export * from "./ports/index.js";

export * from "./scanner/discover.js";
export * from "./scanner/scan.js";
export * from "./scanner/unit-id.js";
export * from "./scanner/significance.js";
export * from "./scanner/maturity.js";
export * from "./scanner/consumers.js";

export * from "./store/index-store.js";
export * from "./store/drift.js";

export * from "./enrich/package-pass.js";
export * from "./enrich/domain-pass.js";
export * from "./enrich/domain-chunks.js";
export * from "./enrich/domain-coverage.js";
export { sanitiseDomain, sanitiseModelText } from "./enrich/untrusted.js";

export * from "./search/search.js";
export * from "./verify/verify.js";

export * from "./gate/components.js";
export * from "./gate/verdict.js";
export * from "./gate/match.js";
export * from "./gate/match-prompts.js";
export * from "./gate/match-parse.js";
export * from "./gate/resolve.js";
export * from "./gate/run.js";
export * from "./gate/interactive.js";
export * from "./gate/eval.js";

// `record.js` re-exports deriveFeatureId, so feature-id.js is deliberately not
// exported here as well — doing so would be a duplicate export of one symbol.
export * from "./gate/record.js";
