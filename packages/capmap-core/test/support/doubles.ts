import type {
  Clock,
  Git,
  Logger,
  ModelClient,
  Writer,
} from "../../src/ports/index.js";

export const fixedClock = (now: Date): Clock => ({ now: () => now });

export const nullGit = (): Git => ({
  headSha: async () => null,
  lastCommitIso: async () => null,
});

export const shaGit = (sha: string, iso: string): Git => ({
  headSha: async () => sha,
  lastCommitIso: async () => iso,
});

export const silentLogger = (): Logger => ({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

export const capturingWriter = (): Writer & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    line: (text: string) => {
      lines.push(text);
    },
  };
};

export const scriptedModel = (
  responses: string[],
): ModelClient & { calls: number } => {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    complete: async () => {
      const next =
        responses[state.calls] ?? responses[responses.length - 1] ?? "";
      state.calls += 1;
      return next;
    },
  };
};
