import { z } from "zod";
import { RepoTierSchema } from "../config/schema.js";

export const INDEX_SCHEMA_VERSION = 1;

export const PackageKindSchema = z.enum([
  "npm-package",
  "py-package",
  "service",
  "app",
  "function",
]);
export type PackageKind = z.infer<typeof PackageKindSchema>;

export const MaturitySchema = z.enum(["ga", "beta", "prototype", "archived"]);
export type Maturity = z.infer<typeof MaturitySchema>;

export const DeployTargetSchema = z.object({
  kind: z.enum([
    "firebase-hosting",
    "firebase-functions",
    "cloud-run",
    "cloud-build",
    "app-hosting",
    "docker",
    "docker-compose",
  ]),
  config: z.string().min(1),
});

export const PackageEntrySchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  kind: PackageKindSchema,
  name: z.string().min(1),
  path: z.string().min(1),
  manifest: z.string().min(1),
  entry: z.string().nullable(),
  exports: z.array(z.string()),
  deps: z.object({
    internal: z.array(z.string()),
    external: z.array(z.string()),
  }),
  consumers: z.array(z.string()),
  deployTarget: DeployTargetSchema.nullable(),
  loc: z.number().int().nonnegative(),
  hasTests: z.boolean(),
  hasReadme: z.boolean(),
  lastCommit: z.string().nullable(),
  significance: z.number().min(0).max(1),
  maturity: MaturitySchema,
  summary: z.string().nullable(),
  domainTags: z.array(z.string()),
  scannedSha: z.string().nullable(),
  enrichmentFailed: z.boolean(),
  extractionFailed: z.boolean(),
});
export type PackageEntry = z.infer<typeof PackageEntrySchema>;

export const MinorEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: PackageKindSchema,
  significance: z.number().min(0).max(1),
  parseError: z.string().nullable(),
});
export type MinorEntry = z.infer<typeof MinorEntrySchema>;

export const DomainEntrySchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  tier: RepoTierSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  domainTags: z.array(z.string()).min(1).max(6),
  packages: z.array(z.string()).min(1),
  stack: z.array(z.string()),
  maturity: MaturitySchema,
  proofOfLife: z.object({
    deployed: z.string().nullable(),
    testCount: z.number().int().nonnegative().nullable(),
    lastCommit: z.string().nullable(),
  }),
  scannedSha: z.string().nullable(),
});
export type DomainEntry = z.infer<typeof DomainEntrySchema>;

export const RepoIndexSchema = z.object({
  schemaVersion: z.literal(INDEX_SCHEMA_VERSION),
  repo: z.string().min(1),
  tier: RepoTierSchema,
  domains: z.array(DomainEntrySchema),
  packages: z.array(PackageEntrySchema),
  minor: z.array(MinorEntrySchema),
});
export type RepoIndex = z.infer<typeof RepoIndexSchema>;

export const RepoManifestEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  tier: RepoTierSchema,
  vcs: z.enum(["git", "none"]),
  available: z.boolean(),
  scannedSha: z.string().nullable(),
  domainCount: z.number().int().nonnegative(),
  packageCount: z.number().int().nonnegative(),
  minorCount: z.number().int().nonnegative(),
  enrichedAt: z.string().nullable(),
});

export const IndexManifestSchema = z.object({
  schemaVersion: z.literal(INDEX_SCHEMA_VERSION),
  generatedAt: z.string().min(1),
  root: z.string().min(1),
  repos: z.array(RepoManifestEntrySchema),
});
export type IndexManifest = z.infer<typeof IndexManifestSchema>;
