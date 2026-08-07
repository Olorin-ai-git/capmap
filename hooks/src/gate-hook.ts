#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import picomatch from "picomatch";
import { BYPASS_ENV_VAR, BYPASS_VALUE, decide } from "./decide.js";
import { deriveFeatureId } from "./feature-id.js";
import { pendingHash } from "./pending-document.js";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;
const GATE_DIR = ".capmap";
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const SCAN_CONFIG_FILE = "scan.config.json";
const MANIFEST_FILE = "index.json";
const GIT_DIR = ".git";
const LINE_TERMINATOR = "\n";

interface HookPayload {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    /** Write supplies the whole new file. */
    content?: string;
    /** Edit supplies the replacement text for one region… */
    new_string?: string;
    /** …and the text it replaces, which is what makes reconstruction possible. */
    old_string?: string;
  };
}

interface HookConfig {
  hook: { specGlobs: string[]; planGlobs: string[] };
  index: { dir: string };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Gate records live beside the repository they describe, so a specification and
 * its plan resolve to the same directory however deeply either is nested.
 */
async function gateDirFor(fileAbs: string): Promise<string> {
  let current = dirname(fileAbs);
  for (;;) {
    if (await exists(join(current, GIT_DIR))) return join(current, GATE_DIR);
    const parent = dirname(current);
    if (parent === current) return join(dirname(fileAbs), GATE_DIR);
    current = parent;
  }
}

/**
 * Hash of the component list the document will declare AFTER the pending write.
 *
 * Reading the file from disk instead was a hole straight through the guard: the
 * on-disk copy is the pre-edit content, so changing a specification's component
 * list and saving it hashed the OLD components, matched the existing gate
 * record, and was allowed — defeated by precisely the edit the check exists to
 * catch. A Write carries its whole new content; an Edit carries only the
 * replacement region, which is enough to see a component list appear or change
 * within it.
 *
 * Falls back to the file on disk when the payload carries no content, and
 * returns null when no `## Components` section is visible at all. Null means
 * "cannot tell", which the decision treats as no evidence of change, so
 * prose-only edits still do not invalidate a gate.
 */
async function main(): Promise<number> {
  const configDir = process.env[CONFIG_DIR_ENV_VAR];
  if (configDir === undefined || configDir === "") return EXIT_ALLOW;

  let payload: HookPayload;
  try {
    payload = JSON.parse(await readStdin()) as HookPayload;
  } catch {
    return EXIT_ALLOW;
  }

  const filePath = payload.tool_input?.file_path;
  if (filePath === undefined || filePath === "") return EXIT_ALLOW;
  const fileAbs = isAbsolute(filePath)
    ? filePath
    : resolve(process.cwd(), filePath);

  let config: HookConfig;
  try {
    config = JSON.parse(
      await readFile(resolve(configDir, SCAN_CONFIG_FILE), "utf8"),
    ) as HookConfig;
  } catch {
    return EXIT_ALLOW;
  }

  // Both are evaluated; the sets may overlap and each carries its own rule.
  const isSpec = picomatch(config.hook.specGlobs)(fileAbs);
  const isPlan = picomatch(config.hook.planGlobs)(fileAbs);
  const gateDir = await gateDirFor(fileAbs);
  const recordPath = join(gateDir, `gate-${deriveFeatureId(fileAbs)}.json`);

  let record = null;
  if (await exists(recordPath)) {
    try {
      record = JSON.parse(await readFile(recordPath, "utf8")) as never;
    } catch {
      record = null;
    }
  }

  const decision = decide({
    filePath: fileAbs,
    fileExists: await exists(fileAbs),
    isSpec,
    isPlan,
    record,
    currentComponentsHash: await pendingHash(fileAbs, payload.tool_input),
    indexPresent: await exists(
      resolve(configDir, "..", config.index.dir, MANIFEST_FILE),
    ),
    bypass: process.env[BYPASS_ENV_VAR] === BYPASS_VALUE,
  });

  if (!decision.allow) {
    process.stderr.write(`${decision.reason}${LINE_TERMINATOR}`);
    return EXIT_BLOCK;
  }
  if (decision.warning !== null) {
    process.stderr.write(`${decision.warning}${LINE_TERMINATOR}`);
  }
  return EXIT_ALLOW;
}

process.exitCode = await main();
