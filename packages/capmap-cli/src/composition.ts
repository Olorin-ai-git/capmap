import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
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

function defaultConfigDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, ...WORKSPACE_ROOT_HOPS, CONFIG_DIR_NAME);
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
  return {
    config,
    store: new IndexStore({
      indexDirAbs: resolveIndexDir(configDir, config.scan.index.dir),
    }),
    git: new NodeGit(),
    clock: systemClock(),
    logger: new PinoLogger(env[LOG_LEVEL_ENV_VAR] ?? DEFAULT_LOG_LEVEL),
    writer: new StdoutWriter(),
    model: new DeferredAnthropicClient(env),
  };
}
