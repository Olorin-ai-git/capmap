import { z } from "zod";
import type { ScanConfig } from "../config/schema.js";
import type { PackageEntry } from "../model/index-schema.js";
import type { Logger, ModelClient } from "../ports/index.js";
import { PACKAGE_SYSTEM_PROMPT, buildPackagePrompt } from "./prompts.js";
import { sanitiseModelText } from "./untrusted.js";

const MAX_TAGS = 6;

const ResponseSchema = z.object({
  summary: z.string().min(1),
  domainTags: z.array(z.string()).min(1),
});

export interface EnrichPackagesArgs {
  packages: PackageEntry[];
  repoRootAbs: string;
  vocabulary: string[];
  model: ModelClient;
  config: ScanConfig["enrichment"];
  logger: Logger;
}

interface PackageEnrichment {
  summary: string;
  domainTags: string[];
}

function parseResponse(
  raw: string,
  vocabulary: string[],
  maxSummaryChars: number,
): PackageEnrichment | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) return null;
  const allowed = new Set(vocabulary);
  const tags = [
    ...new Set(result.data.domainTags.filter((t) => allowed.has(t))),
  ].slice(0, MAX_TAGS);
  if (tags.length === 0) return null;
  const summary = sanitiseModelText(result.data.summary, maxSummaryChars);
  if (summary === "") return null;
  return { summary, domainTags: tags };
}

async function enrichOne(
  entry: PackageEntry,
  args: EnrichPackagesArgs,
): Promise<PackageEntry> {
  const user = await buildPackagePrompt(
    entry,
    args.repoRootAbs,
    args.vocabulary,
    args.config.maxExcerptChars,
  );
  for (let attempt = 0; attempt <= args.config.maxRetries; attempt += 1) {
    // A thrown error is treated exactly like unusable output. The model is a
    // remote service: it rate-limits, it has outages, and its billing can lapse.
    // None of those should destroy a scan whose deterministic half already
    // succeeded — the entry is still worth having without a summary.
    let raw: string;
    try {
      raw = await args.model.complete({
        system: PACKAGE_SYSTEM_PROMPT,
        user,
        model: args.config.model,
        effort: args.config.effort,
        maxTokens: args.config.packageMaxTokens,
      });
    } catch (error) {
      args.logger.warn("package enrichment call failed", {
        id: entry.id,
        attempt,
        error: String(error),
      });
      continue;
    }
    const parsed = parseResponse(raw, args.vocabulary, args.config.maxSummaryChars);
    if (parsed !== null)
      return { ...entry, ...parsed, enrichmentFailed: false };
    args.logger.warn("package enrichment produced invalid output", {
      id: entry.id,
      attempt,
    });
  }
  return { ...entry, summary: null, domainTags: [], enrichmentFailed: true };
}

export async function enrichPackages(
  args: EnrichPackagesArgs,
): Promise<PackageEntry[]> {
  const out: PackageEntry[] = new Array<PackageEntry>(args.packages.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const entry = args.packages[index];
      if (entry === undefined) return;
      out[index] = await enrichOne(entry, args);
    }
  };

  const workers = Math.min(
    args.config.concurrency,
    Math.max(1, args.packages.length),
  );
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
