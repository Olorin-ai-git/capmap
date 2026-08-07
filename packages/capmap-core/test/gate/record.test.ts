import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveFeatureId,
  resolveGateDir,
  writeGateRecord,
  readGateRecord,
} from "../../src/gate/record.js";
import {
  GATE_SCHEMA_VERSION,
  type GateRecord,
} from "../../src/model/gate-schema.js";

const record: GateRecord = {
  schemaVersion: GATE_SCHEMA_VERSION,
  specPath: "docs/specs/x.md",
  feature: "tenant-portal",
  componentsHash: `sha256:${"a".repeat(64)}`,
  componentsSource: "document" as const,
  generatedAt: "2026-08-02T00:00:00.000Z",
  indexGeneratedAt: "2026-07-27T00:00:00.000Z",
  staleRepos: [],
  components: [
    {
      name: "billing",
      verdict: "REUSE",
      target: "angainor/billing",
      score: 0.86,
      bestCandidate: null,
      verifiedSha: "f9f6127",
      failedChecks: [],
      competing: [],
      rationale: "Already built.",
    },
  ],
};

async function gateDir(prefix: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), prefix)), ".capmap");
}

describe("deriveFeatureId", () => {
  it.each([
    [
      "docs/superpowers/specs/2026-08-02-tenant-portal-design.md",
      "tenant-portal",
    ],
    ["docs/superpowers/plans/2026-08-02-tenant-portal.md", "tenant-portal"],
    [
      "docs/superpowers/plans/2026-08-02-tenant-portal-plan.md",
      "tenant-portal",
    ],
    ["specs/tenant-portal.md", "tenant-portal"],
    ["C:\\work\\specs\\2026-08-02-tenant-portal-design.md", "tenant-portal"],
  ])("derives %s to %s", (path, expected) => {
    expect(deriveFeatureId(path)).toBe(expected);
  });

  it("maps a spec and its plan to the same feature id", () => {
    expect(deriveFeatureId("a/2026-08-02-x-design.md")).toBe(
      deriveFeatureId("b/2026-08-02-x.md"),
    );
  });
});

describe("resolveGateDir", () => {
  it("anchors on the nearest repository root", async () => {
    const root = await mkdtemp(join(tmpdir(), "capmap-gate-"));
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "docs", "specs"), { recursive: true });
    const dir = await resolveGateDir(join(root, "docs", "specs", "x.md"));
    expect(dir).toBe(join(root, ".capmap"));
  });

  it("falls back to the file directory outside a repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "capmap-nogit-"));
    const dir = await resolveGateDir(join(root, "x.md"));
    expect(dir).toBe(join(root, ".capmap"));
  });
});

describe("gate record persistence", () => {
  it("round-trips a record", async () => {
    const dir = await gateDir("capmap-rec-");
    const path = await writeGateRecord(dir, record);
    expect(path).toMatch(/gate-tenant-portal\.json$/);
    expect(
      (await readGateRecord(dir, "tenant-portal"))?.components[0]?.verdict,
    ).toBe("REUSE");
  });

  it("replaces an existing record without leaving a partial file behind", async () => {
    const dir = await gateDir("capmap-rec-");
    await writeGateRecord(dir, record);
    await writeGateRecord(dir, {
      ...record,
      components: [{ ...record.components[0]!, verdict: "UNRESOLVED" }],
    });
    expect(await readdir(dir)).toEqual(["gate-tenant-portal.json"]);
    expect(
      (await readGateRecord(dir, "tenant-portal"))?.components[0]?.verdict,
    ).toBe("UNRESOLVED");
  });

  it("returns null for an absent record", async () => {
    const dir = await gateDir("capmap-rec-");
    expect(await readGateRecord(dir, "absent")).toBeNull();
  });

  it("throws on a schema-version mismatch", async () => {
    const dir = await gateDir("capmap-rec-");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "gate-old.json"),
      JSON.stringify({ ...record, schemaVersion: 99, feature: "old" }),
    );
    await expect(readGateRecord(dir, "old")).rejects.toThrow(/schema version/i);
  });

  it("surfaces a read failure that is not a missing record", async () => {
    const dir = await gateDir("capmap-rec-");
    await mkdir(join(dir, "gate-unreadable.json"), { recursive: true });
    await expect(readGateRecord(dir, "unreadable")).rejects.toThrow();
  });
});
