import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * `relPath` resolved under `baseAbs`, or `null` when it does not exist or its
 * real location — after every symlink — is outside `baseAbs`.
 *
 * Anything a manifest names is read into a prompt that leaves the machine, so
 * a `main` of `../dummy.env`, an absolute path, or a symlinked `src/index.ts`
 * must never let a file outside the repository through.
 */
export async function containedPath(
  baseAbs: string,
  relPath: string,
): Promise<string | null> {
  try {
    const base = await realpath(baseAbs);
    const target = await realpath(join(baseAbs, relPath));
    const rel = relative(base, target);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}
