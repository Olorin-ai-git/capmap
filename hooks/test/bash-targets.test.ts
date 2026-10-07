import { describe, it, expect } from "vitest";
import { bashTargets, runsOperatorCommand } from "../src/bash-targets.js";

/** In-process cases for the shell lexer; the end-to-end suite drives the binary. */

const CWD = "/r";
const HOME = "/h";
const targets = (command: string): string[] => bashTargets(command, CWD, HOME).sort();

describe("bashTargets", () => {
  it("takes redirect targets as writes, ignoring fd duplication and the null device", () => {
    expect(targets("cat a 2>&1 >out.md 2>/dev/null &>>log <in")).toEqual(["/r/log", "/r/out.md"]);
    expect(targets("echo x >| a >&b <>c 1>&- <&0")).toEqual(["/r/a", "/r/b", "/r/c"]);
    expect(targets("cat <<< plans/x")).toEqual([]);
  });

  it("removes quotes and escapes", () => {
    expect(targets(`cat > pl""ans/f.md`)).toEqual(["/r/plans/f.md"]);
    expect(targets("cat > pl\\ans/f.md")).toEqual(["/r/plans/f.md"]);
    expect(targets(`cat > 'pl'"a\\"n"s`)).toEqual(['/r/pla"ns']);
    expect(targets("cat > a\\\nb")).toEqual(["/r/ab"]);
  });

  it("treats substitutions, subshells and shell scripts as commands", () => {
    expect(targets("cat $(cp a .capmap/g.json)")).toEqual(["/r/.capmap/g.json", "/r/.capmap/g.json/a"]);
    expect(targets("ls `tee p.md`")).toEqual(["/r/p.md", "/r/tee"]);
    expect(targets(`cat "x$(touch q)y" <(touch s) >(touch t)`)).toEqual(["/r/q", "/r/s", "/r/t", "/r/touch"]);
    expect(targets("(cd /tmp; touch u)")).toEqual(["/tmp/touch", "/tmp/u"]);
    expect(targets(`bash -c "echo > v"`)).toEqual(["/r/v"]);
  });

  it("skips heredoc bodies, except substitutions in an expanding one", () => {
    expect(targets("cat > n.md <<'EOF'\nplans/a.md\nEOF\necho ok")).toEqual(["/r/n.md"]);
    expect(targets("cat <<-EOF\n\tplans/a.md $(touch w) `touch y`\n\tEOF")).toEqual([
      "/r/touch", "/r/w", "/r/y",
    ]);
    expect(targets("cat <<EOF\nunterminated")).toEqual([]);
  });

  it("follows cd and pushd, and ~", () => {
    expect(targets("cd docs && echo > a; pushd ~/x; echo > b; cd; echo > c")).toEqual([
      "/h/c", "/h/x/b", "/r/docs/a",
    ]);
  });

  it("knows readers, destination writers and writers of every argument", () => {
    expect(targets("cat specs/a.md | grep x specs/b.md # > c")).toEqual([]);
    expect(targets("git -C . log -- plans/a.md && git commit -m 'plans/b'")).toEqual([]);
    expect(targets("git log --output=o.md")).toEqual(["/r/git", "/r/log", "/r/o.md"]);
    expect(targets("git grep -Ox")).toEqual(["/r/git", "/r/grep"]);
    expect(targets("rg --pre w x")).toEqual(["/r/rg", "/r/w", "/r/x"]);
    expect(targets("cp -r a b/ d")).toEqual(["/r/d", "/r/d/a", "/r/d/b"]);
    expect(targets("install -t dir a && cp --target-directory=e f")).toEqual([
      "/r/dir", "/r/dir/a", "/r/e", "/r/e/f",
    ]);
    expect(targets("mv a b")).toEqual(["/r/a", "/r/b", "/r/b/a"]);
    expect(targets("cp")).toEqual([]);
    expect(targets("sed -n p s.md; find . -name x")).toEqual([]);
    expect(targets("sed -i '' s/a/b/ s.md")).toEqual(["/r/s.md", "/r/s/a/b", "/r/sed"]);
    expect(targets("sed 's/a/b/w out' s.md")).toContain("/r/s.md");
    expect(targets("find . -delete")).toContain("/r/find");
    expect(targets("if true; then FOO=1 env -i node x.js; fi")).toEqual(["/r/x.js"]);
    expect(targets("capmap gate specs/a.md")).toEqual([]);
  });
});

describe("runsOperatorCommand", () => {
  it("finds capmap gate --resolve however it is quoted", () => {
    expect(runsOperatorCommand(`script -q /dev/null capmap gate s.md --res''olve`)).toBe(true);
    expect(runsOperatorCommand("sh -c 'node packages/capmap-cli/dist/bin.js gate s --resolve'")).toBe(true);
    expect(runsOperatorCommand("capmap gate s.md")).toBe(false);
  });
});
