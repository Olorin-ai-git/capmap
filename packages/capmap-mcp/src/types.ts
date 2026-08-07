import type {
  Clock,
  Git,
  IndexStore,
  LoadedConfig,
  Logger,
  ModelClient,
} from "@capmap/core";

export interface ToolDeps {
  config: LoadedConfig;
  store: IndexStore;
  git: Git;
  clock: Clock;
  logger: Logger;
  model: ModelClient;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
