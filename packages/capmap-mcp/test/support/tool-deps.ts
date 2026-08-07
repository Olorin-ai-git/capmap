import { IndexStore } from "@capmap/core";
import { loadFixtureConfig } from "../../../capmap-core/test/support/fixture-estate.js";
import {
  fixedClock,
  scriptedModel,
  silentLogger,
} from "../../../capmap-core/test/support/doubles.js";
import { writeFixtureIndex } from "../../../capmap-cli/test/support/index-fixture.js";
import {
  estateGit,
  FIXTURE_NOW,
} from "../../../capmap-cli/test/support/deps.js";
import type { ToolDeps } from "../../src/tools.js";

const SHORTLIST = JSON.stringify({
  selections: [{ component: "ui kit", domains: ["alpha/design-system"] }],
});

const RANKING = JSON.stringify({
  rankings: [
    { packageId: "alpha/ui-kit", score: 0.9, rationale: "Exactly this." },
  ],
});

/**
 * Wire the MCP tools over the same committed fixture estate the CLI tests use,
 * so a divergence between the two front doors shows up as a failing test rather
 * than as two subtly different answers to the same question.
 */
export async function makeToolDeps(indexDir: string): Promise<ToolDeps> {
  await writeFixtureIndex(indexDir);
  const config = await loadFixtureConfig();
  return {
    config,
    store: new IndexStore({ indexDirAbs: indexDir }),
    git: estateGit(config.root, config.repos.repos, { alpha: "sha-1" }),
    clock: fixedClock(FIXTURE_NOW),
    logger: silentLogger(),
    model: scriptedModel([SHORTLIST, RANKING]),
  };
}
