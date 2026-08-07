import { expect, it } from "vitest";
import { verifyIdToken } from "../src/index.js";

it("exports a verifier", () => {
  expect(typeof verifyIdToken).toBe("function");
});
