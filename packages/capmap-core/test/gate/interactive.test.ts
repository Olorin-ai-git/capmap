import { describe, it, expect } from "vitest";
import {
  CHOICE_BUILD,
  CHOICE_PICK,
  CHOICE_RECHECK,
  resolveInteractively,
} from "../../src/gate/interactive.js";
import { GATE_SCHEMA_VERSION } from "../../src/model/gate-schema.js";
import type {
  ComponentVerdict,
  GateRecord,
} from "../../src/model/gate-schema.js";
import { INDEX_SCHEMA_VERSION } from "../../src/model/index-schema.js";
import type { RepoIndex } from "../../src/model/index-schema.js";
import type { Prompt } from "../../src/ports/index.js";
import { fixtureEstateRoot } from "../support/fixture-estate.js";

const THRESHOLDS = {
  reuseThreshold: 0.7,
  extendThreshold: 0.5,
  duplicationThreshold: 0.3,
};

function scriptedPrompt(choices: number[], texts: string[] = []): Prompt {
  let choiceAt = 0;
  let textAt = 0;
  return {
    choose: () => Promise.resolve(choices[choiceAt++] ?? CHOICE_BUILD),
    text: () => Promise.resolve(texts[textAt++] ?? ""),
  };
}

const uiKit = {
  id: "alpha/ui-kit",
  repo: "alpha",
  kind: "npm-package" as const,
  name: "@alpha/ui-kit",
  path: "alpha/packages/ui-kit",
  manifest: "package.json",
  entry: "src/index.ts",
  exports: ["Button", "Modal", "useTheme"],
  deps: { internal: [], external: [] },
  consumers: [],
  deployTarget: null,
  loc: 40,
  hasTests: true,
  hasReadme: true,
  lastCommit: null,
  significance: 0.7,
  maturity: "beta" as const,
  summary: "UI kit.",
  domainTags: ["ui-kit"],
  scannedSha: "abc",
  enrichmentFailed: false,
  extractionFailed: false,
};

/** Same package, recorded with an export that no longer exists in the source. */
const drifted = { ...uiKit, id: "alpha/drifted", exports: ["Vanished"] };

function repos(tier: "core" | "external"): RepoIndex[] {
  return [
    {
      schemaVersion: INDEX_SCHEMA_VERSION,
      repo: "alpha",
      tier,
      domains: [],
      packages: [uiKit, drifted],
      minor: [],
    },
  ];
}

function record(component: Partial<ComponentVerdict> = {}): GateRecord {
  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    specPath: "specs/x.md",
    feature: "x",
    componentsHash: `sha256:${"a".repeat(64)}`,
    specContentHash: null,
  componentsSource: "document" as const,
    generatedAt: "2026-08-02T00:00:00.000Z",
    indexGeneratedAt: "2026-07-27T00:00:00.000Z",
    staleRepos: [],
    components: [
      {
        name: "ui kit",
        verdict: "UNRESOLVED",
        target: null,
        score: 0.9,
        bestCandidate: "alpha/drifted",
        verifiedSha: null,
        failedChecks: ["exports"],
        competing: [],
        rationale: "no longer exported: Vanished",
        ...component,
      },
    ],
  };
}

const base = { rootAbs: fixtureEstateRoot(), thresholds: THRESHOLDS };

describe("resolveInteractively", () => {
  it("accepts BUILD when the operator chooses to build", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record(),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_BUILD]),
    });
    expect(out.components[0]!.verdict).toBe("BUILD");
    expect(out.components[0]!.target).toBeNull();
    expect(out.components[0]!.failedChecks).toEqual([]);
  });

  it("leaves the component unresolved when a re-check still fails", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record(),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_RECHECK]),
    });
    expect(out.components[0]!.verdict).toBe("UNRESOLVED");
    expect(out.components[0]!.failedChecks).toEqual(["exports"]);
  });

  it("resolves when the operator points at a capability that verifies", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record(),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_PICK], ["alpha/ui-kit"]),
    });
    expect(out.components[0]!.verdict).toBe("REUSE");
    expect(out.components[0]!.target).toBe("alpha/ui-kit");
    expect(out.components[0]!.verifiedSha).toBe("abc");
  });

  it("reports an id that is not in the index", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record(),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_PICK], ["alpha/imaginary"]),
    });
    expect(out.components[0]!.verdict).toBe("UNRESOLVED");
    expect(out.components[0]!.rationale).toMatch(/not in the index/);
  });

  it("leaves the component untouched when the operator enters nothing", async () => {
    const original = record();
    const out = await resolveInteractively({
      ...base,
      record: original,
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_PICK], [""]),
    });
    expect(out.components[0]).toEqual(original.components[0]);
  });

  it("CANNOT promote an external-tier capability above REFERENCE", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record(),
      repos: repos("external"),
      prompt: scriptedPrompt([CHOICE_PICK], ["alpha/ui-kit"]),
    });
    // The operator chose it and it verifies, but the tier cap still binds:
    // resolution decides what to consider, never what the rules are.
    expect(out.components[0]!.verdict).toBe("REFERENCE");
  });

  it("does not carry the failed candidate's score onto a different capability", async () => {
    // The record's score of 0.9 was computed for alpha/drifted. Applying it to
    // a package the operator named instead would decide the verdict from
    // evidence about a different capability entirely.
    const out = await resolveInteractively({
      ...base,
      record: record({ score: 0.9, bestCandidate: "alpha/drifted" }),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_PICK], ["alpha/ui-kit"]),
    });
    expect(out.components[0]!.bestCandidate).toBe("alpha/ui-kit");
    expect(out.components[0]!.score).not.toBe(0.9);
  });

  it("still caps an operator choice by tier, whatever weight it carries", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record({ score: 0.1 }),
      repos: repos("external"),
      prompt: scriptedPrompt([CHOICE_PICK], ["alpha/ui-kit"]),
    });
    expect(out.components[0]!.verdict).toBe("REFERENCE");
  });

  it("keeps the original score when re-checking the ranked candidate", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record({ score: 0.64, bestCandidate: "alpha/ui-kit" }),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_RECHECK]),
    });
    expect(out.components[0]!.score).toBe(0.64);
  });

  it("does not touch a component that is already resolved", async () => {
    const resolved = record({ verdict: "REUSE", target: "alpha/ui-kit" });
    const out = await resolveInteractively({
      ...base,
      record: resolved,
      repos: repos("core"),
      prompt: scriptedPrompt([]),
    });
    expect(out).toEqual(resolved);
  });

  it("preserves the component hash so the hook still matches", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record(),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_BUILD]),
    });
    expect(out.componentsHash).toBe(record().componentsHash);
    expect(out.feature).toBe("x");
  });
});

/**
 * Audit CM-2: a matcher outage was cleared by "accept BUILD", and re-checking a
 * component with no candidate silently became BUILD. Neither is a comparison
 * against the estate, so neither may clear the component.
 */
describe("resolveInteractively never clears a component nobody compared (CM-2)", () => {
  it.each(["matcher-unavailable", "matcher-unanswered"])(
    "keeps a %s component UNRESOLVED when BUILD is chosen",
    async (check) => {
      const original = record({ failedChecks: [check], bestCandidate: null, score: 0 });
      const out = await resolveInteractively({
        ...base,
        record: original,
        repos: repos("core"),
        prompt: scriptedPrompt([CHOICE_BUILD]),
      });
      expect(out.components[0]).toEqual(original.components[0]);
    },
  );

  it("keeps a component with no candidate UNRESOLVED on re-check", async () => {
    const original = record({ bestCandidate: null });
    const out = await resolveInteractively({
      ...base,
      record: original,
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_RECHECK]),
    });
    expect(out.components[0]!.verdict).toBe("UNRESOLVED");
  });

  it("still lets the operator name a capability for an outage", async () => {
    const out = await resolveInteractively({
      ...base,
      record: record({ failedChecks: ["matcher-unavailable"], bestCandidate: null }),
      repos: repos("core"),
      prompt: scriptedPrompt([CHOICE_PICK], ["alpha/ui-kit"]),
    });
    expect(out.components[0]!.verdict).toBe("REUSE");
  });
});
