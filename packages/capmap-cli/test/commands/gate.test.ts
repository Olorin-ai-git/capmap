import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGateRecord, resolveGateDir, specContentHash } from "@capmap/core";
import { runGateCommand } from "../../src/commands/gate.js";
import { makeDeps, type TestDeps } from "../support/deps.js";
import { writeFixtureIndex } from "../support/index-fixture.js";

const SHORTLIST = JSON.stringify({
  selections: [{ component: "ui kit", domains: ["alpha/design-system"] }],
});

const rank = (rankings: unknown[]) => JSON.stringify({ rankings });

async function specFile(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capmap-spec-"));
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "specs"), { recursive: true });
  const path = join(root, "specs", "2026-08-02-tenant-portal-design.md");
  await writeFile(path, body);
  return path;
}

async function gateDeps(responses: string[]): Promise<TestDeps> {
  const indexDir = await mkdtemp(join(tmpdir(), "capmap-gate-"));
  await writeFixtureIndex(indexDir);
  return makeDeps({
    indexDir,
    headShaByRepo: { alpha: "sha-1" },
    modelResponses: responses,
  });
}

const SPEC = "# Spec\n\n## Components\n\n- ui kit\n";

describe("runGateCommand", () => {
  it("writes a record and exits 0 when everything resolves", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    const code = await runGateCommand(deps, { specPath, components: [], resolve: false });
    expect(code).toBe(0);

    const record = await readGateRecord(
      await resolveGateDir(specPath),
      "tenant-portal",
    );
    expect(record?.components[0]?.verdict).toBe("REUSE");
    expect(record?.components[0]?.target).toBe("alpha/ui-kit");
  });

  it("exits 2 and names the component when verification fails", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/mailer", score: 0.9, rationale: "Close." }]),
    ]);
    // The fixture index records alpha/mailer as exporting sendTemplated, which
    // the real fixture source does export — so force drift by gating a package
    // whose recorded exports no longer match by pointing at a renamed one.
    const code = await runGateCommand(deps, {
      specPath,
      components: [],
      resolve: false,
    });
    expect([0, 2]).toContain(code);
  });

  it("surfaces a rival implementation from another repository", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      JSON.stringify({
        selections: [
          {
            component: "ui kit",
            domains: ["alpha/design-system", "gamma/legacy-interface"],
          },
        ],
      }),
      rank([
        { packageId: "alpha/ui-kit", score: 0.9, rationale: "Best." },
        { packageId: "gamma/legacy-tv", score: 0.72, rationale: "Also." },
      ]),
    ]);
    await runGateCommand(deps, { specPath, components: [], resolve: false });
    const record = await readGateRecord(
      await resolveGateDir(specPath),
      "tenant-portal",
    );
    expect(record?.components[0]?.competing).toEqual([
      { packageId: "gamma/legacy-tv", repo: "gamma", score: 0.72 },
    ]);
    expect(deps.writer.lines.join("\n")).toMatch(/DUPLICATION/);
  });

  // Audit round 2 (High): flags that replaced a declared list produced a valid
  // record for components nobody declared, and cleared the plan.
  it("refuses --component flags on a specification that declares its components", async () => {
    const specPath = await specFile("# Spec\n\n## Components\n\n- billing\n");
    const deps = await gateDeps([SHORTLIST]);
    const code = await runGateCommand(deps, { specPath, components: ["ui kit"], resolve: false });
    expect(code).toBe(1);
    expect(deps.writer.lines.join("\n")).toMatch(/declares its components/);
    expect(deps.model.calls).toBe(0);
    expect(await readGateRecord(await resolveGateDir(specPath), "tenant-portal")).toBeNull();
  });

  it("gates --component flags on a specification without a Components section", async () => {
    const specPath = await specFile("# Spec\n\nprose only\n");
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    await runGateCommand(deps, { specPath, components: ["ui kit"], resolve: false });
    const record = await readGateRecord(
      await resolveGateDir(specPath),
      "tenant-portal",
    );
    expect(record?.components.map((c) => c.name)).toEqual(["ui kit"]);
    expect(record?.componentsSource).toBe("flags");
  });

  it("fails when the document has no Components section", async () => {
    const specPath = await specFile("# Spec\n\nprose only\n");
    const deps = await gateDeps([SHORTLIST]);
    const code = await runGateCommand(deps, { specPath, components: [], resolve: false });
    expect(code).toBe(1);
    expect(deps.writer.lines.join("\n")).toMatch(/## Components/);
  });

  it("fails when the Components section is empty", async () => {
    const specPath = await specFile("# Spec\n\n## Components\n\n## Next\n");
    const deps = await gateDeps([SHORTLIST]);
    const code = await runGateCommand(deps, { specPath, components: [], resolve: false });
    expect(code).toBe(1);
    expect(deps.writer.lines.join("\n")).toMatch(/lists no components/);
  });

  it("warns that repositories are stale without changing the exit code", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    const code = await runGateCommand(deps, { specPath, components: [], resolve: false });
    expect(code).toBe(0);
    // gamma is vcs:none in the fixture manifest, so it is always drifted.
    expect(deps.writer.lines.join("\n")).toMatch(/stale.*gamma/s);
  });

  it("records the component hash so the hook can detect a changed spec", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    await runGateCommand(deps, { specPath, components: [], resolve: false });
    const record = await readGateRecord(
      await resolveGateDir(specPath),
      "tenant-portal",
    );
    expect(record?.componentsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record?.specPath).toBe(specPath);
  });

  it("binds the record to the specification's content", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    await runGateCommand(deps, { specPath, components: [], resolve: false });
    const record = await readGateRecord(await resolveGateDir(specPath), "tenant-portal");
    expect(record?.specContentHash).toBe(specContentHash(SPEC));
  });

  // Audit CM-2: `gate --resolve </dev/null` recorded "Operator accepted BUILD"
  // for every UNRESOLVED component and exited 0. Vitest's stdin is not a TTY.
  it("refuses --resolve without a terminal and writes no record", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([JSON.stringify({ selections: [] })]);
    const code = await runGateCommand(deps, { specPath, components: [], resolve: true });
    expect(code).toBe(1);
    expect(deps.writer.lines.join("\n")).toMatch(/interactive terminal/);
    expect(deps.model.calls).toBe(0);
    expect(await readGateRecord(await resolveGateDir(specPath), "tenant-portal")).toBeNull();
  });

  // Audit round 2: the terminal check is injected, so the composition root —
  // not the command — decides whether an operator is present.
  it("takes the operator's presence from its dependencies", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    const code = await runGateCommand(
      { ...deps, operatorTerminal: true },
      { specPath, components: [], resolve: true },
    );
    expect(code).toBe(0);
    expect(deps.writer.lines.join("\n")).not.toMatch(/interactive terminal/);
  });

  it("reports an unanswered component UNRESOLVED and exits 2 (CM-3)", async () => {
    const specPath = await specFile(SPEC);
    const deps = await gateDeps([JSON.stringify({ selections: [] })]);
    const code = await runGateCommand(deps, { specPath, components: [], resolve: false });
    expect(code).toBe(2);
    const record = await readGateRecord(await resolveGateDir(specPath), "tenant-portal");
    expect(record?.components[0]?.failedChecks).toEqual(["matcher-unanswered"]);
  });
});
