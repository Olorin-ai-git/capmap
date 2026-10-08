import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import picomatch from "picomatch";
import { bindingProblem, canonical, parseGateRecord } from "../src/gate-record.js";
import { componentsHash, specContentHash } from "../src/components-hash.js";

/** In-process cases for record validation and binding; the end-to-end suite drives the binary. */

const SPEC = "# Spec\n\n## Components\n\n- billing\n";
const isSpec = picomatch(["**/specs/**/*.md"], { nocase: true, dot: true });
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await canonical(await mkdtemp(join(tmpdir(), "capmap-record-")));
  dirs.push(dir);
  await mkdir(join(dir, "specs"));
  return dir;
}

function record(specPath: string, names: string[], spec = SPEC): Record<string, unknown> {
  return {
    schemaVersion: 2, specPath, feature: "foo",
    componentsHash: componentsHash(names), specContentHash: specContentHash(spec),
    componentsSource: "document", generatedAt: "t", indexGeneratedAt: "t", staleRepos: [],
    components: names.map((name) => ({
      name, verdict: "BUILD", target: null, score: 0, bestCandidate: null,
      verifiedSha: null, failedChecks: [], rationale: "",
    })),
  };
}

const parse = (raw: unknown) => parseGateRecord(JSON.stringify(raw), "foo");

describe("parseGateRecord", () => {
  it("accepts a genuine record and names what is wrong with others", () => {
    const good = record("/r/specs/foo.md", ["billing"]);
    expect(parse(good).problem).toBeNull();
    expect(parseGateRecord("{", "foo").problem).toMatch(/valid JSON/);
    expect(parse([]).problem).toMatch(/object/);
    expect(parse({ ...good, schemaVersion: 1 }).problem).toMatch(/schema/);
    expect(parse({ ...good, feature: "x" }).problem).toMatch(/feature/);
    expect(parse({ ...good, specPath: "rel.md" }).problem).toMatch(/absolute/);
    expect(parse({ ...good, specContentHash: "x" }).problem).toMatch(/bound/);
    expect(parse({ ...good, componentsSource: "x" }).problem).toMatch(/source/);
    expect(parse({ ...good, generatedAt: "" }).problem).toMatch(/times/);
    expect(parse({ ...good, staleRepos: [1] }).problem).toMatch(/stale/);
    expect(parse({ ...good, components: [] }).problem).toMatch(/no components/);
    expect(parse({ ...good, componentsHash: componentsHash(["x"]) }).problem).toMatch(/hash/);
    const [c] = good["components"] as Record<string, unknown>[];
    const bad = (patch: Record<string, unknown>) => parse({ ...good, components: [{ ...c, ...patch }] }).problem;
    expect(parseGateRecord(JSON.stringify({ ...good, components: [1] }), "foo").problem).toMatch(/not an object/);
    expect(bad({ name: "" })).toMatch(/no name/);
    expect(bad({ verdict: "MAYBE" })).toMatch(/verdict/);
    expect(bad({ score: 2 })).toMatch(/score/);
    expect(bad({ target: 1 })).toMatch(/target/);
    expect(bad({ failedChecks: "x" })).toMatch(/checks/);
    expect(bad({ competing: "x" })).toMatch(/competing/);
  });
});

describe("bindingProblem", () => {
  it("binds a specification to its own file, through symbolic links", async () => {
    const dir = await root();
    const spec = join(dir, "specs", "foo.md");
    await writeFile(spec, SPEC);
    await symlink(join(dir, "specs"), join(dir, "s"));
    const r = parse(record(spec, ["billing"])).record!;
    expect(await bindingProblem(r, { spec: join(dir, "s", "foo.md") }, isSpec)).toBeNull();
    expect(await bindingProblem(r, { spec: join(dir, "specs", "other.md") }, isSpec)).toMatch(/not this file/);
  });

  it("binds a plan to the specification it names, by the globs, its content, its components and the index", async () => {
    const dir = await root();
    const spec = join(dir, "specs", "foo.md");
    await writeFile(spec, SPEC);
    const named = (path: string): { plan: string; indexGeneratedAt: string } => ({ plan: path, indexGeneratedAt: "t" });
    expect(await bindingProblem(parse(record(spec, ["billing"])).record!, named(spec), isSpec)).toBeNull();
    expect(await bindingProblem(parse(record(spec, ["xyzzy"])).record!, named(spec), isSpec)).toMatch(/declares/);
    expect(await bindingProblem(parse(record(spec, ["billing"])).record!, { plan: spec, indexGeneratedAt: "u" }, isSpec))
      .toMatch(/index/);
    const decoy = join(dir, "decoy.md");
    await writeFile(decoy, SPEC);
    expect(await bindingProblem(parse(record(decoy, ["billing"])).record!, named(spec), isSpec)).toMatch(/names/);
    expect(await bindingProblem(parse(record(decoy, ["billing"])).record!, named(decoy), isSpec)).toMatch(/globs/);
    const gone = join(dir, "specs", "gone.md");
    expect(await bindingProblem(parse(record(gone, ["billing"])).record!, named(gone), isSpec)).toMatch(/cannot be read/);
    await writeFile(spec, `${SPEC}\nmore\n`);
    expect(await bindingProblem(parse(record(spec, ["billing"])).record!, named(spec), isSpec)).toMatch(/changed/);
  });
});

describe("canonical", () => {
  it("resolves the existing part of a path and keeps the rest", async () => {
    const dir = await root();
    await symlink(join(dir, "specs"), join(dir, "s"));
    expect(await canonical(join(dir, "s", "a", "b.md"))).toBe(join(dir, "specs", "a", "b.md"));
  });
});
