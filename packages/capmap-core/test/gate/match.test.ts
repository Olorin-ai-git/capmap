import { describe, it, expect } from "vitest";
import {
  selectCandidateDomains,
  rankPackagesForComponent,
} from "../../src/gate/match.js";
import { scriptedModel, silentLogger } from "../support/doubles.js";
import {
  INDEX_SCHEMA_VERSION,
  type RepoIndex,
} from "../../src/model/index-schema.js";

const CFG = {
  maxCandidates: 5,
  model: "m",
  effort: "high",
  selectMaxTokens: 4096,
  rankMaxTokens: 1024,
};
const SELECT_TOKENS = 2048;
const RANK_TOKENS = 512;

const repos: RepoIndex[] = [
  {
    schemaVersion: INDEX_SCHEMA_VERSION,
    repo: "angainor",
    tier: "active",
    domains: [
      {
        id: "angainor/multi-tenant-billing",
        repo: "angainor",
        tier: "active",
        title: "Billing",
        summary: "Stripe subscriptions.",
        domainTags: ["billing"],
        packages: ["angainor/billing"],
        stack: ["stripe"],
        maturity: "ga",
        proofOfLife: { deployed: null, testCount: null, lastCommit: null },
        scannedSha: null,
      },
    ],
    packages: [
      {
        id: "angainor/billing",
        repo: "angainor",
        kind: "service",
        name: "billing",
        path: "Angainor/src/billing",
        manifest: "package.json",
        entry: null,
        exports: [],
        deps: { internal: [], external: [] },
        consumers: [],
        deployTarget: null,
        loc: 900,
        hasTests: true,
        hasReadme: true,
        lastCommit: null,
        significance: 0.8,
        maturity: "ga",
        summary: "Stripe.",
        domainTags: ["billing"],
        scannedSha: null,
        enrichmentFailed: false,
        extractionFailed: false,
      },
    ],
    minor: [],
  },
];

describe("selectCandidateDomains", () => {
  it("maps each component to shortlisted domain ids", async () => {
    const model = scriptedModel([
      JSON.stringify({
        selections: [
          { component: "billing", domains: ["angainor/multi-tenant-billing"] },
        ],
      }),
    ]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.get("billing")).toEqual(["angainor/multi-tenant-billing"]);
    expect(model.calls).toBe(1);
  });

  it("passes the model, effort and token budget through to the request", async () => {
    const seen: unknown[] = [];
    const model = {
      calls: 0,
      complete: async (request: unknown) => {
        seen.push(request);
        return JSON.stringify({ selections: [] });
      },
    };
    await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(seen[0]).toMatchObject({
      model: "m",
      effort: "high",
      maxTokens: SELECT_TOKENS,
    });
  });

  it("loads the whole domain layer into the prompt verbatim", async () => {
    let user = "";
    const model = {
      complete: async (request: { user: string }) => {
        user = request.user;
        return JSON.stringify({ selections: [] });
      },
    };
    await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(user).toContain("angainor/multi-tenant-billing");
    expect(user).toContain("Stripe subscriptions.");
  });

  it("drops domain ids that are not in the index", async () => {
    const model = scriptedModel([
      JSON.stringify({
        selections: [
          {
            component: "billing",
            domains: ["angainor/invented", "angainor/multi-tenant-billing"],
          },
        ],
      }),
    ]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.get("billing")).toEqual(["angainor/multi-tenant-billing"]);
  });

  it("drops components the model invented", async () => {
    const model = scriptedModel([
      JSON.stringify({
        selections: [
          { component: "billing", domains: ["angainor/multi-tenant-billing"] },
          {
            component: "telepathy",
            domains: ["angainor/multi-tenant-billing"],
          },
        ],
      }),
    ]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect([...(result ?? new Map()).keys()]).toEqual(["billing"]);
  });

  it("truncates to maxCandidates", async () => {
    const many = { ...CFG, maxCandidates: 1 };
    const extra: RepoIndex = {
      ...repos[0]!,
      domains: [
        repos[0]!.domains[0]!,
        { ...repos[0]!.domains[0]!, id: "angainor/invoicing" },
      ],
    };
    const model = scriptedModel([
      JSON.stringify({
        selections: [
          {
            component: "billing",
            domains: ["angainor/multi-tenant-billing", "angainor/invoicing"],
          },
        ],
      }),
    ]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos: [extra],
      model,
      config: many,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.get("billing")).toEqual(["angainor/multi-tenant-billing"]);
  });

  it("de-duplicates repeated domain ids", async () => {
    const model = scriptedModel([
      JSON.stringify({
        selections: [
          {
            component: "billing",
            domains: [
              "angainor/multi-tenant-billing",
              "angainor/multi-tenant-billing",
            ],
          },
        ],
      }),
    ]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.get("billing")).toHaveLength(1);
  });

  it("yields null, not an empty shortlist, for a component the model omitted (CM-3)", async () => {
    const model = scriptedModel([JSON.stringify({ selections: [] })]);
    const result = await selectCandidateDomains({
      components: ["holography"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.get("holography")).toBeNull();
  });

  it("reports unavailable and warns when the model returns unusable output", async () => {
    const warnings: string[] = [];
    const logger = { ...silentLogger(), warn: (m: string) => warnings.push(m) };
    const model = scriptedModel(["not json at all"]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger,
      maxTokens: SELECT_TOKENS,
    });
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("reports unavailable when the braces enclose malformed JSON", async () => {
    const model = scriptedModel(["{ selections: not-json }"]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result).toBeNull();
  });

  it("tolerates prose around the JSON body", async () => {
    const model = scriptedModel([
      'Here you go:\n{"selections":[{"component":"billing","domains":' +
        '["angainor/multi-tenant-billing"]}]}\nHope that helps.',
    ]);
    const result = await selectCandidateDomains({
      components: ["billing"],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.get("billing")).toEqual(["angainor/multi-tenant-billing"]);
  });

  it("makes no model call when there are no components", async () => {
    const model = scriptedModel([JSON.stringify({ selections: [] })]);
    const result = await selectCandidateDomains({
      components: [],
      repos,
      model,
      config: CFG,
      logger: silentLogger(),
      maxTokens: SELECT_TOKENS,
    });
    expect(result?.size ?? 0).toBe(0);
    expect(model.calls).toBe(0);
  });
});

describe("rankPackagesForComponent", () => {
  it("returns a ranked list, highest score first", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [
          {
            packageId: "angainor/billing",
            score: 0.86,
            rationale: "Stripe lifecycle already built.",
          },
        ],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking).toEqual([
      {
        packageId: "angainor/billing",
        score: 0.86,
        rationale: "Stripe lifecycle already built.",
      },
    ]);
    expect(model.calls).toBe(1);
  });

  it("keeps every plausible candidate, so duplication stays visible", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [
          { packageId: "angainor/billing", score: 0.6, rationale: "Fits." },
          { packageId: "twogates/billing", score: 0.81, rationale: "Fits better." },
        ],
      }),
    ]);
    const rival = {
      ...repos[0]!.packages[0]!,
      id: "twogates/billing",
      repo: "twogates",
      name: "billing",
    };
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: [...repos[0]!.packages, rival],
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking?.map((r) => r.packageId)).toEqual([
      "twogates/billing",
      "angainor/billing",
    ]);
  });

  it("drops an invented id but keeps the valid ones from the same reply", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [
          { packageId: "angainor/imaginary", score: 0.99, rationale: "x" },
          { packageId: "angainor/billing", score: 0.7, rationale: "Real." },
        ],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking?.map((r) => r.packageId)).toEqual(["angainor/billing"]);
    expect(model.calls).toBe(1);
  });

  it("retries and reports unavailable when every id is invented", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [
          { packageId: "angainor/imaginary", score: 0.9, rationale: "x" },
        ],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking).toBeNull();
    expect(model.calls).toBe(2);
  });

  it("de-duplicates a package the model ranked twice", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [
          { packageId: "angainor/billing", score: 0.8, rationale: "first" },
          { packageId: "angainor/billing", score: 0.3, rationale: "again" },
        ],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking).toHaveLength(1);
    expect(ranking?.[0]?.score).toBe(0.8);
  });

  it("accepts a valid reply on the retry after an unusable one", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [{ packageId: "angainor/imaginary", score: 0.9, rationale: "x" }],
      }),
      JSON.stringify({
        rankings: [
          { packageId: "angainor/billing", score: 0.4, rationale: "Partial fit." },
        ],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking?.[0]?.packageId).toBe("angainor/billing");
    expect(model.calls).toBe(2);
  });

  it("rejects a score outside the unit interval", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [{ packageId: "angainor/billing", score: 1.4, rationale: "x" }],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 0,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking).toBeNull();
    expect(model.calls).toBe(1);
  });

  it("returns empty without calling the model when there are no candidates", async () => {
    const model = scriptedModel(["{}"]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: [],
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking).toEqual([]);
    expect(model.calls).toBe(0);
  });

  it("puts the candidate package ids and summaries in the prompt", async () => {
    let user = "";
    const model = {
      complete: async (request: { user: string }) => {
        user = request.user;
        return JSON.stringify({
          rankings: [
            { packageId: "angainor/billing", score: 0.5, rationale: "ok" },
          ],
        });
      },
    };
    await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(user).toContain("angainor/billing");
    expect(user).toContain("Stripe.");
  });

  it("renders a candidate that has no summary without dropping it", async () => {
    let user = "";
    const model = {
      complete: async (request: { user: string }) => {
        user = request.user;
        return JSON.stringify({
          rankings: [
            { packageId: "angainor/billing", score: 0.5, rationale: "ok" },
          ],
        });
      },
    };
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: [{ ...repos[0]!.packages[0]!, summary: null }],
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 1,
      maxTokens: RANK_TOKENS,
    });
    expect(user).toContain("no summary available");
    expect(ranking?.[0]?.packageId).toBe("angainor/billing");
  });
});

/**
 * A reply cut off by the token ceiling is not malformed JSON in an obvious way
 * — it is a prefix of valid JSON. Live, ten candidates each carrying a
 * rationale overflowed a 1024-token ceiling, every reply truncated, and all of
 * it surfaced only as "unusable result": indistinguishable from a refusal, and
 * every component fell to UNRESOLVED with zero candidates while all unit tests
 * passed.
 */
describe("truncated ranking replies", () => {
  const truncated =
    '{"rankings":[{"packageId":"angainor/billing","score":0.8,' +
    '"implementsIt":true,"rationale":"Stripe subscription lifecy';

  it("treats a truncated reply as unusable rather than crashing", async () => {
    const model = scriptedModel([truncated]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 0,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking).toBeNull();
  });

  it("logs the reply length and tail so truncation is diagnosable", async () => {
    const fields: Record<string, unknown>[] = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (_m: string, f?: Record<string, unknown>) => {
        if (f !== undefined) fields.push(f);
      },
      error: () => undefined,
    };
    await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model: scriptedModel([truncated]),
      config: CFG,
      logger,
      maxRetries: 0,
      maxTokens: RANK_TOKENS,
    });
    const logged = fields.find((f) => f["replyLength"] !== undefined);
    expect(logged?.["replyLength"]).toBe(truncated.length);
    expect(String(logged?.["replyTail"])).toContain("lifecy");
    expect(logged?.["maxTokens"]).toBe(RANK_TOKENS);
  });

  it("still parses a complete reply carrying implementsIt", async () => {
    const model = scriptedModel([
      JSON.stringify({
        rankings: [
          {
            packageId: "angainor/billing",
            score: 0.15,
            implementsIt: true,
            rationale: "Bundled inside a control plane; exists but not adoptable.",
          },
        ],
      }),
    ]);
    const ranking = await rankPackagesForComponent({
      component: "billing",
      candidates: repos[0]!.packages,
      model,
      config: CFG,
      logger: silentLogger(),
      maxRetries: 0,
      maxTokens: RANK_TOKENS,
    });
    expect(ranking?.[0]?.implementsIt).toBe(true);
    expect(ranking?.[0]?.score).toBe(0.15);
  });
});
