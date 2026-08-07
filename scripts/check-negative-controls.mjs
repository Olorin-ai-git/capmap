/**
 * Break each gate on purpose and require it to notice — after first requiring it
 * to pass on the unbroken input.
 *
 * Every check in this repository defaults to passing: it prints what it found
 * and exits 0. Twelve of them were found, across four rounds of independent
 * review, to be incapable of failing at all. Each was fixed, and each fix was
 * checked by hand against a deliberately broken input. By hand is not evidence,
 * so those breakages run here as part of every verification.
 *
 * The baseline run is the part that took another review round to get right. A
 * control that merely observes a non-zero exit proves nothing if the checker was
 * already failing for an unrelated reason — the consumer-edge controls ran
 * against an index whose recorded estate root is an absolute path on one
 * machine, so on any other they failed before the mutation was applied and
 * "detected" a breakage that had done nothing. Each case now requires exit 0
 * before, and non-zero after.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE, buildEstateFixture } from "./lib/estate-fixture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(repoRoot, "scripts");

function run(script, cwd) {
  try {
    execFileSync(process.execPath, [script], { cwd, stdio: "pipe" });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));

/** A copy of the real config and index, which a case may corrupt freely. */
function realIndexCopy(root) {
  for (const dir of ["config", "index"]) {
    cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
  }
}

/** An empty tree that the source-constraint checker will walk. */
function emptySourceTree(root) {
  mkdirSync(join(root, "packages", "capmap-core", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "capmap-cli", "src"), { recursive: true });
}

/** The compiled hook, its configuration and the matrix, ready to run. */
function hookMatrixTree(root) {
  realIndexCopy(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(join(scriptsDir, "hook-matrix.mjs"), join(root, "scripts", "hook-matrix.mjs"));
  cpSync(join(repoRoot, "hooks", "dist"), join(root, "hooks", "dist"), { recursive: true });
  // The compiled hook imports picomatch, so the copy needs somewhere to resolve
  // it — and under pnpm that is the hooks package's own node_modules, not the
  // workspace root's. Without this the baseline failed for a missing dependency
  // and the control "detected" a breakage it had not caused, which is exactly
  // what the baseline run exists to catch.
  symlinkSync(join(repoRoot, "hooks", "node_modules"), join(root, "hooks", "node_modules"), "dir");
}

const repoFile = (root, name) => join(root, "index", "repos", name);

const cases = [
  ["report-index.mjs", realIndexCopy, "a configured repository missing from the manifest", (root) => {
    const path = join(root, "index", "index.json");
    const manifest = readJson(path);
    manifest.repos = manifest.repos.filter((repo) => repo.id !== "alpha");
    writeJson(path, manifest);
  }],
  ["report-index.mjs", realIndexCopy, "a repository file deleted, manifest untouched", (root) => {
    rmSync(repoFile(root, "alpha.json"));
  }],
  ["report-index.mjs", realIndexCopy, "a repository file truncated, manifest untouched", (root) => {
    const repo = readJson(repoFile(root, "alpha.json"));
    repo.packages = repo.packages.slice(0, 2);
    writeJson(repoFile(root, "alpha.json"), repo);
  }],
  ["report-index.mjs", realIndexCopy, "a repository file whose name and id disagree", (root) => {
    cpSync(repoFile(root, "alpha.json"), repoFile(root, "renamed.json"));
    rmSync(repoFile(root, "alpha.json"));
  }],
  ["report-index.mjs", realIndexCopy, "a manifest tier the configuration does not agree with", (root) => {
    const path = join(root, "index", "index.json");
    const manifest = readJson(path);
    const entry = manifest.repos.find((repo) => repo.id === "alpha");
    entry.tier = entry.tier === "external" ? "active" : "external";
    writeJson(path, manifest);
  }],
  ["report-index.mjs", realIndexCopy, "a repository FILE tier that bypasses the reference cap", (root) => {
    // The gate reads RepoIndex.tier from the file, not from the manifest.
    const repo = readJson(repoFile(root, "vendor-toolkit.json"));
    repo.tier = "active";
    writeJson(repoFile(root, "vendor-toolkit.json"), repo);
  }],
  ["report-index.mjs", realIndexCopy, "a configuration that does not satisfy its schema", (root) => {
    const path = join(root, "config", "scan.config.json");
    const config = readJson(path);
    config.verdicts.reuseThreshold = "not-a-number";
    writeJson(path, config);
  }],
  ["check-consumer-edges.mjs", buildEstateFixture, "an edge moved to the same-named package next door", (root) => {
    const alpha = readJson(repoFile(root, "alpha.json"));
    const beta = readJson(repoFile(root, "beta.json"));
    alpha.packages.find((pkg) => pkg.id === FIXTURE.nearProvider).consumers = [];
    beta.packages.find((pkg) => pkg.id === FIXTURE.farProvider).consumers.push(FIXTURE.nearConsumer);
    writeJson(repoFile(root, "alpha.json"), alpha);
    writeJson(repoFile(root, "beta.json"), beta);
  }],
  ["check-consumer-edges.mjs", buildEstateFixture, "an edge from a consumer that declares no such dependency", (root) => {
    const alpha = readJson(repoFile(root, "alpha.json"));
    alpha.packages.find((pkg) => pkg.id === FIXTURE.nearProvider).consumers.push(FIXTURE.declaresNothing);
    writeJson(repoFile(root, "alpha.json"), alpha);
  }],
  ["check-forbidden-terms.mjs", emptySourceTree, "a literal endpoint in source", (root) => {
    writeFileSync(
      join(root, "packages", "capmap-core", "src", "probe.ts"),
      'export const endpoint = "https://api.example.com";\n',
    );
  }],
  ["check-forbidden-terms.mjs", emptySourceTree, "a placeholder term in source", (root) => {
    writeFileSync(
      join(root, "packages", "capmap-cli", "src", "probe.ts"),
      "export const value = 1; // TODO: finish\n",
    );
  }],
  ["check-forbidden-terms.mjs", emptySourceTree, "a source file over the line ceiling", (root) => {
    writeFileSync(
      join(root, "packages", "capmap-core", "src", "long.ts"),
      `${Array.from({ length: 205 }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`,
    );
  }],
  ["hook-matrix.mjs", hookMatrixTree, "a hook that cannot find its configuration", (root) => {
    rmSync(join(root, "config"), { recursive: true, force: true });
  }],
];

let failures = 0;
const lines = [];
for (const [script, build, description, breakIt] of cases) {
  const root = mkdtempSync(join(tmpdir(), "capmap-negative-"));
  build(root);
  // The matrix case runs its own copy of the script; everything else runs the
  // committed one against a prepared directory.
  const target = script === "hook-matrix.mjs"
    ? join(root, "scripts", script)
    : join(scriptsDir, script);
  const baseline = run(target, root);
  breakIt(root);
  const broken = run(target, root);

  const ok = baseline === 0 && broken !== 0;
  if (!ok) failures += 1;
  const verdict = baseline !== 0
    ? `baseline FAILED (exit ${baseline}) — this control proves nothing`
    : broken === 0 ? "NOT NOTICED" : `noticed (exit ${broken})`;
  lines.push(`  ${ok ? "ok  " : "FAIL"} ${script.padEnd(26)} ${description.padEnd(58)} ${verdict}`);
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(
  `${lines.join("\n")}\n\n` +
  `${cases.length} deliberate breakages, each preceded by a passing baseline; ` +
  `${failures} did not hold\n`,
);
process.exit(failures === 0 ? 0 : 1);
