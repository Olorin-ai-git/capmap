import { basename, join, resolve } from "node:path";
import { lex, type Command } from "./shell-lex.js";
import {
  ALL_ARGUMENT_WRITERS, DESTINATION_WRITERS, PIECE_BREAK, destinations, pieces, places, positional, programOf,
  readsOnly, type Program,
} from "./shell-programs.js";
import { inputRole, mayBeScript, SHELLS } from "./shell-input.js";
import { absolutes, changeDir, chdirs, unknown, type Dirs } from "./shell-dirs.js";
import { expandGlob, patchPaths, readRegular, tree } from "./shell-fs.js";
import {
  patchFiles, resolves, taintsNames, type BashAnalysis, type ShellContext, type Step,
} from "./shell-traits.js";

export type { ShellContext } from "./shell-traits.js";

/**
 * Paths a Bash command may write, so the gate also covers shell writes.
 *
 * The command is lexed the way the shell reads it (shell-lex.ts). Redirect
 * targets are always writes. Arguments are writes unless a trusted name says
 * the program writes nothing through them, or only its destination (see
 * shell-programs.ts); an unknown program's every argument piece is a write,
 * and every argument that may be a script is read as one too — a guess, so
 * only the paths in it count. A moved or copied directory carries its files,
 * a glob names what it matches, a patch the files it changes, and what a shell
 * reads on its input — piped, a heredoc or a here-string — is a script.
 * Directories follow every `cd` (shell-dirs.ts).
 *
 * ponytail: lexical, not a shell. Paths built at run time (`$DIR/x.md`, a
 * script file, git configuration or hooks that write) are not seen; an
 * OS-level write guard is the upgrade if that matters.
 */

const NULL_DEVICE = "/dev/null";
const EVAL = "eval";
const CHANGE_DIR = new Set(["cd", "pushd", "popd"]);
const CDPATH_ASSIGNMENT = /^CDPATH\+?=/;
const CONFIG_ASSIGNMENT = /^CAPMAP_CONFIG_DIR=(.*)$/s;
const GATE_DIR_SEGMENT = /(^|\/)\.capmap(\/|$)/;

class Walker {
  readonly paths = new Set<string>();
  operator = false;

  constructor(private readonly ctx: ShellContext) {}

  private all(target: string, dirs: Dirs): string[] {
    return absolutes(target, dirs, this.ctx.home).flatMap((path) => expandGlob(path, this.ctx.maxPaths));
  }

  private add(target: string, dirs: Dirs): void {
    if (target === "" || target === NULL_DEVICE) return;
    for (const path of this.all(target, dirs)) this.paths.add(path);
  }

  /** The files a moved or copied directory carries: into each destination and, moved, out of the source. */
  private carried(args: string[], dirs: Dirs, moves: boolean): void {
    const dests = places(args);
    const into = dests.flatMap((dest) => this.all(dest, dirs));
    for (const source of positional(args).filter((arg) => !dests.includes(arg))) {
      for (const src of this.all(source, dirs)) {
        const inside = tree(src, this.ctx.maxPaths) ?? [];
        for (const rel of inside) {
          if (moves) this.paths.add(join(src, rel));
          for (const dest of into) this.paths.add(join(dest, rel)).add(join(dest, basename(src), rel));
        }
      }
    }
  }

  /** The files a patch changes; one the hook cannot read now — absent, or written earlier in the command — is refused. */
  private patches(files: string[], { cmd, dirs, fed }: Step): void {
    if (files.length === 0 && cmd.input.length === 0 && fed) {
      throw new Error("a patch piped into the command cannot be read; save it to a file and apply that file");
    }
    const texts = files.flatMap((file) => {
      const places = this.all(file, dirs);
      const read = places.some((path) => this.paths.has(path)) ? [] : places.map(readRegular);
      const found = read.filter((text): text is string => text !== null);
      if (found.length === 0) throw new Error(`the patch ${file} cannot be read before the command runs; apply a patch file that exists`);
      return found;
    });
    for (const path of [...texts, ...cmd.input].flatMap(patchPaths)) this.add(path, dirs);
  }

  private argumentWrites(prog: Program, step: Step): void {
    const { program, args } = prog;
    const { dirs, taint, guessing } = step;
    if (prog.capmap && prog.assigned.length === 0) {
      return args.filter((arg) => GATE_DIR_SEGMENT.test(arg)).forEach((arg) => this.add(arg, dirs));
    }
    if (prog.trusted && program !== undefined) {
      if (readsOnly(program, args)) return;
      const moves = ALL_ARGUMENT_WRITERS.has(program);
      if (moves || DESTINATION_WRITERS.has(program)) {
        [...(moves ? positional(args) : []), ...destinations(args)].forEach((target) => this.add(target, dirs));
        return this.carried(args, dirs, moves);
      }
      if (SHELLS.has(program)) {
        // `bash -lc 'script'` as well as `sh -c 'script'` and `bash script.sh`.
        for (const arg of positional(args)) this.walk(arg, dirs, taint, guessing);
        return;
      }
    }
    const files = patchFiles(prog, step.cmd);
    if (files !== null) this.patches(files, step);
    const here = chdirs(args, dirs);
    const words = [...prog.assigned, ...args];
    // An assigned value is run, not read (`GIT_PAGER='cp a b' git log`): never prose.
    const assigned = guessing ? pieces(prog.assigned, true) : prog.assigned.flatMap((value) => value.split(PIECE_BREAK));
    for (const piece of [...assigned, ...pieces(args, guessing)]) this.add(piece, here);
    for (const word of [...(prog.trusted ? [] : [program ?? ""]), ...words]) {
      // A word that lexes to itself is no script; walking it again would never end.
      if (mayBeScript(word) && word !== step.script) this.walk(word, here, taint, true);
    }
  }

  /** What the program does with the text it reads: runs it, runs it as other code, or takes it as paths. */
  private consume(prog: Program, texts: string[], dirs: Dirs, taint: boolean, guessing: boolean): void {
    if (texts.length === 0) return;
    const words = [prog.program ?? "", ...prog.args];
    const at = prog.trusted ? 0 : words.findIndex((word) => inputRole(basename(word), []) !== "data");
    if (at === -1) return;
    const role = inputRole(basename(words[at] as string), words.slice(at + 1));
    for (const text of texts) {
      if (role === "script") this.walk(text, dirs, taint, guessing);
      if (role === "code") this.walk(text, dirs, taint, true);
      if (role === "code" || role === "paths") pieces([text], role === "code").forEach((piece) => this.add(piece, dirs));
    }
  }

  private check(cmd: Command, prog: Program): void {
    // A reader's words are data (`git commit -m "…--resolve"`); any other program may run them.
    const reads = prog.trusted && prog.program !== undefined && readsOnly(prog.program, prog.args);
    const tokens = reads ? cmd.words : cmd.words.flatMap((word) => word.split(PIECE_BREAK));
    this.operator ||= resolves(tokens);
    for (const word of cmd.words) {
      const value = CONFIG_ASSIGNMENT.exec(word)?.[1];
      if (value !== undefined && !this.ctx.configDirs.includes(resolve(this.ctx.cwd, value))) {
        throw new Error(`capmap may not be pointed at another configuration (CAPMAP_CONFIG_DIR=${value})`);
      }
    }
  }

  /** Records what the script may write, returning the directories it may end in. */
  walk(script: string, start: Dirs, inherited: boolean, guessing: boolean): Dirs {
    const { commands, unmodelled } = lex(script, this.ctx.maxWords);
    const taint = inherited || unmodelled || taintsNames(script, commands);
    const cdpath = this.ctx.cdpath || commands.some((cmd) => cmd.words.some((w) => CDPATH_ASSIGNMENT.test(w)));
    let dirs = start;
    let upstream: string[] = [];
    for (const cmd of commands) {
      for (const target of cmd.writes) this.add(target, dirs);
      const prog = programOf(cmd.words, taint);
      const name = prog.program ?? "";
      if (!guessing) this.check(cmd, prog);
      // An untrusted name may be a function of that name: its arguments are writes as well.
      if (!prog.trusted || !(CHANGE_DIR.has(name) || name === EVAL)) {
        this.argumentWrites(prog, { script, cmd, dirs, taint, guessing, fed: upstream.length > 0 });
      }
      this.consume(prog, [...upstream, ...cmd.input], dirs, taint, guessing);
      upstream = cmd.piped ? [...upstream, ...cmd.words, ...cmd.input] : [];
      if (CHANGE_DIR.has(name)) dirs = changeDir(prog, dirs, { home: this.ctx.home, cdpath });
      else if (name === EVAL) dirs = this.walk(prog.args.join(" "), dirs, taint, guessing);
      else if (prog.program === undefined && prog.args.some((a) => CHANGE_DIR.has(a) || a === EVAL)) dirs = unknown(dirs);
    }
    return dirs;
  }
}

/** Absolute candidate paths the command could write, and whether it resolves the gate; throws when it cannot tell. */
export function bashAnalysis(command: string, ctx: ShellContext): BashAnalysis {
  const walker = new Walker(ctx);
  walker.walk(command, { known: new Set([ctx.cwd]), unknown: false }, false, false);
  return { paths: [...walker.paths], operator: walker.operator };
}

export const bashTargets = (command: string, ctx: ShellContext): string[] => bashAnalysis(command, ctx).paths;
