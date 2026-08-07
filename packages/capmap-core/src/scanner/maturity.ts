import type { RepoTier } from "../config/schema.js";
import type { Maturity } from "../model/index-schema.js";

const MS_PER_DAY = 86_400_000;

export interface MaturityInput {
  tier: RepoTier;
  hasDeployTarget: boolean;
  hasTests: boolean;
  hasReadme: boolean;
  lastCommit: string | null;
  now: Date;
  gaRecencyDays: number;
}

export function deriveMaturity(input: MaturityInput): Maturity {
  if (input.tier === "archived") return "archived";

  const ageDays =
    input.lastCommit === null
      ? Number.POSITIVE_INFINITY
      : (input.now.getTime() - new Date(input.lastCommit).getTime()) /
        MS_PER_DAY;

  if (
    input.hasDeployTarget &&
    input.hasTests &&
    input.hasReadme &&
    ageDays <= input.gaRecencyDays
  ) {
    return "ga";
  }
  if ((input.hasTests || input.hasDeployTarget) && input.hasReadme)
    return "beta";
  return "prototype";
}
