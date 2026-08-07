import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSearch } from "../../src/commands/search.js";
import { runShow } from "../../src/commands/show.js";
import { runVerify } from "../../src/commands/verify.js";
import { runStatus } from "../../src/commands/status.js";
import { runGateCommand } from "../../src/commands/gate.js";
import { makeDeps, type TestDeps } from "../support/deps.js";
import { writeFixtureIndex } from "../support/index-fixture.js";

async function deps(withIndex = true): Promise<TestDeps> {
  const indexDir = await mkdtemp(join(tmpdir(), "capmap-err-"));
  if (withIndex) await writeFixtureIndex(indexDir);
  return makeDeps({ indexDir, headShaByRepo: { alpha: "sha-1" } });
}

const output = (d: TestDeps): string => d.writer.lines.join("\n");

describe("commands against a missing index", () => {
  it("gate reports that the index has never been built", async () => {
    const d = await deps(false);
    const code = await runGateCommand(d, {
      specPath: "/nonexistent/specs/2026-08-02-x-design.md",
      components: ["billing"],
      resolve: false,
    });
    expect(code).toBe(1);
    expect(output(d)).toMatch(/capmap scan --all/);
  });

  it("search surfaces the missing index rather than returning nothing", async () => {
    const d = await deps(false);
    await expect(
      runSearch(d, { query: "billing", limit: null, tier: null, kind: null }),
    ).rejects.toThrow(/capmap scan --all/);
  });
});

describe("search argument validation", () => {
  it("rejects a negative limit", async () => {
    const d = await deps();
    const code = await runSearch(d, {
      query: "ui",
      limit: "-3",
      tier: null,
      kind: null,
    });
    expect(code).toBe(1);
    expect(output(d)).toMatch(/--limit/);
  });

  it("rejects a fractional limit", async () => {
    const d = await deps();
    const code = await runSearch(d, {
      query: "ui",
      limit: "2.5",
      tier: null,
      kind: null,
    });
    expect(code).toBe(1);
  });

  it("rejects a zero limit", async () => {
    const d = await deps();
    expect(
      await runSearch(d, { query: "ui", limit: "0", tier: null, kind: null }),
    ).toBe(1);
  });

  it("accepts a valid kind filter", async () => {
    const d = await deps();
    const code = await runSearch(d, {
      query: "ui",
      limit: null,
      tier: null,
      kind: "npm-package",
    });
    expect(code).toBe(0);
  });

  it("lists the permitted tiers when one is unknown", async () => {
    const d = await deps();
    await runSearch(d, {
      query: "ui",
      limit: null,
      tier: "legendary",
      kind: null,
    });
    expect(output(d)).toMatch(/core/);
    expect(output(d)).toMatch(/external/);
  });
});

describe("gate component extraction failures", () => {
  it("reports a specification it cannot read", async () => {
    const d = await deps();
    const code = await runGateCommand(d, {
      specPath: "/nonexistent/path/spec.md",
      components: [],
      resolve: false,
    });
    expect(code).toBe(1);
    expect(output(d)).toMatch(/cannot read specification/);
  });
});

describe("show and verify edge cases", () => {
  it("show reports an unknown id and suggests search", async () => {
    const d = await deps();
    const code = await runShow(d, { id: "alpha/absent" });
    expect(code).toBe(1);
    expect(output(d)).toMatch(/capmap search/);
  });

  it("verify names several unknown ids at once", async () => {
    const d = await deps();
    const code = await runVerify(d, { ids: ["alpha/ghost", "alpha/phantom"] });
    expect(code).toBe(1);
    expect(output(d)).toMatch(/alpha\/ghost/);
    expect(output(d)).toMatch(/alpha\/phantom/);
  });

  it("verify reports a per-run tally", async () => {
    const d = await deps();
    await runVerify(d, { ids: [] });
    expect(output(d)).toMatch(/\d+ of \d+ verified/);
  });
});

describe("status", () => {
  it("reports drift counts and the repository table", async () => {
    const d = await deps();
    const code = await runStatus(d);
    expect(code).toBe(0);
    expect(output(d)).toMatch(/repositories drifted/);
    expect(output(d)).toMatch(/alpha/);
  });
});
