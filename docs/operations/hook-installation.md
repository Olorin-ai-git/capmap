# Installing the Reuse Gate Hook

The hook is **not installed by default**, and installing it is deliberately a
manual step. Once registered it intercepts every `Write` and `Edit` in every
session, and it will refuse writes to specifications and plans that have no
resolved gate record — including writes made through `Bash`, `MultiEdit` and
`NotebookEdit`, and any write to a `.capmap/` directory. That is the point of it, but it is not a change anyone
should make on your behalf.

Everything else — the CLI, the skills, the MCP server — works without it.

## Prerequisites

The index must exist, or the hook blocks every matching write with a message
telling you to build it:

```bash
cd /path/to/capability-map
pnpm install && pnpm -r build
CAPMAP_ROOT=/path/to/your/estate \
CAPMAP_CONFIG_DIR=/path/to/capability-map/config \
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
        "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "CAPMAP_CONFIG_DIR=/path/to/capability-map/config node /path/to/capability-map/hooks/dist/gate-hook.js || exit 2"
          }
        ]
      }
    ]
  }
}
```

The trailing `|| exit 2` is part of the registration. Claude Code treats any
exit other than 2 as non-blocking, so a hook that cannot even start — its code
unparseable, `node` missing — would let every write through; the shell turns
that into a block. The hook's own manifest and its one runtime dependency
(`picomatch`) are guarded like its code, and the dependency is loaded inside the
hook's error handling, so a missing `node_modules` blocks rather than opens.

`CAPMAP_CONFIG_DIR` is required. Without it the hook allows everything rather
than guessing — a guard that is not installed must not start refusing writes on
the strength of a default. Once it is set, the hook fails closed: a missing or
malformed configuration, unreadable input or any error of its own blocks the
write (exit 2) and says why on stderr. A hook that has not decided within
`hook.deadlineMs` blocks as well, so Claude Code's own hook timeout — which lets
the write through — is never reached; keep that timeout above the deadline. Files
the hook reads (records, specifications, its configuration) must be regular
files: a FIFO or device in their place is refused, not waited on.

## What it does

| Situation                                | Result                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| Path matches neither `hook.specGlobs` nor `hook.planGlobs` | allow                                       |
| `CAPMAP_GATE=off` in the environment     | allow, with a bypass notice on stderr                         |
| Index missing                            | block, pointing at `capmap scan --all`                        |
| New **specification**, no record | allow — it cannot be gated before it has content |
| New **plan**, no record | **block** — a plan is downstream of a gated specification |
| Plan that names no specification (no `Spec: <path>` line; spec-kit's `plan.md`/`tasks.md` name the `spec.md` beside them) | block |
| Plan written through the shell, or by an edit the hook cannot rebuild | block — it cannot read which specification the plan names |
| Plan whose named specification's record was gated from another file, or scored against an index other than the configured one | block |
| Path matching `hook.exemptGlobs` (Claude Code's `~/.claude/plans/*.md`) | allow |
| Path matching **both** glob sets | both rules apply; the stricter one wins |
| Existing file, no gate record            | block, pointing at `capmap gate <path>`                       |
| Gate record malformed, or gates no components, or its hash disagrees with its components | block |
| Specification write under a record gated from another file | block |
| Plan write whose specification changed since the gate ran (the table rows of a `## Reuse Verdicts` section excepted) | block, asking for a re-run |
| Plan write whose record came from a file outside `hook.specGlobs`, or gated components other than its specification's `## Components` | block |
| Any write to a `.capmap/` directory, including through a symbolic link | block — records are written only by `capmap gate` |
| Any write to the configuration directory, the index directory, the hook's own code, its `package.json` or `picomatch` | block — they steer or disable the gate |
| `capmap` run with `CAPMAP_CONFIG_DIR` set to anything but the hook's own | block |
| `capmap gate --resolve` run through the Bash tool | block — resolution is answered by the operator at a terminal |
| Configured, but the hook itself errors | block |
| Component set changed since the gate ran | block, asking for a re-run                                    |
| Any component `UNRESOLVED`               | block, printing the verdict table                             |
| Repositories stale                       | allow, with a warning                                         |

Globs are configured in `config/scan.config.json` and match case-insensitively,
including inside dot directories such as `.claude/worktrees`. Specifications are
Markdown under `specs/` or `docs/superpowers/specs/`. Plans cover
`**/plans/**`, `plan*`, `*-plan*`, `*_plan*` and `*implementation*` Markdown under
`docs/`, and spec-kit's `plan.md` and `tasks.md` under `specs/`. A plan is bound
to the specification it names, not to its own file name: the record checked is
the named specification's, so a plan cannot borrow the record of a trivially
gated namesake, and `capmap gate` refuses to replace a record that another
existing specification of the same feature id holds.

### Shell commands

For `Bash`, the command is lexed as the shell reads it: quotes, escapes and
ANSI-C strings are removed (`pl""ans` and `$'pl\x61ns'` are `plans`), braces are
expanded (`p{lans,x}` is `plans` and `px`; a command expanding to more than
`hook.maxShellWords` words is refused), heredoc delimiters are read with the
same quoting (`<<E\;F` ends at the line `E;F`), command and process
substitutions, subshells and `sh -c`/`eval` scripts are commands of their own,
and heredoc bodies are data — except to a program that runs its input.

Redirect targets are always writes. A program's name is trusted to say what it
writes only when it surely names the program: a bare name, reached through
wrappers (`env`, `exec`, `command`, `sudo`, …) that carry no options, with no
assignment in front of it, not run through `npx`/`pnpm`, and in a command that
defines no function, alias or `PATH`/`GIT_*`-style variable, and uses no syntax
whose nesting the lexer does not model (a `case` statement, whose patterns end
in a lone `)`; zsh's glob qualifiers `*(e:…:)`, parameter flags `${(e)…}` and
`=( )`; a function `f()`). A trusted name writes nothing through its arguments
(`cat`, `grep`, `ls`, `mkdir`, `sed` without `-i`/`w`/`e`, `find` without
`-exec`/`-delete`, `git` read-only subcommands without `-c`, `--upload-pack`,
`--receive-pack`, `--exec` or `--output`, `capmap` itself unless an argument
lies in `.capmap/`) or only its destination (`cp`, `install`, `rsync`: the last
argument or `-t`, and each source's name inside it; `mv` and `ln` also write
their sources). Any other command is unknown: every piece of every argument and
of every value assigned in front of it is a write — including values attached
to a short option (`-o.capmap/x`) — except the words of a sentence
(`--body "updates plans and specs"`), where only path-like pieces count; and
every argument that may be a script is also read as one.

The file system is consulted where the words alone do not say what is written.
A glob names every existing path it matches (`.capm?p/`). A moved or copied
directory carries its files: `mv scratch decoy/specs` writes
`decoy/specs/<each file>`, and moving `specs` away writes every specification in
it; a directory of more than `hook.maxShellPaths` entries is refused. A patch
(`git apply`, `git am`, `patch -i`/`<`) writes the files it names; a patch the
hook cannot read before the command runs — piped in, or written earlier in the
same command — is refused.

What a program reads on its input is a script when the program runs it: text
piped, here-documented or here-stringed into `sh`, `bash`, `zsh` (no script
operand, or `-s`) is walked like the command itself, and into an interpreter
(`node`, `python`, `perl`, …) its paths count. Paths piped into `xargs` are its
arguments, unless the program it runs only reads.

A relative path is checked in every directory the command may be in: a `cd`,
`pushd` or `builtin cd` adds its target and keeps the directory it left (it
may fail, or run in a subshell or pipeline), and `git -C`, `make -C`,
`env --chdir` and similar options add theirs. A `cd` whose target is known only
at run time (`cd "$D"`, `cd -`, `popd`, `cd` under `CDPATH`) makes every later
relative write in the command undecidable, and the hook blocks it: use an
absolute path, or run the `cd` as a command of its own. A gated specification
can therefore not be changed through the shell (use `Write`/`Edit`, which the
hook can reconstruct), and a plan cannot be written through it at all. Every
path is decided after symbolic links are resolved. `capmap gate --resolve` is
refused wherever its words appear as a command's, however quoted or wrapped
(`script`, `env -u`, a renamed link, `node -e`), but not inside a reader's
arguments (`git commit -m "…"`, `grep -- --resolve`).

This is lexical, not a shell. The lexer models bash and the zsh constructs that
carry commands; Claude Code on macOS runs commands in zsh, and any zsh syntax
outside that model is a gap of the same kind. Not seen: paths assembled at run
time (`$DIR/plan.md`, `printf '%s' … | sh`, encoded text), and anything a file the
agent wrote earlier does when it runs — a script, a function or `PATH` entry in a
shell profile, git configuration, hooks or objects (`git checkout`, `git stash
pop`), an archive (`tar x`), a package in `node_modules`, or a rebuilt capmap.
Gate records carry no proof of authorship an agent cannot reproduce, so each such
gap is a way to forge one. Closing the class needs an anchor outside the agent's
reach — a record signed with a key the agent cannot read, or an operating-system
write guard on `.capmap/` — which this hook does not provide.

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

It runs on every `Write`, `Edit` and `Bash` call, so that figure is the one that matters — a hook that reached for the index or the model would be
unusable at this frequency, which is why the component hash is reimplemented in
`hooks/src/` rather than imported from `@capmap/core`.
