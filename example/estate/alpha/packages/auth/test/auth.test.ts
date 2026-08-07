import { expect, it } from "vitest";
import { verifyToken } from "../src/index.js";

it("exports a verifier", () => {
  expect(typeof verifyToken).toBe("function");
});
