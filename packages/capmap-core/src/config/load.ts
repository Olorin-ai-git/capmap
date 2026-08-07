import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ReposConfigSchema,
  ScanConfigSchema,
  VocabularySchema,
} from "./schema.js";
import type { ReposConfig, ScanConfig } from "./schema.js";

export const ROOT_ENV_VAR = "CAPMAP_ROOT";

export interface LoadedConfig {
  root: string;
  scan: ScanConfig;
  repos: ReposConfig;
  vocabulary: string[];
}

export interface LoadConfigOptions {
  configDir: string;
  env: NodeJS.ProcessEnv;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (cause) {
    throw new Error(`unable to read configuration file ${path}`, { cause });
  }
}

export async function loadConfig(
  opts: LoadConfigOptions,
): Promise<LoadedConfig> {
  const scan = ScanConfigSchema.parse(
    await readJson(join(opts.configDir, "scan.config.json")),
  );
  const repos = ReposConfigSchema.parse(
    await readJson(join(opts.configDir, "repos.json")),
  );
  const vocabulary = VocabularySchema.parse(
    await readJson(join(opts.configDir, "domain-vocabulary.json")),
  );

  const root = opts.env[ROOT_ENV_VAR] ?? scan.root;
  if (root === null || root === undefined || root.length === 0) {
    throw new Error(
      `estate root unresolved: set ${ROOT_ENV_VAR} or the "root" field in scan.config.json`,
    );
  }

  return { root, scan, repos, vocabulary: vocabulary.tags };
}
