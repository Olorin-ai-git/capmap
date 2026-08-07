import { describe, it, expect } from "vitest";
import { shouldEnrich } from "../../src/commands/scan-report.js";
import type { ScanOptions } from "../../src/commands/scan.js";

const RUN: ScanOptions = { repoIds: null, dryRun: false, explain: false };

function ask(overrides: {
  opts?: Partial<ScanOptions>;
  available?: boolean;
  headSha?: string | null;
  previousSha?: string | null;
}): boolean {
  return shouldEnrich({
    opts: { ...RUN, ...overrides.opts },
    available: overrides.available ?? true,
    headSha: overrides.headSha === undefined ? "sha-1" : overrides.headSha,
    previousSha:
      overrides.previousSha === undefined ? "sha-1" : overrides.previousSha,
  });
}

/**
 * Enrichment is the only part of a scan that costs money, so it is gated on
 * evidence that the description could have changed. Re-running a full scan over
 * a settled estate previously re-enriched every repository in it.
 */
describe("shouldEnrich", () => {
  it("skips a repository whose HEAD has not moved", () => {
    expect(ask({ headSha: "sha-1", previousSha: "sha-1" })).toBe(false);
  });

  it("enriches a repository whose HEAD has moved", () => {
    expect(ask({ headSha: "sha-2", previousSha: "sha-1" })).toBe(true);
  });

  it("enriches a repository the index has never seen", () => {
    expect(ask({ previousSha: null })).toBe(true);
  });

  it("enriches a repository with no version control, which cannot prove it is current", () => {
    expect(ask({ headSha: null })).toBe(true);
  });

  it("enriches an unchanged repository when forced", () => {
    expect(
      ask({ opts: { force: true }, headSha: "sha-1", previousSha: "sha-1" }),
    ).toBe(true);
  });

  it("never enriches on a dry run, even when forced", () => {
    expect(
      ask({ opts: { dryRun: true, force: true }, previousSha: null }),
    ).toBe(false);
  });

  it("never enriches when --no-enrich was passed, even when forced", () => {
    expect(
      ask({ opts: { enrich: false, force: true }, previousSha: null }),
    ).toBe(false);
  });

  it("never enriches an unavailable repository", () => {
    expect(ask({ available: false, previousSha: null })).toBe(false);
  });
});
