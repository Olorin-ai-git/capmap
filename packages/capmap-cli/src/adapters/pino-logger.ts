import pino from "pino";
import type {
  LogFields,
  Logger,
} from "@capmap/core";

/**
 * Structured diagnostics on stderr, so that piping stdout to a file or another
 * process never mixes machine-readable command output with log records.
 */
export class PinoLogger implements Logger {
  private readonly inner: pino.Logger;

  constructor(level: string) {
    this.inner = pino({ level }, pino.destination(process.stderr.fd));
  }

  debug(message: string, fields?: LogFields): void {
    this.inner.debug(fields ?? {}, message);
  }

  info(message: string, fields?: LogFields): void {
    this.inner.info(fields ?? {}, message);
  }

  warn(message: string, fields?: LogFields): void {
    this.inner.warn(fields ?? {}, message);
  }

  error(message: string, fields?: LogFields): void {
    this.inner.error(fields ?? {}, message);
  }
}
