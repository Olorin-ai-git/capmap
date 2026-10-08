import { readFile, realpath } from "node:fs/promises";
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
import {
  loadIndexContext,
  staleWarning,
  type IndexContext,
} from "./index-context.js";

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
 * Components come from the document's `## Components` section; `--component` flags are
 * accepted only for a document that has none. Model extraction is deliberately absent — a gate
 * that guesses what it is gating produces a record whose hash means nothing,
 * and the operator would have no way to tell a guess from a reading.
 */
async function readSpec(deps: CommandDeps, specAbs: string): Promise<string | null> {
  try {
    return await readFile(specAbs, "utf8");
  } catch {
    deps.writer.line(`cannot read specification at ${specAbs}`);
    return null;
  }
}

function componentsFor(
  deps: CommandDeps,
  opts: GateOptions,
  specAbs: string,
  markdown: string,
): string[] | null {
  const listed = extractComponentsFromMarkdown(markdown);
  if (opts.components.length > 0) {
    if (listed === null) return opts.components;
    // Flags replacing a declared list gated components nobody declared, and
    // the record then cleared the plan for the ones that were.
    deps.writer.line(
      `${specAbs} declares its components in "${COMPONENTS_HEADING}"; ` +
        `gate them as declared, without --component.`,
    );
    return null;
  }
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

function gateOnce(
  deps: CommandDeps,
  specAbs: string,
  specText: string,
  components: string[],
  componentsSource: GateRecord["componentsSource"],
  context: IndexContext,
): Promise<GateRecord> {
  return runGate({
    specPath: specAbs,
    specText,
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
  // A pipe, a CI job or an agent is not an operator. Resolving off a terminal
  // used to answer every prompt with "accept BUILD", clearing the gate unseen.
  if (opts.resolve && !deps.operatorTerminal) {
    deps.writer.line(
      "--resolve needs an operator at an interactive terminal, outside an agent " +
        "session. Run it yourself in a terminal, or fix what each UNRESOLVED row names.",
    );
    return EXIT_ERROR;
  }

  const literal = isAbsolute(opts.specPath) ? opts.specPath : resolve(process.cwd(), opts.specPath);
  // Named and bound by where it resolves, as the hook names it: a record for
  // `specs/foo.md -> ../shared/bar.md` is gate-bar.json beside bar.md, or the
  // hook would look for a record the CLI never wrote and refuse every later edit.
  const specAbs = await realpath(literal).catch(() => literal);

  let context;
  try {
    context = await loadIndexContext(deps);
  } catch (error) {
    deps.writer.line(
      `${String(error)}\nRun "capmap scan --all" before gating a specification.`,
    );
    return EXIT_ERROR;
  }

  // The record is bound to this text, so it is read once and gated as read.
  const specText = await readSpec(deps, specAbs);
  if (specText === null) return EXIT_ERROR;

  const components = componentsFor(deps, opts, specAbs, specText);
  if (components === null) return EXIT_ERROR;
  const componentsSource = opts.components.length > 0 ? "flags" : "document";

  let record: GateRecord;
  try {
    record = await gateOnce(deps, specAbs, specText, components, componentsSource, context);
  } catch (error) {
    deps.writer.line(String(error));
    return EXIT_ERROR;
  }

  const warning = staleWarning(context);
  if (warning !== null) deps.writer.line(warning);
  deps.writer.line(renderVerdictTable(record));

  if (opts.resolve && unresolvedComponents(record).length > 0) {
    const prompt = new StdinPrompt(deps.writer, deps.operatorTerminal);
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

  // Refused when another specification of the same feature id holds the record.
  const written = await writeGateRecord(await resolveGateDir(specAbs), record).catch((error: unknown) => error);
  if (typeof written !== "string") {
    deps.writer.line(written instanceof Error ? written.message : String(written));
    return EXIT_ERROR;
  }
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
