# Installing the Reuse Gate Hook

The hook is **not installed by default**, and installing it is deliberately a
manual step. Once registered it intercepts every `Write` and `Edit` in every
session, and it will refuse writes to specifications and plans that have no
resolved gate record. That is the point of it, but it is not a change anyone
should make on your behalf.

Everything else — the CLI, the skills, the MCP server — works without it.

## Prerequisites

The index must exist, or the hook blocks every matching write with a message
telling you to build it:

```bash
cd /path/to/capability-map
pnpm install && pnpm -r build
CAPMAP_ROOT=/path/to/your/estate \
CAPMAP_CONFIG_DIR=/path/outside/the/checkout/config \
ANTHROPIC_API_KEY=… \
  node packages/capmap-cli/dist/bin.js scan
```

## Registration

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "CAPMAP_CONFIG_DIR=/path/outside/the/checkout/config node /path/to/capability-map/hooks/dist/gate-hook.js"
          }
        ]
      }
    ]
  }
}
```

The configuration directory, and the index written beside it, belong outside
the capability-map checkout: an index of a real estate is refused inside it.

`CAPMAP_CONFIG_DIR` is required. Without it the hook allows everything rather
than guessing — a guard that cannot find its configuration must not start
refusing writes on the strength of a default.

## What it does

| Situation                                | Result                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| Path matches neither `hook.specGlobs` nor `hook.planGlobs` | allow                                       |
| `CAPMAP_GATE=off` in the environment     | allow, with a bypass notice on stderr                         |
| Index missing                            | block, pointing at `capmap scan --all`                        |
| New **specification**, no record | allow — it cannot be gated before it has content |
| New **plan**, no record | **block** — a plan is downstream of a gated specification |
| Path matching **both** glob sets | both rules apply; the stricter one wins |
| Existing file, no gate record            | block, pointing at `capmap gate <path>`                       |
| Component set changed since the gate ran | block, asking for a re-run                                    |
| Any component `UNRESOLVED`               | block, printing the verdict table                             |
| Repositories stale                       | allow, with a warning                                         |

Globs default to `**/docs/superpowers/specs/**/*.md`, `**/specs/**/*.md`,
`**/plans/**/*.md` and `**/docs/**/plan*.md`, and are configured in
`config/scan.config.json`. They match Markdown only, so an OpenAPI file or a
diagram kept beside a specification is never gated as one.

A gate record is named by the feature id. In a spec-kit layout
(`specs/029-tenant-portal/spec.md`, `plan.md`, `tasks.md`, `contracts/…`) the
numbered folder is the feature, so every file in it shares one record; a file
named only for its role (`docs/feature-a/spec.md`) takes its directory's name.

## Bypassing

```bash
CAPMAP_GATE=off
```

Set for one command, or exported for a session. The bypass is announced on
stderr every time it is used, so it cannot be forgotten silently.

## Removing it

Delete the `PreToolUse` entry from `settings.json`. Nothing else needs undoing;
the hook holds no state of its own, and gate records under `.capmap/` are inert
without it.

## Cost

The hook reads one JSON file and makes no git, network or model calls.

The contract is **the hook's own work — wall clock minus a bare `node -e ""`
start-up on the same machine — under 100 ms**, measured by
`scripts/hook-latency.mjs` and asserted by CI.

| environment              | bare node | hook    | own work | ratio |
| ------------------------ | --------- | ------- | -------- | ----- |
| macOS arm64, quiet       | 16.1 ms   | 26.4 ms | 10.3 ms  | 0.64  |
| Linux arm64, container   | 9.6 ms    | 22.9 ms | 13.3 ms  | 1.39  |
| macOS arm64, loaded      | 32.3 ms   | 55.8 ms | 23.5 ms  | 0.73  |
| ubuntu-latest, hosted CI | 27.2 ms   | 54.9 ms | 27.7 ms  | 1.02  |
| macos-latest, hosted CI  | 39.8 ms   | 91.7 ms | 52.0 ms  | 1.31  |
| emulated x86_64          | 173 ms    | 269 ms  | 95 ms    | 0.55  |

Neither own work nor the ratio is a property of the code alone: own work spans
10 to 52 ms across honest environments and the ratio 0.56 to 1.39. An earlier
ceiling of 50 ms was set from quiet machines and failed a hosted macOS runner at
52.0 ms on unchanged code.

The ceiling is therefore derived from two measured bounds. The slowest honest
reading is 52 ms. The regression it exists to catch — importing the
`@capmap/core` bundle at start-up rather than carrying the component hashing in
`hooks/src/` — costs 134 ms of own work on a quiet machine, twelve times the
current hook. 100 ms sits between them: a shim that imports the bundle reads
140.6 ms and fails.

Emulation multiplies own work by about six and is not used for verification;
`scripts/verify-linux.sh` runs a native container by default.

The measurement is its own step rather than a unit test. Inside vitest, with
forty-one other files running in parallel, the same build measured 1.54 quiet
and 2.45–3.12 under the runner.

It runs on every `Write` and `Edit`, so that figure is the one that matters — a hook that reached for the index or the model would be
unusable at this frequency, which is why the component hash is reimplemented in
`hooks/src/` rather than imported from `@capmap/core`.
