import { computeDrift, runGate } from "@capmap/core";
import { asString } from "../shared.js";
import type { ToolDefinition, ToolDeps } from "../types.js";

/**
 * The one tool that spends model calls. Kept apart from the read-only tools so
 * the cost boundary is visible in the file layout, not only in prose.
 */
export function gateTool(deps: ToolDeps): ToolDefinition[] {
  return [
    {
      name: "capmap_gate",
      description:
        "Score a list of components against the estate and return a build-vs-reuse " +
        "verdict for each, verified against live source. Reports competing " +
        "implementations when the same capability exists in more than one " +
        "repository. Costs model calls.",
      inputSchema: {
        type: "object",
        properties: {
          components: { type: "array", items: { type: "string" } },
          specPath: {
            type: "string",
            description: "path recorded on the result; not read",
          },
        },
        required: ["components"],
      },
      handler: async (args) => {
        const components = Array.isArray(args["components"])
          ? (args["components"] as string[])
          : [];
        const manifest = await deps.store.readManifest();
        const repos = await deps.store.readAllRepos();
        const drift = await computeDrift(manifest, deps.git, deps.config.root);
        return runGate({
          specPath: asString(args["specPath"]) ?? "mcp://gate",
          // Not read, so the result is bound to no document and cannot satisfy the hook.
          specText: null,
          components,
          // The caller supplies components directly, so the record must not
          // claim they were read from a document: the hook uses that to tell a
          // deleted component section from one that never existed.
          componentsSource: "flags",
          repos,
          manifest,
          staleRepos: drift.drifted,
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
      },
    },
  ];
}
