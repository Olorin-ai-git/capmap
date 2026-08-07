# A check that cannot fail is not a check

Twenty-six defects in this repository were the same defect. Not twenty-six bugs
in the product — twenty-six checks that were incapable of reporting a problem.
Each was found by asking one question: **what would this print if the thing it
checks were false?** In almost every case the answer was "print it and pass".

They are recorded here rather than quietly fixed, because the class is more
useful than any instance, and because this is a tool whose entire pitch is that
it tells you the truth about a codebase. A verification suite that cannot fail
is exactly the failure it exists to prevent.

## The defects

| Defect                                                          | Consequence had it shipped                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D21 the enforcement matrix measured the caller's shell          | the hook allows everything when `CAPMAP_CONFIG_DIR` is unset, and the matrix never set it — so eight cases failed and the other six reported `ok` while proving nothing. The transcript's strongest section was worth exactly as much as an ambient variable |
| D22 both verification runners returned 0 whatever happened      | `verify.sh` and `verify-linux.sh` printed each command's exit code and then exited 0, so a failed build or a red suite produced a complete-looking transcript and a successful-looking run                                                                   |
| D23 the index checker could not fail                            | `report-index.mjs` printed duplicate ids, out-of-band counts and unreachable packages as facts and exited 0 either way; it also never compared the indexed repositories with the configured ones                                                             |
| D24 consumer edges were checked by name alone                   | 12 names in the estate are declared by more than one package and 7 of them carry edges; an edge attributed to the wrong same-named package passed                                                                                                            |
| D25 a criterion claimed literal configuration was checked       | nothing checked for URLs, hosts or absolute paths in source; the criterion asserted an absence that no code tested                                                                                                                                           |
| D26 CI could never have passed its own provenance gate          | `actions/checkout` fetches one commit by default, and the gate must resolve the older commit the transcript names, so every hosted job would have failed a check that passes locally                                                                         |
| D27 the index gate never looked at the repository files         | it compared the manifest with the configuration only; deleting a repository file, or truncating it, left both in agreement while a consumer loads an incomplete index                                                                                        |
| D28 the dry-scan section compared nothing                       | it printed "scanned: 27" beside "configured: 27"; an unavailable repository is a result rather than a fault to the scanner, which exits 0, so a skipped repository counted as evidence that the scan completes                                               |
| D29 the runners exited 0 when they could not run                | an output path that could not be opened skipped the whole redirected block and reported success; a failed clone, checkout or `cd` was equally silent                                                                                                         |
| D30 the container's identity probes were prints                 | git, the index manifest, the capmap link and `capmap --version` were echoed with their values interpolated, so any of them failing still ended with "every command in the container exited 0"                                                                |
| D31 repository agreement was reduced to ids                     | tier was never compared, so an entry left at `active` after the configuration moved it to `external` would be recommended for reuse instead of capped at `REFERENCE`                                                                                         |
| D32 a criterion claimed more than its evidence                  | the report said `refresh --stale` "re-enriched exactly those five" from an excerpt printing four repositories out of twenty-seven; the criterion is now marked partial                                                                                       |
| D33 the drift section accepted any failure as success           | it required only a non-zero exit, so a crash or a usage error would have been published as proof that drift was detected — and the run then announced "every command above exited 0" while one section had deliberately exited 1                             |
| D34 a criterion was attributed to a run that never exercised it | the gate's drift-to-`UNRESOLVED` half was credited to a live transcript containing no occurrence of `UNRESOLVED`                                                                                                                                             |
| D35 the repository FILE tier was never compared                 | the gate reads `RepoIndex.tier` from the file, so a file left `active` while configuration and manifest agreed on `external` would be recommended for reuse instead of capped at `REFERENCE` — the tier boundary, bypassed by a field nothing compared       |
| D36 the negative controls proved nothing off this machine       | the consumer-edge cases ran against an index recording an absolute estate root, so on any other machine the checker failed before the mutation and the control "detected" a breakage that had done nothing                                                   |
| D37 the Linux runner appended to whatever transcript it found   | it never compared HEAD with the commit the transcript names, and the provenance checker reads only the first header, so a transcript mixing two commits could pass as "two clean clones of ONE commit"                                                       |
| D38 the line ceiling excluded the scripts                       | `scripts/` was outside the source roots, and one checker had reached 203 lines while the criterion said no file exceeds 200                                                                                                                                  |
| D39 the latency budget could be met by a hook that never ran    | `hook-latency.mjs` ignored the hook's exit code, so a missing or broken binary failed instantly, own work came out near zero, and the budget was reported comfortably met — by nothing                                                                       |
| D40 the MCP check could crash or hang                           | an unframed line on the server's stdout threw out of a readline handler and killed the checker with a stack trace instead of a verdict; a server that stayed up and answered nothing would have hung an unattended run for ever                              |
| D41 the macOS runner printed its entry points                   | `ls` on the four built entry points showed a reader whether they existed and told the runner nothing — the same defect as D30, in the other script                                                                                                           |
| D42 an empty count made a comparison pass                       | if the configured-repository count could not be read, `[ 27 -ne "" ]` is a bash error rather than a mismatch, and a comparison that errors is a comparison that passes                                                                                       |
| D43 the provenance check read one commit header                 | it validated the header and ignored the commit each platform section prints, so a transcript whose halves described different commits could still pass while claiming to be two clean clones of one                                                          |
| D44 the line ceiling exempted every shell script                | extending it to `scripts/` still matched only `.ts`, `.js` and `.mjs`, so `verify.sh` at 292 lines — the longest file in the repository — was exempt from the rule the transcript announced it was subject to                                                |
| D45 the report claimed Zod validation the checker did not do    | "configuration is read from `config/` and validated with Zod at load" was true of the CLI and not of `report-index.mjs`, which merely `JSON.parse`d both files, so an invalid configuration passed the gate whose subject is exactly that                    |
| D46 the latency ceiling was set from quiet machines only        | 50 ms was chosen from readings of 10 to 24 ms and failed a hosted macOS runner at 52.0 ms on unchanged code. The ceiling is now derived from two measured bounds: the slowest honest reading, and the 134 ms cost of the regression it exists to catch       |

## D21 deserves its name spelled out

The hook was correct. The evidence about the hook was not, and it failed in the
direction that reads as success. The matrix now supplies the configuration
itself and aborts if an ungated plan is not blocked, so a misconfiguration can
no longer be mistaken for a pass.

## How they arrived

In seven waves, and the shape of that matters more than any individual entry.

D21 to D25 came from one review round. **D26 to D28 came from the round that
examined the fixes for D21 to D25** — two were new checks introduced by those
fixes and were themselves unfalsifiable, and the third was a gate that could
only ever have passed on the machine that wrote it. D29 to D32 came from the
round after that; D33 to D38 from the round after that, and they include the
negative-control suite written specifically to end this class of defect, which
turned out to prove nothing on any machine but the one that wrote it.

**D39 to D43 were found without a reviewer**, by re-reading every script against
the single question the previous rounds had established: what would this print
if the thing it checks were false? The answer, five more times, was "a pass".
That is the useful outcome — not that the reviews found these, but that the
question they taught can now be asked directly.

## The lesson

It is not "check the checks", which is an infinite regress. It is:

1. A checker's default behaviour is to pass. Writing one establishes nothing.
2. Watching it pass establishes nothing either.
3. **Watching it fail establishes nothing unless you have first watched it pass
   on the unbroken input.** This is the one that took five rounds to learn: a
   control that observes a non-zero exit cannot tell a detected breakage from a
   checker that was already broken.

`scripts/check-negative-controls.mjs` now holds thirteen deliberate breakages,
each requiring exit 0 before the mutation and non-zero after, against a hermetic
fixture rather than any particular machine's estate. The first thing that
requirement did was fail one of its own cases.

```
13 deliberate breakages, each preceded by a passing baseline; 0 did not hold
```
