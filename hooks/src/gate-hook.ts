#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import picomatch from "picomatch";
import { BYPASS_ENV_VAR, BYPASS_VALUE, decide, type Decision } from "./decide.js";
import { deriveFeatureId } from "./feature-id.js";
import { bindingProblem, isGateRecordPath, parseGateRecord } from "./gate-record.js";
import { AMBIGUOUS_EDIT_HASH, pendingHash } from "./pending-document.js";
import { loadConfig, targetsOf, type HookConfig, type HookPayload, type Target } from "./payload.js";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;
const GATE_DIR = ".capmap";
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const SCAN_CONFIG_FILE = "scan.config.json";
const MANIFEST_FILE = "index.json";
const GIT_DIR = ".git";
const LINE_TERMINATOR = "\n";
/** Case-insensitive, and into dot directories such as `.claude/worktrees`. */
const GLOB_OPTIONS = { nocase: true, dot: true };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Gate records live beside the repository they describe, so a specification and
 * its plan resolve to the same directory however deeply either is nested.
 */
async function gateDirFor(fileAbs: string): Promise<string> {
  let current = dirname(fileAbs);
  for (;;) {
    if (await exists(join(current, GIT_DIR))) return join(current, GATE_DIR);
    const parent = dirname(current);
    if (parent === current) return join(dirname(fileAbs), GATE_DIR);
    current = parent;
  }
}

interface Context {
  config: HookConfig;
  configDir: string;
  bypass: boolean;
  isSpec: (path: string) => boolean;
  isPlan: (path: string) => boolean;
}

async function evaluate(target: Target, ctx: Context): Promise<Decision> {
  const { fileAbs } = target;
  if (isGateRecordPath(fileAbs)) {
    return ctx.bypass
      ? { allow: true, warning: `${BYPASS_ENV_VAR}=${BYPASS_VALUE}: gate record write allowed` }
      : {
          allow: false,
          reason:
            `Gate records are written only by "capmap gate": ${fileAbs}\n` +
            `Bypass: ${BYPASS_ENV_VAR}=${BYPASS_VALUE}`,
        };
  }
  const isSpec = ctx.isSpec(fileAbs);
  const isPlan = ctx.isPlan(fileAbs);
  if (!isSpec && !isPlan) return { allow: true, warning: null };

  const feature = deriveFeatureId(fileAbs);
  const recordPath = join(await gateDirFor(fileAbs), `gate-${feature}.json`);
  let record = null;
  let recordProblem = null;
  if (await exists(recordPath)) {
    const parsed = parseGateRecord(await readFile(recordPath, "utf8"), feature);
    record = parsed.record;
    recordProblem =
      parsed.problem ?? (await bindingProblem(parsed.record, fileAbs, isPlan));
  }

  return decide({
    filePath: fileAbs,
    fileExists: await exists(fileAbs),
    isSpec,
    isPlan,
    record,
    recordProblem,
    currentComponentsHash:
      target.input === null
        ? isSpec ? AMBIGUOUS_EDIT_HASH : null
        : await pendingHash(fileAbs, target.input),
    indexPresent: await exists(
      resolve(ctx.configDir, "..", ctx.config.index.dir, MANIFEST_FILE),
    ),
    bypass: ctx.bypass,
  });
}

async function run(configDir: string, bypass: boolean): Promise<number> {
  const payload = JSON.parse(await readStdin()) as HookPayload;
  const config = loadConfig(
    await readFile(resolve(configDir, SCAN_CONFIG_FILE), "utf8"),
  );
  const ctx: Context = {
    config,
    configDir,
    bypass,
    isSpec: picomatch(config.hook.specGlobs, GLOB_OPTIONS),
    isPlan: picomatch(config.hook.planGlobs, GLOB_OPTIONS),
  };
  const warnings = new Set<string>();
  for (const target of targetsOf(payload, payload.cwd ?? process.cwd())) {
    const decision = await evaluate(target, ctx);
    if (!decision.allow) {
      process.stderr.write(`${decision.reason}${LINE_TERMINATOR}`);
      return EXIT_BLOCK;
    }
    if (decision.warning !== null) warnings.add(decision.warning);
  }
  for (const warning of warnings) process.stderr.write(`${warning}${LINE_TERMINATOR}`);
  return EXIT_ALLOW;
}

/**
 * Unconfigured, the hook allows: a guard with no configuration must not start
 * refusing writes on the strength of a default. Configured, any error of its
 * own blocks. Exit 1 is non-blocking to Claude Code, so an uncaught exception
 * used to let the write through — a malformed record or config opened the gate.
 */
async function main(): Promise<number> {
  const configDir = process.env[CONFIG_DIR_ENV_VAR];
  if (configDir === undefined || configDir === "") return EXIT_ALLOW;
  const bypass = process.env[BYPASS_ENV_VAR] === BYPASS_VALUE;
  try {
    return await run(configDir, bypass);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `capmap gate hook could not decide (${message}); ` +
        (bypass ? `allowed under ${BYPASS_ENV_VAR}=${BYPASS_VALUE}` : "blocking") +
        LINE_TERMINATOR,
    );
    return bypass ? EXIT_ALLOW : EXIT_BLOCK;
  }
}

process.exitCode = await main();
