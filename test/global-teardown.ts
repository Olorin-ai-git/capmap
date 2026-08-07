import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Remove the temporary trees the suite creates, once it has finished.
 *
 * Roughly ninety `mkdtemp` directories are made per run, across a dozen test
 * files, and nothing removed them. Individually they are a few kilobytes, which
 * is exactly why it went unnoticed until a session of repeated runs had left ten
 * thousand of them behind. Fixing it in one place beats an `afterAll` in every
 * file that someone will forget to add to the next one.
 *
 * Only directories created after this run began are removed, so a concurrent run
 * on the same machine keeps its own.
 */
const PREFIX = "capmap-";

let startedAt = 0;

export function setup(): void {
  startedAt = Date.now();
}

export async function teardown(): Promise<void> {
  const root = tmpdir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((name) => name.startsWith(PREFIX))
      .map(async (name) => {
        const path = join(root, name);
        try {
          const info = await stat(path);
          if (!info.isDirectory() || info.birthtimeMs < startedAt) return;
          await rm(path, { recursive: true, force: true });
        } catch {
          // Raced with something else removing it, or not ours to read.
        }
      }),
  );
}
