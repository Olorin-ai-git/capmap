#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";
import { BYPASS_ENV_VAR, BYPASS_VALUE, decide, type Decision } from "./decide.js";
import { deriveFeatureId } from "./feature-id.js";
import { runsOperatorCommand } from "./bash-targets.js";
import { bindingProblem, canonical, isGateRecordPath, parseGateRecord } from "./gate-record.js";
import { AMBIGUOUS_EDIT_HASH, pendingHash } from "./pending-document.js";
import { loadConfig, targetsOf, type HookConfig, type HookPayload, type Target } from "./payload.js";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;
const GATE_DIR = ".capmap";
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const SCAN_CONFIG_FILE = "scan.config.json";
const MANIFEST_FILE = "index.json";
const GIT_DIR = ".git";
const BASH_TOOL = "Bash";
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
  /**
   * Directories only the operator or capmap itself may write: the gate's
   * configuration, its index and the hook's own code. Changing any of them
   * steers or disables the gate as surely as forging a record.
   */
  protectedDirs: string[];
  bypass: boolean;
  isSpec: (path: string) => boolean;
  isPlan: (path: string) => boolean;
}

function blockUnlessBypassed(ctx: Context, what: string, path: string): Decision {
  return ctx.bypass
    ? { allow: true, warning: `${BYPASS_ENV_VAR}=${BYPASS_VALUE}: ${what} allowed` }
    : { allow: false, reason: `${what} is not allowed: ${path}\nBypass: ${BYPASS_ENV_VAR}=${BYPASS_VALUE}` };
}

const lower = (path: string): string => path.toLowerCase();
const within = (dir: string, path: string): boolean =>
  lower(path) === lower(dir) || lower(path).startsWith(lower(dir) + sep);

async function evaluate(target: Target, ctx: Context): Promise<Decision> {
  // Decided on the path as written and as it resolves, so a symbolic link
  // cannot carry a write into a guarded place under an unguarded name.
  const raw = target.fileAbs;
  const fileAbs = await canonical(raw);
  if (isGateRecordPath(raw) || isGateRecordPath(fileAbs)) {
    return blockUnlessBypassed(
      ctx,
      `Writing a gate record other than through "capmap gate"`,
      fileAbs,
    );
  }
  if (ctx.protectedDirs.some((dir) => within(dir, fileAbs))) {
    return blockUnlessBypassed(ctx, "Changing the reuse gate's configuration, index or hook", fileAbs);
  }
  const isSpec = ctx.isSpec(raw) || ctx.isSpec(fileAbs);
  const isPlan = ctx.isPlan(raw) || ctx.isPlan(fileAbs);
  if (!isSpec && !isPlan) return { allow: true, warning: null };

  const feature = deriveFeatureId(fileAbs);
  const recordPath = join(await gateDirFor(fileAbs), `gate-${feature}.json`);
  let record = null;
  let recordProblem = null;
  if (await exists(recordPath)) {
    const parsed = parseGateRecord(await readFile(recordPath, "utf8"), feature);
    record = parsed.record;
    recordProblem =
      parsed.problem ?? (await bindingProblem(parsed.record, fileAbs, isPlan, ctx.isSpec));
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

/** Where the hook's own compiled code lives. */
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

async function run(configDir: string, bypass: boolean): Promise<number> {
  const payload = JSON.parse(await readStdin()) as HookPayload;
  const config = loadConfig(
    await readFile(resolve(configDir, SCAN_CONFIG_FILE), "utf8"),
  );
  const ctx: Context = {
    config,
    configDir,
    protectedDirs: await Promise.all(
      [configDir, resolve(configDir, "..", config.index.dir), HOOK_DIR].map(canonical),
    ),
    bypass,
    isSpec: picomatch(config.hook.specGlobs, GLOB_OPTIONS),
    isPlan: picomatch(config.hook.planGlobs, GLOB_OPTIONS),
  };
  if (payload.tool_name === BASH_TOOL && runsOperatorCommand(payload.tool_input?.command ?? "")) {
    const decision = blockUnlessBypassed(
      ctx,
      `Running "capmap gate --resolve" from an agent (it is answered by the operator, at a terminal)`,
      payload.tool_input?.command ?? "",
    );
    process.stderr.write(`${decision.allow ? decision.warning : decision.reason}${LINE_TERMINATOR}`);
    if (!decision.allow) return EXIT_BLOCK;
  }
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
