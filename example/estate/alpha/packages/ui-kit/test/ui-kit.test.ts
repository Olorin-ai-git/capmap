import { expect, it } from "vitest";
import { Button } from "../src/index.js";

it("exports Button", () => {
  expect(typeof Button).toBe("function");
});
