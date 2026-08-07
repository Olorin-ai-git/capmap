import type { RepoTier } from "@capmap/core";
import type {
  DomainEntry,
  MinorEntry,
  PackageEntry,
} from "@capmap/core";
import { renderTable } from "./table.js";

/** Placement of an entry that the entry itself does not record. */
export interface EntryContext {
  repo: string;
  tier: RepoTier;
  /** Drift state of the containing repository, as reported by `capmap status`. */
  state: string;
}

const FIELD_HEADER = "field";
const VALUE_HEADER = "value";
const EMPTY = "none";
const LIST_SEPARATOR = ", ";
const LINE_TERMINATOR = "\n";
const YES = "yes";
const NO = "no";

type Field = [string, string];

function list(values: string[]): string {
  return values.length === 0 ? EMPTY : values.join(LIST_SEPARATOR);
}

function text(value: string | null): string {
  return value ?? EMPTY;
}

function count(value: number | null): string {
  return value === null ? EMPTY : String(value);
}

function flag(value: boolean): string {
  return value ? YES : NO;
}

/**
 * Render one record as a heading followed by a field table. Fields whose value
 * is absent are still printed as `none`, because "the index does not know" is
 * itself an answer a reader needs.
 */
function renderFields(heading: string, fields: Field[]): string {
  return [
    heading,
    renderTable({
      headers: [FIELD_HEADER, VALUE_HEADER],
      rows: fields.map(([name, value]) => [name, value]),
    }),
  ].join(LINE_TERMINATOR);
}

export function renderDomainEntry(
  entry: DomainEntry,
  context: EntryContext,
): string {
  return renderFields(`domain ${entry.id}`, [
    ["title", entry.title],
    ["repo", `${entry.repo} (${entry.tier})`],
    ["summary", entry.summary],
    ["tags", list(entry.domainTags)],
    ["packages", list(entry.packages)],
    ["stack", list(entry.stack)],
    ["maturity", entry.maturity],
    ["deployed", text(entry.proofOfLife.deployed)],
    ["tests", count(entry.proofOfLife.testCount)],
    ["last commit", text(entry.proofOfLife.lastCommit)],
    ["scanned sha", text(entry.scannedSha)],
    ["index state", context.state],
  ]);
}

export function renderPackageEntry(
  entry: PackageEntry,
  context: EntryContext,
): string {
  return renderFields(`package ${entry.id}`, [
    ["name", entry.name],
    ["repo", `${entry.repo} (${context.tier})`],
    ["kind", entry.kind],
    ["path", entry.path],
    ["entry", text(entry.entry)],
    ["summary", text(entry.summary)],
    ["tags", list(entry.domainTags)],
    ["exports", list(entry.exports)],
    ["internal deps", list(entry.deps.internal)],
    ["external deps", list(entry.deps.external)],
    ["consumers", list(entry.consumers)],
    [
      "deploy target",
      entry.deployTarget === null
        ? EMPTY
        : `${entry.deployTarget.kind} (${entry.deployTarget.config})`,
    ],
    ["loc", String(entry.loc)],
    ["tests", flag(entry.hasTests)],
    ["readme", flag(entry.hasReadme)],
    ["maturity", entry.maturity],
    ["significance", entry.significance.toFixed(2)],
    ["last commit", text(entry.lastCommit)],
    ["scanned sha", text(entry.scannedSha)],
    ["enrichment failed", flag(entry.enrichmentFailed)],
    ["extraction failed", flag(entry.extractionFailed)],
    ["index state", context.state],
  ]);
}

export function renderMinorEntry(
  entry: MinorEntry,
  context: EntryContext,
): string {
  return renderFields(`minor ${entry.id}`, [
    ["repo", `${context.repo} (${context.tier})`],
    ["kind", entry.kind],
    ["path", entry.path],
    ["significance", entry.significance.toFixed(2)],
    ["parse error", text(entry.parseError)],
    ["index state", context.state],
  ]);
}
