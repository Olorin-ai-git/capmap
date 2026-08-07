/**
 * Check the committed index against its schema, its configuration and its
 * invariants — and fail when any of them is false.
 *
 * It used to print the same figures and always exit 0, which made it a report
 * rather than a gate: out-of-band counts, duplicate ids, or a package no matcher
 * can reach were all printed as facts and none of them stopped anything. An
 * independent review was right that a checker nothing can fail is not a check.
 */
import { MANIFEST_FILE, loadIndex } from "./lib/index-files.mjs";

/**
 * An index produced by `capmap scan --no-enrich` has no domain layer at all, by
 * design — the domain layer is the model-backed half. Three of the checks below
 * are statements about that layer and are therefore meaningless for such an
 * index: the count bands, matcher reachability, and repositories with packages
 * but no domains. Everything else still applies, and that is precisely what is
 * worth checking about the writing path.
 */
const UNENRICHED_FLAG = "--scanned-without-enrichment";
const unenriched = process.argv.includes(UNENRICHED_FLAG);

const loaded = loadIndex();
const { manifest, reposConfig } = loaded;
const bands = loaded.scanConfig.expectedCounts;
const failures = [...loaded.failures];
const fail = (message) => failures.push(message);

const byId = new Map(manifest.repos.map((repo) => [repo.id, repo]));
const configById = new Map(reposConfig.repos.map((repo) => [repo.id, repo]));

let domains = 0;
let packages = 0;
let minor = 0;
for (const repo of manifest.repos) {
  domains += repo.domainCount;
  packages += repo.packageCount;
  minor += repo.minorCount;
}

const repoFiles = loaded.files;
const ids = new Map();
const unreachableIds = [];
const onDisk = new Set();
const countMismatches = [];
for (const { file, repo } of loaded.repos) {
  onDisk.add(repo.repo);
  // IndexStore loads a repository by id, so the filename is not decoration.
  // A file whose name and embedded id disagree is unloadable while every set
  // comparison below still balances.
  if (file !== `${repo.repo}.json`) {
    fail(`${file} contains repository "${repo.repo}", so it cannot be loaded by id`);
  }
  // The tier that governs verdicts is this one. `locate` in the gate reads
  // RepoIndex.tier from the repository FILE, not from the manifest entry, so a
  // file left `active` while the configuration and the manifest agree on
  // `external` would be recommended for reuse instead of capped at REFERENCE —
  // the criterion-7 boundary, bypassed by a field nothing compared.
  const configuredTier = configById.get(repo.repo)?.tier;
  if (configuredTier !== undefined && repo.tier !== configuredTier) {
    fail(`${file} declares tier "${repo.tier}" but the configuration says "${configuredTier}"`);
  }
  // The manifest's per-repository counts are a summary of the file beside it,
  // and nothing kept them honest. A file deleted or truncated leaves the
  // manifest's totals — and every figure derived from them — describing an
  // index that is not on disk.
  const summary = byId.get(repo.repo);
  if (summary !== undefined) {
    const actual = {
      domainCount: repo.domains.length,
      packageCount: repo.packages.length,
      minorCount: repo.minor.length,
    };
    for (const [field, value] of Object.entries(actual)) {
      if (summary[field] !== value) {
        countMismatches.push(`${repo.repo}.${field}: manifest ${summary[field]}, file ${value}`);
      }
    }
  }
  const covered = new Set(repo.domains.flatMap((domain) => domain.packages));
  for (const pkg of repo.packages) {
    ids.set(pkg.id, (ids.get(pkg.id) ?? 0) + 1);
    if (!covered.has(pkg.id)) unreachableIds.push(pkg.id);
  }
}

// Criterion 1 is partly about the index describing the estate it was configured
// for. A repository silently dropped, or one appearing that nothing configures,
// is exactly the substitution a count on its own cannot show.
const configured = new Set(reposConfig.repos.map((repo) => repo.id));
const indexed = new Set(manifest.repos.map((repo) => repo.id));
const missing = [...configured].filter((id) => !indexed.has(id));
const unexpected = [...indexed].filter((id) => !configured.has(id));
// Three sets, not two. Comparing the manifest with the configuration says
// nothing about the files beside it: deleting index/repos/angainor.json leaves
// both of those in agreement while what a consumer loads is short a repository.
const absentFiles = [...indexed].filter((id) => !onDisk.has(id));
const orphanFiles = [...onDisk].filter((id) => !indexed.has(id));

// Ids alone are not the whole of "the index describes the configured estate".
// Tier in particular is a policy boundary: an entry left at `active` after the
// configuration moved it to `external` would be recommended for reuse when it
// must be capped at REFERENCE. Path and vcs decide what is scanned and how
// drift is judged.
const COMPARED_FIELDS = ["path", "tier", "vcs"];
const metadataMismatches = [];
for (const entry of manifest.repos) {
  const source = configById.get(entry.id);
  if (source === undefined) continue;
  for (const field of COMPARED_FIELDS) {
    if (entry[field] !== source[field]) {
      metadataMismatches.push(`${entry.id}.${field}: configured ${source[field]}, indexed ${entry[field]}`);
    }
  }
}
const duplicateConfigured = reposConfig.repos.length - configured.size;
const duplicateIndexed = manifest.repos.length - indexed.size;

const withinBands =
  domains >= bands.domainsMin && domains <= bands.domainsMax &&
  packages >= bands.packagesMin && packages <= bands.packagesMax;
const duplicates = [...ids.entries()].filter(([, count]) => count > 1).map(([id]) => id);
const packagesWithoutDomains = manifest.repos
  .filter((repo) => repo.packageCount > 0 && repo.domainCount === 0)
  .map((repo) => repo.id);

if (!withinBands && !unenriched) fail(`counts outside the configured bands: ${domains} domains, ${packages} packages`);
if (duplicates.length > 0) fail(`duplicate package ids: ${duplicates.join(", ")}`);
if (unreachableIds.length > 0 && !unenriched) fail(`packages unreachable by the matcher: ${unreachableIds.join(", ")}`);
if (missing.length > 0) fail(`configured repositories absent from the index: ${missing.join(", ")}`);
if (unexpected.length > 0) fail(`indexed repositories that nothing configures: ${unexpected.join(", ")}`);
if (absentFiles.length > 0) fail(`repositories in the manifest with no file on disk: ${absentFiles.join(", ")}`);
if (orphanFiles.length > 0) fail(`repository files the manifest does not list: ${orphanFiles.join(", ")}`);
if (countMismatches.length > 0) fail(`manifest counts disagree with the repository files: ${countMismatches.join("; ")}`);
if (metadataMismatches.length > 0) fail(`indexed repository metadata disagrees with the configuration: ${metadataMismatches.join("; ")}`);
if (duplicateConfigured > 0) fail(`config/repos.json lists ${duplicateConfigured} duplicate repository id(s)`);
if (duplicateIndexed > 0) fail(`the manifest lists ${duplicateIndexed} duplicate repository id(s)`);
if (packagesWithoutDomains.length > 0 && !unenriched) fail(`repositories with packages but no domains: ${packagesWithoutDomains.join(", ")}`);

process.stdout.write(
  `generatedAt: ${manifest.generatedAt}\n` +
  `root: ${manifest.root}\n` +
  `schema: ${MANIFEST_FILE} and ${repoFiles.length} repo files validated against @capmap/core\n` +
  `repos: ${manifest.repos.length} in the manifest, ${configured.size} configured, ` +
  `${onDisk.size} files on disk — ${missing.length} missing, ${unexpected.length} unexpected, ` +
  `${absentFiles.length} without a file, ${orphanFiles.length} orphan file(s)\n` +
  `manifest counts agreeing with their files: ${repoFiles.length - countMismatches.length}/${repoFiles.length}\n` +
  `id, path, tier and vcs agreeing with the configuration: ` +
  `${manifest.repos.length - metadataMismatches.length}/${manifest.repos.length}\n` +
  `domains: ${domains}  packages: ${packages}  minor: ${minor}\n` +
  `bands: domains ${bands.domainsMin}..${bands.domainsMax}  packages ${bands.packagesMin}..${bands.packagesMax}\n` +
  `within bands: ${withinBands}\n` +
  `duplicate package ids: ${duplicates.length}\n` +
  `packages unreachable by the matcher: ${unreachableIds.length}\n` +
  `repos with packages but no domains: ${packagesWithoutDomains.join(", ") || "none"}\n` +
  (unenriched
    ? "domain-layer checks skipped: this index was scanned without enrichment\n"
    : "") +
  (failures.length === 0
    ? "all invariants hold\n"
    : `${failures.length} INVARIANT(S) VIOLATED:\n${failures.map((f) => `  ${f}\n`).join("")}`),
);
process.exit(failures.length === 0 ? 0 : 1);
