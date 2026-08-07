import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSearch } from "../../src/commands/search.js";
import { runShow } from "../../src/commands/show.js";
import { runVerify } from "../../src/commands/verify.js";
import { makeDeps, type TestDeps } from "../support/deps.js";
import { writeFixtureIndex } from "../support/index-fixture.js";

let deps: TestDeps;

beforeEach(async () => {
  const indexDir = await mkdtemp(join(tmpdir(), "capmap-query-"));
  await writeFixtureIndex(indexDir);
  deps = await makeDeps({ indexDir, headShaByRepo: { alpha: "sha-1" } });
});

const output = (): string => deps.writer.lines.join("\n");

describe("runSearch", () => {
  it("ranks the matching domain above its packages", async () => {
    const code = await runSearch(deps, {
      query: "ui-kit",
      limit: null,
      tier: null,
      kind: null,
    });
    expect(code).toBe(0);
    const lines = output().split("\n");
    const domainLine = lines.findIndex((l) =>
      l.includes("alpha/design-system"),
    );
    const packageLine = lines.findIndex((l) => l.includes("alpha/ui-kit"));
    expect(domainLine).toBeGreaterThan(0);
    expect(domainLine).toBeLessThan(packageLine);
  });

  it("warns that the index is stale for repositories that drifted", async () => {
    await runSearch(deps, {
      query: "email",
      limit: null,
      tier: null,
      kind: null,
    });
    expect(output()).toMatch(/stale/);
    expect(output()).toMatch(/gamma/);
  });

  it("honours an explicit limit", async () => {
    await runSearch(deps, {
      query: "alpha",
      limit: "1",
      tier: null,
      kind: null,
    });
    expect(
      output()
        .split("\n")
        .filter((l) => l.includes("alpha/")),
    ).toHaveLength(1);
  });

  it("filters by tier", async () => {
    await runSearch(deps, {
      query: "alpha",
      limit: null,
      tier: "archived",
      kind: null,
    });
    expect(output()).not.toMatch(/alpha\/ui-kit/);
  });

  it("reports when nothing matches", async () => {
    await runSearch(deps, {
      query: "holography",
      limit: null,
      tier: null,
      kind: null,
    });
    expect(output()).toMatch(/no capability matches/);
  });

  it("rejects a limit that is not a positive integer", async () => {
    const code = await runSearch(deps, {
      query: "email",
      limit: "many",
      tier: null,
      kind: null,
    });
    expect(code).toBe(1);
    expect(output()).toMatch(/--limit/);
  });

  it("rejects an unknown tier", async () => {
    const code = await runSearch(deps, {
      query: "email",
      limit: null,
      tier: "legendary",
      kind: null,
    });
    expect(code).toBe(1);
    expect(output()).toMatch(/tier/);
  });

  it("rejects an unknown kind", async () => {
    const code = await runSearch(deps, {
      query: "email",
      limit: null,
      tier: null,
      kind: "binary",
    });
    expect(code).toBe(1);
    expect(output()).toMatch(/kind/);
  });
});

describe("runShow", () => {
  it("renders a package with its consumers, deploy target and drift state", async () => {
    const code = await runShow(deps, { id: "alpha/mailer" });
    expect(code).toBe(0);
    expect(output()).toMatch(/@alpha\/mailer/);
    expect(output()).toMatch(/firebase-functions/);
    expect(output()).toMatch(/@alpha\/ui-kit/);
    expect(output()).toMatch(/current/);
  });

  it("renders a domain with its member packages", async () => {
    await runShow(deps, { id: "alpha/design-system" });
    expect(output()).toMatch(/Design system/);
    expect(output()).toMatch(/alpha\/ui-kit/);
  });

  it("renders a minor entry", async () => {
    await runShow(deps, { id: "alpha/console" });
    expect(output()).toMatch(/alpha\/apps\/console/);
  });

  it("reports drift for a repository without version control", async () => {
    await runShow(deps, { id: "gamma/legacy-tv" });
    expect(output()).toMatch(/drifted/);
  });

  it("fails when no entry carries the id", async () => {
    const code = await runShow(deps, { id: "alpha/absent" });
    expect(code).toBe(1);
    expect(output()).toMatch(/alpha\/absent/);
  });
});

describe("runVerify", () => {
  it("passes every check for an unchanged package", async () => {
    const code = await runVerify(deps, { ids: ["alpha/ui-kit"] });
    expect(code).toBe(0);
    expect(output()).toMatch(/alpha\/ui-kit/);
    expect(output()).toMatch(/ok/);
  });

  it("verifies every indexed package when no id is given", async () => {
    const code = await runVerify(deps, { ids: [] });
    expect(code).toBe(0);
    expect(output()).toMatch(/alpha\/mailer/);
    expect(output()).toMatch(/gamma\/legacy-tv/);
  });

  it("fails and names an id that is not in the index", async () => {
    const code = await runVerify(deps, { ids: ["alpha/ghost"] });
    expect(code).toBe(1);
    expect(output()).toMatch(/alpha\/ghost/);
    expect(output()).toMatch(/not in the index/);
  });
});
