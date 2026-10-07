import { describe, it, expect } from "vitest";
import {
  componentsHash,
  extractComponents,
  normalise,
  specContentHash as hookSpecContentHash,
} from "../src/components-hash.js";
import {
  extractComponentsFromMarkdown,
  hashComponents,
  normaliseComponents,
  specContentHash,
} from "../../packages/capmap-core/src/gate/components.js";

/**
 * The hook carries its own copy of this logic so it never loads the core bundle
 * at runtime. These cases exist to make the duplication safe: if the two ever
 * disagree, the hook would block on a hash the gate never writes, and the only
 * symptom would be an unexplainable refusal.
 */
const DOCUMENTS = [
  "## Components\n- billing\n- auth\n",
  "# Spec\n\nprose\n\n## Components\n\n- **billing** — Stripe subscriptions\n- auth/login\n\n## Next\n- ignored\n",
  "## Components\n* ui kit\n* email: transactional delivery\n",
  "## Components\n\n# Appendix\n- ignored\n",
  "## Components\n",
  "# Spec\nno components heading at all\n",
  "##  Components  \n- spaced heading\n",
  // A level-three subheading groups components rather than ending the section.
  // The two extractors disagreed here, and the conformance suite did not cover
  // it — which is the whole reason this suite exists.
  "## Components\n- authentication\n### Backend\n- billing\n",
  "## Components\n\n### Frontend\n- ui kit\n\n### Backend\n- billing\n- auth\n\n## Next\n- ignored\n",
  "## Components\n- a\n#### Deeply nested\n- b\n# Appendix\n- ignored\n",
  // CM-16: line endings, fences, nesting and numbered lists.
  "# t\r\n## Components\r\n- billing\r\n- auth\r\n",
  "intro\n```\n## Components\n- fake\n```\n## Components\n- real\n",
  "## Components\n- billing\n~~~md\n- example\n~~~\n- auth\n",
  "## Components\n- billing\n  - stripe webhooks\n  - note: uses x\n- auth\n",
  "## Components\n1. billing\n2) auth\n+ email\n",
  "# Spec\n\n## Reuse Verdicts\n| a | B |\n\n## Components\n- billing\n",
];

const NAME_SETS = [
  ["billing", "auth"],
  ["  Billing ", "AUTH", "billing"],
  ["ui  kit", "email"],
  [],
  ["a", "b", "c"],
];

describe("hook and core agree on component extraction", () => {
  it.each(DOCUMENTS)("extracts identically from %j", (markdown) => {
    expect(extractComponents(markdown)).toEqual(
      extractComponentsFromMarkdown(markdown),
    );
  });

  it.each(DOCUMENTS)("hashes the specification identically: %j", (markdown) => {
    expect(hookSpecContentHash(markdown)).toBe(specContentHash(markdown));
  });
});

describe("hook and core agree on normalisation and hashing", () => {
  it.each(NAME_SETS)("normalises identically: %j", (...names) => {
    expect(normalise(names)).toEqual(normaliseComponents(names));
  });

  it.each(NAME_SETS)("hashes identically: %j", (...names) => {
    expect(componentsHash(names)).toBe(hashComponents(names));
  });
});

describe("componentsHash", () => {
  it("is stable under reordering and case", () => {
    expect(componentsHash(["auth", "Billing"])).toBe(
      componentsHash(["BILLING", "auth"]),
    );
  });

  it("changes when a component is added", () => {
    expect(componentsHash(["auth"])).not.toBe(
      componentsHash(["auth", "billing"]),
    );
  });

  it("is prefixed with its algorithm", () => {
    expect(componentsHash(["auth"])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
