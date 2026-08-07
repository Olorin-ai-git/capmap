import { expect, it } from "vitest";
import { parseLedger } from "../src/index.js";

it("exports a ledger parser", () => {
  expect(typeof parseLedger).toBe("function");
});
