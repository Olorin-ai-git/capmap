import type { PackageEntry } from "@capmap/core";
import { verifyCapability } from "@capmap/core";
import type { CommandDeps } from "../composition.js";
import { renderTable } from "../render/table.js";
import { loadIndexContext } from "./index-context.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const HEADERS = ["id", "result", "failed checks", "detail"];
const RESULT_OK = "ok";
const RESULT_FAILED = "failed";
const EMPTY = "—";
const CHECK_SEPARATOR = ", ";

export interface VerifyOptions {
  ids: string[];
}

/**
 * Check indexed capabilities against live source. Wholly deterministic: it
 * opens the files and compares, so a pass here means the capability really is
 * importable at current HEAD rather than that the index believes it is.
 *
 * With no ids, every indexed package is checked — that is the sweep worth
 * running after a refresh.
 */
export async function runVerify(
  deps: CommandDeps,
  options: VerifyOptions,
): Promise<number> {
  const context = await loadIndexContext(deps);
  const all: PackageEntry[] = context.repos.flatMap((repo) => repo.packages);

  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const missing = options.ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    deps.writer.line(
      `not in the index: ${missing.join(CHECK_SEPARATOR)}; ` +
        `run "capmap search" to find the right id`,
    );
    return EXIT_ERROR;
  }

  const targets =
    options.ids.length === 0
      ? all
      : options.ids.map((id) => byId.get(id) as PackageEntry);

  const rows: string[][] = [];
  let failures = 0;
  for (const entry of targets) {
    const result = await verifyCapability({
      entry,
      rootAbs: deps.config.root,
    });
    if (!result.ok) failures += 1;
    rows.push([
      result.id,
      result.ok ? RESULT_OK : RESULT_FAILED,
      result.failed.length === 0 ? EMPTY : result.failed.join(CHECK_SEPARATOR),
      result.detail ?? EMPTY,
    ]);
  }

  deps.writer.line(renderTable({ headers: HEADERS, rows }));
  deps.writer.line(
    `${String(targets.length - failures)} of ${String(targets.length)} verified`,
  );
  return failures === 0 ? EXIT_OK : EXIT_ERROR;
}
