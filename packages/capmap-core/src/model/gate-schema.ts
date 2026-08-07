import { z } from "zod";

/** Version of the gate record format. Independent of the index schema version. */
export const GATE_SCHEMA_VERSION = 1;

export const VerdictSchema = z.enum([
  "REUSE",
  "EXTEND",
  "REFERENCE",
  "BUILD",
  "UNRESOLVED",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ComponentVerdictSchema = z.object({
  name: z.string().min(1),
  verdict: VerdictSchema,
  /** Capability the component resolves to; null for BUILD and UNRESOLVED. */
  target: z.string().nullable(),
  score: z.number().min(0).max(1),
  /** Highest-ranked capability considered, retained even when it was not adopted. */
  bestCandidate: z.string().nullable(),
  verifiedSha: z.string().nullable(),
  failedChecks: z.array(z.string()),
  /**
   * Rival implementations of this component found in OTHER repositories, each
   * scoring at or above the extend threshold.
   *
   * Populated because across this estate duplication rather than absence is the
   * dominant waste: authentication, billing and transactional email each exist
   * twice, and the UI kit three times. A verdict naming one target and staying
   * silent about the others would describe an estate that does not exist, and
   * would attach a verified sha to the omission. Two matches inside a single
   * repository are normal layering and are deliberately not recorded here.
   */
  competing: z
    .array(
      z.object({
        packageId: z.string().min(1),
        repo: z.string().min(1),
        score: z.number().min(0).max(1),
      }),
    )
    .default([]),
  rationale: z.string(),
});
export type ComponentVerdict = z.infer<typeof ComponentVerdictSchema>;
export type CompetingImplementation = ComponentVerdict["competing"][number];

export const GateRecordSchema = z.object({
  schemaVersion: z.literal(GATE_SCHEMA_VERSION),
  specPath: z.string().min(1),
  feature: z.string().min(1),
  componentsHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /**
   * Where the component list came from.
   *
   * The hook needs this to tell two situations apart that look identical from
   * the document alone: a specification whose `## Components` section was
   * DELETED — which must block, because the gated list is gone — and one that
   * never had a section because the operator passed `--component` flags, where
   * the absence of a section is normal and must not block every write forever.
   */
  componentsSource: z.enum(["document", "flags"]).default("document"),
  generatedAt: z.string().min(1),
  indexGeneratedAt: z.string().min(1),
  staleRepos: z.array(z.string()),
  components: z.array(ComponentVerdictSchema),
});
export type GateRecord = z.infer<typeof GateRecordSchema>;

/** Components that blocked the gate. An empty result means the gate is satisfied. */
export function unresolvedComponents(record: GateRecord): ComponentVerdict[] {
  return record.components.filter((c) => c.verdict === "UNRESOLVED");
}
