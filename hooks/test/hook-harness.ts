import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentsHash, specContentHash } from "../src/components-hash.js";

/** Drives the compiled hook with real payloads against the checkout's own configuration. */

const here = dirname(fileURLToPath(import.meta.url));
export const HOOK = join(here, "..", "dist", "gate-hook.js");
export const CONFIG_DIR = join(here, "..", "..", "config");
export const BLOCK = 2;
export const ALLOW = 0;
export const SPEC_TEXT = "# Spec\n\n## Components\n\n- billing\n";
/** The generation time of the index the hook is configured with. */
export const INDEX_GENERATED_AT = (
  JSON.parse(readFileSync(join(CONFIG_DIR, "..", "index", "index.json"), "utf8")) as { generatedAt: string }
).generatedAt;
const scratch: string[] = [];

export type Payload = Record<string, unknown>;

export function invoke(payload: Payload | string, env: NodeJS.ProcessEnv = {}, hook = HOOK): Promise<number> {
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      [hook],
      { env: { ...process.env, CAPMAP_GATE: "", CAPMAP_CONFIG_DIR: CONFIG_DIR, ...env } },
      (error) => done(error === null ? ALLOW : ((error as { code?: number }).code ?? 1)),
    );
    child.stdin?.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

/** A plan names the specification it implements. */
export const PLAN_TEXT = "# Plan\n\nSpec: specs/foo.md\n";

export const write = (file_path: string, content = PLAN_TEXT): Payload => ({
  tool_name: "Write",
  tool_input: { file_path, content },
});
export const bash = (command: string, cwd: string): Payload => ({
  tool_name: "Bash",
  cwd,
  tool_input: { command },
});

export async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capmap-audit-"));
  scratch.push(root);
  for (const dir of [".git", "specs", "plans", ".capmap", "docs"]) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, "specs", "foo.md"), SPEC_TEXT);
  return root;
}

export async function cleanUp(): Promise<void> {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

/** The record `capmap gate <spec>` writes for `text`, as an object to vary. */
export function genuineRecord(
  root: string,
  text = SPEC_TEXT,
  { spec = join(root, "specs", "foo.md"), names = ["billing"], verdict = "REUSE", feature = "foo" } = {},
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    specPath: spec,
    feature,
    componentsHash: componentsHash(names),
    specContentHash: specContentHash(text),
    componentsSource: "document",
    generatedAt: "2026-10-06T00:00:00.000Z",
    indexGeneratedAt: INDEX_GENERATED_AT,
    staleRepos: [],
    components: names.map((name) => ({
      name, verdict, target: verdict === "REUSE" ? "alpha/billing" : null, score: 0.9,
      bestCandidate: "alpha/billing", verifiedSha: "abc", failedChecks: [],
      competing: [], rationale: "Exact.",
    })),
  };
}

export async function putRecord(root: string, record: unknown, feature = "foo"): Promise<void> {
  const text = typeof record === "string" ? record : JSON.stringify(record);
  await writeFile(join(root, ".capmap", `gate-${feature}.json`), text);
}
