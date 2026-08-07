import type {
  DomainEntry,
  IndexManifest,
  PackageEntry,
  RepoIndex,
} from "@capmap/core";
import { INDEX_SCHEMA_VERSION } from "@capmap/core";
import { IndexStore } from "@capmap/core";
import { fixtureEstateRoot } from "../../../capmap-core/test/support/fixture-estate.js";
import { FIXTURE_NOW } from "./deps.js";

/** Sha the fixture index claims it was built from; matches the git double. */
export const FIXTURE_SCANNED_SHA = "sha-1";

const uiKit: PackageEntry = {
  id: "alpha/ui-kit",
  repo: "alpha",
  kind: "npm-package",
  name: "@alpha/ui-kit",
  path: "alpha/packages/ui-kit",
  manifest: "package.json",
  entry: "src/index.ts",
  exports: ["Button", "Modal", "useTheme"],
  deps: { internal: [], external: [] },
  consumers: ["@alpha/mailer"],
  deployTarget: null,
  loc: 40,
  hasTests: true,
  hasReadme: true,
  lastCommit: "2026-07-01T00:00:00.000Z",
  significance: 0.72,
  maturity: "beta",
  summary: "Reusable interface components for the alpha console.",
  domainTags: ["ui-kit"],
  scannedSha: FIXTURE_SCANNED_SHA,
  enrichmentFailed: false,
  extractionFailed: false,
};

const mailer: PackageEntry = {
  id: "alpha/mailer",
  repo: "alpha",
  kind: "npm-package",
  name: "@alpha/mailer",
  path: "alpha/packages/mailer",
  manifest: "package.json",
  entry: "src/index.ts",
  exports: ["sendTemplated"],
  deps: { internal: ["@alpha/ui-kit"], external: ["mjml"] },
  consumers: [],
  deployTarget: { kind: "firebase-functions", config: "firebase.json" },
  loc: 12,
  hasTests: false,
  hasReadme: false,
  lastCommit: "2026-07-01T00:00:00.000Z",
  significance: 0.51,
  maturity: "prototype",
  summary: "Templated transactional email delivery.",
  domainTags: ["email"],
  scannedSha: FIXTURE_SCANNED_SHA,
  enrichmentFailed: false,
  extractionFailed: false,
};

const designSystem: DomainEntry = {
  id: "alpha/design-system",
  repo: "alpha",
  tier: "core",
  title: "Design system",
  summary: "Shared interface primitives used across the alpha console.",
  domainTags: ["ui-kit"],
  packages: ["alpha/ui-kit"],
  stack: ["typescript"],
  maturity: "beta",
  proofOfLife: {
    deployed: null,
    testCount: 12,
    lastCommit: "2026-07-01T00:00:00.000Z",
  },
  scannedSha: FIXTURE_SCANNED_SHA,
};

const alpha: RepoIndex = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  repo: "alpha",
  tier: "core",
  domains: [designSystem],
  packages: [uiKit, mailer],
  minor: [
    {
      id: "alpha/console",
      path: "alpha/apps/console",
      kind: "app",
      significance: 0.18,
      parseError: null,
    },
  ],
};

/**
 * gamma carries a domain covering the same ground as alpha's design system, so
 * the fixture can represent the situation the estate actually contains: two
 * repositories having independently built the same capability.
 */
const legacyInterface: DomainEntry = {
  id: "gamma/legacy-interface",
  repo: "gamma",
  tier: "archived",
  title: "Legacy television interface",
  summary: "Retired interface components for the television client.",
  domainTags: ["ui-kit"],
  packages: ["gamma/legacy-tv"],
  stack: ["javascript"],
  maturity: "archived",
  proofOfLife: { deployed: null, testCount: null, lastCommit: null },
  scannedSha: null,
};

const gamma: RepoIndex = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  repo: "gamma",
  tier: "archived",
  domains: [legacyInterface],
  packages: [
    {
      ...uiKit,
      id: "gamma/legacy-tv",
      repo: "gamma",
      name: "@gamma/legacy-tv",
      path: "gamma",
      entry: "src/index.js",
      exports: [],
      consumers: [],
      summary: "Retired television client.",
      domainTags: [],
      maturity: "archived",
      significance: 0.46,
      scannedSha: null,
    },
  ],
  minor: [],
};

const manifest: IndexManifest = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  generatedAt: FIXTURE_NOW.toISOString(),
  root: fixtureEstateRoot(),
  repos: [
    {
      id: "alpha",
      path: "alpha",
      tier: "core",
      vcs: "git",
      available: true,
      scannedSha: FIXTURE_SCANNED_SHA,
      domainCount: alpha.domains.length,
      packageCount: alpha.packages.length,
      minorCount: alpha.minor.length,
      enrichedAt: FIXTURE_NOW.toISOString(),
    },
    {
      id: "gamma",
      path: "gamma",
      tier: "archived",
      vcs: "none",
      available: true,
      scannedSha: null,
      domainCount: gamma.domains.length,
      packageCount: gamma.packages.length,
      minorCount: 0,
      enrichedAt: null,
    },
  ],
};

/**
 * Write a small index over the committed fixture estate, so that the query
 * commands can be exercised without paying for a full scan. Every path and
 * export in it is real, which is what makes it usable by the verify command.
 */
export async function writeFixtureIndex(indexDirAbs: string): Promise<void> {
  const store = new IndexStore({ indexDirAbs });
  await store.writeRepo(alpha);
  await store.writeRepo(gamma);
  await store.writeManifest(manifest);
}
