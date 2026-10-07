# capmap

**A Claude Code hook and two skills that stop your agent building something you
already have.**

Point it at the repositories you already own. It indexes them into capabilities,
and then — before any plan gets written — it checks each component of the new
work against what already exists and answers `REUSE`, `EXTEND`, `REFERENCE` or
`BUILD`. The hook refuses to let the plan be written until every component has
an answer.

It exists because of a specific, measured problem. In the estate it was built
for, authentication, billing and transactional email each already existed
**twice** — once inside the Angainor control plane and once inside the TwoGates
one — and the UI kit existed **three times**, all under one package name. Nobody
set out to build any of them twice. Everybody had simply asked an agent to build
a thing, and the agent, with no memory of the estate, built it.

## What you get

| you install                    | it does                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `hooks/` — a `PreToolUse` hook | blocks writes to specs and plans that have no resolved gate record           |
| `skills/capability-map`        | "what do we already have?" — a survey, answered from the index with evidence |
| `skills/reuse-gate`            | drives every component of a draft spec to a build-versus-reuse decision      |
| `capmap` — a CLI               | scan, search, show, verify, gate                                             |
| `packages/capmap-mcp`          | the same five operations as MCP tools, if you prefer that wiring             |

The skills and the CLI are useful on their own. The hook is the part that makes
it non-optional, and it is deliberately **not installed by default** — see
[`docs/operations/hook-installation.md`](docs/operations/hook-installation.md).

## A real verdict table

This is `capmap gate` run against the [example estate](example/) in this
repository, on a spec naming six components:

```
component            verdict  target                                 score  note
audit log            BUILD    —                                      0.00
authentication       REUSE    alpha/auth                             0.90   DUPLICATION: also in beta/auth (0.85)
billing              REUSE    alpha/billing                          0.90   DUPLICATION: also in beta/billing (0.72)
component library    REUSE    alpha/ui-kit                           0.90
ledger import        BUILD    (best: vendor-toolkit/vendor-toolkit)  0.35
transactional email  REUSE    beta/email                             0.90   DUPLICATION: also in alpha/email (0.45)

3 component(s) have more than one implementation in the estate. Decide which is
canonical before accepting these verdicts — the gate deliberately does not
choose for you, because that is a judgement about ownership and roadmap rather
than about code.
```

Three things in that table are the whole point.

**`DUPLICATION`.** The gate reports _every_ place a capability already exists,
not just the best one. A gate that answered `REUSE -> alpha/billing` and said
nothing about `beta/billing` would describe a tidier estate than the one you
have — and it would do so with a verified sha attached, which makes the omission
credible. It does not pick a winner, because which implementation is canonical
is a judgement about ownership and roadmap, not about code.

**`ledger import` → `BUILD`, best match 0.35.** `vendor-toolkit` is at tier
`external`. Capabilities in `external` or `archived` repositories can never
exceed `REFERENCE`, however well they score. That cap is unconditional — it is
how you stop an agent helpfully importing a client's, an employer's or a
vendor's code into your own.

**`audit log` → `BUILD`, with nothing behind it.** When nothing matches, it says
so, and the plan is expected to record which searches came back empty.

## Install it against your own estate

```bash
git clone https://github.com/Olorin-ai-git/capmap && cd capmap
pnpm install && pnpm -r build
```

Your index describes your private code, so keep it out of this checkout: copy
`config/` to a directory of your own (`cp -r config ~/.capmap/config`) and the
index is written beside it (`~/.capmap/index`). `capmap` refuses to write the
index of an estate outside this checkout into this checkout's `index/`.

Describe your repositories in that copy's `repos.json` — each entry is a path
relative to `scan.config.json`'s `root`, plus a tier:

```json
{
  "repos": [
    { "id": "web", "path": "web", "tier": "core", "vcs": "git" },
    { "id": "api", "path": "api", "tier": "active", "vcs": "git" },
    {
      "id": "legacy-cms",
      "path": "legacy-cms",
      "tier": "archived",
      "vcs": "git"
    },
    {
      "id": "client-fork",
      "path": "client-fork",
      "tier": "external",
      "vcs": "git"
    }
  ]
}
```

Tiers are the load-bearing part. `core` and `active` may be recommended for
import; `archived` and `external` never can be.

```bash
export CAPMAP_CONFIG_DIR="$HOME/.capmap/config"
ANTHROPIC_API_KEY=... pnpm exec capmap scan     # index every configured repository

pnpm exec capmap search billing                 # what already does this? no API key needed
pnpm exec capmap show web/checkout
pnpm exec capmap verify                         # does the index still match live source?
```

Then install the skills into Claude Code, and — when you actually want the
enforcement — the hook. The skills are symlinked, not copied, so they track this
checkout:

```bash
pnpm skills:install        # symlinks both skills into ~/.claude/skills
```

Scanning and gating make model calls and need `ANTHROPIC_API_KEY`. Everything
that reads the index does not.

**Try it before you point it at your own code:** the [example estate](example/)
ships with a committed index, so `search`, `show` and `status` work immediately
after a build.

## Design commitments

- **Determinism as far forward as possible.** The model never decides whether a
  package exists, what it exports, or who depends on it. It ranks candidates;
  everything else is read from source.
- **Existence and adoptability are separate judgements.** An authentication
  implementation bundled inside a control plane genuinely _is_ authentication —
  it is simply not extractable. Conflating the two hid every capability bundled
  inside a service.
- **Fail closed.** Model unavailable → `UNRESOLVED`, never `BUILD`. An edit that
  cannot be reconstructed → block. A plan with no record → block.
- **Tier caps are unconditional.** Capabilities in `external` or `archived`
  repositories never exceed `REFERENCE`, whatever they score.
- **A check that cannot fail is not a check.** Twenty-six of those were found
  here, across six rounds of independent review and one self-audit.
  `scripts/check-negative-controls.mjs` now breaks every gate on purpose —
  thirteen ways, each preceded by a passing baseline — and requires each one to
  notice.
  [`docs/operations/checks-that-cannot-fail.md`](docs/operations/checks-that-cannot-fail.md)
  is the whole log, including the ones that were embarrassing.

## Measuring it

The thresholds are only as good as the verdicts they produce, so measure them.
Write a labelled set — components your estate really duplicated, each with the
verdict and capability a correct gate gives — and keep it beside your config,
outside this checkout. [`example/labels.json`](example/labels.json) is the
format, labelled for the example estate.

```bash
pnpm exec capmap eval ~/.capmap/labels.json            # gate accuracy + search recall
pnpm exec capmap eval ~/.capmap/labels.json --no-gate  # search recall only, no API key
```

The result, with every case's score for calibrating the thresholds, is written
to `labels.result.json` beside the set. If every case comes back `UNRESOLVED`
the gate did not run, and nothing is recorded.

Status: the shipped thresholds (`reuseThreshold` 0.7, `extendThreshold` 0.5)
have not yet been calibrated against a real estate. Only search recall has
been measured on one (7 of 9 real duplicates in the top 10); gate accuracy
needs an enriched index and a model credential, and has not been run.

## What the verdicts mean

| verdict      | meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `REUSE`      | import it unchanged                                         |
| `EXTEND`     | it covers part of this; add to it rather than starting over |
| `REFERENCE`  | read it for prior art, do not adopt it                      |
| `BUILD`      | nothing in the estate covers this                           |
| `UNRESOLVED` | the gate could not decide — a human must, before planning   |

`REFERENCE` is a firm answer, not a weak `REUSE`. `UNRESOLVED` blocks planning
until a human clears it.

## Layout

| path                   | what                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `packages/capmap-core` | scanner, matcher, gate, verifier                             |
| `packages/capmap-cli`  | the `capmap` command                                         |
| `packages/capmap-mcp`  | the same five operations as MCP tools                        |
| `hooks/`               | the `PreToolUse` gate hook, no dependency on core            |
| `skills/`              | `capability-map` and `reuse-gate`, installable into Claude   |
| `example/`             | a three-repository estate and a committed index to try it on |
| `config/`              | what to scan, thresholds, globs, expected count bands        |
| `index/`               | the committed index — a tracked artifact, not a build output |
| `scripts/`             | the verification runners and the gates they run              |

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm test
node scripts/check-negative-controls.mjs   # the gates can fail — 13 ways
node scripts/hook-matrix.mjs               # the hook actually blocks
node scripts/hook-latency.mjs              # the hook's own work, under 100 ms

scripts/verify.sh                          # the whole battery, into a transcript
scripts/verify-linux.sh                    # the second platform, in a container
```

Both runners refuse to report success unless every check met its expectation,
and the transcript names the commit it was generated at. CI runs the same
commands, in the same order, on macOS and Linux against Node 20 and 22.

The hook runs on every `Write` and `Edit`, so its cost is a contract rather than
a hope: **its own work — wall clock minus a bare `node -e ""` start-up on the
same machine — stays under 100 ms**, asserted by CI. That budget is why the
component hash is reimplemented in `hooks/src/` rather than imported from
`@capmap/core`.

## Honest limits

- Ranking is a model judgement and moves between runs. Verdicts are stable; the
  third decimal place is not.
- A capability your documentation mandates but which no manifest declares is
  invisible to a manifest-driven scanner, and correctly so.
- Scanning a large estate costs real model calls. Reading the index costs none.
- This was built for one estate and then generalised. If it meets something
  yours does that it handles badly, that is worth an issue.

## Licence

MIT.
