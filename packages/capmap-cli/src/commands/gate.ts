import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  extractComponentsFromMarkdown,
  resolveGateDir,
  resolveInteractively,
  runGate,
  unresolvedComponents,
  writeGateRecord,
  type GateRecord,
} from "@capmap/core";
import { StdinPrompt } from "../adapters/stdin-prompt.js";
import type { CommandDeps } from "../composition.js";
import { renderVerdictTable } from "../render/verdict-table.js";
import { loadIndexContext, staleWarning } from "./index-context.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_UNRESOLVED = 2;
const COMPONENTS_HEADING = "## Components";

export interface GateOptions {
  specPath: string;
  components: string[];
  /** Walk each unresolved component to a decision instead of only reporting it. */
  resolve: boolean;
}

/**
 * Component precedence, highest first: explicit flags, then a `## Components`
 * section in the document. Model extraction is deliberately absent — a gate
 * that guesses what it is gating produces a record whose hash means nothing,
 * and the operator would have no way to tell a guess from a reading.
 */
async function componentsFor(
  deps: CommandDeps,
  opts: GateOptions,
  specAbs: string,
): Promise<string[] | null> {
  if (opts.components.length > 0) return opts.components;

  let markdown: string;
  try {
    markdown = await readFile(specAbs, "utf8");
  } catch {
    deps.writer.line(`cannot read specification at ${specAbs}`);
    return null;
  }

  const listed = extractComponentsFromMarkdown(markdown);
  if (listed === null) {
    deps.writer.line(
      `${specAbs} has no "${COMPONENTS_HEADING}" section. ` +
        `Add one, or pass --component for each component to gate.`,
    );
    return null;
  }
  if (listed.length === 0) {
    deps.writer.line(
      `the "${COMPONENTS_HEADING}" section of ${specAbs} lists no components`,
    );
    return null;
  }
  return listed;
}

/**
 * Score a draft specification against the index and record the verdicts.
 *
 * Exit code 2 is distinct from 1 so that a shell, CI job or hook can tell "the
 * gate ran and found unresolved components" from "the gate could not run".
 */
export async function runGateCommand(
  deps: CommandDeps,
  opts: GateOptions,
): Promise<number> {
  const specAbs = isAbsolute(opts.specPath)
    ? opts.specPath
    : resolve(process.cwd(), opts.specPath);

  const components = await componentsFor(deps, opts, specAbs);
  if (components === null) return EXIT_ERROR;
  const componentsSource = opts.components.length > 0 ? "flags" : "document";

  let context;
  try {
    context = await loadIndexContext(deps);
  } catch (error) {
    deps.writer.line(
      `${String(error)}\nRun "capmap scan --all" before gating a specification.`,
    );
    return EXIT_ERROR;
  }

  let record: GateRecord = await runGate({
    specPath: specAbs,
    components,
    componentsSource,
    repos: context.repos,
    manifest: context.manifest,
    staleRepos: [...context.drifted].sort(),
    rootAbs: deps.config.root,
    thresholds: deps.config.scan.verdicts,
    matching: deps.config.scan.matching,
    selectMaxTokens: deps.config.scan.matching.selectMaxTokens,
    rankMaxTokens: deps.config.scan.matching.rankMaxTokens,
    model: deps.model,
    clock: deps.clock,
    logger: deps.logger,
    maxRetries: deps.config.scan.enrichment.maxRetries,
  });

  const warning = staleWarning(context);
  if (warning !== null) deps.writer.line(warning);
  deps.writer.line(renderVerdictTable(record));

  if (opts.resolve && unresolvedComponents(record).length > 0) {
    const prompt = new StdinPrompt(deps.writer, process.stdin.isTTY === true);
    try {
      record = await resolveInteractively({
        record,
        repos: context.repos,
        rootAbs: deps.config.root,
        thresholds: deps.config.scan.verdicts,
        prompt,
      });
    } finally {
      prompt.close();
    }
    deps.writer.line(renderVerdictTable(record));
  }

  const gateDir = await resolveGateDir(specAbs);
  const written = await writeGateRecord(gateDir, record);
  deps.writer.line(`gate record written to ${written}`);

  const unresolved = unresolvedComponents(record);
  if (unresolved.length === 0) return EXIT_OK;

  deps.writer.line(
    `${String(unresolved.length)} component(s) unresolved: ` +
      `${unresolved.map((component) => component.name).join(", ")}. ` +
      `Each names the check that failed above; fix the drift or amend the ` +
      `specification, then run this command again.`,
  );
  return EXIT_UNRESOLVED;
}
