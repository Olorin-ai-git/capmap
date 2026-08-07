# The example estate

A tiny estate — three repositories, eight packages — so you can watch the gate
work before you point it at your own code. `config/repos.json` and the committed
`index/` both describe this directory, so every command in the root README runs
against it with no scan and no API key.

## What is in it, and why

| repository       | tier       | what it holds                                 |
| ---------------- | ---------- | --------------------------------------------- |
| `alpha`          | `core`     | auth, billing, email, a UI kit, a console app |
| `beta`           | `active`   | auth, billing, email — built independently    |
| `vendor-toolkit` | `external` | third-party ledger parsing                    |

`alpha` and `beta` are the point. Both implement authentication, billing and
transactional email. Neither imports the other. That is the shape the gate
exists to find, and it is a miniature of the real thing: in the estate this tool
was built for, authentication, billing and transactional email each existed
twice, in two sibling control planes, and nobody set out to build any of them
twice.

`vendor-toolkit` is at tier `external`, so it can never score above `REFERENCE`
however well it matches — the boundary that stops the gate recommending code
somebody else owns.

## Try it

```bash
pnpm install && pnpm -r build
export CAPMAP_CONFIG_DIR="$PWD/config"

pnpm exec capmap search auth          # reads the committed index, no API key
pnpm exec capmap show alpha/auth
pnpm exec capmap status
```

Gating needs a model call, so it needs a key:

```bash
ANTHROPIC_API_KEY=... pnpm exec capmap gate \
  example/specs/2026-08-06-partner-portal-design.md
```

which produces the table in the root README: three components carrying a
`DUPLICATION` marker, one capped at `BUILD` behind an `external` repository, and
one with nothing behind it at all.

## Two things that look like faults and are not

**"the index is stale for alpha, beta, vendor-toolkit".** These repositories are
configured `vcs: "none"`, because a git repository cannot be committed inside
another one. A repository with no VCS has no sha to compare against, so drift
detection reports it stale every time — only a rescan could tell whether its
contents changed. That is the guard refusing to certify what it cannot check,
which is the behaviour you want everywhere else.

**Scores move between runs.** Ranking is a model judgement, so `alpha/auth` may
come back 0.85 on one run and 0.90 on the next. The verdicts are stable; the
third decimal place is not. Everything the model is _not_ trusted with —
whether a package exists, what it exports, who depends on it — is read from
source and does not move.
