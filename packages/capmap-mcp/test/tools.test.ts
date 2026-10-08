import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTools, type ToolDefinition } from "../src/tools.js";
import { makeToolDeps } from "./support/tool-deps.js";

let tools: ToolDefinition[];

function tool(name: string): ToolDefinition {
  const found = tools.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no such tool: ${name}`);
  return found;
}

beforeEach(async () => {
  const indexDir = await mkdtemp(join(tmpdir(), "capmap-mcp-"));
  tools = buildTools(await makeToolDeps(indexDir));
});

describe("tool surface", () => {
  it("exposes exactly the five documented tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "capmap_gate",
      "capmap_search",
      "capmap_show",
      "capmap_status",
      "capmap_verify",
    ]);
  });

  it("gives every tool an object schema and a real description", () => {
    for (const definition of tools) {
      expect(definition.inputSchema.type).toBe("object");
      expect(definition.description.length).toBeGreaterThan(40);
    }
  });

  it("marks the model-backed tool as costing calls, so a caller can tell", () => {
    expect(tool("capmap_gate").description).toMatch(/model call/i);
    expect(tool("capmap_search").description).toMatch(/no model call/i);
  });
});

describe("capmap_search", () => {
  it("ranks the matching domain above its packages", async () => {
    const result = (await tool("capmap_search").handler({
      query: "ui-kit",
    })) as { hits: Array<{ id: string; layer: string }> };
    expect(result.hits[0]?.layer).toBe("domain");
    expect(result.hits[0]?.id).toBe("alpha/design-system");
  });

  it("reports stale repositories alongside the hits", async () => {
    const result = (await tool("capmap_search").handler({
      query: "email",
    })) as { staleRepos: string[] };
    expect(result.staleRepos).toContain("gamma");
  });

  it("honours an explicit limit", async () => {
    const result = (await tool("capmap_search").handler({
      query: "alpha",
      limit: 1,
    })) as { hits: unknown[] };
    expect(result.hits).toHaveLength(1);
  });

  it("returns no hits for a query with no overlap", async () => {
    const result = (await tool("capmap_search").handler({
      query: "holography",
    })) as { hits: unknown[] };
    expect(result.hits).toEqual([]);
  });
});

describe("capmap_show", () => {
  it("returns a package with its layer", async () => {
    const result = (await tool("capmap_show").handler({
      id: "alpha/mailer",
    })) as { found: boolean; layer: string; entry: { name: string } };
    expect(result.found).toBe(true);
    expect(result.layer).toBe("package");
    expect(result.entry.name).toBe("@alpha/mailer");
  });

  it("returns a domain", async () => {
    const result = (await tool("capmap_show").handler({
      id: "alpha/design-system",
    })) as { layer: string };
    expect(result.layer).toBe("domain");
  });

  it("reports a missing id rather than throwing", async () => {
    await expect(
      tool("capmap_show").handler({ id: "nope/nothing" }),
    ).resolves.toMatchObject({ found: false, id: "nope/nothing" });
  });
});

describe("capmap_verify", () => {
  it("verifies every indexed package when given no ids", async () => {
    const result = (await tool("capmap_verify").handler({})) as {
      ok: boolean;
      results: Array<{ id: string }>;
    };
    expect(result.results.map((r) => r.id)).toContain("alpha/ui-kit");
    expect(result.ok).toBe(true);
  });

  it("reports an id that is not in the index without throwing", async () => {
    const result = (await tool("capmap_verify").handler({
      ids: ["alpha/ghost"],
    })) as { ok: boolean; notInIndex: string[] };
    expect(result.ok).toBe(false);
    expect(result.notInIndex).toEqual(["alpha/ghost"]);
  });
});

describe("capmap_status", () => {
  it("reports index age, repositories and drift", async () => {
    const result = (await tool("capmap_status").handler({})) as {
      generatedAt: string;
      repos: unknown[];
      drifted: string[];
    };
    expect(result.generatedAt).toBeTruthy();
    expect(result.repos.length).toBeGreaterThan(0);
    expect(result.drifted).toContain("gamma");
  });
});

describe("capmap_gate", () => {
  it("returns a record of verdicts", async () => {
    const result = (await tool("capmap_gate").handler({
      components: ["ui kit"],
      specPath: "docs/specs/2026-08-02-x-design.md",
    })) as { components: Array<{ name: string; verdict: string }> };
    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.name).toBe("ui kit");
  });
});

describe("capmap_search kind filter", () => {
  it("offers every package kind the index can hold, including Python sub-packages", async () => {
    const { PackageKindSchema } = await import("@capmap/core");
    const { readTools } = await import("../src/tools/read.js");
    const search = readTools({} as never).find((tool) => tool.name === "capmap_search");
    const kind = (search?.inputSchema as unknown as { properties: { kind: { enum: string[] } } }).properties.kind;
    expect(kind.enum).toEqual(PackageKindSchema.options);
    expect(kind.enum).toContain("py-subpackage");
  });
});
