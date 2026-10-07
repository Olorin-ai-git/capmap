export interface Clock {
  now(): Date;
}

export interface Git {
  /** Current HEAD sha for a repository, or null when the path is not a git repository. */
  headSha(repoAbsPath: string): Promise<string | null>;
  /** ISO-8601 commit time of the newest commit touching relPath, or null when unavailable. */
  lastCommitIso(repoAbsPath: string, relPath: string): Promise<string | null>;
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** User-facing output on stdout. Distinct from Logger, which writes diagnostics to stderr. */
export interface Writer {
  line(text: string): void;
}

export interface ModelRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<string>;
}

/**
 * Operator input, injected so interactive resolution is testable without a
 * terminal. Implementations must never assume a TTY is attached: a caller
 * running without one supplies a prompt that declines rather than blocks.
 */
export interface Prompt {
  /** Present numbered options and return the chosen index. */
  choose(question: string, options: string[]): Promise<number>;
  /** Ask for free text; an empty answer means the operator declined. */
  text(question: string): Promise<string>;
}
