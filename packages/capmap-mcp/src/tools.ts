import { gateTool } from "./tools/gate.js";
import { readTools } from "./tools/read.js";
import type { ToolDefinition, ToolDeps } from "./types.js";

export type { ToolDefinition, ToolDeps } from "./types.js";

/**
 * Every tool is a thin adapter: it marshals arguments, calls the same core
 * function the CLI calls, and shapes the result as JSON. No logic lives here,
 * so the two front doors cannot disagree about what the index means.
 */
export function buildTools(deps: ToolDeps): ToolDefinition[] {
  return [...readTools(deps), ...gateTool(deps)];
}
