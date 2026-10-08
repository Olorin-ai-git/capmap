import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CM-15: smol-toml 1.7.1 (quadratic parse) parsed untrusted pyproject.toml
 * files, the MCP SDK below 1.31.0 carried a high advisory, and ts-morph 23
 * pulled braces 3.0.3 (no patched release) into the production tree. The
 * versions installed for each workspace package, not only the declared
 * ranges, must clear the patched floors.
 */
const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const FLOORS: Array<[string, string, [number, number, number]]> = [
  ["capmap-core", "smol-toml", [1, 9, 0]],
  ["capmap-core", "ts-morph", [28, 0, 0]],
  ["capmap-mcp", "@modelcontextprotocol/sdk", [1, 31, 0]],
];

function installedVersion(workspacePackage: string, dependency: string): number[] {
  const manifest = JSON.parse(
    readFileSync(join(packagesDir, workspacePackage, "node_modules", dependency, "package.json"), "utf8"),
  ) as { version: string };
  return manifest.version.split(".").map((part) => Number.parseInt(part, 10));
}

describe("patched dependency floors (CM-15)", () => {
  it.each(FLOORS)("%s installs %s at or above the patched version", (from, dependency, floor) => {
    const [major = 0, minor = 0, patch = 0] = installedVersion(from, dependency);
    const value = major * 1e6 + minor * 1e3 + patch;
    expect(value).toBeGreaterThanOrEqual(floor[0] * 1e6 + floor[1] * 1e3 + floor[2]);
  });
});
