/**
 * Measure what the hook costs on top of starting a Node process, and fail if it
 * exceeds its budget.
 *
 * This lived inside the vitest suite and had to leave. Vitest runs test files in
 * parallel, so forty-one other files were competing for the CPU while this one
 * timed subprocess spawns: the same build measures 1.54 here and 2.45 to 3.12
 * under the runner, on identical code. A benchmark that reports the runner's
 * load is the same defect as a benchmark that reports the machine's — it is
 * evidence about something other than the thing it names.
 *
 * The budget is stated in absolute milliseconds of OWN work — wall clock minus a
 * bare `node -e ""` start-up on the same machine — and it is set from two
 * measured bounds rather than from taste:
 *
 *     legitimate, observed          own work    where
 *     macOS arm64, quiet            11 ms       this machine
 *     Linux arm64, container        13 ms       verify-linux.sh
 *     ubuntu-latest, hosted CI      28 ms       first real CI run
 *     macOS arm64, loaded           24 ms       machine running builds
 *     macos-latest, hosted CI       52 ms       the slowest legitimate reading
 *
 *     the regression it must catch  own work
 *     importing @capmap/core        134 ms      on a QUIET machine, 12x the hook
 *
 * So the ceiling sits at 100 ms: roughly double the slowest honest measurement,
 * and comfortably under the cheapest possible reading of the thing it exists to
 * catch. It was 50 ms, which was set from quiet machines only and failed a
 * hosted macOS runner at 52.0 ms on code nobody had touched.
 *
 * The ratio against the baseline is printed but not asserted. Neither quantity
 * is stable across machines — own work ranges 11 to 52 ms and the ratio 0.56 to
 * 1.39 — so both are reported and only the one with a defensible threshold is
 * enforced.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HOOK = "hooks/dist/gate-hook.js";
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
/** Between the slowest honest reading (52 ms) and the cheapest regression (134 ms). */
const BUDGET_MS = 100;
const ROUNDS = 5;
const RUNS_PER_ROUND = 4;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(repoRoot, "config");

const root = mkdtempSync(join(tmpdir(), "capmap-latency-"));
for (const dir of [".git", "plans", "specs", ".capmap"]) {
  mkdirSync(join(root, dir), { recursive: true });
}
const target = join(root, "plans", "2026-08-02-tenant-portal.md");
writeFileSync(target, "# Plan\n");
// A record bound to its specification, so the timed path includes reading and
// hashing the specification as every gated plan write does.
const spec = join(root, "specs", "2026-08-02-tenant-portal-design.md");
const specText = "# Spec\n\n## Components\n\n- billing\n";
writeFileSync(spec, specText);
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
writeFileSync(
  join(root, ".capmap", "gate-tenant-portal.json"),
  JSON.stringify({
    schemaVersion: 2, specPath: spec, feature: "tenant-portal",
    componentsHash: digest(JSON.stringify(["billing"])),
    specContentHash: digest(specText.trimEnd()),
    componentsSource: "document", generatedAt: "a", indexGeneratedAt: "b",
    staleRepos: [],
    components: [{ name: "billing", verdict: "REUSE", target: "t", score: 0.9,
      bestCandidate: null, verifiedSha: "s", failedChecks: [], competing: [],
      rationale: "r" }],
  }),
);

const payload = JSON.stringify({
  tool_name: "Write",
  tool_input: { file_path: target, content: "# Plan\n" },
});

function invokeHook() {
  return new Promise((done) => {
    const child = execFile(process.execPath, [HOOK],
      { env: { ...process.env, [CONFIG_DIR_ENV_VAR]: configDir } },
      (error) => done(error === null ? 0 : (error.code ?? 1)));
    child.stdin.end(payload);
  });
}

/** An empty Node process, to measure start-up on whatever machine this is. */
function invokeBare() {
  return new Promise((done) => execFile(process.execPath, ["-e", ""], () => done()));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timeRounds(run) {
  const rounds = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = performance.now();
    for (let i = 0; i < RUNS_PER_ROUND; i += 1) await run();
    rounds.push((performance.now() - started) / RUNS_PER_ROUND);
  }
  return median(rounds);
}

// One of each first, so neither measurement pays for a cold page cache — and
// the hook's exit code is checked while we are here.
//
// Without that check this script is the very defect it was written to escape.
// A missing or broken hook fails instantly, every invocation costs less than a
// bare node start-up, own work comes out at roughly zero, and the budget is
// reported as comfortably met by a hook that never ran. The payload is a plan
// with a resolved gate record, so the only correct answer is exit 0.
const warmup = await invokeHook();
if (warmup !== 0) {
  process.stderr.write(
    `the hook exited ${warmup} on a payload it must allow. Nothing below would ` +
    `be a measurement of this hook — run "pnpm -r build" and check ${HOOK}.\n`,
  );
  process.exit(1);
}
await invokeBare();

const hook = await timeRounds(invokeHook);
const bare = await timeRounds(invokeBare);
const ownWork = hook - bare;

rmSync(root, { recursive: true, force: true });

process.stdout.write(
  `hook ${hook.toFixed(1)}ms   bare node ${bare.toFixed(1)}ms   ` +
  `own work ${ownWork.toFixed(1)}ms   ratio ${(ownWork / bare).toFixed(2)}\n` +
  `budget: own work under ${BUDGET_MS}ms — ${ownWork < BUDGET_MS ? "met" : "EXCEEDED"}\n`,
);
process.exit(ownWork < BUDGET_MS ? 0 : 1);
