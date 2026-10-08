import { describe, it, expect, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ALLOW, BLOCK, SPEC_TEXT, bash, cleanUp, genuineRecord, invoke, putRecord, repo, write } from "./hook-harness.js";

/**
 * The shell guard fails closed on what it cannot read exactly, rather than
 * enumerating tricks. Two classes:
 *
 * - a value the shell computes at run time (`$X`, `${…}`, `$(…)`, backquotes,
 *   `~+`, zsh's `=cmd`) where it decides what is written or run: a redirect
 *   target, the program, or an argument of anything but a pure reader;
 * - syntax whose reading the lexer does not model (a `case` statement, a
 *   function, backquotes, arithmetic, `${…}` operators, zsh's clobbering
 *   redirects `>!` and `>>|`).
 *
 * The record of specs/foo.md is UNRESOLVED, so a forged record, a written plan
 * or a rewritten gated spec is a bypass. Every BLOCK case below was written
 * under /bin/zsh or /bin/bash by the hook it was red against.
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

describe("fail closed: values computed at run time", () => {
  it("blocks a computed path where a program may write it", async () => {
    await expectAll(
      [
        "cp forged.json $(printf .capmap)/gate-foo.json",
        'cp forged.json "$(printf .capmap)"/gate-foo.json',
        "cp forged.json `printf .capmap`/gate-foo.json",
        "D=.capmap; cp forged.json $D/gate-foo.json",
        "cp forged.json ${D:-.capmap}/gate-foo.json",
        "for d in .capmap; do cp forged.json $d/gate-foo.json; done",
        "tee $(echo plans)/foo-plan.md < stage/foo-plan.md",
        "cp stage/foo-plan.md ~+/plans/foo-plan.md",
        "cp stage/foo-plan.md ~-/plans/foo-plan.md",
        "printf x > ~+/specs/foo.md",
        "read D < name.txt; cp forged.json $=D/gate-foo.json",
        "read D < name.txt; cp forged.json $~D/gate-foo.json",
        "printf '.cap%smap/gate-foo.json' '' | xargs cp forged.json",
      ],
      BLOCK,
    );
  });

  it("blocks a computed redirect target or program", async () => {
    await expectAll(
      [
        "cat forged.json > $(printf .capmap)/gate-foo.json",
        'cat stage/foo-plan.md > "$OUT"',
        "cat stage/foo-plan.md >> ${P}",
        "$CP stage/foo-plan.md plans/foo-plan.md",
        "$(echo cp) stage/foo-plan.md $(echo plans)/foo-plan.md",
      ],
      BLOCK,
    );
  });

  it("blocks a computed name in an environment builtin", async () => {
    await expectAll(["export $(printf CAPMAP_CONFIG_DIR)=/tmp/x; capmap gate specs/foo.md"], BLOCK);
  });
});

describe("fail closed: syntax the lexer does not model", () => {
  it("refuses it outright instead of guessing", async () => {
    await expectAll(
      [
        "echo x >! plans/foo-plan.md",
        "cat stage/foo-plan.md >>| plans/foo-plan.md",
        "case x in x) cp stage/foo-plan.md plans/foo-plan.md;; esac",
        "f() { cp \"$@\"; }; f stage/foo-plan.md plans/foo-plan.md",
        "function f { cp stage/foo-plan.md plans/foo-plan.md; }; f",
        "echo $(( $(cp forged.json .capm\"\"ap/gate-foo.json; echo 1) ))",
        "echo ${x/a/$(cp stage/foo-plan.md plans/foo-plan.md)}",
        "printf '%s' 'cp stage/foo-plan.md pl' 'ans/foo-plan.md' | sh",
        "printf 'cp stage/foo-plan.md pl%sans/foo-plan.md' '' | bash -s",
        "{ echo a } always { cp stage/foo-plan.md plans/foo-plan.md }",
        "{ echo a }; cp stage/foo-plan.md plans/x.md }",
      ],
      BLOCK,
    );
  });
});

describe("fail closed: what still runs", () => {
  it("allows the commands an agent runs every day", async () => {
    await expectAll(
      [
        "git commit -m \"$(cat <<'EOF'\nfix: a thing\n\nIt updates plans and specs.\nEOF\n)\"",
        "gh pr create --title \"x\" --body \"$(cat <<'EOF'\n## Summary\n- see plans/foo-plan.md\nEOF\n)\"",
        'echo "$HOME" && ls "$PWD"',
        'for f in specs/*.md; do wc -l "$f"; done',
        'grep -rn "$PATTERN" specs',
        'cd "$(git rev-parse --show-toplevel)" && git status',
        "X=$(git rev-parse HEAD); echo $X",
        "export PATH=/opt/homebrew/opt/node@22/bin:$PATH; node -v",
        "echo $(date) >> notes.log",
        'if [ -n "$CI" ]; then echo ci; fi',
        '[[ -f "$F" ]] && cat "$F"',
        "pnpm test 2>&1 | tail -5",
        "node -e 'const x = `${1 + 1}`; console.log(x)'",
      ],
      ALLOW,
    );
  });
});
