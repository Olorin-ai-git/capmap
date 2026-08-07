import type { CommandDeps } from "../composition.js";
import {
  renderDomainEntry,
  renderMinorEntry,
  renderPackageEntry,
  type EntryContext,
} from "../render/entry.js";
import {
  loadIndexContext,
  repoState,
  type IndexContext,
} from "./index-context.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;

export interface ShowOptions {
  id: string;
}

function contextFor(context: IndexContext, repoId: string): EntryContext {
  return {
    repo: repoId,
    tier: context.tierByRepo.get(repoId) ?? "active",
    state: repoState(context, repoId),
  };
}

/**
 * Render one indexed entry in full, whichever layer carries it. Domains are
 * searched before packages and packages before minor entries, matching the
 * precedence the matcher uses, so an id shown here is the one the gate resolves.
 */
export async function runShow(
  deps: CommandDeps,
  options: ShowOptions,
): Promise<number> {
  const context = await loadIndexContext(deps);

  for (const repo of context.repos) {
    const domain = repo.domains.find((entry) => entry.id === options.id);
    if (domain !== undefined) {
      deps.writer.line(
        renderDomainEntry(domain, contextFor(context, repo.repo)),
      );
      return EXIT_OK;
    }

    const pkg = repo.packages.find((entry) => entry.id === options.id);
    if (pkg !== undefined) {
      deps.writer.line(renderPackageEntry(pkg, contextFor(context, repo.repo)));
      return EXIT_OK;
    }

    const minor = repo.minor.find((entry) => entry.id === options.id);
    if (minor !== undefined) {
      deps.writer.line(renderMinorEntry(minor, contextFor(context, repo.repo)));
      return EXIT_OK;
    }
  }

  deps.writer.line(
    `no entry in the index carries the id "${options.id}"; ` +
      `run "capmap search" to find one`,
  );
  return EXIT_ERROR;
}
