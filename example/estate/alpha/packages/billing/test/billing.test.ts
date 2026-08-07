import { expect, it } from "vitest";
import { verifyWebhook } from "../src/index.js";

it("exports a verifier", () => {
  expect(typeof verifyWebhook).toBe("function");
});
