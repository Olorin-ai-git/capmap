import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import {
  ALLOW, BLOCK, CONFIG_DIR, HOOK, PLAN_TEXT, SPEC_TEXT,
  bash, cleanUp, genuineRecord, invoke, putRecord, repo, write,
} from "./hook-harness.js";

/**
 * Audit round 4: each case was reproduced against the hook at c7a1889 and is
 * asserted here in its fixed form.
 */

afterAll(cleanUp);

const AUTH_SPEC = "# Foo\n\n## Components\n\n- authentication\n- billing\n";
const unresolved = (root: string): Record<string, unknown> =>
  genuineRecord(root, AUTH_SPEC, { names: ["authentication", "billing"], verdict: "UNRESOLVED" });

async function gatedUnresolved(): Promise<string> {
  const root = await repo();
  await writeFile(join(root, "specs", "foo.md"), AUTH_SPEC);
  await putRecord(root, unresolved(root));
  return root;
}

describe("round 4, High: a plan is bound to the specification it names", () => {
  it("blocks a plan cleared by a record gated from a decoy of the same name", async () => {
    const root = await gatedUnresolved();
    const decoyText = "# Decoy\n\n## Components\n\n- banner\n";
    const decoy = join(root, "decoy", "specs", "foo.md");
    await mkdir(dirname(decoy), { recursive: true });
    await writeFile(decoy, decoyText);
    await putRecord(root, genuineRecord(root, decoyText, { spec: decoy, names: ["banner"], verdict: "BUILD" }));
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });

  it("blocks a plan that names no specification", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    expect(await invoke(write(join(root, "plans", "foo-plan.md"), "# Plan\n"))).toBe(BLOCK);
  });

  it("binds by the named specification, not the plan's file name", async () => {
    const root = await gatedUnresolved();
    await writeFile(join(root, "specs", "bar.md"), "# Bar\n\n## Components\n\n- banner\n");
    await putRecord(root, genuineRecord(root, "# Bar\n\n## Components\n\n- banner\n", {
      spec: join(root, "specs", "bar.md"), names: ["banner"], verdict: "BUILD", feature: "bar",
    }), "bar");
    // The plan for foo, filed under bar's name, still names foo.
    expect(await invoke(write(join(root, "plans", "bar-plan.md"), PLAN_TEXT))).toBe(BLOCK);
    await putRecord(root, genuineRecord(root));
    await writeFile(join(root, "specs", "foo.md"), SPEC_TEXT);
    expect(await invoke(write(join(root, "plans", "anything.md"), "**Spec**: [foo](../specs/foo.md)\n"))).toBe(ALLOW);
  });

  it("blocks a plan written through the shell, whose content it cannot read", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    expect(await invoke(bash(`printf 'Spec: specs/foo.md' > plans/foo-plan.md`, root))).toBe(BLOCK);
  });
});

describe("round 4, High: directory moves and copies carry their files", () => {
  it("blocks moving or copying a gated specification's directory", async () => {
    const root = await gatedUnresolved();
    expect(await invoke(bash("mv specs specs-tmp", root))).toBe(BLOCK);
    await mkdir(join(root, "stage", "specs"), { recursive: true });
    await writeFile(join(root, "stage", "specs", "foo.md"), "# Foo\n\n## Components\n\n- banner\n");
    expect(await invoke(bash("cp -r stage/specs .", root))).toBe(BLOCK);
    expect(await invoke(bash("rsync -a stage/ .", root))).toBe(BLOCK);
    await rm(join(root, "specs"), { recursive: true });
    await mkdir(join(root, "specs-tmp"));
    await writeFile(join(root, "specs-tmp", "foo.md"), "# Foo\n\n## Components\n\n- banner\n");
    expect(await invoke(bash("mv specs-tmp specs", root))).toBe(BLOCK);
  });

  it("still allows moving directories that hold nothing guarded", async () => {
    const root = await repo();
    await mkdir(join(root, "a"));
    await writeFile(join(root, "a", "x.ts"), "");
    expect(await invoke(bash("mv a b && cp -r b c", root))).toBe(ALLOW);
  });
});

describe("round 4, High: ANSI-C and locale quoting", () => {
  it("dequotes $'..' and $\"..\" before matching", async () => {
    const root = await repo();
    expect(await invoke(bash("cp r.json $'.capmap'/gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("echo x > $'plans'/foo-plan.md", root))).toBe(BLOCK);
    expect(await invoke(bash('echo x > $"plans"/foo-plan.md', root))).toBe(BLOCK);
    expect(await invoke(bash("cp r.json $'\\x2ecap\\155ap/gate-foo.json'", root))).toBe(BLOCK);
  });
});

describe("round 4, High: the hook fails closed when it cannot load", () => {
  const registration = async (): Promise<string> => {
    const doc = await readFile(join(CONFIG_DIR, "..", "docs", "operations", "hook-installation.md"), "utf8");
    const block = /```json\n([\s\S]*?)```/.exec(doc)?.[1] ?? "";
    const settings = JSON.parse(block) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } };
    return settings.hooks.PreToolUse[0]?.hooks[0]?.command ?? "";
  };
  const copyHook = async (type: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "capmap-hook-copy-"));
    await cp(join(HOOK, ".."), join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type }));
    return join(dir, "dist", "gate-hook.js");
  };
  const run = (command: string): Promise<number> =>
    new Promise((done) => {
      const child = execFile("/bin/sh", ["-c", command], (error) =>
        done(error === null ? ALLOW : ((error as { code?: number }).code ?? 1)));
      child.stdin?.end(JSON.stringify(write("/x/plans/foo-plan.md")));
    });

  it("blocks when a dependency is missing", async () => {
    expect(await invoke(write("/x/plans/foo-plan.md"), {}, await copyHook("module"))).toBe(BLOCK);
  });

  it("blocks under the documented registration when the code cannot even parse", async () => {
    const hook = await copyHook("commonjs");
    const command = (await registration())
      .replace("/path/to/capability-map/config", CONFIG_DIR)
      .replace("/path/to/capability-map/hooks/dist/gate-hook.js", hook);
    expect(await run(command)).toBe(BLOCK);
  });

  it("guards the hook's manifest and its dependencies", async () => {
    const hooksDir = join(HOOK, "..", "..");
    expect(await invoke(write(join(hooksDir, "package.json"), "{}"))).toBe(BLOCK);
    const picomatch = dirname(createRequire(join(hooksDir, "package.json")).resolve("picomatch/package.json"));
    expect(await invoke(write(join(picomatch, "index.js"), ""))).toBe(BLOCK);
  });
});

describe("round 4, Medium-High: literal-path shell writes", () => {
  it("follows cd -, pushd and popd", async () => {
    const root = await repo();
    expect(await invoke(bash("cd .capmap; cd /; cd -; cp ../forged.json gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("pushd .capmap; pushd /; popd; cp ../forged.json gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("(cd .capmap); cp f gate-foo.json", join(root, ".capmap")))).toBe(BLOCK);
  });

  it("blocks when the directory cannot be told", async () => {
    const root = await repo();
    expect(await invoke(bash("cd -; cp f gate-foo.json", root))).toBe(BLOCK);
  });

  it("does not take node, npx or a local script as a transparent wrapper or as capmap", async () => {
    const root = await repo();
    expect(await invoke(bash("node cat forged.json .capmap/gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("./capmap forged.json .capmap/gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("PATH=.:$PATH capmap forged.json .capmap/gate-foo.json", root))).toBe(BLOCK);
    expect(await invoke(bash("capmap gate .capmap/gate-foo.json", root))).toBe(BLOCK);
  });

  it("expands globs and braces against the file system", async () => {
    const root = await repo();
    expect(await invoke(bash("cp x .capm?p/", root))).toBe(BLOCK);
    expect(await invoke(bash("cp x .cap{map,x}/", root))).toBe(BLOCK);
    expect(await invoke(bash("cp x pla*/foo-plan.md", root))).toBe(BLOCK);
  });

  it("sees sed's write commands and git's configuration and patches", async () => {
    const root = await repo();
    expect(await invoke(bash("sed -n '1w plans/foo-plan.md' specs/foo.md", root))).toBe(BLOCK);
    expect(await invoke(bash("sed 's/a/b/w plans/foo-plan.md' specs/foo.md", root))).toBe(BLOCK);
    expect(await invoke(bash("git -c core.fsmonitor='cp f .capmap/gate-foo.json' status", root))).toBe(BLOCK);
    expect(await invoke(bash(`git -c diff.external='sh -c "cp f .capmap/gate-foo.json"' diff --ext-diff`, root))).toBe(BLOCK);
    await writeFile(join(root, "p.diff"),
      "diff --git a/.capmap/gate-foo.json b/.capmap/gate-foo.json\nnew file mode 100644\n" +
      "--- /dev/null\n+++ b/.capmap/gate-foo.json\n@@ -0,0 +1 @@\n+{}\n");
    expect(await invoke(bash("git apply p.diff", root))).toBe(BLOCK);
    expect(await invoke(bash("patch -p1 < p.diff", root))).toBe(BLOCK);
    expect(await invoke(bash("cat p.diff | git apply", root))).toBe(BLOCK);
  });
});

describe("round 4, Medium: --resolve and the gate's configuration from the shell", () => {
  it("blocks --resolve spelled with ANSI-C quoting under env and script", async () => {
    const root = await repo();
    const command = "env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID script -q /dev/null capmap gate specs/foo.md --re$'s'olve";
    expect(await invoke(bash(command, root))).toBe(BLOCK);
  });

  it("blocks capmap run with another configuration directory", async () => {
    const root = await repo();
    expect(await invoke(bash("CAPMAP_CONFIG_DIR=/tmp/fake capmap gate specs/foo.md", root))).toBe(BLOCK);
    expect(await invoke(bash("export CAPMAP_CONFIG_DIR=/tmp/fake; capmap gate specs/foo.md", root))).toBe(BLOCK);
    expect(await invoke(bash("env CAPMAP_CONFIG_DIR=/tmp/fake capmap gate specs/foo.md", root))).toBe(BLOCK);
    expect(await invoke(bash(`CAPMAP_CONFIG_DIR=${CONFIG_DIR} capmap gate specs/foo.md`, root))).toBe(ALLOW);
  });

  it("blocks a plan whose record was scored against another index", async () => {
    const root = await repo();
    await putRecord(root, { ...genuineRecord(root), indexGeneratedAt: "2020-01-01T00:00:00.000Z" });
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });
});

describe("round 4, Medium: plan files the gate cannot satisfy", () => {
  it("leaves Claude Code's own plan-mode files alone", async () => {
    const home = await mkdtemp(join(tmpdir(), "capmap-home-"));
    expect(await invoke(write(join(home, ".claude", "plans", "quiet-sleeping-fox.md"), "# Plan\n"))).toBe(ALLOW);
  });

  it("gates spec-kit's plan.md and tasks.md through the spec.md beside them", async () => {
    const root = await repo();
    const dir = join(root, "specs", "001-foo");
    await mkdir(dir);
    expect(await invoke(write(join(dir, "spec.md"), SPEC_TEXT))).toBe(ALLOW);
    await writeFile(join(dir, "spec.md"), SPEC_TEXT);
    expect(await invoke(write(join(dir, "plan.md"), "# Plan\n"))).toBe(BLOCK);
    await putRecord(root, genuineRecord(root, SPEC_TEXT, { spec: join(dir, "spec.md"), feature: "001-foo" }), "001-foo");
    expect(await invoke(write(join(dir, "plan.md"), "# Plan\n"))).toBe(ALLOW);
    expect(await invoke(write(join(dir, "tasks.md"), "# Tasks\n"))).toBe(ALLOW);
  });
});

describe("round 4, Low: wrongful blocks", () => {
  it("allows prose, directory changes and messages that only mention guarded words", async () => {
    const root = await repo();
    for (const command of [
      'gh pr create --body "updates plans and specs"',
      "pushd plans >/dev/null && ls && popd >/dev/null",
      'git commit -m "capmap gate --resolve fix"',
      "grep -n -- --resolve packages/capmap-cli/src/commands/gate.ts",
    ]) {
      expect(await invoke(bash(command, root)), command).toBe(ALLOW);
    }
  });

  it("rebuilds a multi-line LF edit of a CRLF specification", async () => {
    const root = await repo();
    const crlf = "# Spec\r\n\r\nfirst line\r\nsecond line\r\n\r\n## Components\r\n\r\n- billing\r\n";
    await writeFile(join(root, "specs", "foo.md"), crlf);
    await putRecord(root, genuineRecord(root, crlf));
    const edit = { file_path: join(root, "specs", "foo.md"), old_string: "first line\nsecond line", new_string: "one line" };
    expect(await invoke({ tool_name: "Edit", tool_input: edit })).toBe(ALLOW);
  });

  it("counts table rows under the verdicts that are not verdicts of declared components", async () => {
    const root = await repo();
    await putRecord(root, genuineRecord(root));
    const plan = write(join(root, "plans", "foo-plan.md"));
    for (const row of ["| NEW SCOPE: also build a payments ledger |", "| payments ledger | BUILD | — |"]) {
      await writeFile(join(root, "specs", "foo.md"), `${SPEC_TEXT}\n## Reuse Verdicts\n\n| billing | REUSE |\n${row}\n`);
      expect(await invoke(plan), row).toBe(BLOCK);
    }
    await writeFile(join(root, "specs", "foo.md"),
      `${SPEC_TEXT}\n## Reuse Verdicts\n\n| component | verdict |\n| --- | --- |\n| billing | REUSE |\n`);
    expect(await invoke(plan)).toBe(ALLOW);
  });
});
