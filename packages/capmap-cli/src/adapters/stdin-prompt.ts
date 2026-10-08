import { createInterface, type Interface } from "node:readline/promises";
import type { Prompt, Writer } from "@capmap/core";

const FIRST_OPTION = 1;

/** Returned when no valid choice was made; it selects no option. */
export const NO_CHOICE = -1;

/**
 * Reads operator choices from stdin.
 *
 * Refuses to answer when stdin is not a terminal. Defaulting to option 1 there
 * turned `gate --resolve </dev/null` into "the operator accepted BUILD" for
 * every unresolved component: a pipe or an agent is not an operator. An answer
 * that is not a listed option selects nothing rather than option 1.
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
    this.requireTerminal();
    this.writer.line(question);
    options.forEach((option, index) => {
      this.writer.line(`  ${String(index + FIRST_OPTION)}) ${option}`);
    });
    const answer = await this.rl.question(`select 1-${options.length}: `);
    const chosen = Number(answer.trim()) - FIRST_OPTION;
    return Number.isInteger(chosen) && chosen >= 0 && chosen < options.length
      ? chosen
      : NO_CHOICE;
  }

  async text(question: string): Promise<string> {
    this.requireTerminal();
    return this.rl.question(`${question}: `);
  }

  private requireTerminal(): void {
    if (!this.interactive) {
      throw new Error(
        "resolving needs an operator at an interactive terminal; stdin is not one",
      );
    }
  }

  close(): void {
    this.rl.close();
  }
}
