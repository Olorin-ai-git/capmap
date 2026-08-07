import { execFile } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  IndexStore,
  loadConfig,
  type Git,
  type LogFields,
  type Logger,
  type ModelClient,
  type ModelRequest,
} from "@capmap/core";
import type { ToolDeps } from "./tools.js";

const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";
const CONFIG_DIR_NAME = "config";
const WORKSPACE_ROOT_HOPS = ["..", "..", ".."];

const run = promisify(execFile);

class NodeGit implements Git {
  async headSha(repoAbsPath: string): Promise<string | null> {
    try {
      const { stdout } = await run("git", ["rev-parse", "HEAD"], {
        cwd: repoAbsPath,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async lastCommitIso(
    repoAbsPath: string,
    relPath: string,
  ): Promise<string | null> {
    try {
      const { stdout } = await run(
        "git",
        ["log", "-1", "--format=%cI", "--", relPath],
        { cwd: repoAbsPath },
      );
      const value = stdout.trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }
}

/**
 * Diagnostics go to stderr. An MCP server speaks its protocol on stdout, so
 * anything written there that is not a protocol frame corrupts the session —
 * this is the one place where the stdout/stderr split is load-bearing rather
 * than merely tidy.
 */
class StderrLogger implements Logger {
  private write(level: string, message: string, fields?: LogFields): void {
    process.stderr.write(
      `${JSON.stringify({ level, message, ...(fields ?? {}) })}\n`,
    );
  }
  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }
}

/** Resolved on first use, so the read-only tools work without a credential. */
class DeferredAnthropicClient implements ModelClient {
  private inner: Anthropic | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async complete(request: ModelRequest): Promise<string> {
    if (this.inner === null) {
      const key = this.env[API_KEY_ENV_VAR];
      if (key === undefined || key === "") {
        throw new Error(
          `${API_KEY_ENV_VAR} is not set; capmap_gate requires it, ` +
            `the read-only tools do not`,
        );
      }
      this.inner = new Anthropic({ apiKey: key });
    }
    const response = await this.inner.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}

function defaultConfigDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, ...WORKSPACE_ROOT_HOPS, CONFIG_DIR_NAME);
}

export async function buildToolDeps(env: NodeJS.ProcessEnv): Promise<ToolDeps> {
  const configured = env[CONFIG_DIR_ENV_VAR];
  const configDir =
    configured === undefined || configured === ""
      ? defaultConfigDir()
      : configured;
  const config = await loadConfig({ configDir, env });

  const indexDir = isAbsolute(config.scan.index.dir)
    ? config.scan.index.dir
    : join(configDir, "..", config.scan.index.dir);

  return {
    config,
    store: new IndexStore({ indexDirAbs: indexDir }),
    git: new NodeGit(),
    clock: { now: () => new Date() },
    logger: new StderrLogger(),
    model: new DeferredAnthropicClient(env),
  };
}
