import { describe, it, expect } from "vitest";
import { classifyPath } from "../src/classify.js";
import { decide } from "../src/decide.js";

const HASH = `sha256:${"a".repeat(64)}`;

const record = {
  schemaVersion: 1 as const,
  specPath: "specs/x.md",
  feature: "x",
  componentsHash: HASH,
  componentsSource: "document" as const,
  generatedAt: "2026-08-02T00:00:00.000Z",
  indexGeneratedAt: "2026-07-27T00:00:00.000Z",
  staleRepos: [] as string[],
  components: [
    {
      name: "billing",
      verdict: "REUSE" as const,
      target: "angainor/billing",
      score: 0.86,
      bestCandidate: null,
      verifiedSha: "f9f6127",
      failedChecks: [] as string[],
      competing: [] as never[],
      rationale: "Built.",
    },
  ],
};

const base = {
  filePath: "docs/superpowers/plans/2026-08-02-x.md",
  fileExists: true,
  isSpec: true,
  isPlan: false,
  record,
  currentComponentsHash: HASH,
  indexPresent: true,
  bypass: false,
};

describe("decide", () => {
  it("allows a path that is neither a specification nor a plan", () => {
    expect(decide({ ...base, isSpec: false,
  isPlan: false, record: null }).allow).toBe(
      true,
    );
  });

  it("allows creating a new specification that has no gate record yet", () => {
    const d = decide({ ...base, fileExists: false, record: null });
    expect(d).toEqual({ allow: true, warning: null });
  });

  it("allows when the record is complete and the hash matches", () => {
    expect(decide(base)).toEqual({ allow: true, warning: null });
  });

  it("blocks when a document-gated component section has been removed", () => {
    const d = decide({ ...base, currentComponentsHash: null });
    expect(d.allow).toBe(false);
    expect((d as { reason: string }).reason).toMatch(/removed from this document/i);
  });

  it("allows an absent section when the record came from --component flags", () => {
    // That document never had a section, so its absence carries no information
    // and must not block every write to it forever.
    expect(
      decide({
        ...base,
        currentComponentsHash: null,
        record: { ...record, componentsSource: "flags" as const },
      }),
    ).toEqual({ allow: true, warning: null });
  });

  it("blocks an edit to an existing file with no gate record", () => {
    const d = decide({ ...base, record: null });
    expect(d).toMatchObject({ allow: false });
    expect((d as { reason: string }).reason).toMatch(/capmap gate/);
  });

  it("blocks when any component is unresolved and names it", () => {
    const unresolved = {
      ...record,
      components: [
        { ...record.components[0]!, verdict: "UNRESOLVED" as const },
      ],
    };
    const d = decide({ ...base, record: unresolved });
    expect(d.allow).toBe(false);
    expect((d as { reason: string }).reason).toMatch(/billing/);
  });

  it("blocks when the component set changed since the gate ran", () => {
    const d = decide({
      ...base,
      currentComponentsHash: `sha256:${"b".repeat(64)}`,
    });
    expect(d.allow).toBe(false);
    expect((d as { reason: string }).reason).toMatch(/component set changed/i);
  });

  it("blocks with a distinct message when the index is missing", () => {
    const d = decide({ ...base, indexPresent: false, record: null });
    expect(d.allow).toBe(false);
    expect((d as { reason: string }).reason).toMatch(/capmap scan --all/);
  });

  it("warns but allows when repositories are stale", () => {
    const d = decide({
      ...base,
      record: { ...record, staleRepos: ["alpha"] },
    });
    expect(d).toMatchObject({ allow: true });
    expect((d as { warning: string }).warning).toMatch(/alpha/);
  });

  it("allows unconditionally when bypassed", () => {
    const d = decide({ ...base, record: null, bypass: true });
    expect(d).toMatchObject({ allow: true });
    expect((d as { warning: string }).warning).toMatch(/bypass/i);
  });

  it("bypasses even when the component set changed", () => {
    const d = decide({
      ...base,
      bypass: true,
      currentComponentsHash: `sha256:${"c".repeat(64)}`,
    });
    expect(d).toMatchObject({ allow: true });
  });
});

/**
 * A plan never carries a `## Components` section — that lives in the
 * specification it implements — so a null hash on a plan means "nothing to
 * compare", not "the gated list was deleted". Applying the removal rule to
 * plans blocked every plan write that had a perfectly good gate record, which
 * is the opposite of what the rule is for.
 */
describe("the removal rule applies to specifications only", () => {
  it("allows a plan with no component section and a resolved record", () => {
    const d = decide({
      ...base,
      isSpec: false,
      isPlan: true,
      currentComponentsHash: null,
    });
    expect(d).toMatchObject({ allow: true });
  });

  it("still blocks a specification whose section was removed", () => {
    const d = decide({
      ...base,
      isSpec: true,
  isPlan: false,
      currentComponentsHash: null,
    });
    expect(d.allow).toBe(false);
    expect((d as { reason: string }).reason).toMatch(/removed from this document/i);
  });

  it("still blocks a plan when a component is unresolved", () => {
    const d = decide({
      ...base,
      isSpec: false,
      isPlan: true,
      currentComponentsHash: null,
      record: {
        ...record,
        components: [{ ...record.components[0]!, verdict: "UNRESOLVED" as const }],
      },
    });
    expect(d.allow).toBe(false);
  });
});

/**
 * The glob sets may overlap — a specification under a `plans/` tree, or one
 * caught by the plan-prefixed-filename glob. Collapsing that to a single
 * exclusive kind meant whichever set was tested first silently disabled the
 * other's protection, so such a document could shed its gated component list.
 */
describe("a path matching BOTH glob sets gets both rules", () => {
  const both = { isSpec: true, isPlan: true };

  it("blocks removing the component list, the specification rule", () => {
    const d = decide({ ...base, ...both, currentComponentsHash: null });
    expect(d.allow).toBe(false);
    expect((d as { reason: string }).reason).toMatch(/removed from this document/i);
  });

  it("blocks creating it ungated, the plan rule", () => {
    const d = decide({ ...base, ...both, fileExists: false, record: null });
    expect(d.allow).toBe(false);
  });

  it("still allows an unchanged write when the record is resolved", () => {
    expect(decide({ ...base, ...both })).toMatchObject({ allow: true });
  });
});

describe("classifyPath", () => {
  const specsGated = { spec: (p: string) => p.includes("/specs/") && p.endsWith(".md"), plan: () => false };

  it("makes a spec-kit sibling a plan and spec.md the only specification", () => {
    expect(classifyPath("/r/specs/029-x/spec.md", specsGated)).toEqual({ isSpec: true, isPlan: false });
    expect(classifyPath("/r/specs/029-x/plan.md", specsGated)).toEqual({ isSpec: false, isPlan: true });
    expect(classifyPath("/r/specs/029-x/contracts/a.md", specsGated)).toEqual({ isSpec: false, isPlan: true });
    expect(classifyPath("/r/specs/029-x/contracts/a.yaml", specsGated)).toEqual({ isSpec: false, isPlan: false });
    expect(classifyPath("/r/specs/029-x/checklists/q.md", specsGated)).toEqual({ isSpec: false, isPlan: false });
  });

  it("leaves a spec-kit folder to the globs when they do not gate its spec.md", () => {
    const none = { spec: () => false, plan: () => false };
    expect(classifyPath("/r/specs/029-x/plan.md", none)).toEqual({ isSpec: false, isPlan: false });
  });
});
