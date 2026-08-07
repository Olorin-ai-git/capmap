import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Git } from "@capmap/core";

const run = promisify(execFile);

/** Reads git metadata by shelling out to the `git` binary on PATH. */
export class NodeGit implements Git {
  async headSha(repoAbsPath: string): Promise<string | null> {
    try {
      const { stdout } = await run("git", ["rev-parse", "HEAD"], {
        cwd: repoAbsPath,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async lastCommitIso(
    repoAbsPath: string,
    relPath: string,
  ): Promise<string | null> {
    try {
      const { stdout } = await run(
        "git",
        ["log", "-1", "--format=%cI", "--", relPath],
        { cwd: repoAbsPath },
      );
      const value = stdout.trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }
}
