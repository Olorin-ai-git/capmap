import { describe, it, expect } from "vitest";
import {
  extractComponentsFromMarkdown,
  specContentHash,
} from "../../src/gate/components.js";

/**
 * Audit CM-16, PoC 5 (audit-pocs/capmap/t.mjs), inverted to assert the fixed
 * behaviour: a CRLF specification yielded zero components, and nested bullets
 * and fenced examples were counted as components.
 */
describe("component extraction edges (CM-16)", () => {
  it("reads a CRLF document exactly like its LF twin", () => {
    expect(
      extractComponentsFromMarkdown("# t\r\n## Components\r\n- billing\r\n- auth\r\n"),
    ).toEqual(["billing", "auth"]);
  });

  it("ignores a Components heading and items inside a fenced example", () => {
    expect(
      extractComponentsFromMarkdown(
        "intro\n```\n## Components\n- fake\n```\n## Components\n- real\n",
      ),
    ).toEqual(["real"]);
  });

  it("ignores fenced items inside the real section, tilde fences included", () => {
    expect(
      extractComponentsFromMarkdown(
        "## Components\n- billing\n~~~md\n- example\n~~~\n- auth\n",
      ),
    ).toEqual(["billing", "auth"]);
  });

  it("does not count nested bullets as components", () => {
    expect(
      extractComponentsFromMarkdown(
        "## Components\n- billing\n  - stripe webhooks\n  - note: uses x\n- auth\n",
      ),
    ).toEqual(["billing", "auth"]);
  });

  it("reads numbered and plus-sign lists", () => {
    expect(
      extractComponentsFromMarkdown("## Components\n1. billing\n2) auth\n+ email\n"),
    ).toEqual(["billing", "auth", "email"]);
  });
});

describe("specContentHash (CM-1 binding)", () => {
  const spec = "# Spec\n\nprose\n\n## Components\n- billing\n";

  it("ignores line endings", () => {
    expect(specContentHash(spec.replace(/\n/g, "\r\n"))).toBe(specContentHash(spec));
  });

  it("changes when prose changes", () => {
    expect(specContentHash(`${spec}more\n`)).not.toBe(specContentHash(spec));
  });

  it("ignores a Reuse Verdicts section, which the skill writes after gating", () => {
    const withVerdicts = `${spec}\n## Reuse Verdicts\n| billing | REUSE |\n`;
    expect(specContentHash(withVerdicts)).toBe(specContentHash(`${spec}\n`));
    const verdictsMidway =
      "# Spec\n\n## Reuse Verdicts\n| billing | BUILD |\n\n## Components\n- billing\n";
    expect(specContentHash(verdictsMidway)).toBe(
      specContentHash("# Spec\n\n## Components\n- billing\n"),
    );
  });

  // Audit round 4 (Low): a pipe-led line is not a verdict by its first character.
  it("counts table rows that are not verdicts of declared components", () => {
    for (const row of ["| NEW SCOPE: also build a payments ledger |", "| payments ledger | BUILD |", "| a | B |"]) {
      expect(specContentHash(`${spec}\n## Reuse Verdicts\n${row}\n`), row).not.toBe(specContentHash(`${spec}\n`));
    }
    const header = `${spec}\n## Reuse Verdicts\n| Component | Verdict |\n|---|:-:|\n| Billing | REUSE |\n`;
    expect(specContentHash(header)).toBe(specContentHash(`${spec}\n`));
  });

  // Audit round 2 (Low): only the copied table is exempt, so scope cannot be
  // added beneath the heading without breaking the binding.
  it("counts any other line under the Reuse Verdicts heading", () => {
    const table = `${spec}\n## Reuse Verdicts\n\n| billing | REUSE |\n`;
    expect(specContentHash(`${table}\n### New service: build our own auth\n`)).not.toBe(
      specContentHash(table),
    );
    expect(specContentHash(`${table}Note.\n`)).not.toBe(specContentHash(table));
  });

  it("is prefixed with its algorithm", () => {
    expect(specContentHash(spec)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
