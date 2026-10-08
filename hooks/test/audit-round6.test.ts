import { describe, it, expect, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ALLOW, BLOCK, SPEC_TEXT, bash, cleanUp, genuineRecord, invoke, putRecord, repo, write } from "./hook-harness.js";

/**
 * Audit round 6: the lexer's reading of a command differed from the shell's —
 * bash's or zsh's, which Claude Code runs on macOS — so text the shell runs was
 * taken for data. Each case was reproduced against the round-5 tree with the
 * write really landing under /bin/zsh (and /bin/bash where noted); the record is
 * UNRESOLVED, so a forged BUILD record or an ungated plan is a bypass.
 */

afterAll(cleanUp);

async function gated(): Promise<string> {
  const root = await repo();
  await putRecord(root, genuineRecord(root, SPEC_TEXT, { verdict: "UNRESOLVED" }));
  await mkdir(join(root, "stage"));
  await writeFile(join(root, "stage", "foo-plan.md"), "# Plan\n\nSpec: specs/foo.md\n");
  await writeFile(join(root, "forged.json"), JSON.stringify(genuineRecord(root)));
  return root;
}

async function expectAll(commands: string[], expected: number): Promise<void> {
  const root = await gated();
  expect(await invoke(write(join(root, "plans", "foo-plan.md"))), "control").toBe(BLOCK);
  for (const command of commands) expect(await invoke(bash(command, root)), command).toBe(expected);
}

describe("round 6, High: a case pattern's ')' inside a substitution", () => {
  it("does not end the substitution early and hide the pattern's command", async () => {
    await expectAll(
      [
        "echo $(case x in x) cp forged.json .capmap/gate-foo.json;; esac)",
        "echo $(case x in x) cp stage/foo-plan.md plans/foo-plan.md;; esac)",
        "git log $(case x in x) cp forged.json .capmap/gate-foo.json;; esac)",
      ],
      BLOCK,
    );
  });
});

describe("round 6, Medium: zsh and stdin-fed shells", () => {
  it("sees commands carried by zsh glob qualifiers and parameter flags", async () => {
    await expectAll(
      [
        "ls *(e:'cp forged.json .capmap/gate-foo.json':)",
        "echo ${(e):-'$(cp forged.json .capmap/gate-foo.json)'}",
        "cat =(cp forged.json .capmap/gate-foo.json)",
      ],
      BLOCK,
    );
  });

  it("reads text piped, here-documented or here-stringed into a shell as a script", async () => {
    await expectAll(
      [
        "echo 'cp forged.json .capmap/gate-foo.json' | sh",
        "printf 'cp stage/foo-plan.md plans/foo-plan.md' | zsh",
        "cat <<'EOF' | bash\ncp forged.json .capmap/gate-foo.json\nEOF",
        "sh <<'EOF'\ncp forged.json .capmap/gate-foo.json\nEOF",
        "bash <<< 'cp forged.json .capmap/gate-foo.json'",
        "node <<'EOF'\nrequire('fs').copyFileSync('forged.json', '.capmap/gate-foo.json')\nEOF",
      ],
      BLOCK,
    );
  });

  it("still allows reading records and prose that only mentions guarded words", async () => {
    await expectAll(
      [
        "cat .capmap/gate-foo.json",
        'git commit -m "fix(hooks): guard plans and specs (SP-2)"',
        "git commit -m \"$(cat <<'EOF'\nfix(hooks): plans are bound to their spec\nEOF\n)\"",
        "cat > notes.md <<'EOF'\nsee plans/foo-plan.md for the plan\nEOF",
        "git log --oneline | head -5",
      ],
      ALLOW,
    );
  });
});

describe("round 6, High: directory moves and copies carry their files", () => {
  it("blocks moving a directory onto, or away from, guarded files", async () => {
    await expectAll(
      [
        "mv specs specs-tmp",
        "mkdir -p s2/plans && cp stage/foo-plan.md s2/plans/ && cp -R s2/plans .",
        "mkdir -p x/specs && cp stage/foo-plan.md x/specs/foo.md && cp -R x/specs .",
        "mv stage plans",
        "rsync -a stage/ plans/",
        "cp -r stage/. plans",
        "mv sta?e plans",
      ],
      BLOCK,
    );
  });

  it("does not clear a plan through a decoy specification moved into place", async () => {
    const root = await gated();
    await mkdir(join(root, "scratch"));
    const decoyText = "# Decoy\n\n## Components\n\n- banner\n";
    await writeFile(join(root, "scratch", "foo.md"), decoyText);
    // The decoy lands on a specification path whose feature is gated for another file.
    expect(await invoke(bash("mkdir -p decoy && mv scratch decoy/specs", root))).toBe(BLOCK);
    // Gated anyway, it may not replace the real specification's record, and the plan names the real one.
    await putRecord(root, genuineRecord(root, decoyText, {
      spec: join(root, "decoy", "specs", "foo.md"), names: ["banner"], verdict: "BUILD",
    }));
    expect(await invoke(write(join(root, "plans", "foo-plan.md")))).toBe(BLOCK);
  });
});

describe("round 6 sibling: a patch the hook cannot read", () => {
  it("refuses a patch written earlier in the same command, or piped in", async () => {
    const patch = "diff --git a/.capmap/gate-foo.json b/.capmap/gate-foo.json\\nnew file mode 100644\\n" +
      "--- /dev/null\\n+++ b/.capmap/gate-foo.json\\n@@ -0,0 +1 @@\\n+{}\\n";
    await expectAll([`printf '${patch}' > p.txt; git apply p.txt`, `printf '${patch}' | git apply`], BLOCK);
  });
});

