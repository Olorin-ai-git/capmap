/**
 * A self-contained estate and index, for negative controls that must mean
 * something on a machine that is not this one.
 *
 * The consumer-edge controls used to run against the real index, whose manifest
 * records an absolute estate root under a specific home directory. On any other
 * machine — a CI runner, for one — that root does not exist, so the checker
 * failed for every edge before the mutation was applied and the control
 * "detected" its breakage without the breakage doing anything. A control that
 * passes for the wrong reason is worse than no control.
 *
 * Four packages, two of which deliberately share a name, so both the "is it
 * declared?" and the "is it the RIGHT package of that name?" halves of the
 * checker can be broken on purpose.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NPM_MANIFEST = "package.json";
const MANIFEST_NAME = "index.json";
const SHARED_NAME = "@fixture/ui";

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function pkg(id, name, path, consumers) {
  return {
    id, name, path, manifest: NPM_MANIFEST,
    kind: "npm-package", repo: id.split("/")[0],
    entry: null, exports: [], deps: { internal: [], external: [] },
    consumers, deployTarget: null, loc: 1, hasTests: false, hasReadme: false,
    lastCommit: null, significance: 0.9, maturity: "ga", summary: "fixture",
    domainTags: [], scannedSha: null, enrichmentFailed: false, extractionFailed: false,
  };
}

/**
 * Lay down the estate, the index that describes it, and a configuration that
 * points at both. The baseline must pass: every edge below is real.
 */
export function buildEstateFixture(root) {
  const estate = join(root, "estate");

  const manifests = [
    ["alpha/packages/ui", { name: SHARED_NAME, version: "1.0.0" }],
    ["alpha/apps/web", { name: "@fixture/web", dependencies: { [SHARED_NAME]: "1.0.0" } }],
    ["alpha/apps/standalone", { name: "@fixture/standalone", version: "1.0.0" }],
    ["beta/packages/ui", { name: SHARED_NAME, version: "1.0.0" }],
    ["beta/apps/web", { name: "@fixture/beta-web", dependencies: { [SHARED_NAME]: "1.0.0" } }],
  ];
  for (const [path, manifest] of manifests) {
    writeJson(join(estate, path, NPM_MANIFEST), manifest);
  }

  writeJson(join(root, "config", "scan.config.json"), { index: { dir: "index" } });
  writeJson(join(root, "index", MANIFEST_NAME), {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    root: estate,
    repos: [
      { id: "alpha", path: "alpha", tier: "core", vcs: "git", available: true,
        scannedSha: null, domainCount: 0, packageCount: 3, minorCount: 0, enrichedAt: null },
      { id: "beta", path: "beta", tier: "active", vcs: "git", available: true,
        scannedSha: null, domainCount: 0, packageCount: 2, minorCount: 0, enrichedAt: null },
    ],
  });

  writeJson(join(root, "index", "repos", "alpha.json"), {
    schemaVersion: 1, repo: "alpha", tier: "core", domains: [], minor: [],
    packages: [
      pkg("alpha/ui", SHARED_NAME, "alpha/packages/ui", ["alpha/web"]),
      pkg("alpha/web", "@fixture/web", "alpha/apps/web", []),
      pkg("alpha/standalone", "@fixture/standalone", "alpha/apps/standalone", []),
    ],
  });
  writeJson(join(root, "index", "repos", "beta.json"), {
    schemaVersion: 1, repo: "beta", tier: "active", domains: [], minor: [],
    packages: [
      pkg("beta/ui", SHARED_NAME, "beta/packages/ui", ["beta/web"]),
      pkg("beta/web", "@fixture/beta-web", "beta/apps/web", []),
    ],
  });

  return root;
}

export const FIXTURE = {
  /** The two packages that share a name, and the consumer nearest each. */
  sharedName: SHARED_NAME,
  nearConsumer: "alpha/web",
  nearProvider: "alpha/ui",
  farProvider: "beta/ui",
  /** Declares no dependencies at all. */
  declaresNothing: "alpha/standalone",
};
