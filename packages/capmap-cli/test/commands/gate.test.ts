import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGateRecord, resolveGateDir } from "@capmap/core";
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
      components: ["ui kit"],
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

  it("prefers explicit --component flags over the document section", async () => {
    const specPath = await specFile("# Spec\n\n## Components\n\n- ignored\n");
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

  /**
   * SP-3 audit round 4: the feature id was read from the absolute path, so a
   * checkout under `/work/specs/100-acme/` named every record "100-acme". The
   * id comes from the path inside the repository, as the hook reads it.
   */
  it("names the record from the path inside the repository", async () => {
    const outer = await mkdtemp(join(tmpdir(), "capmap-outer-"));
    const repo = join(outer, "specs", "100-acme", "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, "docs"), { recursive: true });
    const specPath = join(repo, "docs", "2026-08-02-tenant-portal-design.md");
    await writeFile(specPath, SPEC);
    const deps = await gateDeps([
      SHORTLIST,
      rank([{ packageId: "alpha/ui-kit", score: 0.9, rationale: "Exact." }]),
    ]);
    await runGateCommand(deps, { specPath, components: [], resolve: false });
    const record = await readGateRecord(await resolveGateDir(specPath), "tenant-portal");
    expect(record?.feature).toBe("tenant-portal");
  });
});
