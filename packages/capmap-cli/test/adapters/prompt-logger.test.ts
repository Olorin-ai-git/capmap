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

describe("StdinPrompt without a terminal", () => {
  it("prints the question and every option", async () => {
    const writer = capturing();
    const prompt = new StdinPrompt(writer, false);
    await prompt.choose("pick one", ["first", "second"]);
    prompt.close();

    const output = writer.lines.join("\n");
    expect(output).toContain("pick one");
    expect(output).toContain("1) first");
    expect(output).toContain("2) second");
  });

  it("takes the first option rather than blocking", async () => {
    const writer = capturing();
    const prompt = new StdinPrompt(writer, false);
    const chosen = await prompt.choose("pick one", ["accept build", "recheck"]);
    prompt.close();

    // Option one is always the conservative answer — accept BUILD — so a gate
    // run inside CI or a pipe neither hangs waiting for a human who is not
    // there nor silently adopts a capability nobody chose.
    expect(chosen).toBe(0);
    expect(writer.lines.join("\n")).toMatch(/not a terminal/);
  });

  it("returns empty text rather than blocking", async () => {
    const prompt = new StdinPrompt(capturing(), false);
    const answer = await prompt.text("capability id");
    prompt.close();
    expect(answer).toBe("");
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
