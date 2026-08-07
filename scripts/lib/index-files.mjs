/**
 * Load the configuration and the index, validating both against the schemas the
 * writer itself uses.
 *
 * Separate from its caller so both stay inside the 200-line ceiling this
 * repository applies to its own source, and so that "schema-valid" means valid
 * against `@capmap/core` rather than against a second description of the same
 * shapes that can drift away from it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIG_DIR = "config";
const SCAN_CONFIG_FILE = "scan.config.json";
const REPOS_CONFIG_FILE = "repos.json";
export const MANIFEST_FILE = "index.json";
export const REPOS_DIR = "repos";

// By built path rather than by package name: the repository root is not a
// workspace member, so `@capmap/core` does not resolve from here. This needs a
// build, which verify.sh performs before it reaches the sections that use it.
const CORE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "packages", "capmap-core", "dist", "index.js",
);
const {
  IndexManifestSchema,
  RepoIndexSchema,
  ScanConfigSchema,
  ReposConfigSchema,
} = await import(pathToFileURL(CORE).href);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const issues = (error) =>
  error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ");

/**
 * Everything a checker needs about the index in the current directory, with any
 * schema violations reported rather than thrown — an invalid file is a finding,
 * not a crash, and the remaining checks still have something to say about it.
 */
export function loadIndex() {
  const failures = [];

  // The configuration is validated with the same Zod schemas the CLI loads it
  // through, not merely JSON-parsed. An independent review pointed out that the
  // acceptance report claimed "configuration is validated with Zod at load"
  // while this checker only parsed it, so an invalid configuration would have
  // sailed through the gate that is supposed to be about exactly that.
  const scanConfig = readJson(join(CONFIG_DIR, SCAN_CONFIG_FILE));
  const scanParse = ScanConfigSchema.safeParse(scanConfig);
  if (!scanParse.success) {
    failures.push(`${SCAN_CONFIG_FILE} does not satisfy ScanConfigSchema: ${issues(scanParse.error)}`);
  }
  const reposConfig = readJson(join(CONFIG_DIR, REPOS_CONFIG_FILE));
  const reposParse = ReposConfigSchema.safeParse(reposConfig);
  if (!reposParse.success) {
    failures.push(`${REPOS_CONFIG_FILE} does not satisfy ReposConfigSchema: ${issues(reposParse.error)}`);
  }

  const indexDir = scanConfig.index.dir;

  const rawManifest = readJson(join(indexDir, MANIFEST_FILE));
  const manifestParse = IndexManifestSchema.safeParse(rawManifest);
  if (!manifestParse.success) {
    failures.push(
      `${MANIFEST_FILE} does not satisfy IndexManifestSchema: ${issues(manifestParse.error)}`,
    );
  }

  const files = readdirSync(join(indexDir, REPOS_DIR));
  const repos = [];
  for (const file of files) {
    const raw = readJson(join(indexDir, REPOS_DIR, file));
    const parsed = RepoIndexSchema.safeParse(raw);
    if (!parsed.success) {
      failures.push(`${file} does not satisfy RepoIndexSchema: ${issues(parsed.error)}`);
    }
    repos.push({ file, repo: parsed.success ? parsed.data : raw });
  }

  return {
    scanConfig,
    reposConfig,
    manifest: manifestParse.success ? manifestParse.data : rawManifest,
    repos,
    files,
    failures,
  };
}
