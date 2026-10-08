import { describe, it, expect, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import picomatch from "picomatch";
import { evaluate, type Context } from "../src/evaluate.js";
import { canonical } from "../src/gate-record.js";
import { namedSpec, specReference } from "../src/plan-spec.js";
import { expandGlob, patchPaths, readRegular, tree } from "../src/shell-fs.js";
import { genuineRecord, SPEC_TEXT } from "./hook-harness.js";

/** In-process cases for plan binding and the shell's file-system reading; the end-to-end suites drive the binary. */

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await canonical(await mkdtemp(join(tmpdir(), "capmap-binding-")));
  dirs.push(dir);
  for (const sub of [".git", "specs", "plans", ".capmap"]) await mkdir(join(dir, sub));
  await writeFile(join(dir, "specs", "foo.md"), SPEC_TEXT);
  return dir;
}

const GENERATED = "2026-10-06T00:00:00.000Z";
const context = (over: Partial<Context> = {}): Context => ({
  protectedDirs: ["/protected"],
  bypass: false,
  isSpec: picomatch(["**/specs/**/*.md"], { dot: true }),
  isPlan: picomatch(["**/plans/**", "**/specs/**/plan.md"], { dot: true }),
  isExempt: picomatch(["**/.claude/plans/*.md"], { dot: true }),
  indexGeneratedAt: GENERATED,
  ...over,
});
const write = (fileAbs: string, content: string | null) => ({ fileAbs, input: content === null ? null : { content } });
const gate = async (dir: string, record: Record<string, unknown>, feature = "foo"): Promise<void> =>
  writeFile(join(dir, ".capmap", `gate-${feature}.json`), JSON.stringify({ ...record, indexGeneratedAt: GENERATED }));

describe("specReference", () => {
  it("reads a Spec line as text, link, backquotes or angle brackets", () => {
    expect(specReference("# P\n\nSpec: specs/a.md\n")).toBe("specs/a.md");
    expect(specReference("**Spec:** `specs/a.md`")).toBe("specs/a.md");
    expect(specReference("**Spec**: [a](../specs/a.md)")).toBe("../specs/a.md");
    expect(specReference("> Specification: <specs/a b.md>")).toBe("specs/a b.md");
    expect(specReference("Specs: x\nno line")).toBeNull();
  });
});

describe("namedSpec", () => {
  it("looks beside the plan, then at the root, and takes spec-kit's spec.md", async () => {
    const dir = await root();
    expect(await namedSpec(join(dir, "plans", "p.md"), "plans/p.md", "Spec: specs/foo.md", dir)).toBe(join(dir, "specs", "foo.md"));
    expect(await namedSpec(join(dir, "plans", "p.md"), "plans/p.md", "Spec: ../specs/foo.md", dir)).toBe(join(dir, "specs", "foo.md"));
    expect(await namedSpec(join(dir, "plans", "p.md"), "plans/p.md", "Spec: /abs.md", dir)).toBe("/abs.md");
    expect(await namedSpec(join(dir, "plans", "p.md"), "plans/p.md", "Spec: gone.md", dir)).toBe(join(dir, "plans", "gone.md"));
    expect(await namedSpec(join(dir, "plans", "p.md"), "plans/p.md", null, dir)).toBeNull();
    await mkdir(join(dir, "specs", "001-x"));
    await writeFile(join(dir, "specs", "001-x", "spec.md"), SPEC_TEXT);
    for (const doc of ["tasks.md", "research.md", "contracts/api.md"]) {
      expect(await namedSpec(join(dir, "specs", "001-x", doc), `specs/001-x/${doc}`, null, dir)).toBe(join(dir, "specs", "001-x", "spec.md"));
    }
  });
});

describe("evaluate", () => {
  it("binds a plan to the record of the specification it names", async () => {
    const dir = await root();
    const plan = join(dir, "plans", "foo-plan.md");
    expect((await evaluate(write(plan, "Spec: specs/foo.md"), context())).allow).toBe(false);
    await gate(dir, genuineRecord(dir));
    expect(await evaluate(write(plan, "Spec: specs/foo.md"), context())).toEqual({ allow: true, warning: null });
    // Filed under another feature, it does not clear on foo's record.
    expect((await evaluate(write(join(dir, "plans", "bar-plan.md"), "Spec: specs/foo.md"), context())).allow).toBe(false);
    expect((await evaluate(write(plan, "# no line"), context())).allow).toBe(false);
    expect((await evaluate(write(plan, null), context())).allow).toBe(false);
    expect((await evaluate(write(plan, "Spec: specs/foo.md"), context({ indexGeneratedAt: "other" }))).allow).toBe(false);
    expect((await evaluate(write(plan, "# no line"), context({ bypass: true }))).allow).toBe(true);
  });

  it("guards records, protected paths and specifications, and leaves exempt files alone", async () => {
    const dir = await root();
    await gate(dir, genuineRecord(dir));
    expect((await evaluate(write(join(dir, ".capmap", "x.json"), "{}"), context())).allow).toBe(false);
    expect((await evaluate(write("/protected/x", ""), context())).allow).toBe(false);
    expect((await evaluate(write(join(dir, ".claude", "plans", "p.md"), ""), context())).allow).toBe(true);
    expect((await evaluate(write(join(dir, "specs", "foo.md"), SPEC_TEXT), context())).allow).toBe(true);
    expect((await evaluate(write(join(dir, "specs", "foo.md"), null), context())).allow).toBe(false);
    expect((await evaluate(write(join(dir, "README.md"), ""), context())).allow).toBe(true);
  });

  it("treats spec-kit's plan.md as a plan of the spec.md beside it", async () => {
    const dir = await root();
    await mkdir(join(dir, "specs", "001-x"));
    const spec = join(dir, "specs", "001-x", "spec.md");
    await writeFile(spec, SPEC_TEXT);
    const isSpec = picomatch(["**/specs/**/*.md"], { dot: true });
    expect((await evaluate(write(join(dir, "specs", "001-x", "plan.md"), "# P"), context({ isSpec }))).allow).toBe(false);
    await gate(dir, genuineRecord(dir, SPEC_TEXT, { spec, feature: "001-x" }), "001-x");
    expect((await evaluate(write(join(dir, "specs", "001-x", "plan.md"), "# P"), context({ isSpec }))).allow).toBe(true);
  });
});

describe("shell-fs", () => {
  it("expands globs against the file system, keeping the literal", async () => {
    const dir = await root();
    expect(expandGlob(join(dir, "pl?ns", "x"), 100)).toEqual([join(dir, "pl?ns", "x"), join(dir, "plans", "x")]);
    expect(expandGlob(join(dir, "[ps]*"), 100).sort()).toEqual([join(dir, "[ps]*"), join(dir, "plans"), join(dir, "specs")].sort());
    expect(expandGlob(join(dir, "[!p]pecs"), 100)).toContain(join(dir, "specs"));
    expect(expandGlob(join(dir, "none*", "x"), 100)).toEqual([join(dir, "none*", "x")]);
    expect(() => expandGlob(join(dir, "*"), 1)).toThrow(/matches over/);
  });

  it("lists a directory's tree, refusing one past the limit", async () => {
    const dir = await root();
    expect(tree(join(dir, "specs"), 10)).toEqual(["foo.md"]);
    expect(tree(join(dir, "specs", "foo.md"), 10)).toBeNull();
    expect(tree(join(dir, "gone"), 10)).toBeNull();
    expect(() => tree(dir, 1)).toThrow(/entries/);
  });

  it("reads patches and regular files only", async () => {
    const dir = await root();
    expect(patchPaths("diff --git a/x/y b/x/z\n--- /dev/null\n+++ b/p.md\nrename to q\n")).toEqual([
      "x/y", "y", "x/z", "z", "p.md", "p.md", "q", "q",
    ]);
    expect(readRegular(join(dir, "specs", "foo.md"))).toBe(SPEC_TEXT);
    expect(readRegular(join(dir, "specs"))).toBeNull();
    expect(readRegular(join(dir, "gone"))).toBeNull();
    await symlink(join(dir, "specs", "foo.md"), join(dir, "link.md"));
    expect(readRegular(join(dir, "link.md"))).toBe(SPEC_TEXT);
  });
});
