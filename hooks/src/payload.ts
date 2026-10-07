import { homedir } from "node:os";
import { resolve } from "node:path";
import { bashTargets } from "./bash-targets.js";
import type { PendingEdit } from "./pending-document.js";

/** Reading the hook's input: the tool call payload and the scan configuration. */

const SCAN_CONFIG_FILE = "scan.config.json";
const BASH_TOOL = "Bash";
const NOTEBOOK_TOOL = "NotebookEdit";
/** Tools that write one named file. Anything else that is not Bash writes nothing guarded. */
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", NOTEBOOK_TOOL]);

export interface HookPayload {
  tool_name?: string;
  cwd?: string;
  /** Write sends `content`; Edit `old_string`/`new_string`; MultiEdit `edits`; Bash `command`. */
  tool_input?: PendingEdit & {
    file_path?: string;
    notebook_path?: string;
    command?: string;
  };
}

export interface HookConfig {
  hook: { specGlobs: string[]; planGlobs: string[] };
  index: { dir: string };
}

/** A path the call may write, and its pending edit; null when the new content is unknowable. */
export interface Target {
  fileAbs: string;
  input: PendingEdit | null;
}

export function loadConfig(text: string): HookConfig {
  const config = JSON.parse(text) as Partial<HookConfig>;
  const globs = (value: unknown): boolean =>
    Array.isArray(value) && value.every((glob) => typeof glob === "string");
  if (
    !globs(config.hook?.specGlobs) ||
    !globs(config.hook?.planGlobs) ||
    typeof config.index?.dir !== "string"
  ) {
    throw new Error(`${SCAN_CONFIG_FILE} has no valid "hook" globs or "index.dir"`);
  }
  return config as HookConfig;
}

export function targetsOf(payload: HookPayload, cwd: string): Target[] {
  const tool = payload.tool_name ?? "";
  const input = payload.tool_input ?? {};
  if (tool === BASH_TOOL) {
    return bashTargets(input.command ?? "", cwd, homedir()).map((fileAbs) => ({
      fileAbs,
      input: null,
    }));
  }
  if (!FILE_TOOLS.has(tool)) return [];
  const path = input.file_path ?? input.notebook_path ?? "";
  if (path === "") throw new Error(`${tool} payload names no file`);
  return [
    { fileAbs: resolve(cwd, path), input: tool === NOTEBOOK_TOOL ? null : input },
  ];
}

