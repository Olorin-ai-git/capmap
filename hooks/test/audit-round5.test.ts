import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentsHash, specContentHash } from "../src/components-hash.js";

/**
 * Audit round 5: shell commands the lexer read differently from the shell. Each
 * case was reproduced against c7a1889 with the write really landing under bash;
 * the record is UNRESOLVED, so a forged BUILD record or an ungated plan is a bypass.
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOOK = join(here, "..", "dist", "gate-hook.js");
const CONFIG_DIR = join(here, "..", "..", "config");
const BLOCK = 2;
const ALLOW = 0;
/** Longer than the configured hook deadline, so a hang shows as a kill, not a pass. */
const HANG_KILL_MS = 15_000;
const SPEC_TEXT = "# Spec\n\n## Components\n\n- billing\n";
const scratch: string[] = [];

type Payload = Record<string, unknown>;

function invoke(payload: Payload): Promise<number | null> {
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      [HOOK],
      {
        env: { ...process.env, CAPMAP_GATE: "", CAPMAP_CONFIG_DIR: CONFIG_DIR },
        timeout: HANG_KILL_MS,
      },
      (error) => done(error === null ? ALLOW : ((error as { code?: number | null }).code ?? null)),
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

const bash = (command: string, cwd: string): Payload => ({ tool_name: "Bash", cwd, tool_input: { command } });
const plan = (root: string): Payload => ({
  tool_name: "Write",
  tool_input: { file_path: join(root, "plans", "foo-plan.md"), content: "# plan\n" },
});

function record(root: string, verdict: string): string {
  return JSON.stringify({
    schemaVersion: 2,
    specPath: join(root, "specs", "foo.md"),
    feature: "foo",
    componentsHash: componentsHash(["billing"]),
    specContentHash: specContentHash(SPEC_TEXT),
    componentsSource: "document",
    generatedAt: "2026-10-07T00:00:00.000Z",
    indexGeneratedAt: "2026-10-07T00:00:00.000Z",
    staleRepos: [],
    components: [
      {
        name: "billing", verdict, score: 0.1, target: null, bestCandidate: null, verifiedSha: null,
        failedChecks: verdict === "UNRESOLVED" ? ["matcher-unavailable"] : [], rationale: "r",
      },
    ],
  });
}

/** A repository whose spec is gated UNRESOLVED, with a forged BUILD record and a plan staged beside it. */
async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capmap-r5-"));
  scratch.push(root);
  for (const dir of [".git", "specs", "plans", ".capmap", "stage", "docs"]) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, "specs", "foo.md"), SPEC_TEXT);
  await writeFile(join(root, ".capmap", "gate-foo.json"), record(root, "UNRESOLVED"));
  await writeFile(join(root, "forged.json"), record(root, "BUILD"));
  await writeFile(join(root, "stage", "foo-plan.md"), "# plan\n");
  return root;
}

async function expectAll(commands: string[], expected: number): Promise<void> {
  const root = await repo();
  expect(await invoke(plan(root)), "control: the plan is blocked").toBe(BLOCK);
  for (const command of commands) {
    expect(await invoke(bash(command, root)), command).toBe(expected);
  }
}

beforeAll(async () => {
  await access(HOOK);
});

afterAll(async () => {
  await Promise.all(scratch.map((path) => rm(path, { recursive: true, force: true })));
});

describe("audit round 5: heredoc delimiters are read as the shell reads them", () => {
  it("does not take a command after a quoted or escaped delimiter for heredoc body", async () => {
    await expectAll(
      [
        "cat <<E\\;F\nE;F\ncp forged.json .capmap/gate-foo.json\nE\n",
        'cat <<"E F"\nE F\ncp forged.json .capmap/gate-foo.json\nE\n',
        "cat <<E'|'F\nE|F\ncp forged.json .capmap/gate-foo.json\nE\n",
        "cat <<E\n\tE\nE\ncp forged.json .capmap/gate-foo.json\n",
      ],
      BLOCK,
    );
  });

  it("still skips the body of an ordinary heredoc", async () => {
    await expectAll(["cat > notes.md <<'EOF'\ncp forged.json .capmap/gate-foo.json\nEOF"], ALLOW);
  });
});

describe("audit round 5: a command's name decides nothing unless it is the program", () => {
  it("sees through wrapper options, interpreters and path-qualified names", async () => {
    await expectAll(
      [
        "env -u cat cp forged.json .capmap/gate-foo.json",
        "exec -a cat cp forged.json .capmap/gate-foo.json",
        `node --eval='require("fs").copyFileSync("forged.json",".capmap/gate-foo.json")'`,
        `node -e 'require("fs").copyFileSync("forged.json",".capmap/gate-foo.json") //cat'`,
        "node cat forged.json .capmap/gate-foo.json",
        "./stage/cat forged.json .capmap/gate-foo.json",
        "npx cat forged.json .capmap/gate-foo.json",
      ],
      BLOCK,
    );
  });

  it("trusts no name once the command defines a function or changes how names resolve", async () => {
    await expectAll(
      [
        'cat() { command cp "$@"; }; cat forged.json .capmap/gate-foo.json',
        'function cat { command cp "$@"; }; cat forged.json .capmap/gate-foo.json',
        "PATH=./stage:$PATH cat forged.json .capmap/gate-foo.json",
        "export PATH=./stage:$PATH; cat forged.json .capmap/gate-foo.json",
        "GIT_EXTERNAL_DIFF='cp forged.json .capmap/gate-foo.json' git diff",
      ],
      BLOCK,
    );
  });

  it("still lets plain reads and the gate through", async () => {
    await expectAll(
      [
        "cat specs/foo.md",
        "command cat specs/foo.md",
        "npx capmap gate specs/foo.md",
        "npx vitest run test/specs/x.test.ts",
      ],
      ALLOW,
    );
  });
});

describe("audit round 5: option values attached to the option are paths too", () => {
  it("blocks writes named inside -oFILE and -tDIR", async () => {
    await expectAll(
      [
        "sort -o.capmap/gate-foo.json forged.json",
        "sort -oplans/foo-plan.md stage/foo-plan.md",
        "curl -s -o.capmap/gate-foo.json file://$PWD/forged.json",
        "cp -t.capmap forged.json",
        "mv -vt.capmap forged.json",
      ],
      BLOCK,
    );
  });
});

describe("audit round 5: brace expansion is performed before matching", () => {
  it("blocks paths that only exist after expansion", async () => {
    await expectAll(
      [
        "tee .c{apmap,apmap}/gate-foo.json < forged.json > /dev/null",
        "tee p{lans,lans}/foo-plan.md < /dev/null",
        "cp stage/foo-plan.md p{lans,lans}/",
        "cp forged.json .c{a..a}pmap/gate-foo.json",
        "tee .{x,c{apmap,y}}/gate-foo.json < forged.json",
      ],
      BLOCK,
    );
  });

  it("leaves quoted braces and parameter expansions alone", async () => {
    await expectAll(
      ["cp stage/foo-plan.md '{plans,x}'", "cp stage/foo-plan.md p\\{lans,x}", "echo ${HOME} > /dev/null"],
      ALLOW,
    );
  });
});

describe("audit round 5: every directory a command may be in is checked", () => {
  it("follows cd and pushd that carry a redirect, builtin cd, and cd that may fail", async () => {
    await expectAll(
      [
        "cd docs >/dev/null && cat ../stage/foo-plan.md > foo-plan.md",
        "cd specs >/dev/null && printf x > foo.md",
        "pushd specs >/dev/null; printf x > foo.md",
        "builtin cd specs; printf x > foo.md",
        "cd plans 2>/dev/null; cp ../stage/foo-plan.md .",
        "cd /nonexistent-capmap-dir; printf x > specs/foo.md",
        "sh -c 'cd specs && printf x > foo.md'",
        "eval 'cd specs'; printf x > foo.md",
        "git -C specs checkout -- foo.md",
      ],
      BLOCK,
    );
  });

  it("does not let a cd inside a subshell or substitution hide the outer directory", async () => {
    await expectAll(
      [
        "(cd /tmp); printf x > specs/foo.md",
        "x=$(cd /tmp && pwd); printf x > specs/foo.md",
        "cd /tmp | true; printf x > specs/foo.md",
      ],
      BLOCK,
    );
  });

  it("guards the gate's configuration after a subshell cd", async () => {
    const checkout = join(here, "..", "..");
    for (const command of ["(cd /tmp); printf x > config/scan.config.json", "x=$(cd /tmp); printf x > config/x"]) {
      expect(await invoke(bash(command, checkout)), command).toBe(BLOCK);
    }
  });

  it("blocks a relative write once the directory cannot be known", async () => {
    await expectAll(
      [
        'cd "$(git rev-parse --show-toplevel)/specs" && printf x > foo.md',
        "cd -; printf x > foo.md",
        "popd; printf x > foo.md",
        "CDPATH=. cd specs; printf x > foo.md",
      ],
      BLOCK,
    );
  });

  it("still allows reads and absolute writes after a cd", async () => {
    await expectAll(
      [
        "cd specs && cat foo.md",
        "pushd plans >/dev/null && ls && popd >/dev/null",
        "cd \"$(git rev-parse --show-toplevel)\" && cat specs/foo.md > /dev/null",
        "cd /tmp && npx vitest run",
      ],
      ALLOW,
    );
  });
});

describe("audit round 5: git options that run commands make git a writer", () => {
  it("blocks --upload-pack, --receive-pack, --exec and -c", async () => {
    await expectAll(
      [
        "git fetch --upload-pack='cp forged.json .capmap/gate-foo.json; false' .",
        "git push --receive-pack='cp forged.json .capmap/gate-foo.json' .",
        "git push --exec='cp forged.json .capmap/gate-foo.json' .",
        "git -c core.fsmonitor='cp forged.json .capmap/gate-foo.json; false' status",
      ],
      BLOCK,
    );
  });

  it("still allows read-only git", async () => {
    await expectAll(["git -C . log --oneline -- plans/foo-plan.md", "git --no-pager diff specs/foo.md"], ALLOW);
  });
});

describe("audit round 5: the hook decides when a file it reads is not a regular file", () => {
  it("blocks a plan whose specification is a FIFO instead of hanging", async () => {
    const root = await repo();
    await rm(join(root, "specs", "foo.md"));
    execFileSync("mkfifo", [join(root, "specs", "foo.md")]);
    await writeFile(join(root, ".capmap", "gate-foo.json"), record(root, "BUILD"));
    expect(await invoke(plan(root))).toBe(BLOCK);
  }, HANG_KILL_MS * 2);
});
