/**
 * Drive the built MCP server over real stdio: initialize, list its tools, then
 * call one of them.
 *
 * Listing alone was the earlier evidence and it is too weak — a server can
 * advertise five tools and fail on the first call, because the tool handlers and
 * the registration are wired separately. `capmap_search` is used because it is
 * read-only and consults no model, so this stays runnable without a credential.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = "packages/capmap-mcp/dist/server.js";
const CONFIG_DIR_ENV_VAR = "CAPMAP_CONFIG_DIR";
const ROOT_ENV_VAR = "CAPMAP_ROOT";
const CONFIG_FILE = "config/scan.config.json";
const MANIFEST_FILE = "index.json";
const PROTOCOL_VERSION = "2024-11-05";
const EXPECTED_TOOLS = [
  "capmap_search",
  "capmap_show",
  "capmap_verify",
  "capmap_status",
  "capmap_gate",
];
const PROBE_TOOL = "capmap_search";
const PROBE_QUERY = "billing";

// Both are supplied here rather than left to the caller's shell, so the check
// describes this checkout and this index instead of whatever was exported last.
// The estate root is taken from the index's own manifest — the index is the
// artifact under test, and it records the tree it was built from.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(repoRoot, "config");
const indexDir = JSON.parse(readFileSync(join(repoRoot, CONFIG_FILE), "utf8")).index.dir;
const estateRoot = JSON.parse(
  readFileSync(join(repoRoot, indexDir, MANIFEST_FILE), "utf8"),
).root;

const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    [CONFIG_DIR_ENV_VAR]: configDir,
    [ROOT_ENV_VAR]: estateRoot,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
createInterface({ input: child.stdout }).on("line", (line) => {
  if (line.trim() === "") return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    // A server that prints anything but framed JSON on stdout is a finding, not
    // a reason for this checker to throw out of a readline handler and die with
    // a stack trace instead of a verdict.
    process.stderr.write(`unframed line on the server's stdout: ${line}\n`);
    return;
  }
  const settle = pending.get(message.id);
  if (settle !== undefined) {
    pending.delete(message.id);
    settle(message);
  }
});

// A server that dies answers nothing and node exits; a server that stays up and
// answers nothing would hang an unattended verification run for ever.
const REPLY_TIMEOUT_MS = 30_000;

let nextId = 0;
function request(method, params) {
  const id = (nextId += 1);
  return new Promise((settle, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      child.kill();
      reject(new Error(`the server did not answer ${method} within ${REPLY_TIMEOUT_MS}ms`));
    }, REPLY_TIMEOUT_MS);
    pending.set(id, (message) => {
      clearTimeout(timer);
      settle(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

const initialized = await request("initialize", {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: "capmap-verify", version: "0.1.0" },
});
notify("notifications/initialized");

const listed = await request("tools/list", {});
const names = (listed.result?.tools ?? []).map((tool) => tool.name);

const called = await request("tools/call", {
  name: PROBE_TOOL,
  arguments: { query: PROBE_QUERY },
});
const payload = called.result?.isError === true
  ? null
  : JSON.parse(called.result?.content?.[0]?.text ?? "null");
const hits = payload?.hits ?? null;

child.stdin.end();
child.kill();

const missing = EXPECTED_TOOLS.filter((tool) => !names.includes(tool));
const callOk = Array.isArray(hits) ? hits.length > 0 : false;

process.stdout.write(
  `server: ${initialized.result?.serverInfo?.name} ${initialized.result?.serverInfo?.version}\n` +
  `${names.length} tools: ${names.join(", ")}\n` +
  `missing: ${missing.length === 0 ? "none" : missing.join(", ")}\n` +
  `${PROBE_TOOL}("${PROBE_QUERY}") over stdio: ${Array.isArray(hits) ? `${hits.length} hits, top ${hits[0]?.id}` : "no result"}\n`,
);
process.exit(missing.length === 0 && callOk ? 0 : 1);
