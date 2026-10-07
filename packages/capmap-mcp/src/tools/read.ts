import {
  PackageKindSchema,
  computeDrift,
  searchIndex,
  verifyCapability,
  type PackageEntry,
} from "@capmap/core";
import { DEFAULT_LIMIT, allPackages, asString, load } from "../shared.js";
import type { ToolDefinition, ToolDeps } from "../types.js";

/**
 * The four read-only tools. None consults a model, so all four are cheap,
 * deterministic and safe to call speculatively.
 */
export function readTools(deps: ToolDeps): ToolDefinition[] {
  return [
    {
      name: "capmap_search",
      description:
        "Rank capabilities in the Olorin estate against a query. Returns domain, " +
        "package and minor-entry hits with their tier and score. Deterministic " +
        "term overlap — no model call, so the same query always ranks the same.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "terms to match" },
          limit: { type: "number", description: "maximum hits, default 20" },
          tier: {
            type: "string",
            enum: ["core", "active", "archived", "external"],
          },
          kind: {
            type: "string",
            enum: PackageKindSchema.options,
          },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const { repos, drifted } = await load(deps);
        const hits = searchIndex({
          repos,
          query: String(args["query"] ?? ""),
          scoring: deps.config.scan.search,
          limit:
            typeof args["limit"] === "number" ? args["limit"] : DEFAULT_LIMIT,
          ...(asString(args["tier"]) === undefined
            ? {}
            : { tier: args["tier"] as never }),
          ...(asString(args["kind"]) === undefined
            ? {}
            : { kind: args["kind"] as never }),
        });
        return { hits, staleRepos: drifted };
      },
    },
    {
      name: "capmap_show",
      description:
        "Return one indexed entry in full by id, whichever layer holds it — " +
        "domain, package or minor. Includes consumers, deploy target and the " +
        "sha the entry was scanned at.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      handler: async (args) => {
        const id = String(args["id"] ?? "");
        const { repos } = await load(deps);
        for (const repo of repos) {
          const domain = repo.domains.find((entry) => entry.id === id);
          if (domain !== undefined)
            return { found: true, layer: "domain", entry: domain };
          const pkg = repo.packages.find((entry) => entry.id === id);
          if (pkg !== undefined)
            return { found: true, layer: "package", entry: pkg };
          const minor = repo.minor.find((entry) => entry.id === id);
          if (minor !== undefined)
            return { found: true, layer: "minor", entry: minor };
        }
        return { found: false, id };
      },
    },
    {
      name: "capmap_verify",
      description:
        "Check indexed capabilities against live source: the path exists, the " +
        "manifest still declares the indexed name, the entry point resolves and " +
        "every recorded export is still exported. Wholly deterministic.",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" } },
        },
      },
      handler: async (args) => {
        const requested = Array.isArray(args["ids"])
          ? (args["ids"] as string[])
          : [];
        const { repos } = await load(deps);
        const packages = allPackages(repos);
        const byId = new Map(packages.map((entry) => [entry.id, entry]));
        const missing = requested.filter((id) => !byId.has(id));
        if (missing.length > 0) return { ok: false, notInIndex: missing };

        const targets =
          requested.length === 0
            ? packages
            : requested.map((id) => byId.get(id) as PackageEntry);
        const results = [];
        for (const entry of targets) {
          results.push(
            await verifyCapability({ entry, rootAbs: deps.config.root }),
          );
        }
        return { ok: results.every((r) => r.ok), results };
      },
    },
    {
      name: "capmap_status",
      description:
        "Report when the index was built, how many entries each repository " +
        "contributes, and which repositories have drifted since being scanned.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const manifest = await deps.store.readManifest();
        const drift = await computeDrift(manifest, deps.git, deps.config.root);
        return {
          generatedAt: manifest.generatedAt,
          root: manifest.root,
          repos: manifest.repos,
          drifted: drift.drifted,
          unavailable: drift.unavailable,
        };
      },
    },
  ];
}
