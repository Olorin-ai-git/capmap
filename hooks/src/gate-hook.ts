#!/usr/bin/env node
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BYPASS_ENV_VAR, BYPASS_VALUE } from "./decide.js";
import { bashAnalysis } from "./bash-targets.js";
import { blockUnlessBypassed, evaluate, type Context } from "./evaluate.js";
import { canonical } from "./gate-record.js";
import { readRegularFile } from "./read-regular.js";
import { loadConfig, targetsOf, type HookPayload } from "./payload.js";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const CDPATH_ENV_VAR = "CDPATH";
const SCAN_CONFIG_FILE = "scan.config.json";
const MANIFEST_FILE = "index.json";
const PACKAGE_FILE = "package.json";
const GLOB_LIBRARY = "picomatch";
const BASH_TOOL = "Bash";
const LINE_TERMINATOR = "\n";
/** Case-insensitive, and into dot directories such as `.claude/worktrees`. */
const GLOB_OPTIONS = { nocase: true, dot: true };

/** Where the hook's own compiled code lives. */
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The index manifest's generation time, or null when there is no index. */
async function indexGeneratedAt(manifest: string): Promise<string | null> {
  if (!(await exists(manifest))) return null;
  const { generatedAt } = JSON.parse(await readRegularFile(manifest)) as { generatedAt?: unknown };
  if (typeof generatedAt !== "string" || generatedAt === "") throw new Error(`${manifest} has no generatedAt`);
  return generatedAt;
}

async function run(configDir: string, bypass: boolean): Promise<number> {
  const payload = JSON.parse(await readStdin()) as HookPayload;
  const config = loadConfig(await readRegularFile(resolve(configDir, SCAN_CONFIG_FILE)));
  // A hook that never answers is let through by Claude Code's timeout, so it answers itself first.
  setTimeout(() => {
    process.stderr.write(`capmap gate hook did not decide within ${String(config.hook.deadlineMs)} ms; ` +
      (bypass ? `allowed under ${BYPASS_ENV_VAR}=${BYPASS_VALUE}` : "blocking") + LINE_TERMINATOR);
    process.exit(bypass ? EXIT_ALLOW : EXIT_BLOCK);
  }, config.hook.deadlineMs).unref();
  // Loaded here, not at module load, so a missing or broken dependency blocks instead of crashing open.
  const { default: picomatch } = await import("picomatch");
  const matcher = (globs: string[]): ((path: string) => boolean) =>
    globs.length === 0 ? () => false : picomatch(globs, GLOB_OPTIONS);
  const hookPackage = dirname(HOOK_DIR);
  const library = dirname(createRequire(join(hookPackage, PACKAGE_FILE)).resolve(`${GLOB_LIBRARY}/${PACKAGE_FILE}`));
  const ctx: Context = {
    protectedDirs: await Promise.all(
      [configDir, resolve(configDir, "..", config.index.dir), HOOK_DIR, join(hookPackage, PACKAGE_FILE), library,
        process.execPath, ...(isAbsolute(process.argv0) ? [process.argv0] : [])].map(canonical),
    ),
    bypass,
    isSpec: matcher(config.hook.specGlobs),
    isPlan: matcher(config.hook.planGlobs),
    isExempt: matcher(config.hook.exemptGlobs),
    indexGeneratedAt: await indexGeneratedAt(resolve(configDir, "..", config.index.dir, MANIFEST_FILE)),
  };
  // Started as `node …`, the shell looked the interpreter up on PATH, where a
  // writable directory ahead of the real one can hold a `node` that never runs this hook.
  if (!isAbsolute(process.argv0)) {
    const decision = blockUnlessBypassed(
      ctx,
      `Deciding with an interpreter found on PATH (${process.argv0}); register the hook with node's absolute path —`,
      process.argv0,
    );
    process.stderr.write(`${decision.allow ? decision.warning : decision.reason}${LINE_TERMINATOR}`);
    if (!decision.allow) return EXIT_BLOCK;
  }
  const shell = {
    home: homedir(),
    cdpath: (process.env[CDPATH_ENV_VAR] ?? "") !== "",
    maxWords: config.hook.maxShellWords,
    maxPaths: config.hook.maxShellPaths,
    configDirs: [resolve(configDir), await canonical(resolve(configDir))],
  };
  const cwd = payload.cwd ?? process.cwd();
  const command = payload.tool_input?.command ?? "";
  if (payload.tool_name === BASH_TOOL && bashAnalysis(command, { ...shell, cwd }).operator) {
    const decision = blockUnlessBypassed(
      ctx,
      `Running "capmap gate --resolve", or "capmap gate" with arguments the hook cannot read, from an agent ` +
        `(resolution is answered by the operator, at a terminal)`,
      command,
    );
    process.stderr.write(`${decision.allow ? decision.warning : decision.reason}${LINE_TERMINATOR}`);
    if (!decision.allow) return EXIT_BLOCK;
  }
  const warnings = new Set<string>();
  for (const target of targetsOf(payload, cwd, shell)) {
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
 * An error before this code runs at all (it cannot be parsed) is caught by the
 * documented registration, which turns any other exit into 2.
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
