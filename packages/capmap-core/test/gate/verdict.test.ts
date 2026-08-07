import { describe, it, expect } from "vitest";
import { applyVerdict } from "../../src/gate/verdict.js";

const T = {
  reuseThreshold: 0.7,
  extendThreshold: 0.5,
  duplicationThreshold: 0.3,
};
const base = {
  tier: "active" as const,
  verified: true,
  isMinor: false,
  thresholds: T,
};

describe("applyVerdict", () => {
  it("returns REUSE at or above the reuse threshold", () => {
    expect(applyVerdict({ ...base, score: 0.7 })).toBe("REUSE");
    expect(applyVerdict({ ...base, score: 0.86 })).toBe("REUSE");
  });

  it("returns EXTEND between the two thresholds", () => {
    expect(applyVerdict({ ...base, score: 0.5 })).toBe("EXTEND");
    expect(applyVerdict({ ...base, score: 0.69 })).toBe("EXTEND");
  });

  it("returns BUILD below the extend threshold", () => {
    expect(applyVerdict({ ...base, score: 0.49 })).toBe("BUILD");
    expect(applyVerdict({ ...base, score: 0 })).toBe("BUILD");
  });

  it("returns UNRESOLVED whenever verification failed, at any score", () => {
    expect(applyVerdict({ ...base, score: 0.99, verified: false })).toBe(
      "UNRESOLVED",
    );
    expect(applyVerdict({ ...base, score: 0.1, verified: false })).toBe(
      "UNRESOLVED",
    );
  });

  it("caps an archived capability at REFERENCE however high it scores", () => {
    expect(applyVerdict({ ...base, score: 0.99, tier: "archived" })).toBe(
      "REFERENCE",
    );
  });

  it("caps an external capability at REFERENCE however high it scores", () => {
    expect(applyVerdict({ ...base, score: 1, tier: "external" })).toBe(
      "REFERENCE",
    );
  });

  it("caps a minor entry at REFERENCE even from a core repository", () => {
    expect(
      applyVerdict({ ...base, score: 0.95, tier: "core", isMinor: true }),
    ).toBe("REFERENCE");
  });

  it("does not promote a capped capability that scored below extend", () => {
    expect(applyVerdict({ ...base, score: 0.2, tier: "external" })).toBe(
      "BUILD",
    );
  });

  it("applies the cap after, not instead of, the verification check", () => {
    expect(
      applyVerdict({ ...base, score: 0.9, tier: "external", verified: false }),
    ).toBe("UNRESOLVED");
  });
});
