import { describe, it, expect } from "vitest";
import { bashAnalysis, bashTargets } from "../src/bash-targets.js";

/** In-process cases for the shell lexer; the end-to-end suite drives the binary. */

const CWD = "/r";
const HOME = "/h";
const CTX = { cwd: CWD, home: HOME, cdpath: false, maxWords: 4096, maxPaths: 10000, configDirs: ["/cfg"] };
const targets = (command: string): string[] => bashTargets(command, CTX).sort();
const runsOperatorCommand = (command: string): boolean => bashAnalysis(command, CTX).operator;

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
    // Backquotes nest differently from $( ): refused, not read.
    expect(() => targets("ls `tee p.md`")).toThrow(/backquotes/);
    expect(targets(`cat "x$(touch q)y" <(touch s) >(touch t)`)).toEqual(["/r/q", "/r/s", "/r/t"]);
    expect(targets("(cd /tmp; touch u)")).toEqual(["/r/u", "/tmp/u"]);
    expect(targets(`bash -c "echo > v"`)).toEqual(["/r/v"]);
  });

  it("skips heredoc bodies, except substitutions in an expanding one", () => {
    expect(targets("cat > n.md <<'EOF'\nplans/a.md\nEOF\necho ok")).toEqual(["/r/n.md"]);
    expect(targets("cat <<-EOF\n\tplans/a.md $(touch w)\n\tEOF")).toEqual(["/r/w"]);
    expect(() => targets("cat <<-EOF\n\t`touch y`\n\tEOF")).toThrow(/backquotes/);
    expect(targets("cat <<EOF\nunterminated")).toEqual([]);
  });

  it("checks every directory a cd or pushd may leave the command in, and ~", () => {
    expect(targets("cd docs && echo > a; pushd ~/x; echo > b; cd; echo > ~/c")).toEqual([
      "/h/c", "/h/x/b", "/r/a", "/r/b", "/r/docs/a", "/r/docs/b",
    ]);
    expect(targets("cd docs >/dev/null; builtin cd x; echo > a")).toEqual(["/r/a", "/r/docs/a", "/r/docs/x/a", "/r/x/a"]);
    expect(targets("sh -c 'cd s && echo > a'")).toEqual(["/r/a", "/r/s/a"]);
    expect(targets("git -C s checkout -- a.md")).toContain("/r/s/a.md");
  });

  it("refuses a relative write after a cd known only at run time", () => {
    for (const command of ['cd "$D"; echo > a', "cd -; echo > a", "popd; echo > a", "cd ~u; echo > a", "cd s*; echo > a"]) {
      expect(() => targets(command), command).toThrow(/run time/);
    }
    expect(() => bashTargets("cd s; echo > a", { ...CTX, cdpath: true })).toThrow();
    expect(targets('cd "$D"; echo > /abs; cat a')).toEqual(["/abs"]);
  });

  it("knows readers, destination writers and writers of every argument", () => {
    expect(targets("cat specs/a.md | grep x specs/b.md # > c")).toEqual([]);
    expect(targets("git -C . log -- plans/a.md && git commit -m 'plans/b'")).toEqual([]);
    expect(targets("git log --output=o.md")).toEqual(["/r/log", "/r/o.md"]);
    expect(targets("git grep -Ox")).toEqual(["/r/grep", "/r/x"]);
    expect(targets("rg --pre w x")).toEqual(["/r/w", "/r/x"]);
    expect(targets("git fetch --upload-pack='cp a b' .")).toContain("/r/b");
    expect(targets("git -c x=y status a")).toContain("/r/a");
    expect(targets("cp -r a b/ d")).toEqual(["/r/d", "/r/d/a", "/r/d/b"]);
    expect(targets("install -t dir a && cp --target-directory=e f")).toEqual([
      "/r/dir", "/r/dir/a", "/r/e", "/r/e/f",
    ]);
    expect(targets("mv a b")).toEqual(["/r/a", "/r/b", "/r/b/a"]);
    expect(targets("cp")).toEqual([]);
    expect(targets("sed -n p s.md; find . -name x")).toEqual([]);
    expect(targets("sed -i '' s/a/b/ s.md")).toEqual(["/r/s.md", "/r/s/a/b"]);
    for (const script of ["s/a/b/w out", "1w out", "s/a/b/gw out", "$e", "s|a|b|e"]) {
      expect(targets(`sed -n '${script}' s.md`), script).toContain("/r/s.md");
    }
    expect(targets("sed -n 's/hello/world/p;/^## Components/,/^## /p' s.md")).toEqual([]);
    expect(targets("find . -delete")).toContain("/r");
    expect(targets("if true; then FOO=1 env -i node x.js; fi")).toContain("/r/x.js");
    expect(targets("capmap gate specs/a.md")).toEqual([]);
  });
});

describe("bashTargets, audit round 5", () => {
  it("reads a heredoc delimiter with the shell's quoting", () => {
    expect(targets("cat <<E\\;F\nE\ntouch a\nE;F\ntouch b")).toEqual(["/r/b"]);
    expect(targets("cat <<'E F'\nE\nE F\ntouch b")).toEqual(["/r/b"]);
    expect(targets("cat <<E\n\tE\ntouch a\nE")).toEqual([]);
    expect(() => targets("cat <<$(x)\nbody")).toThrow(/delimiter/);
  });

  it("expands braces outside quotes, and refuses an expansion past the word limit", () => {
    expect(targets("touch p{lans,x}/a .c{a..b}")).toEqual(["/r/.ca", "/r/.cb", "/r/plans/a", "/r/px/a"]);
    expect(targets("cp a '{b,c}' && cp a \\{b,c} && cp a '${x}'")).toEqual(["/r/${x}", "/r/${x}/a", "/r/{b,c}", "/r/{b,c}/a"]);
    expect(() => targets("cp a ${x}")).toThrow(/computed at run time/);
    expect(targets("cp a {b,c}")).toEqual(["/r/c", "/r/c/a", "/r/c/b"]);
    expect(targets("echo > {01..03}.md")).toEqual(["/r/01.md", "/r/02.md", "/r/03.md"]);
    expect(() => bashTargets("echo {1..5000}", CTX)).toThrow();
  });

  it("takes attached option values as paths", () => {
    expect(targets("sort -o.capmap/g x")).toContain("/r/.capmap/g");
    expect(targets("cp -t.capmap x")).toContain("/r/.capmap/x");
  });

  it("trusts a name only when it surely names the program", () => {
    expect(targets("cat a")).toEqual([]);
    expect(targets("env -u cat cp a b")).toContain("/r/b");
    expect(targets("./cat a")).toEqual(["/r/a"]);
    expect(targets("npx cat a")).toEqual(["/r/a"]);
    expect(() => targets("cat() { :; }; cat a")).toThrow(/function definition/);
    expect(targets("PATH=x cat a")).toContain("/r/a");
    expect(targets("GIT_PAGER='cp a b' git log")).toContain("/r/b");
    expect(targets("eval 'cd s'; echo > a")).toEqual(["/r/a", "/r/s/a"]);
  });
});

describe("runsOperatorCommand", () => {
  it("finds capmap gate --resolve however it is quoted or run", () => {
    expect(runsOperatorCommand(`script -q /dev/null capmap gate s.md --res''olve`)).toBe(true);
    expect(runsOperatorCommand("sh -c 'node packages/capmap-cli/dist/bin.js gate s --resolve'")).toBe(true);
    expect(runsOperatorCommand("env -u CLAUDECODE script -q /dev/null ./cm gate s.md --re$'s'olve")).toBe(true);
    expect(runsOperatorCommand(`node -e 'spawnSync("capmap", ["gate", "s", "--resolve"])'`)).toBe(true);
    expect(runsOperatorCommand("capmap gate s.md")).toBe(false);
  });

  it("does not find it in a message or a search for it", () => {
    expect(runsOperatorCommand('git commit -m "capmap gate --resolve fix"')).toBe(false);
    expect(runsOperatorCommand("grep -n -- --resolve packages/capmap-cli/src/commands/gate.ts")).toBe(false);
  });
});

describe("bashTargets, audit round 6", () => {
  it("refuses a case pattern or zsh syntax that may end a substitution early", () => {
    expect(() => targets("echo $(case x in x) cp a .capmap/g;; esac)")).toThrow(/"case" statement/);
    expect(() => targets("ls *(e:'cp a .capmap/g':)")).toThrow(/glob qualifier/);
    expect(() => targets("echo ${(e):-'$(cp a .capmap/g)'}")).toThrow(/expansion with an operator/);
  });

  it("reads what a shell or an interpreter takes on its input as a script", () => {
    // Piped into a shell, the script is another program's output: refused.
    expect(() => targets("echo 'cp a b' | sh")).toThrow(/piped into it/);
    expect(() => targets("cat <<'E' | bash\ncp a b\nE")).toThrow(/piped into it/);
    expect(targets("bash <<< 'cp a b'")).toContain("/r/b");
    expect(targets("sh <<'E'\ncp a b\nE")).toContain("/r/b");
    expect(targets("node - <<'E'\nfs.writeFileSync('p/x.md')\nE")).toContain("/r/p/x.md");
    expect(() => targets("find plans | xargs rm")).toThrow(/piped into it/);
    expect(() => targets("find plans -name '*.md' | xargs grep -n Spec")).not.toThrow();
  });

  it("leaves data a reader takes, and prose, alone", () => {
    expect(targets("echo 'cp a b' | grep cp; cat <<'E' > n.md\ncp a b\nE")).toEqual(["/r/n.md"]);
    expect(targets('gh pr create --body "updates plans and specs"')).not.toContain("/r/plans");
    expect(targets("ls specs | xargs -n1 wc -l")).not.toContain("/r/specs");
  });

  it("refuses capmap pointed at another configuration", () => {
    expect(() => targets("CAPMAP_CONFIG_DIR=/tmp/x capmap gate s.md")).toThrow(/another configuration/);
    expect(() => targets("export CAPMAP_CONFIG_DIR=/tmp/x; capmap gate s.md")).toThrow(/another configuration/);
    expect(targets("CAPMAP_CONFIG_DIR=/cfg capmap gate s.md")).toEqual([]);
  });
});
