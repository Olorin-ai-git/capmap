#!/usr/bin/env node
import { Command } from "commander";
import { runRefresh } from "./commands/refresh.js";
import { runGateCommand } from "./commands/gate.js";
import { runScan } from "./commands/scan.js";
import { runSearch } from "./commands/search.js";
import { runShow } from "./commands/show.js";
import { runStatus } from "./commands/status.js";
import { runVerify } from "./commands/verify.js";
import { buildDeps, packageVersion, type CommandDeps } from "./composition.js";

const EXIT_FAILURE = 1;
const PROGRAM_NAME = "capmap";
const PROGRAM_DESCRIPTION =
  "Index every repository in the estate into a capability map.";
const LINE_TERMINATOR = "\n";

/**
 * Run a command against a freshly wired dependency set. Failures before the
 * logger exists have nowhere structured to go, so they are reported on stderr
 * directly; everything afterwards is logged.
 */
async function withDeps(
  run: (deps: CommandDeps) => Promise<number>,
): Promise<void> {
  let deps: CommandDeps;
  try {
    deps = await buildDeps(process.env);
  } catch (error) {
    process.stderr.write(`${String(error)}${LINE_TERMINATOR}`);
    process.exitCode = EXIT_FAILURE;
    return;
  }
  try {
    process.exitCode = await run(deps);
  } catch (error) {
    deps.logger.error("command failed", { error: String(error) });
    process.exitCode = EXIT_FAILURE;
  }
}

const program = new Command();
program
  .name(PROGRAM_NAME)
  .description(PROGRAM_DESCRIPTION)
  .version(packageVersion());

program
  .command("scan")
  .argument("[repos...]", "repository ids to scan; all of them when omitted")
  .description("Rebuild the deterministic layer of the index")
  // --all is what the hook, the skills and every error message tell an operator
  // to run when the index is missing. It was never implemented, so the printed
  // recovery instruction failed with "unknown option". Accepting it explicitly
  // is better than rewording six call sites into something less obvious.
  .option("--all", "scan every configured repository (the default)")
  .option("--dry-run", "score every unit without writing the index")
  .option("--explain", "print the significance breakdown of every unit")
  .option("--no-enrich", "skip model-backed summaries and the domain layer")
  .option("--force", "re-enrich even repositories whose HEAD has not moved")
  .action(async (repos: string[], options: Record<string, unknown>) => {
    await withDeps((deps) =>
      runScan(deps, {
        repoIds:
          repos.length === 0 || options["all"] === true ? null : repos,
        dryRun: options["dryRun"] === true,
        explain: options["explain"] === true,
        enrich: options["enrich"] !== false,
        force: options["force"] === true,
      }),
    );
  });

program
  .command("status")
  .description("Report index coverage and drift against the working tree")
  .action(async () => {
    await withDeps(runStatus);
  });

program
  .command("refresh")
  .argument("[repos...]", "repository ids to refresh; all of them when omitted")
  .description("Rescan and re-enrich repositories that have drifted")
  .option("--stale", "restrict the selection to repositories that drifted")
  .option("--force", "refresh the selection whether or not it drifted")
  .action(async (repos: string[], options: Record<string, unknown>) => {
    await withDeps((deps) =>
      runRefresh(deps, {
        repoIds: repos.length === 0 ? null : repos,
        stale: options["stale"] === true,
        force: options["force"] === true,
      }),
    );
  });

program
  .command("search")
  .argument("<query>", "terms to match against domains, packages and exports")
  .description("Rank indexed capabilities against a query")
  .option("--limit <n>", "maximum hits to print")
  .option("--tier <tier>", "restrict to core, active, archived or external")
  .option("--kind <kind>", "restrict to one package kind")
  .action(async (query: string, options: Record<string, unknown>) => {
    await withDeps((deps) =>
      runSearch(deps, {
        query,
        limit: typeof options["limit"] === "string" ? options["limit"] : null,
        tier: typeof options["tier"] === "string" ? options["tier"] : null,
        kind: typeof options["kind"] === "string" ? options["kind"] : null,
      }),
    );
  });

program
  .command("show")
  .argument("<id>", "domain, package or minor entry id")
  .description("Print one indexed entry in full")
  .action(async (id: string) => {
    await withDeps((deps) => runShow(deps, { id }));
  });

program
  .command("verify")
  .argument("[ids...]", "capability ids to check; every package when omitted")
  .description("Check indexed capabilities against live source")
  .action(async (ids: string[]) => {
    await withDeps((deps) => runVerify(deps, { ids }));
  });

program
  .command("gate")
  .argument("<spec>", "path to the specification to gate")
  .description("Score a specification's components against the estate")
  .option(
    "--component <name>",
    "component to gate; repeatable, overrides the document",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .option("--resolve", "walk each unresolved component to a decision")
  .action(async (spec: string, options: Record<string, unknown>) => {
    await withDeps((deps) =>
      runGateCommand(deps, {
        specPath: spec,
        components: Array.isArray(options["component"])
          ? (options["component"] as string[])
          : [],
        resolve: options["resolve"] === true,
      }),
    );
  });

await program.parseAsync(process.argv);
