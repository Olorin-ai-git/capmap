import { isAbsolute, resolve } from "node:path";
import type { Program } from "./shell-programs.js";

/**
 * The directories a command may be in when it reaches each of its commands.
 *
 * A `cd` or `pushd` adds its target and keeps the directory it left, because it
 * may fail, run in a subshell or a pipeline; one whose target is known only at
 * run time (`cd "$D"`, `cd -`, `popd`) makes any later relative path
 * undecidable, and the hook refuses it rather than guess.
 */

export interface Dirs {
  known: Set<string>;
  /** A `cd` went somewhere known only at run time. */
  unknown: boolean;
}

export interface Places {
  home: string;
  /** CDPATH is set, so a relative `cd` may go anywhere. */
  cdpath: boolean;
}

const HOME = "~";
const HOME_PREFIX = "~/";
/** Options naming the directory a program works in: `git -C`, `make -C`, `env --chdir`. */
const CHDIR_OPTION = /^(-C|-D|--chdir|--directory|--dir|--cwd|--prefix|--work-tree)(=|$)/;
const ATTACHED_CHDIR = /^-C(.+)$/s;
/** A directory the shell works out only at run time. */
const DYNAMIC = /[$`*?[]|^~[^/]/;
/** Relative paths CDPATH does not apply to. */
const EXPLICITLY_RELATIVE = /^\.\.?(\/|$)/;
const PUSHD_ROTATION = /^[+-]\d+$/;

export const union = (dirs: Dirs, paths: string[]): Dirs => ({
  known: new Set([...dirs.known, ...[...dirs.known].flatMap((dir) => paths.map((path) => resolve(dir, path)))]),
  unknown: dirs.unknown,
});
export const unknown = (dirs: Dirs): Dirs => ({ known: dirs.known, unknown: true });

const isHome = (target: string): boolean => target === HOME || target.startsWith(HOME_PREFIX);

/** Every absolute path a word may name; throws for a relative one after a run-time cd. */
export function absolutes(target: string, dirs: Dirs, home: string): string[] {
  if (isHome(target)) return [resolve(home, target.slice(HOME_PREFIX.length))];
  if (isAbsolute(target)) return [resolve(target)];
  if (dirs.unknown) {
    throw new Error(
      `"${target}" is relative to a directory a cd entered at run time; ` +
        `use an absolute path, or run the cd as a command of its own`,
    );
  }
  return [...dirs.known].map((dir) => resolve(dir, target));
}

/** Where a `cd`, `pushd` or `popd` may leave the command. */
export function changeDir(prog: Program, dirs: Dirs, places: Places): Dirs {
  const target = prog.args.find((arg) => arg === "-" || !arg.startsWith("-"));
  if (!prog.trusted || prog.program === "popd" || target === "-") return unknown(dirs);
  if (prog.program === "pushd" && (target === undefined || PUSHD_ROTATION.test(target))) return unknown(dirs);
  if (target === undefined) return union(dirs, [places.home]);
  if (DYNAMIC.test(target)) return unknown(dirs);
  if (places.cdpath && !isAbsolute(target) && !EXPLICITLY_RELATIVE.test(target)) return unknown(dirs);
  return union(dirs, [isHome(target) ? resolve(places.home, target.slice(HOME_PREFIX.length)) : target]);
}

/** The directories an unknown program may work in: its own, and any it is told to change to. */
export function chdirs(args: string[], dirs: Dirs): Dirs {
  const named = args.flatMap((arg, k) => {
    const option = CHDIR_OPTION.exec(arg);
    if (option !== null) return [option[2] === "=" ? arg.slice(arg.indexOf("=") + 1) : args[k + 1] ?? ""];
    return ATTACHED_CHDIR.exec(arg)?.slice(1, 2) ?? [];
  });
  const fixed = named.filter((dir) => !DYNAMIC.test(dir));
  const moved = union(dirs, fixed);
  return fixed.length < named.length ? unknown(moved) : moved;
}
