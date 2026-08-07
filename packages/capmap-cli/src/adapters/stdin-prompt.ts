import { createInterface, type Interface } from "node:readline/promises";
import type { Prompt, Writer } from "@capmap/core";

const FIRST_OPTION = 1;

/**
 * Reads operator choices from stdin.
 *
 * Falls back to the first option — always "accept BUILD", the conservative
 * answer — when stdin is not a terminal. A gate run inside CI or a pipe must
 * not hang waiting for a human who is not there, and must not silently adopt a
 * capability nobody chose.
 */
export class StdinPrompt implements Prompt {
  private readonly rl: Interface;

  constructor(
    private readonly writer: Writer,
    private readonly interactive: boolean,
  ) {
    this.rl = createInterface({ input: process.stdin, output: process.stderr });
  }

  async choose(question: string, options: string[]): Promise<number> {
    this.writer.line(question);
    options.forEach((option, index) => {
      this.writer.line(`  ${String(index + FIRST_OPTION)}) ${option}`);
    });
    if (!this.interactive) {
      this.writer.line("  (not a terminal — taking option 1)");
      return 0;
    }
    const answer = await this.rl.question(`select 1-${options.length}: `);
    const chosen = Number(answer.trim()) - FIRST_OPTION;
    return Number.isInteger(chosen) && chosen >= 0 && chosen < options.length
      ? chosen
      : 0;
  }

  async text(question: string): Promise<string> {
    if (!this.interactive) return "";
    return this.rl.question(`${question}: `);
  }

  close(): void {
    this.rl.close();
  }
}
