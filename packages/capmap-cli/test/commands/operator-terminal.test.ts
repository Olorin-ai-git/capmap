import { describe, it, expect } from "vitest";
import { operatorAtTerminal } from "../../src/composition.js";

// Audit round 2: `script -q /dev/null capmap gate … --resolve` hands the CLI a
// pseudo-terminal, so a terminal alone does not prove an operator is present.
describe("operatorAtTerminal", () => {
  it("needs a terminal", () => {
    expect(operatorAtTerminal({}, false)).toBe(false);
    expect(operatorAtTerminal({}, true)).toBe(true);
  });

  it("refuses inside an agent session, terminal or not", () => {
    expect(operatorAtTerminal({ CLAUDECODE: "1" }, true)).toBe(false);
    expect(operatorAtTerminal({ CLAUDE_CODE_SESSION_ID: "s" }, true)).toBe(false);
  });
});
