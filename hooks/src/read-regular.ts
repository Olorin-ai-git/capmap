import { constants } from "node:fs";
import { open } from "node:fs/promises";

/**
 * Reads a regular file, refusing anything else. Opening a FIFO for reading
 * waits for a writer that never comes, so a specification replaced by one
 * hung the hook until Claude Code's timeout — which lets the write through.
 * The open does not block, and the type is checked on the opened file, so
 * nothing can be swapped in between.
 */
export async function readRegularFile(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`${path} is not a regular file`);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
