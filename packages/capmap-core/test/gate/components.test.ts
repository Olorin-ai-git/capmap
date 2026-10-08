import { describe, it, expect } from "vitest";
import {
  normaliseComponents,
  hashComponents,
  extractComponentsFromMarkdown,
} from "../../src/gate/components.js";
import {
  GATE_SCHEMA_VERSION,
  GateRecordSchema,
  unresolvedComponents,
  VerdictSchema,
  type GateRecord,
} from "../../src/model/gate-schema.js";

describe("normaliseComponents", () => {
  it("trims, lowercases, de-duplicates and sorts", () => {
    expect(
      normaliseComponents([" Billing ", "auth", "BILLING", "", "UI  Kit"]),
    ).toEqual(["auth", "billing", "ui kit"]);
  });

  it("drops entries that are only whitespace", () => {
    expect(normaliseComponents(["   ", "\t\n", "auth"])).toEqual(["auth"]);
  });
});

describe("hashComponents", () => {
  it("is stable under reordering and case", () => {
    expect(hashComponents(["auth", "Billing"])).toBe(
      hashComponents(["BILLING", "auth"]),
    );
  });

  it("changes when a component is added", () => {
    expect(hashComponents(["auth"])).not.toBe(
      hashComponents(["auth", "billing"]),
    );
  });

  it("is prefixed for self-description", () => {
    expect(hashComponents(["auth"])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("distinguishes a split component from a joined one", () => {
    expect(hashComponents(["auth", "billing"])).not.toBe(
      hashComponents(["auth billing"]),
    );
  });
});

describe("extractComponentsFromMarkdown", () => {
  it("reads list items under a Components heading", () => {
    const md = [
      "# Spec",
      "prose",
      "## Components",
      "- auth/login",
      "- billing",
      "",
      "## Other",
      "- ignored",
    ].join("\n");
    expect(extractComponentsFromMarkdown(md)).toEqual([
      "auth/login",
      "billing",
    ]);
  });

  it("strips bold markers and trailing descriptions", () => {
    const md = "## Components\n- **billing** — Stripe subscriptions\n- auth\n";
    expect(extractComponentsFromMarkdown(md)).toEqual(["billing", "auth"]);
  });

  it("strips a colon-separated description", () => {
    expect(
      extractComponentsFromMarkdown("## Components\n* billing: Stripe\n"),
    ).toEqual(["billing"]);
  });

  it("returns null when the heading is absent", () => {
    expect(extractComponentsFromMarkdown("# Spec\nprose only")).toBeNull();
  });

  it("returns an empty list for a Components heading with no items", () => {
    expect(extractComponentsFromMarkdown("## Components\n\n## Next")).toEqual(
      [],
    );
  });

  it("stops at a following level-one heading", () => {
    const md = "## Components\n- billing\n\n# Appendix\n- ignored\n";
    expect(extractComponentsFromMarkdown(md)).toEqual(["billing"]);
  });

  it("reads to the end of the document when nothing follows", () => {
    expect(extractComponentsFromMarkdown("## Components\n- billing\n")).toEqual(
      ["billing"],
    );
  });

  it("ignores a horizontal rule inside the section", () => {
    expect(
      extractComponentsFromMarkdown("## Components\n- auth\n---\n"),
    ).toEqual(["auth"]);
  });
});

describe("gate record schema", () => {
  const record: GateRecord = {
    schemaVersion: GATE_SCHEMA_VERSION,
    specPath: "docs/specs/x.md",
    feature: "tenant-portal",
    componentsHash: hashComponents(["billing", "holography"]),
    specContentHash: `sha256:${"b".repeat(64)}`,
    componentsSource: "document",
    generatedAt: "2026-08-02T00:00:00.000Z",
    indexGeneratedAt: "2026-07-27T00:00:00.000Z",
    staleRepos: [],
    components: [
      {
        name: "billing",
        verdict: "REUSE",
        target: "angainor/billing",
        score: 0.86,
        bestCandidate: "angainor/billing",
        verifiedSha: "f9f6127",
        failedChecks: [],
        competing: [],
        rationale: "Already built.",
      },
      {
        name: "holography",
        verdict: "UNRESOLVED",
        target: null,
        score: 0.9,
        bestCandidate: "angainor/billing",
        verifiedSha: null,
        failedChecks: ["exports"],
        competing: [],
        rationale: "Declared exports were not found in source.",
      },
    ],
  };

  it("accepts a well-formed record", () => {
    expect(GateRecordSchema.parse(record).components).toHaveLength(2);
  });

  it("rejects a record whose components hash is not a sha256 digest", () => {
    expect(
      GateRecordSchema.safeParse({ ...record, componentsHash: "sha256:zz" })
        .success,
    ).toBe(false);
  });

  it("rejects a foreign schema version", () => {
    expect(
      GateRecordSchema.safeParse({ ...record, schemaVersion: 99 }).success,
    ).toBe(false);
  });

  it("enumerates every verdict the gate can emit", () => {
    expect(VerdictSchema.options).toEqual([
      "REUSE",
      "EXTEND",
      "REFERENCE",
      "BUILD",
      "UNRESOLVED",
    ]);
  });

  it("selects only the unresolved components", () => {
    expect(unresolvedComponents(record).map((c) => c.name)).toEqual([
      "holography",
    ]);
  });

  it("returns nothing when every component resolved", () => {
    const resolved: GateRecord = {
      ...record,
      components: [record.components[0]!],
    };
    expect(unresolvedComponents(resolved)).toEqual([]);
  });
});
