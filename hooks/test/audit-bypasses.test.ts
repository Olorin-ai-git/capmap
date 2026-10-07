import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentsHash, specContentHash } from "../src/components-hash.js";

/**
 * Regression tests for the gate bypasses in the capmap audit (CM-1, CM-4, CM-5,
 * CM-16), each driving the compiled hook with a real payload against the
 * checkout's own configuration. Every case was reproduced against the hook as
 * audited and is asserted here in its fixed form.
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOOK = join(here, "..", "dist", "gate-hook.js");
const CONFIG_DIR = join(here, "..", "..", "config");
const BLOCK = 2;
const ALLOW = 0;
const SPEC_TEXT = "# Spec\n\n## Components\n\n- billing\n";
const scratch: string[] = [];

type Payload = Record<string, unknown>;

function invoke(payload: Payload | string, env: NodeJS.ProcessEnv = {}): Promise<number> {
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      [HOOK],
      { env: { ...process.env, CAPMAP_GATE: "", CAPMAP_CONFIG_DIR: CONFIG_DIR, ...env } },
      (error) => done(error === null ? ALLOW : ((error as { code?: number }).code ?? 1)),
    );
    child.stdin?.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

const write = (file_path: string, content = "# Doc\n"): Payload => ({
  tool_name: "Write",
  tool_input: { file_path, content },
});
const bash = (command: string, cwd: string): Payload => ({
  tool_name: "Bash",
  cwd,
  tool_input: { command },
});

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capmap-audit-"));
  scratch.push(root);
  for (const dir of [".git", "specs", "plans", ".capmap", "docs"]) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, "specs", "foo.md"), SPEC_TEXT);
  return root;
}

/** The record `capmap gate specs/foo.md` writes for SPEC_TEXT, as an object to vary. */
function genuineRecord(root: string, spec = SPEC_TEXT): Record<string, unknown> {
  return {
    schemaVersion: 2,
    specPath: join(root, "specs", "foo.md"),
    feature: "foo",
    componentsHash: componentsHash(["billing"]),
    specContentHash: specContentHash(spec),
    componentsSource: "document",
    generatedAt: "2026-10-06T00:00:00.000Z",
    indexGeneratedAt: "2026-10-05T00:00:00.000Z",
    staleRepos: [],
    components: [
      {
        name: "billing", verdict: "REUSE", target: "alpha/billing", score: 0.9,
        bestCandidate: "alpha/billing", verifiedSha: "abc", failedChecks: [],
        competing: [], rationale: "Exact.",
      },
    ],
  };
}

async function putRecord(root: string, record: unknown): Promise<void> {
  const text = typeof record === "string" ? record : JSON.stringify(record);
  await writeFile(join(root, ".capmap", "gate-foo.json"), text);
}

beforeAll(async () => {
  await access(HOOK);
});

afterAll(async () => {
  await Promise.all(scratch.map((path) => rm(path, { recursive: true, force: true })));
});

describe("CM-1: a gate record must be genuine and bound to its specification", () => {
  it("rejects the audit's forged record (any JSON passed)", async () => {
    const root = await repo();
    await putRecord(root, { components: [], staleRepos: [], componentsSource: "flags" });
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });

  it("rejects a record whose component hash does not match its components", async () => {
    const root = await repo();
    await putRecord(root, { ...genuineRecord(root), componentsHash: componentsHash(["other"]) });
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });

  it("rejects a record that gates no components", async () => {
    const root = await repo();
    await putRecord(root, { ...genuineRecord(root), components: [], componentsHash: componentsHash([]) });
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });

  it("rejects a record produced for a different specification", async () => {
    const root = await repo();
    await mkdir(join(root, "specs", "other"), { recursive: true });
    await writeFile(join(root, "specs", "other", "foo.md"), SPEC_TEXT);
    await putRecord(root, genuineRecord(root));
    expect(await invoke(write(join(root, "specs", "other", "foo.md"), SPEC_TEXT))).toBe(BLOCK);
    expect(await invoke(write(join(root, "specs", "foo.md"), SPEC_TEXT))).toBe(ALLOW);
  });

  it("blocks a plan once its specification changed after the gate ran", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    const plan = join(root, "plans", "foo-plan.md");
    expect(await invoke(write(plan))).toBe(ALLOW);
    await writeFile(join(root, "specs", "foo.md"), `${SPEC_TEXT}\nNew scope.\n`);
    expect(await invoke(write(plan))).toBe(BLOCK);
  });

  it("still allows the plan after the verdicts are copied into the specification", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    await writeFile(join(root, "specs", "foo.md"), `${SPEC_TEXT}\n## Reuse Verdicts\n| billing | REUSE |\n`);
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(ALLOW);
  });

  it("blocks Write, Edit and shell writes to .capmap", async () => {
    const root = await repo();
    const record = join(root, ".capmap", "gate-foo.json");
    expect(await invoke(write(record, JSON.stringify(genuineRecord(root))))).toBe(BLOCK);
    await putRecord(root, genuineRecord(root));
    expect(
      await invoke({ tool_name: "Edit", tool_input: { file_path: record, old_string: "REUSE", new_string: "BUILD" } }),
    ).toBe(BLOCK);
    expect(await invoke(bash(`echo '{}' > .capmap/gate-foo.json`, root))).toBe(BLOCK);
    expect(await invoke(bash("cp /tmp/x.json ./.CAPMAP/gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("cat .capmap/gate-foo.json", root))).toBe(ALLOW);
  });
});

describe("CM-4: shell writes, more paths and new specifications", () => {
  it("blocks an ungated plan written through a Bash redirect", async () => {
    const root = await repo();
    expect(await invoke(bash("cat > plans/foo-plan.md <<'EOF'\n# Plan\nEOF", root))).toBe(BLOCK);
    expect(await invoke(bash("echo x | tee docs/plans/foo.md >/dev/null", root))).toBe(BLOCK);
  });

  it("follows a cd earlier in the command", async () => {
    const root = await repo();
    // Neither directory is guarded by itself; only the file inside it is.
    expect(await invoke(bash("cd docs && cat > foo-plan.md <<'EOF'\n# Plan\nEOF", root))).toBe(BLOCK);
    expect(await invoke(bash("pushd docs; echo x > implementation.md", root))).toBe(BLOCK);
    expect(await invoke(bash("cd docs && cat > notes.md <<'EOF'\nx\nEOF", root))).toBe(ALLOW);
  });

  it("blocks plans at the paths the audit found unguarded", async () => {
    const root = await repo();
    expect(await invoke(write(join(root, "docs", "implementation.md")))).toBe(BLOCK);
    expect(await invoke(write(join(root, "Plans", "foo.md")))).toBe(BLOCK);
    expect(await invoke(write(join(root, "specs", "001-foo", "plan.md")))).toBe(BLOCK);
    expect(await invoke(write(join(root, ".claude", "worktrees", "w", "plans", "x.md")))).toBe(BLOCK);
  });

  it("gates a new specification after its first write", async () => {
    const root = await repo();
    const spec = join(root, "specs", "fresh.md");
    expect(await invoke(write(spec, SPEC_TEXT))).toBe(ALLOW);
    await writeFile(spec, SPEC_TEXT);
    expect(await invoke(write(spec, SPEC_TEXT))).toBe(BLOCK);
  });

  it("lets reads and the gate itself through", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    expect(await invoke(bash("cat plans/foo-plan.md specs/foo.md 2>&1 | head", root))).toBe(ALLOW);
    expect(await invoke(bash("git add specs/foo.md && git status", root))).toBe(ALLOW);
    expect(await invoke(bash("capmap gate specs/fresh.md", root))).toBe(ALLOW);
    expect(await invoke(bash("ls -la && pnpm test", root))).toBe(ALLOW);
  });

  it("treats a shell write to a gated specification as an unknown change", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    expect(await invoke(bash("sed -i '' 's/billing/auth/' specs/foo.md", root))).toBe(BLOCK);
  });
});

describe("CM-5: the hook blocks on its own errors once configured", () => {
  it("blocks on a record of {}", async () => {
    const root = await repo();
    await putRecord(root, {});
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });

  it("blocks on a record that is not JSON", async () => {
    const root = await repo();
    await putRecord(root, "{not json");
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });

  it("blocks on a configuration without a hook section, or a missing directory", async () => {
    const root = await repo();
    const config = join(root, "cfg");
    await mkdir(config);
    await writeFile(join(config, "scan.config.json"), JSON.stringify({ index: { dir: "index" } }));
    const plan = write(join(root, "plans", "foo-plan.md"));
    expect(await invoke(plan, { CAPMAP_CONFIG_DIR: config })).toBe(BLOCK);
    expect(await invoke(plan, { CAPMAP_CONFIG_DIR: join(root, "absent") })).toBe(BLOCK);
  });

  it("blocks on unreadable input, unless bypassed", async () => {
    expect(await invoke("not json")).toBe(BLOCK);
    expect(await invoke("not json", { CAPMAP_GATE: "off" })).toBe(ALLOW);
  });
});

describe("CM-16: repeated-string edits and line endings", () => {
  it("allows a replace_all edit of repeated prose", async () => {
    const root = await repo();
    const spec = join(root, "specs", "foo.md");
    const text = "# Spec\n\nthe thing, the thing\n\n## Components\n\n- billing\n";
    await writeFile(spec, text);
    await putRecord(root, genuineRecord(root, text));
    const edit = { file_path: spec, old_string: "the thing", new_string: "the service", replace_all: true };
    expect(await invoke({ tool_name: "Edit", tool_input: edit })).toBe(ALLOW);
  });

  it("blocks a MultiEdit that changes a component", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    const edits = [{ old_string: "# Spec", new_string: "# Specification" }, { old_string: "- billing", new_string: "- auth" }];
    const payload = { tool_name: "MultiEdit", tool_input: { file_path: join(root, "specs", "foo.md"), edits } };
    expect(await invoke(payload)).toBe(BLOCK);
  });

  it("reads the components of a CRLF specification", async () => {
    const root = await repo();
    const crlf = SPEC_TEXT.replace(/\n/g, "\r\n");
    await writeFile(join(root, "specs", "foo.md"), crlf);
    await putRecord(root, genuineRecord(root, crlf));
    expect(await invoke(write(join(root, "specs", "foo.md"), crlf))).toBe(ALLOW);
  });
});
