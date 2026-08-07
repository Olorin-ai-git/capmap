import { expect, it } from "vitest";
import { createCheckout } from "../src/index.js";

it("exports checkout", () => {
  expect(typeof createCheckout).toBe("function");
});
