import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { GateRecord } from "@capmap/core";
import { componentsHash, extractComponents, specContentHash } from "./components-hash.js";

/**
 * A dependency-free validator for gate records, plus the checks that bind a
 * record to the specification it was produced from.
 *
 * The hook used to cast whatever JSON sat at `.capmap/gate-<feature>.json` to a
 * record, so `{"components":[],"staleRepos":[],"componentsSource":"flags"}`
 * satisfied it. The full schema lives in `@capmap/core`; the hook cannot load
 * zod inside its latency budget, so the shape is checked by hand here and the
 * schema version pins the two together.
 */

const SCHEMA_VERSION = 2;
const HASH = /^sha256:[0-9a-f]{64}$/;
const VERDICTS = new Set(["REUSE", "EXTEND", "REFERENCE", "BUILD", "UNRESOLVED"]);
const SOURCES = new Set(["document", "flags"]);
const GATE_DIR_SEGMENT = /(^|[\\/])\.capmap([\\/]|$)/i;

type Fields = Record<string, unknown>;
const isString = (v: unknown): v is string => typeof v === "string";
const isFilled = (v: unknown): v is string => isString(v) && v.length > 0;
const isNullableString = (v: unknown): boolean => v === null || isString(v);
const isStrings = (v: unknown): boolean => Array.isArray(v) && v.every(isString);
const isObject = (v: unknown): v is Fields =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** True for any path inside a `.capmap` directory, where only `capmap gate` may write. */
export function isGateRecordPath(path: string): boolean {
  return GATE_DIR_SEGMENT.test(path);
}

function componentProblem(value: unknown, index: number): string | null {
  const where = `component ${String(index + 1)}`;
  if (!isObject(value)) return `${where} is not an object`;
  if (!isFilled(value["name"])) return `${where} has no name`;
  if (!VERDICTS.has(value["verdict"] as string)) return `${where} has no valid verdict`;
  const score = value["score"];
  if (typeof score !== "number" || !(score >= 0 && score <= 1)) {
    return `${where} has no score between 0 and 1`;
  }
  const nullable = ["target", "bestCandidate", "verifiedSha"];
  if (!nullable.every((key) => isNullableString(value[key]))) {
    return `${where} has a malformed target, candidate or commit`;
  }
  if (!isStrings(value["failedChecks"]) || !isString(value["rationale"])) {
    return `${where} has malformed checks or rationale`;
  }
  if (value["competing"] !== undefined && !Array.isArray(value["competing"])) {
    return `${where} has malformed competing implementations`;
  }
  return null;
}

function recordProblem(raw: unknown, feature: string): string | null {
  if (!isObject(raw)) return "it is not a JSON object";
  if (raw["schemaVersion"] !== SCHEMA_VERSION) {
    return `it uses schema version ${String(raw["schemaVersion"])}, expected ${String(SCHEMA_VERSION)}`;
  }
  if (raw["feature"] !== feature) return `it names feature "${String(raw["feature"])}"`;
  if (!isFilled(raw["specPath"]) || !isAbsolute(raw["specPath"])) {
    return "it names no absolute specification path";
  }
  if (!HASH.test(String(raw["componentsHash"])) || !HASH.test(String(raw["specContentHash"]))) {
    return "it is not bound to a specification's components and content";
  }
  if (!SOURCES.has(raw["componentsSource"] as string)) return "its component source is missing";
  if (!isFilled(raw["generatedAt"]) || !isFilled(raw["indexGeneratedAt"])) {
    return "it has no generation times";
  }
  if (!isStrings(raw["staleRepos"])) return "its stale repositories are malformed";
  const components = raw["components"];
  if (!Array.isArray(components) || components.length === 0) return "it gates no components";
  for (const [index, component] of components.entries()) {
    const problem = componentProblem(component, index);
    if (problem !== null) return problem;
  }
  const names = components.map((c) => (c as Fields)["name"] as string);
  if (componentsHash(names) !== raw["componentsHash"]) {
    return "its component hash does not match the components it lists";
  }
  return null;
}

/** A validated record, or why the text is not one. Never throws. */
export function parseGateRecord(
  text: string,
  feature: string,
): { record: GateRecord; problem: null } | { record: null; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { record: null, problem: "it is not valid JSON" };
  }
  const problem = recordProblem(raw, feature);
  return problem === null
    ? { record: raw as GateRecord, problem: null }
    : { record: null, problem };
}

/**
 * The path with every symbolic link resolved, as far as it exists; the rest is
 * appended unchanged. A link such as `l -> .capmap` must not hide where a write lands.
 */
export async function canonical(path: string): Promise<string> {
  let existing = path;
  let rest = "";
  for (;;) {
    try {
      return join(await realpath(existing), rest);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return path;
      rest = join(basename(existing), rest);
      existing = parent;
    }
  }
}

/**
 * Why this record does not belong to the file being written, or null when it does.
 *
 * A specification must be the very file the record was gated from. A plan is
 * bound through its specification: that file must be a specification by the
 * configured globs, still hash to the content the gate saw, and — when it
 * declares a `## Components` section — be gated for exactly those components.
 * Otherwise a record gated from a decoy document, or from `--component` flags
 * that replaced the declared list, would clear a plan nobody gated.
 */
export async function bindingProblem(
  record: GateRecord,
  fileAbs: string,
  isPlan: boolean,
  isSpec: (path: string) => boolean,
): Promise<string | null> {
  const specAbs = await canonical(record.specPath);
  if (!isPlan) {
    return specAbs === (await canonical(fileAbs))
      ? null
      : `it was produced for ${record.specPath}, not this file`;
  }
  if (!isSpec(record.specPath) && !isSpec(specAbs)) {
    return `it was produced for ${record.specPath}, which is not a specification by the configured globs`;
  }
  let text: string;
  try {
    text = await readFile(record.specPath, "utf8");
  } catch {
    return `its specification ${record.specPath} cannot be read`;
  }
  if (specContentHash(text) !== record.specContentHash) {
    return `its specification ${record.specPath} changed after the gate ran`;
  }
  const declared = extractComponents(text);
  return declared === null || componentsHash(declared) === record.componentsHash
    ? null
    : `it gated components other than the ones ${record.specPath} declares`;
}
