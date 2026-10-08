import { describe, it, expect } from "vitest";
import { StdinPrompt } from "../../src/adapters/stdin-prompt.js";
import { PinoLogger } from "../../src/adapters/pino-logger.js";
import { StdoutWriter } from "../../src/adapters/stdout-writer.js";
import type { Writer } from "@capmap/core";

function capturing(): Writer & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    line: (text: string) => {
      lines.push(text);
    },
  };
}

/**
 * Audit CM-2: off a terminal the prompt took option 1, so
 * `capmap gate --resolve </dev/null` recorded "Operator accepted BUILD" for
 * every unresolved component. It must refuse instead.
 */
describe("StdinPrompt without a terminal", () => {
  it("refuses to choose rather than accepting BUILD for the operator", async () => {
    const prompt = new StdinPrompt(capturing(), false);
    await expect(
      prompt.choose("pick one", ["accept build", "recheck"]),
    ).rejects.toThrow(/interactive terminal/);
    prompt.close();
  });

  it("refuses to read text", async () => {
    const prompt = new StdinPrompt(capturing(), false);
    await expect(prompt.text("capability id")).rejects.toThrow(/interactive terminal/);
    prompt.close();
  });
});

describe("PinoLogger", () => {
  it("accepts every severity without throwing", () => {
    const logger = new PinoLogger("silent");
    expect(() => {
      logger.debug("d", { a: 1 });
      logger.info("i");
      logger.warn("w", { b: "x" });
      logger.error("e", { error: "boom" });
    }).not.toThrow();
  });

  it("writes diagnostics to stderr, never stdout", () => {
    // stdout carries command output; a diagnostic appearing there would corrupt
    // anything parsing the CLI, and would corrupt the MCP protocol outright.
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      new PinoLogger("info").error("must not reach stdout");
    } finally {
      process.stdout.write = original;
    }
    expect(written.join("")).not.toContain("must not reach stdout");
  });
});

describe("StdoutWriter", () => {
  it("writes each line to stdout with a terminator", () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      new StdoutWriter().line("hello");
    } finally {
      process.stdout.write = original;
    }
    expect(written.join("")).toBe("hello\n");
  });
});
