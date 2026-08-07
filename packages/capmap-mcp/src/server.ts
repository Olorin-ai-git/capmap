#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTools } from "./tools.js";
import { buildToolDeps } from "./composition.js";

const SERVER_NAME = "capmap";
const SERVER_VERSION = "0.1.0";

const deps = await buildToolDeps(process.env);
const tools = buildTools(deps);
const byName = new Map(tools.map((tool) => [tool.name, tool]));

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = byName.get(request.params.name);
  if (tool === undefined) {
    return {
      isError: true,
      content: [
        { type: "text" as const, text: `unknown tool: ${request.params.name}` },
      ],
    };
  }
  try {
    const result = await tool.handler(request.params.arguments ?? {});
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (error) {
    // Surfaced as tool content rather than thrown: a missing index or a refused
    // model call is a condition the caller should read and act on, not a
    // transport fault that kills the session.
    deps.logger.error("tool failed", {
      tool: request.params.name,
      error: String(error),
    });
    return {
      isError: true,
      content: [{ type: "text" as const, text: String(error) }],
    };
  }
});

await server.connect(new StdioServerTransport());
