# Sections 5 to 9a: the hook's enforcement matrix and cost, search, consumer
# edges, capability verification and the drift it must notice, the MCP server,
# and the negative controls that require every gate above to be able to fail.
# Sourced by scripts/verify.sh, which owns the shell, the clone, the helpers and
# the redirection into the transcript. Split out because the runner passed the
# 200-line ceiling this repository applies to its own scripts — a ceiling that
# had quietly exempted every .sh in the directory, so the longest file in the
# repository was the one it was least true of.

# The dry run proves the pipeline reaches the end; it writes nothing, so it says
# nothing about the half of criterion 1 that is about producing an index. This
# writes one, into a scratch configuration whose index directory is its own, so
# the tracked artifact every other section is about stays untouched. Enrichment
# is the model-backed half and is deliberately absent, which is why the domain
# checks are skipped for this index and only for this index.
echo "=== 4b. FULL SCAN, writing an index (criterion 1) ==="
SCRATCH_PARENT="$(mktemp -d)"
SCRATCH="$SCRATCH_PARENT/capmap-scan"
mkdir -p "$SCRATCH"
SCRATCH_DIRS+=("$SCRATCH_PARENT")
cp -R "$CLONE/config" "$SCRATCH/config"
echo "\$ CAPMAP_CONFIG_DIR=<scratch> capmap scan --no-enrich"
WRITE_OUT="$(CAPMAP_CONFIG_DIR="$SCRATCH/config" ./node_modules/.bin/capmap scan --no-enrich 2>&1)"
WRITE_RC=$?
echo "index written to a scratch directory, not the tracked one:"
echo "  index.json:      $(test -f "$SCRATCH/index/index.json" && echo present || echo ABSENT)"
echo "  repo files:      $(ls "$SCRATCH/index/repos" 2>/dev/null | wc -l | tr -d ' ')"
echo "  tracked index untouched: $(git -C "$CLONE" status --porcelain index | wc -l | tr -d ' ') change(s)"
printf '%s\n' "$WRITE_OUT" | grep -v '"level"' | tail -2
echo "exit $WRITE_RC"
record "capmap scan --no-enrich" "$WRITE_RC"
echo "\$ node scripts/report-index.mjs --scanned-without-enrichment   (in the scratch directory)"
FRESH_OUT="$(cd "$SCRATCH" && node "$CLONE/scripts/report-index.mjs" --scanned-without-enrichment 2>&1)"
FRESH_RC=$?
printf '%s\n' "$FRESH_OUT"
echo "exit $FRESH_RC"; echo
record "the freshly written index is valid" "$FRESH_RC"

echo "=== 5. HOOK ENFORCEMENT MATRIX (criteria 8, 9) ==="
step "node scripts/hook-matrix.mjs" node scripts/hook-matrix.mjs

echo "=== 5a. HOOK LATENCY (criterion 8, cost) ==="
step "node scripts/hook-latency.mjs" node scripts/hook-latency.mjs

echo "=== 6. CAPABILITY SEARCH (criterion 3) ==="
step "capmap search billing --limit 3" ./node_modules/.bin/capmap search billing --limit 3

echo "=== 7. CONSUMER EDGES (criterion 4) ==="
step "node scripts/check-consumer-edges.mjs" node scripts/check-consumer-edges.mjs

echo "=== 8. CAPABILITY VERIFICATION (criterion 5) ==="
echo "\$ capmap verify   (last lines; one row per capability)"
./node_modules/.bin/capmap verify 2>&1 | tail -4
VERIFY_RC=${PIPESTATUS[0]}
echo "exit $VERIFY_RC"; echo
record "capmap verify" "$VERIFY_RC"

# 155 of 155 verifying shows the estate has not drifted. It does not show that
# verification would NOTICE drift, which is the half of criterion 5 that
# matters, and no section established it until now. A copy of the index is given
# an export that the source does not have — exactly what a renamed export looks
# like — and verification must report that capability as failed and exit 1.
echo "=== 8a. VERIFICATION NOTICES DRIFT (criterion 5) ==="
DRIFT_PARENT="$(mktemp -d)"
DRIFT="$DRIFT_PARENT/capmap-drift"
mkdir -p "$DRIFT"
SCRATCH_DIRS+=("$DRIFT_PARENT")
cp -R "$CLONE/config" "$DRIFT/config"
cp -R "$CLONE/index" "$DRIFT/index"
# The estate root in scan.config.json is relative, so the estate has to sit
# beside the index here. Without it every capability fails for a missing tree
# and the section "detects" drift it did not cause.
cp -R "$CLONE/example" "$DRIFT/example"
DRIFT_TARGET="$(node -e '
const { readFileSync, writeFileSync, readdirSync } = require("node:fs");
const dir = process.argv[1] + "/index/repos";
for (const file of readdirSync(dir)) {
  const repo = JSON.parse(readFileSync(dir + "/" + file, "utf8"));
  const entry = repo.packages.find((pkg) => pkg.exports.length > 0 && pkg.entry !== null);
  if (entry === undefined) continue;
  entry.exports.push("thisExportWasNeverThere");
  writeFileSync(dir + "/" + file, JSON.stringify(repo));
  process.stdout.write(entry.id);
  break;
}
' "$DRIFT")"
echo "\$ capmap verify   (against an index claiming an export that does not exist)"
echo "  drifted entry: $DRIFT_TARGET"
DRIFT_OUT="$(cd "$DRIFT" && CAPMAP_CONFIG_DIR="$DRIFT/config" "$CLONE/node_modules/.bin/capmap" verify 2>&1)"
DRIFT_RC=$?
printf '%s\n' "$DRIFT_OUT" | grep -E "failed|verified" | tail -3
echo "exit $DRIFT_RC"
# The expectation is exit 1 AND the drifted entry named with a failed export
# check. Accepting any non-zero exit would let a crash or a usage error be
# published as proof that drift was detected.
if [ "$DRIFT_RC" -ne 1 ] \
   || ! printf '%s\n' "$DRIFT_OUT" | grep -q "$DRIFT_TARGET" \
   || ! printf '%s\n' "$DRIFT_OUT" | grep -q "no longer exported: thisExportWasNeverThere"; then
  echo "NOT AS EXPECTED: this section requires exit 1 with $DRIFT_TARGET named"
  echo "                 and its missing export reported; anything else is not"
  echo "                 evidence that drift was noticed"
  record "verification notices drift" 1
else
  echo "as expected: exit 1, $DRIFT_TARGET reported with the missing export"
fi
echo

echo "=== 9. MCP SERVER over real stdio ==="
step "node scripts/check-mcp-tools.mjs" node scripts/check-mcp-tools.mjs

# Everything above reports that a check passed. This reports that the checks can
# fail, which is the claim two rounds of review found to be false eight times
# over. Each case corrupts a copy and requires the gate to notice.
echo "=== 9a. THE GATES CAN FAIL (negative controls) ==="
step "node scripts/check-negative-controls.mjs" node scripts/check-negative-controls.mjs

# Stated rather than left as a hole in the numbering. A reader should be able to
# see what this run did NOT establish without diffing it against an older one.
echo "=== NOT ESTABLISHED BY THIS RUN ==="
echo "  Three sections need a real model call and are therefore not part of"
echo "  this script:"
echo "    - live gate over four capabilities   (criteria 6, 6a)"
echo "    - live gate, employer-code boundary  (criterion 7)"
echo "    - capmap refresh --stale             (criterion 10)"
# Never interpolate the variable itself. `${VAR:-absent}` prints the KEY when it
# is set, which would put a live credential in a committed transcript.
echo "  ANTHROPIC_API_KEY in this environment: $([ -n "${ANTHROPIC_API_KEY:-}" ] && echo present || echo absent)"
echo "  Where those three criteria stand is stated in the acceptance report,"
echo "  against the commit that last exercised them — which is NOT necessarily"
echo "  the commit above."
echo
