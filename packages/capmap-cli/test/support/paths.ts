import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Presence of this file marks the workspace root, so no depth is hard-coded. */
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Absolute path of the repository root, resolved by walking up from this file. */
export function repoRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, WORKSPACE_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `no ${WORKSPACE_MARKER} found above ${fileURLToPath(import.meta.url)}`,
      );
    }
    current = parent;
  }
}
