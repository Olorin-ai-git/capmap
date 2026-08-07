import type { Writer } from "@capmap/core";

const LINE_TERMINATOR = "\n";

/**
 * User-facing output on stdout, one line at a time. Diagnostics never travel
 * this channel: they belong to the Logger port, which writes to stderr.
 */
export class StdoutWriter implements Writer {
  line(text: string): void {
    process.stdout.write(`${text}${LINE_TERMINATOR}`);
  }
}
