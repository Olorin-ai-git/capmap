import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, parse, sep } from "node:path";

/**
 * What the file system says a shell word names: the files a glob matches, the
 * files a directory carries when it is moved or copied, and the files a patch
 * changes. `cp x .capm?p/`, `mv scratch decoy/specs` and `git apply p.diff`
 * write guarded files that no word of the command names.
 *
 * ponytail: synchronous and bounded by `limit` entries; a command reaching
 * further is refused rather than walked.
 */

const GLOB_CHAR = /[*?[]/;
const REGEX_SPECIAL = /[.+^${}()|\\/]/g;
/** `+++ b/path`, `--- a/path`, `diff --git a/x b/y`, `rename to x`, `copy to x`. */
const PATCH_PATH = /^(?:(?:\+\+\+|---) (?:[ab]\/)?(\S+)|diff --git a\/(\S+) b\/(\S+)|(?:rename|copy) (?:from|to) (\S+))/gm;
const NULL_DEVICE = "/dev/null";

/** A regular expression for one glob segment, as the shell matches a name. */
function segmentPattern(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string;
    const close = c === "[" ? glob.indexOf("]", i + 2) : -1;
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else if (close !== -1) {
      const body = glob.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\");
      out += `[${body}]`;
      i = close;
    } else out += c.replace(REGEX_SPECIAL, "\\$&");
  }
  return new RegExp(`^${out}$`, "s");
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The path itself and every existing path its glob segments match. */
export function expandGlob(path: string, limit: number): string[] {
  if (!GLOB_CHAR.test(path)) return [path];
  const { root } = parse(path);
  let found = [root];
  for (const segment of path.slice(root.length).split(sep).filter((s) => s !== "")) {
    if (!GLOB_CHAR.test(segment)) {
      found = found.map((dir) => join(dir, segment));
      continue;
    }
    const pattern = segmentPattern(segment);
    found = found.flatMap((dir) => entries(dir).filter((name) => pattern.test(name)).map((name) => join(dir, name)));
    if (found.length > limit) throw new Error(`"${path}" matches over ${String(limit)} paths`);
  }
  return [path, ...found];
}

/** Every path under a directory, relative to it; null when the path is not a directory. */
export function tree(path: string, limit: number): string[] | null {
  try {
    if (!statSync(path).isDirectory()) return null;
  } catch {
    return null;
  }
  const found = readdirSync(path, { recursive: true, encoding: "utf8" });
  if (found.length > limit) {
    throw new Error(`${path} holds over ${String(limit)} entries; the hook cannot check what moving it carries`);
  }
  return found;
}

/** A regular file's text, or null; a FIFO is never waited on. */
export function readRegular(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd, "utf8") : null;
  } finally {
    closeSync(fd);
  }
}

/** The files a patch text changes, each also with its first component stripped (`-p1`). */
export function patchPaths(text: string): string[] {
  const paths = [...text.matchAll(PATCH_PATH)].flatMap((m) => m.slice(1).filter((p) => p !== undefined));
  return paths
    .filter((path) => path !== NULL_DEVICE)
    .flatMap((path) => [path, path.slice(path.indexOf("/") + 1)]);
}
