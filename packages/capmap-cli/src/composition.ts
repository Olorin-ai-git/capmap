import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  type LoadedConfig,
} from "@capmap/core";
import { IndexStore } from "@capmap/core";
import type {
  Clock,
  Git,
  Logger,
  ModelClient,
  ModelRequest,
  Writer,
} from "@capmap/core";
import { AnthropicModelClient } from "./adapters/anthropic-client.js";
import { NodeGit } from "./adapters/node-git.js";
import { PinoLogger } from "./adapters/pino-logger.js";
import { StdoutWriter } from "./adapters/stdout-writer.js";

export const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
export const LOG_LEVEL_ENV_VAR = "CAPMAP_LOG_LEVEL";
/** Fallback severity when the environment names none; not security-sensitive. */
export const DEFAULT_LOG_LEVEL = "info";
const CONFIG_DIR_NAME = "config";
/** Depth from this module's directory up to the workspace root. */
const WORKSPACE_ROOT_HOPS = ["..", "..", ".."];

/** Every dependency a command needs, resolved once in the composition root. */
export interface CommandDeps {
  config: LoadedConfig;
  store: IndexStore;
  git: Git;
  clock: Clock;
  logger: Logger;
  writer: Writer;
  model: ModelClient;
  /** True only when a person can answer prompts; see operatorAtTerminal. */
  operatorTerminal: boolean;
}

/**
 * Variables Claude Code sets in every command it runs. A pseudo-terminal
 * (`script -q /dev/null capmap gate … --resolve`) satisfies isTTY, so inside an
 * agent session a terminal does not prove a person is answering.
 */
const AGENT_SESSION_ENV_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID"];

export function operatorAtTerminal(env: NodeJS.ProcessEnv, stdinIsTTY: boolean): boolean {
  return stdinIsTTY && AGENT_SESSION_ENV_VARS.every((name) => env[name] === undefined);
}

export const systemClock = (): Clock => ({ now: () => new Date() });

/**
 * The API credential is resolved on first use rather than at wiring time, so
 * that the deterministic commands — scan, status — run without one.
 */
class DeferredAnthropicClient implements ModelClient {
  private inner: ModelClient | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async complete(request: ModelRequest): Promise<string> {
    this.inner ??= AnthropicModelClient.fromEnv(this.env);
    return this.inner.complete(request);
  }
}

function workspaceRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), ...WORKSPACE_ROOT_HOPS);
}

function defaultConfigDir(): string {
  return join(workspaceRoot(), CONFIG_DIR_NAME);
}

/**
 * The path as the disk names it: symlinks resolved and, on a case-insensitive
 * disk, the stored case. A path that does not exist yet keeps its missing tail
 * under the canonical form of its nearest existing ancestor.
 */
function onDisk(pathAbs: string): string {
  const tail: string[] = [];
  let current = resolve(pathAbs);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(pathAbs);
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

function isInside(parentAbs: string, childAbs: string): boolean {
  const rel = relative(onDisk(parentAbs), onDisk(childAbs));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * What capmap writes from an estate — its index, an eval result — describes
 * that estate. When anything it reads lies outside this checkout (the estate
 * root or any configured repository), the output must not be written into the
 * checkout, where the next commit would publish it; only the bundled example
 * estate is indexed in place. Paths are compared as the disk resolves them, so
 * a symlink or a change of case cannot name the checkout as somewhere else.
 */
export function assertPlacement(targetAbs: string, config: LoadedConfig): void {
  const checkout = workspaceRoot();
  if (!isInside(checkout, targetAbs)) return;
  const rootAbs = resolve(config.root);
  const outside = [rootAbs, ...config.repos.repos.map((repo) => resolve(rootAbs, repo.path))].find(
    (sourceAbs) => !isInside(checkout, sourceAbs),
  );
  if (outside === undefined) return;
  throw new Error(
    `refusing to write ${targetAbs}: it describes ${outside}, which is outside this ` +
      `checkout, so it must be kept outside this checkout too. Point ` +
      `${CONFIG_DIR_ENV_VAR} at a configuration directory outside the checkout, or ` +
      `make "index.dir" in scan.config.json an absolute path outside it.`,
  );
}

/** The index lives beside the configuration directory unless made absolute. */
function resolveIndexDir(configDir: string, indexDir: string): string {
  return isAbsolute(indexDir) ? indexDir : join(dirname(configDir), indexDir);
}

export function packageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version: string };
  return manifest.version;
}

export async function buildDeps(env: NodeJS.ProcessEnv): Promise<CommandDeps> {
  const configDir = env[CONFIG_DIR_ENV_VAR] ?? defaultConfigDir();
  const config = await loadConfig({ configDir, env });
  const indexDirAbs = resolve(resolveIndexDir(configDir, config.scan.index.dir));
  assertPlacement(indexDirAbs, config);
  return {
    config,
    store: new IndexStore({ indexDirAbs }),
    git: new NodeGit(),
    clock: systemClock(),
    logger: new PinoLogger(env[LOG_LEVEL_ENV_VAR] ?? DEFAULT_LOG_LEVEL),
    writer: new StdoutWriter(),
    model: new DeferredAnthropicClient(env),
    operatorTerminal: operatorAtTerminal(env, process.stdin.isTTY === true),
  };
}
