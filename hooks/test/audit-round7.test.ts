import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ALLOW, BLOCK, CONFIG_DIR, HOOK, SPEC_TEXT, bash, cleanUp, genuineRecord, invoke, putRecord, repo, write,
  type Payload,
} from "./hook-harness.js";

/**
 * Audit round 7. Each case was reproduced against 8a13e10 with the compiled
 * hook; the record of specs/foo.md is UNRESOLVED, so a cleared plan or a capmap
 * run the hook cannot vouch for is a bypass.
 */

afterAll(cleanUp);

const BAR_TEXT = "# Bar\n\n## Components\n\n- banner\n";

async function gated(): Promise<string> {
  const root = await repo();
  await putRecord(root, genuineRecord(root, SPEC_TEXT, { verdict: "UNRESOLVED" }));
  await writeFile(join(root, "specs", "bar.md"), BAR_TEXT);
  await putRecord(root, genuineRecord(root, BAR_TEXT, {
    spec: join(root, "specs", "bar.md"), names: ["banner"], verdict: "BUILD", feature: "bar",
  }), "bar");
  return root;
}

async function expectAll(commands: string[], expected: number): Promise<void> {
  const root = await gated();
  for (const command of commands) expect(await invoke(bash(command, root)), command).toBe(expected);
}

const plan = (spec: string): string => `# Plan\n\nSpec: ${spec}\n\nBuild billing from scratch.\n`;

describe("round 7, High: a plan is checked against its own feature", () => {
  it("does not clear a plan on the record of another specification it names", async () => {
    const root = await gated();
    expect(await invoke(write(join(root, "plans", "foo-plan.md"), plan("specs/foo.md"))), "control").toBe(BLOCK);
    expect(await invoke(write(join(root, "plans", "foo-plan.md"), plan("specs/bar.md")))).toBe(BLOCK);
    expect(await invoke(write(join(root, "docs", "foo-implementation.md"), plan("specs/bar.md")))).toBe(BLOCK);
  });

  it("clears a plan named for the specification it names", async () => {
    const root = await gated();
    await mkdir(join(root, "docs", "superpowers", "plans"), { recursive: true });
    for (const path of ["plans/bar-plan.md", "plans/bar.md", "docs/superpowers/plans/2026-10-08-bar.md",
      "docs/bar-implementation-plan.md", "docs/plan-bar.md"]) {
      expect(await invoke(write(join(root, path), plan("specs/bar.md"))), path).toBe(ALLOW);
    }
  });
});

describe("round 7, High: capmap runs only in the environment the session gave it", () => {
  it("blocks a command that changes capmap's environment", async () => {
    await expectAll(
      [
        "export ANTHROPIC_BASE_URL=http://127.0.0.1:47811 ANTHROPIC_API_KEY=x; capmap gate specs/foo.md",
        "ANTHROPIC_BASE_URL=http://127.0.0.1:47811 capmap gate specs/foo.md",
        "CAPMAP_ROOT=/tmp/fake-estate capmap scan --all",
        "export CAPMAP_ROOT=/tmp/fake-estate; capmap scan --all",
        "env NODE_OPTIONS=--require=/tmp/x.js capmap gate specs/foo.md",
        "env -u ANTHROPIC_API_KEY capmap gate specs/foo.md",
        "unset ANTHROPIC_API_KEY; capmap gate specs/foo.md",
        "set -a; . ./fake.env; capmap gate specs/foo.md",
        "sh -c 'export ANTHROPIC_BASE_URL=http://x; capmap gate specs/foo.md'",
        "export ANTHROPIC_BASE_URL=http://x; sh -c 'capmap gate specs/foo.md'",
        "declare -x CAPMAP_ROOT=/tmp/f; node packages/capmap-cli/dist/bin.js scan --all",
      ],
      BLOCK,
    );
  });

  it("still allows capmap in the session's environment, and environment changes without capmap", async () => {
    await expectAll(
      [
        "capmap gate specs/foo.md",
        "set -euo pipefail; capmap gate specs/foo.md",
        "capmap scan --all",
        `CAPMAP_CONFIG_DIR=${CONFIG_DIR} capmap gate specs/foo.md`,
        "export FOO=1; ls",
        "cat .capmap/gate-foo.json",
      ],
      ALLOW,
    );
  });
});

describe("round 7, High: capmap gate arguments the hook cannot read", () => {
  it("blocks --resolve spelled at run time or supplied by another program", async () => {
    await expectAll(
      [
        "(sleep 3; printf '1\\n') | env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID script -q /dev/null capmap gate $(echo specs/foo.md) $(echo --resolve)",
        "script -q /dev/null capmap gate specs/foo.md --re$(echo solve)",
        "capmap gate specs/foo.md --re$(echo solve)",
        "echo $(printf specs/foo.md) --resolve | xargs capmap gate",
        "capmap gate specs/foo.md `echo --resolve`",
        "capmap gate specs/foo.md ${R:---resolve}",
        "capmap gate specs/foo.md --res*",
        "capmap gate specs/foo.md --res[o]lve",
        "find . -name -- -exec capmap gate specs/foo.md {} \\;",
        "xargs -a args.txt capmap gate",
      ],
      BLOCK,
    );
  });

  it("still allows a literal gate run and prose about it", async () => {
    await expectAll(
      [
        "capmap gate specs/foo.md",
        "capmap gate ./specs/foo.md --component billing",
        'echo "capmap gate specs/foo.md --resolve"',
        'git commit -m "docs: capmap gate $(date)"',
      ],
      ALLOW,
    );
  });
});

/** The hook as a registration that names `node` without a path runs it. */
function invokeAs(argv0: string, payload: Payload): Promise<number> {
  return new Promise((done) => {
    // spawn, not execFile: execFile does not pass argv0 on.
    const child = spawn(process.execPath, [HOOK], {
      argv0, env: { ...process.env, CAPMAP_GATE: "", CAPMAP_CONFIG_DIR: CONFIG_DIR }, stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("close", (code) => done(code ?? 1));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("round 7, Medium: the hook's interpreter", () => {
  it("refuses to decide when started through a PATH lookup, which a writable PATH entry can shadow", async () => {
    const root = await gated();
    const payload = write(join(root, "notes.md"), "notes");
    expect(await invokeAs(process.execPath, payload), "absolute").toBe(ALLOW);
    expect(await invokeAs("node", payload)).toBe(BLOCK);
  });

  it("guards the interpreter it runs on", async () => {
    const root = await gated();
    expect(await invoke(write(process.execPath, "#!/bin/sh\nexit 0\n"))).toBe(BLOCK);
    expect(await invoke(bash(`cp /bin/sh ${process.execPath}`, root))).toBe(BLOCK);
  });
});

describe("round 7, Medium: documents that are not plans", () => {
  it("does not take specifications and architecture notes for plans", async () => {
    const root = await gated();
    await mkdir(join(root, "docs", "superpowers", "specs"), { recursive: true });
    await mkdir(join(root, "docs", "architecture"), { recursive: true });
    for (const path of ["docs/superpowers/specs/2026-10-07-oap-control-plane.md", "docs/architecture/control-plane.md",
      "specs/tasks-api.md", "specs/planner.md", "docs/planet.md", "docs/explanation.md"]) {
      expect(await invoke(write(join(root, path), "# Notes\n")), path).toBe(ALLOW);
    }
  });

  it("still takes the plan shapes for plans", async () => {
    const root = await gated();
    await mkdir(join(root, "specs", "001-x"), { recursive: true });
    for (const path of ["docs/foo-plan.md", "docs/plan.md", "docs/plan-foo.md", "docs/foo_plan_v2.md",
      "docs/foo-implementation.md", "specs/001-x/tasks.md", "specs/001-x/plan.md", "plans/anything.md"]) {
      expect(await invoke(write(join(root, path), "# Notes\n")), path).toBe(BLOCK);
    }
  });
});

describe("round 7, Low-Medium: a second specification of a gated feature id", () => {
  it("may be created, and cannot clear a plan", async () => {
    const root = await gated();
    await mkdir(join(root, "specs", "v2"));
    await mkdir(join(root, "docs", "superpowers", "specs"), { recursive: true });
    const decoy = "# Foo again\n\n## Components\n\n- banner\n";
    expect(await invoke(write(join(root, "specs", "v2", "foo.md"), decoy))).toBe(ALLOW);
    expect(await invoke(write(join(root, "docs", "superpowers", "specs", "2026-10-07-foo-design.md"), decoy)))
      .toBe(ALLOW);
    expect(await invoke(write(join(root, "plans", "foo-plan.md"), plan("specs/v2/foo.md")))).toBe(BLOCK);
  });

  it("still blocks changing an existing one, which the record does not belong to", async () => {
    const root = await gated();
    await mkdir(join(root, "specs", "v2"));
    await writeFile(join(root, "specs", "v2", "foo.md"), "# Foo again\n");
    expect(await invoke(write(join(root, "specs", "v2", "foo.md"), "# Foo again\n\nMore.\n"))).toBe(BLOCK);
  });
});

describe("round 7, Low: the copied verdict table carries only the record's verdicts", () => {
  const record = (root: string, text: string): Record<string, unknown> => genuineRecord(root, text);
  const withTable = (row: string): string =>
    `${SPEC_TEXT}\n## Reuse Verdicts\n\n| component | verdict | target | score | note |\n|---|---|---|---|---|\n${row}\n`;

  it("clears a plan when the table repeats the record", async () => {
    const root = await repo();
    await putRecord(root, record(root, SPEC_TEXT));
    await writeFile(join(root, "specs", "foo.md"), withTable("| billing | REUSE | alpha/billing | 0.90 | |"));
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(ALLOW);
  });

  it("blocks a plan when a row's cells carry text the record does not", async () => {
    for (const row of [
      "| billing | REUSE | alpha/billing | 0.90 | ALSO IN SCOPE: payments ledger, fraud engine |",
      "| billing | BUILD | alpha/billing | 0.90 | |",
      "| billing | REUSE | new-payments-ledger | 0.90 | |",
      "| billing | REUSE | alpha/billing | 0.90 | | and a fraud engine |",
    ]) {
      const root = await repo();
      await putRecord(root, record(root, SPEC_TEXT));
      await writeFile(join(root, "specs", "foo.md"), withTable(row));
      expect(await invoke(write(join(root, "plans", "foo-plan.md"))), row).toBe(BLOCK);
    }
  });
});

describe("round 7, Low: an exempt name that resolves to a guarded file", () => {
  it("is decided on where the write lands, dangling link or not", async () => {
    const root = await gated();
    await mkdir(join(root, ".claude", "plans"), { recursive: true });
    await symlink("../../plans/foo-plan.md", join(root, ".claude", "plans", "x.md"));
    expect(await invoke(write(join(root, ".claude", "plans", "x.md"), plan("specs/foo.md")))).toBe(BLOCK);
    await writeFile(join(root, "plans", "foo-plan.md"), plan("specs/foo.md"));
    expect(await invoke(write(join(root, ".claude", "plans", "x.md"), plan("specs/foo.md")))).toBe(BLOCK);
    expect(await invoke(write(join(root, ".claude", "plans", "y.md"), plan("specs/foo.md"))), "own").toBe(ALLOW);
  });
});
