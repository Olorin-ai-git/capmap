import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HOOK = join(here, "..", "dist", "gate-hook.js");
const EXIT_BLOCK = 2;

/**
 * Every temporary tree this suite makes, removed when it finishes.
 *
 * Each scenario builds two, and nothing removed them: a session of repeated
 * runs left ten thousand directories in the system temporary directory. They
 * are small individually, which is exactly why it went unnoticed.
 */
const scratch: string[] = [];

interface Invocation {
  code: number;
  stderr: string;
}

/**
 * Drive the compiled hook exactly as the harness does: a JSON payload on stdin,
 * a decision expressed as an exit code, and any explanation on stderr. Testing
 * the shell rather than only `decide` is what catches wiring faults — a glob
 * that never matches, a record path assembled wrongly, an unreadable config.
 */
function invoke(filePath: string, env: NodeJS.ProcessEnv): Promise<Invocation> {
  return new Promise((resolvePromise) => {
    const child = execFile(
      process.execPath,
      [HOOK],
      { env: { ...process.env, ...env } },
      (error, _stdout, stderr) => {
        const code =
          error === null ? 0 : ((error as { code?: number }).code ?? 1);
        resolvePromise({ code, stderr });
      },
    );
    child.stdin?.end(
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: filePath },
      }),
    );
  });
}

const HASH_OF_BILLING_ONLY = "sha256:f8ecc289bb90f63f1ceebbec31147ecc8b97d98014f0f8a39d258ec6d816e2f3";

const RESOLVED_RECORD = {
  schemaVersion: 1,
  specPath: "specs/x.md",
  feature: "tenant-portal",
  componentsHash: `sha256:${"a".repeat(64)}`,
  generatedAt: "2026-08-02T00:00:00.000Z",
  indexGeneratedAt: "2026-07-27T00:00:00.000Z",
  staleRepos: [] as string[],
  components: [
    {
      name: "billing",
      verdict: "REUSE",
      target: "angainor/billing",
      score: 0.86,
      bestCandidate: null,
      verifiedSha: "f9f6127",
      failedChecks: [] as string[],
      competing: [] as unknown[],
      rationale: "Already built.",
    },
  ],
};

async function scenario(): Promise<{ root: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(join(tmpdir(), "capmap-hook-"));
  scratch.push(root);
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "plans"), { recursive: true });
  await writeFile(
    join(root, "plans", "2026-08-02-tenant-portal.md"),
    "# Plan\n",
  );
  await writeFile(join(root, "README.md"), "# readme\n");

  const configRoot = await mkdtemp(join(tmpdir(), "capmap-hookcfg-"));
  scratch.push(configRoot);
  await mkdir(join(configRoot, "config"), { recursive: true });
  await mkdir(join(configRoot, "index"), { recursive: true });
  await writeFile(
    join(configRoot, "config", "scan.config.json"),
    JSON.stringify({
      hook: {
        specGlobs: ["**/specs/**/*.{md,markdown}"],
        planGlobs: ["**/plans/**/*.{md,markdown}"],
      },
      index: { dir: "index" },
    }),
  );
  await writeFile(
    join(configRoot, "index", "index.json"),
    JSON.stringify({ schemaVersion: 1 }),
  );

  return { root, env: { CAPMAP_CONFIG_DIR: join(configRoot, "config") } };
}

async function writeRecord(root: string, record: unknown): Promise<void> {
  await mkdir(join(root, ".capmap"), { recursive: true });
  await writeFile(
    join(root, ".capmap", "gate-tenant-portal.json"),
    JSON.stringify(record, null, 2),
  );
}

afterAll(async () => {
  await Promise.all(
    scratch.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("gate hook end to end", () => {
  beforeAll(async () => {
    await access(HOOK).catch(() => {
      throw new Error(
        `hook not built at ${HOOK}; run "pnpm -r build" before this suite`,
      );
    });
  });

  it("blocks a plan write that has no gate record", async () => {
    const { root, env } = await scenario();
    const result = await invoke(
      join(root, "plans", "2026-08-02-tenant-portal.md"),
      env,
    );
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toMatch(/No reuse gate has been run/);
    expect(result.stderr).toMatch(/capmap gate/);
  });

  it("allows the same write once every component is resolved", async () => {
    const { root, env } = await scenario();
    await writeRecord(root, RESOLVED_RECORD);
    const result = await invoke(
      join(root, "plans", "2026-08-02-tenant-portal.md"),
      env,
    );
    expect(result.code).toBe(0);
  });

  it("blocks and names the component when one is unresolved", async () => {
    const { root, env } = await scenario();
    await writeRecord(root, {
      ...RESOLVED_RECORD,
      components: [{ ...RESOLVED_RECORD.components[0], verdict: "UNRESOLVED" }],
    });
    const result = await invoke(
      join(root, "plans", "2026-08-02-tenant-portal.md"),
      env,
    );
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toMatch(/billing/);
    expect(result.stderr).toMatch(/unresolved/i);
  });

  it("does not reference a command-line flag that does not exist", async () => {
    const { root, env } = await scenario();
    await writeRecord(root, {
      ...RESOLVED_RECORD,
      components: [{ ...RESOLVED_RECORD.components[0], verdict: "UNRESOLVED" }],
    });
    const result = await invoke(
      join(root, "plans", "2026-08-02-tenant-portal.md"),
      env,
    );
    expect(result.stderr).not.toMatch(/--resolve/);
  });

  it("gates a plan whose extension differs in case (SP-3 audit)", async () => {
    const { root, env } = await scenario();
    const result = await invoke(join(root, "plans", "2026-08-02-other.MD"), env);
    expect(result.code).toBe(EXIT_BLOCK);
  });

  it("leaves a file outside the configured globs alone", async () => {
    const { root, env } = await scenario();
    const result = await invoke(join(root, "README.md"), env);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("honours the bypass environment variable", async () => {
    const { root, env } = await scenario();
    const result = await invoke(
      join(root, "plans", "2026-08-02-tenant-portal.md"),
      { ...env, CAPMAP_GATE: "off" },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/bypass/i);
  });

  it("allows everything when no config directory is configured", async () => {
    const { root } = await scenario();
    const result = await invoke(
      join(root, "plans", "2026-08-02-tenant-portal.md"),
      { CAPMAP_CONFIG_DIR: "" },
    );
    expect(result.code).toBe(0);
  });

  // The latency contract lives in scripts/hook-latency.mjs, not here. Vitest
  // runs test files in parallel, so measuring subprocess spawns from inside the
  // suite measured the runner: 1.54 quiet against 2.45-3.12 under the runner,
  // on identical code. It is asserted as its own step by verify.sh and by CI.
});

/**
 * The hole an independent review found: the hash was computed from the file on
 * disk, which during a PreToolUse check is the PRE-edit content. Rewriting a
 * specification's component list therefore hashed the old components, matched
 * the existing gate record, and was allowed — defeated by precisely the edit
 * the check exists to catch.
 */
describe("component changes in the pending write", () => {
  function invokeWithContent(
    filePath: string,
    content: string,
    env: NodeJS.ProcessEnv,
    field: "content" | "new_string" = "content",
    oldString?: string,
  ): Promise<Invocation> {
    return new Promise((resolvePromise) => {
      const child = execFile(
        process.execPath,
        [HOOK],
        { env: { ...process.env, ...env } },
        (error, _stdout, stderr) => {
          const code =
            error === null ? 0 : ((error as { code?: number }).code ?? 1);
          resolvePromise({ code, stderr });
        },
      );
      child.stdin?.end(
        JSON.stringify({
          tool_name: field === "content" ? "Write" : "Edit",
          tool_input: {
            file_path: filePath,
            [field]: content,
            ...(oldString === undefined ? {} : { old_string: oldString }),
          },
        }),
      );
    });
  }

  async function gatedSpec(): Promise<{
    path: string;
    env: NodeJS.ProcessEnv;
  }> {
    const { root, env } = await scenario();
    await mkdir(join(root, "specs"), { recursive: true });
    const path = join(root, "specs", "2026-08-02-tenant-portal-design.md");
    await writeFile(path, "# Spec\n\n## Components\n\n- billing\n");
    // A record gated for exactly the component list currently on disk.
    await writeRecord(root, {
      ...RESOLVED_RECORD,
      componentsHash: HASH_OF_BILLING_ONLY,
    });
    return { path, env };
  }

  it("blocks writing a whole new PLAN with no gate record", async () => {
    // The blocking bypass: a caller could write an entire implementation plan
    // to a new path in one Write and never be stopped, because first creation
    // was allowed for every guarded path rather than for specifications only.
    const { root, env } = await scenario();
    const result = await invokeWithContent(
      join(root, "plans", "2099-01-01-ungated.md"),
      "# Plan\n\nBuild all of it from scratch.\n",
      env,
    );
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toMatch(/plan may not be written/i);
  });

  it("still allows creating a NEW specification, or the gate is unsatisfiable", async () => {
    const { root, env } = await scenario();
    await mkdir(join(root, "specs"), { recursive: true });
    const result = await invokeWithContent(
      join(root, "specs", "2099-01-01-brand-new-design.md"),
      "# Spec\n",
      env,
    );
    expect(result.code).toBe(0);
  });

  it("blocks a Write that adds a component the gate never saw", async () => {
    const { path, env } = await gatedSpec();
    const result = await invokeWithContent(
      path,
      "# Spec\n\n## Components\n\n- billing\n- authentication\n",
      env,
    );
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toMatch(/component set changed/i);
  });

  it("allows a Write that leaves the component list alone", async () => {
    const { path, env } = await gatedSpec();
    const result = await invokeWithContent(
      path,
      "# Spec\n\nMore prose, same components.\n\n## Components\n\n- billing\n",
      env,
    );
    expect(result.code).toBe(0);
  });

  it("blocks a NARROW Edit that changes one component without the heading", async () => {
    // The reported bypass: the replacement region contains no `## Components`
    // heading, so hashing it alone found nothing and the pre-edit file was
    // hashed instead, matching the old record.
    const { path, env } = await gatedSpec();
    const result = await invokeWithContent(
      path,
      "- authentication",
      env,
      "new_string",
      "- billing",
    );
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toMatch(/component set changed/i);
  });

  it("allows an Edit that only rewrites prose", async () => {
    const { path, env } = await gatedSpec();
    const result = await invokeWithContent(
      path,
      "# Specification",
      env,
      "new_string",
      "# Spec",
    );
    expect(result.code).toBe(0);
  });

  it("fails closed when the edit cannot be reconstructed", async () => {
    // No old_string, so the post-edit document is genuinely unknown. A guard
    // that cannot tell what an edit does must not assume it changed nothing.
    const { path, env } = await gatedSpec();
    const result = await invokeWithContent(path, "- payments", env, "new_string");
    expect(result.code).toBe(EXIT_BLOCK);
  });

  it("fails closed when old_string appears more than once", async () => {
    const { root, env } = await scenario();
    await mkdir(join(root, "specs"), { recursive: true });
    const path = join(root, "specs", "2026-08-02-tenant-portal-design.md");
    await writeFile(path, "# Spec\n\n## Components\n\n- billing\n- billing\n");
    await writeRecord(root, {
      ...RESOLVED_RECORD,
      componentsHash: HASH_OF_BILLING_ONLY,
    });
    const result = await invokeWithContent(
      path,
      "- authentication",
      env,
      "new_string",
      "- billing",
    );
    expect(result.code).toBe(EXIT_BLOCK);
  });
});

/**
 * The bypass an independent review found last: deleting the whole
 * `## Components` section produced a null hash, which the decision treated as
 * "no evidence of change" and allowed. A specification could therefore be
 * rewritten with no gated component list and then proceed to planning against
 * a stale record.
 */
describe("removal of the gated component list", () => {
  async function gatedFrom(
    source: "document" | "flags",
  ): Promise<{ path: string; env: NodeJS.ProcessEnv }> {
    const { root, env } = await scenario();
    await mkdir(join(root, "specs"), { recursive: true });
    const path = join(root, "specs", "2026-08-02-tenant-portal-design.md");
    await writeFile(path, "# Spec\n\n## Components\n\n- billing\n");
    await writeRecord(root, {
      ...RESOLVED_RECORD,
      componentsHash: HASH_OF_BILLING_ONLY,
      componentsSource: source,
    });
    return { path, env };
  }

  function writeContent(
    filePath: string,
    content: string,
    env: NodeJS.ProcessEnv,
  ): Promise<Invocation> {
    return new Promise((resolvePromise) => {
      const child = execFile(
        process.execPath,
        [HOOK],
        { env: { ...process.env, ...env } },
        (error, _stdout, stderr) => {
          const code =
            error === null ? 0 : ((error as { code?: number }).code ?? 1);
          resolvePromise({ code, stderr });
        },
      );
      child.stdin?.end(
        JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: filePath, content },
        }),
      );
    });
  }

  it("blocks deleting the section when the record was gated from the document", async () => {
    const { path, env } = await gatedFrom("document");
    const result = await writeContent(path, "# Spec\n\nAll prose now.\n", env);
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toMatch(/removed from this document/i);
  });

  it("allows a write that keeps the section unchanged", async () => {
    const { path, env } = await gatedFrom("document");
    const result = await writeContent(
      path,
      "# Spec\n\nnew prose\n\n## Components\n\n- billing\n",
      env,
    );
    expect(result.code).toBe(0);
  });

  it("allows an absent section when the record came from --component flags", async () => {
    // That document never had a section, so its absence carries no information
    // and must not block every write to it forever.
    const { path, env } = await gatedFrom("flags");
    const result = await writeContent(path, "# Spec\n\nAll prose now.\n", env);
    expect(result.code).toBe(0);
  });
});
