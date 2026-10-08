/**
 * Drive the compiled hook through every enforcement case and print a matrix.
 *
 * Committed because the unit tests passed over a real defect this found in one
 * run: a plan carrying a perfectly good gate record was blocked, because the
 * component-removal rule fired on a document that legitimately has no component
 * section.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = "hooks/dist/gate-hook.js";
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const SCAN_CONFIG_FILE = "scan.config.json";
const EXIT_BLOCK = 2;

// Resolved from this file rather than the working directory so the matrix
// exercises the configuration of the checkout it was run from — which is what
// makes it correct inside the throwaway clone verify.sh builds.
const CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "config");

// The compiled hook must exist. A staleness check by mtime was tried and
// removed: tsc is content-incremental, so touching a source without changing it
// leaves dist correctly untouched and the check fired falsely. verify.sh builds
// before calling this; run "pnpm -r build" when invoking it directly.
if (!existsSync(HOOK)) {
  process.stderr.write(`${HOOK} is missing. Run "pnpm -r build".\n`);
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), "capmap-matrix-"));
for (const d of [".git", "specs", "plans", ".capmap"]) {
  mkdirSync(join(root, d), { recursive: true });
}
const spec = join(root, "specs", "2026-08-02-demo-design.md");
const plan = join(root, "plans", "2026-08-02-demo.md");
writeFileSync(spec, "# Spec\n\n## Components\n\n- billing\n");
const FORGED = JSON.stringify({ components: [], staleRepos: [], componentsSource: "flags" });
writeFileSync(join(root, "README.md"), "# r\n");

const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const SPEC_TEXT = "# Spec\n\n## Components\n\n- billing\n";
// A plan names the specification it implements; the hook checks that file's record.
const PLAN_TEXT = "# Plan\n\nSpec: specs/2026-08-02-demo-design.md\n\nSteps.\n";
// Records are bound to the index the hook is configured with, as `capmap gate` writes them.
const scanConfig = JSON.parse(readFileSync(join(CONFIG_DIR, SCAN_CONFIG_FILE), "utf8"));
const INDEX_GENERATED_AT = JSON.parse(
  readFileSync(resolve(CONFIG_DIR, "..", scanConfig.index.dir, "index.json"), "utf8"),
).generatedAt;
// What `capmap gate` writes: schema 2, bound to the specification's path and
// content (CM-1), its component hash consistent with the components it lists.
const record = (verdict) =>
  JSON.stringify({
    schemaVersion: 2, specPath: spec, feature: "demo",
    componentsHash: digest(JSON.stringify(["billing"])),
    specContentHash: digest(SPEC_TEXT.trimEnd()),
    componentsSource: "document", generatedAt: "a", indexGeneratedAt: INDEX_GENERATED_AT,
    staleRepos: [],
    components: [{ name: "billing", verdict, target: "t", score: 0.9,
      bestCandidate: null, verifiedSha: "s", failedChecks: [], competing: [],
      rationale: "r" }],
  });
const setRecord = (verdict) =>
  writeFileSync(join(root, ".capmap", "gate-demo.json"),
    verdict === "FORGED" ? FORGED : record(verdict));
// Removed, not emptied: an empty record is now a malformed one, which blocks.
const clearRecord = () => rmSync(join(root, ".capmap", "gate-demo.json"), { force: true });

const write = (file, content) => ({ tool_name: "Write", tool_input: { file_path: file, content } });
const bash = (command) => ({ tool_name: "Bash", cwd: root, tool_input: { command } });
const edit = (file, old_string, new_string) => ({ tool_name: "Edit", tool_input: { file_path: file, old_string, new_string } });

// The config directory is supplied here and always overrides the ambient value.
// Leaving it to the caller's shell was a hole in the harness rather than in the
// hook: without it the hook allows everything by design, so eight cases failed
// and — far worse — the six that expect exit 0 still reported "ok" while proving
// nothing at all.
function invoke(payload, env = {}) {
  return new Promise((done) => {
    const child = execFile(process.execPath, [HOOK],
      { env: { ...process.env, [CONFIG_DIR_ENV_VAR]: CONFIG_DIR, ...env } },
      (error) => done(error === null ? 0 : (error.code ?? 1)));
    child.stdin.end(JSON.stringify(payload));
  });
}

// Prove the hook is gating before trusting a single "ok". Any misconfiguration
// that makes it fail open turns every allow-case into a vacuous pass, which is
// the one failure this harness must never report as success.
clearRecord();
const preflight = await invoke(
  write(join(root, "plans", "2099-01-01-preflight.md"), "# Plan\n"),
);
if (preflight !== EXIT_BLOCK) {
  process.stderr.write(
    `Preflight: an ungated plan exited ${preflight}, expected ${EXIT_BLOCK}. ` +
    `The hook is not gating, so every case below would pass vacuously. ` +
    `Check ${join(CONFIG_DIR, SCAN_CONFIG_FILE)} and rebuild.\n`,
  );
  // The failure paths have to tidy up too. This one fires on every run of the
  // negative controls, by design, so leaving its tree behind leaks one
  // directory per verification.
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

const cases = [
  ["no record",  "new specification",              null,         write(join(root, "specs", "2099-01-01-new-design.md"), "# Spec\n"), 0],
  ["no record",  "new PLAN",                       null,         write(join(root, "plans", "2099-01-01-ungated.md"), "# Plan\n"),   2],
  ["no record",  "existing specification",         null,         write(spec, "# Spec\n\n## Components\n\n- billing\n"),             2],
  ["resolved",   "plan",                           "REUSE",      write(plan, PLAN_TEXT),                                            0],
  ["resolved",   "plan naming no specification",   "REUSE",      write(plan, "# Plan\n\nSteps.\n"),                                 2],
  ["resolved",   "specification unchanged",        "REUSE",      write(spec, "# Spec\n\n## Components\n\n- billing\n"),             0],
  ["resolved",   "prose-only edit",                "REUSE",      edit(spec, "# Spec", "# Specification"),                           0],
  ["resolved",   "path outside the globs",         "REUSE",      write(join(root, "README.md"), "# r\n"),                           0],
  ["resolved",   "component added",                "REUSE",      write(spec, "# Spec\n\n## Components\n\n- billing\n- auth\n"),     2],
  ["resolved",   "narrow edit changes a component","REUSE",      edit(spec, "- billing", "- auth"),                                 2],
  ["resolved",   "component section deleted",      "REUSE",      write(spec, "# Spec\n\nprose only\n"),                             2],
  ["resolved",   "edit that cannot be rebuilt",    "REUSE",      { tool_name: "Edit", tool_input: { file_path: spec, new_string: "- x" } }, 2],
  ["unresolved", "plan",                           "UNRESOLVED", write(plan, PLAN_TEXT),                                            2],
  ["unresolved", "specification",                  "UNRESOLVED", write(spec, "# Spec\n\n## Components\n\n- billing\n"),             2],
  // The audit's bypasses (CM-1, CM-4): a hand-written record, writing the
  // record directly, and a plan written by a shell redirect.
  ["forged",     "plan under a hand-written record","FORGED",    write(plan, PLAN_TEXT),                                            2],
  ["resolved",   "Write to the gate record",       "REUSE",      write(join(root, ".capmap", "gate-demo.json"), "{}"),              2],
  ["no record",  "plan by Bash redirect",          null,         bash("cat > plans/2099-01-01-ungated.md <<'EOF'\n# Plan\nEOF"),   2],
];

let failures = 0;
for (const [state, label, verdict, payload, expected] of cases) {
  if (verdict === null) clearRecord(); else setRecord(verdict);
  const actual = await invoke(payload);
  const ok = actual === expected;
  if (!ok) failures += 1;
  process.stdout.write(
    `  ${ok ? "ok  " : "FAIL"} [${state.padEnd(10)}] ${label.padEnd(32)} exit ${actual} (expected ${expected})\n`,
  );
}

setRecord("REUSE");
const bypass = await invoke(write(join(root, "plans", "2099-01-01-ungated.md"), "# Plan\n"), { CAPMAP_GATE: "off" });
if (bypass !== 0) failures += 1;
process.stdout.write(`  ${bypass === 0 ? "ok  " : "FAIL"} [bypass    ] CAPMAP_GATE=off                  exit ${bypass} (expected 0)\n`);

// Removed rather than left behind: one directory per run is nothing, and a
// session of repeated runs left thousands of them in the system temporary
// directory.
rmSync(root, { recursive: true, force: true });

process.stdout.write(`\n${cases.length + 1} cases, ${failures} failing\n`);
process.exit(failures === 0 ? 0 : 1);
