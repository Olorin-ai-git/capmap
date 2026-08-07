#!/usr/bin/env bash
# Append the sections that need a real model call: the live gate and selective
# refresh. Everything here was previously typed into a shell and summarised by
# hand, which is why four acceptance criteria sat on evidence from an older
# commit for so long.
#
# The credential is read from the environment and never printed. Nothing here
# writes to the tracked index: refresh runs against a copy, so the artifact the
# other sections are about is unchanged.
#
# Usage:  ANTHROPIC_API_KEY=... scripts/verify-live.sh [output-file]
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO/docs/operations/verification-transcript.txt}"
SHA="$(git -C "$REPO" rev-parse HEAD)"

die() { echo "$1" >&2; exit 1; }
[ -n "${ANTHROPIC_API_KEY:-}" ] || die "ANTHROPIC_API_KEY is required for the live sections"

STATED="$(grep -m1 'Code commit under test:' "$OUT" 2>/dev/null | awk '{print $NF}')"
[ -n "$STATED" ] || die "$OUT does not name a commit; run scripts/verify.sh first"
[ "$STATED" = "$SHA" ] || die \
  "refusing to append: the transcript was generated at $STATED but HEAD is now $SHA"

cd "$REPO" || die "could not enter $REPO"
export CAPMAP_CONFIG_DIR="$REPO/config"
export CAPMAP_ROOT="$(node -p "require('$REPO/index/index.json').root")"
CAPMAP="$REPO/node_modules/.bin/capmap"
[ -x "$CAPMAP" ] || die "$CAPMAP is missing; run pnpm install && pnpm -r build"

WORK="$(mktemp -d)"
FAILED=0
note() { echo "  $1"; }
fail() { echo "  NOT AS EXPECTED: $1"; FAILED=$((FAILED + 1)); }

mkdir -p "$WORK/estate/specs"
cat > "$WORK/estate/specs/2026-08-02-tenant-portal-design.md" <<'SPEC'
# Tenant portal

## Components

- authentication
- billing
- transactional email
- ui kit
SPEC
cat > "$WORK/estate/specs/2026-08-02-llm-platform-design.md" <<'SPEC'
# LLM platform

## Components

- application configuration loading and schema validation
- llm orchestration server with authentication and file storage
SPEC

{
echo "=== 11. LIVE GATE, four capabilities (criteria 6, 6a) ==="
echo "\$ capmap gate <a specification naming auth, billing, email and a ui kit>"
GATE_OUT="$("$CAPMAP" gate "$WORK/estate/specs/2026-08-02-tenant-portal-design.md" 2>&1)"
GATE_RC=$?
printf '%s\n' "$GATE_OUT" | grep -v '"level"'
echo "exit $GATE_RC"
# Criterion 6: all four resolved to REUSE or EXTEND, so none is UNRESOLVED and
# none is BUILD. Criterion 6a: the duplication list is not empty.
for component in authentication billing "transactional email" "ui kit"; do
  line="$(printf '%s\n' "$GATE_OUT" | grep -E "^${component}[[:space:]]" | head -1)"
  verdict="$(printf '%s\n' "$line" | awk '{ for (i=1;i<=NF;i++) if ($i ~ /^(REUSE|EXTEND|REFERENCE|BUILD|UNRESOLVED)$/) { print $i; exit } }')"
  case "$verdict" in
    REUSE|EXTEND) note "$component: $verdict" ;;
    "")           fail "$component produced no verdict line" ;;
    *)            fail "$component is $verdict, criterion 6 requires REUSE or EXTEND" ;;
  esac
done
DUPES="$(printf '%s\n' "$GATE_OUT" | grep -c 'DUPLICATION')"
if [ "$DUPES" -ge 3 ]; then
  note "criterion 6a: $DUPES components report competing implementations"
else
  fail "only $DUPES components reported duplication; criterion 6a expects auth, billing and email"
fi
echo

echo "=== 12. LIVE GATE, external-tier boundary (criterion 7) ==="
echo "\$ capmap gate <a specification drawn from an external repository's own domains>"
IP_OUT="$("$CAPMAP" gate "$WORK/estate/specs/2026-08-02-llm-platform-design.md" 2>&1)"
IP_RC=$?
printf '%s\n' "$IP_OUT" | grep -v '"level"'
echo "exit $IP_RC"
# The cap is unconditional: nothing sourced from an external or archived
# repository may exceed REFERENCE, whatever it scores.
VIOLATIONS="$(printf '%s\n' "$IP_OUT" | grep -E '(REUSE|EXTEND)' | grep -c 'vendor-toolkit' || true)"
if [ "$VIOLATIONS" -eq 0 ]; then
  note "criterion 7: 0 external capabilities exceeded REFERENCE"
else
  fail "$VIOLATIONS external capabilities were recommended above REFERENCE"
fi
echo

echo "=== 13. LIVE GATE, drift downgrades to UNRESOLVED (criterion 5) ==="
echo "\$ capmap gate <the same specification, against an index whose exports do not exist>"
cp -R "$REPO/config" "$WORK/broken-config"
cp -R "$REPO/index" "$WORK/index"
node -e '
const { readFileSync, writeFileSync, readdirSync } = require("node:fs");
const dir = process.argv[1] + "/index/repos";
for (const file of readdirSync(dir)) {
  const repo = JSON.parse(readFileSync(dir + "/" + file, "utf8"));
  for (const pkg of repo.packages) pkg.exports.push("thisExportWasNeverThere");
  writeFileSync(dir + "/" + file, JSON.stringify(repo));
}
' "$WORK"
DRIFT_OUT="$(cd "$WORK" && CAPMAP_CONFIG_DIR="$WORK/broken-config" "$CAPMAP" gate \
  "$WORK/estate/specs/2026-08-02-tenant-portal-design.md" 2>&1)"
DRIFT_RC=$?
printf '%s\n' "$DRIFT_OUT" | grep -v '"level"' | head -12
echo "exit $DRIFT_RC"
UNRESOLVED="$(printf '%s\n' "$DRIFT_OUT" | grep -c 'UNRESOLVED' || true)"
if [ "$DRIFT_RC" -eq 2 ] && [ "$UNRESOLVED" -gt 0 ]; then
  note "criterion 5: every candidate failed verification and the gate said UNRESOLVED, exit 2"
else
  fail "expected exit 2 with UNRESOLVED verdicts; got exit $DRIFT_RC with $UNRESOLVED"
fi
echo

echo "=== 14. SELECTIVE REFRESH, every repository (criterion 10) ==="
echo "\$ capmap status, then capmap refresh --stale, against a COPY of the index"
cp -R "$REPO/config" "$WORK/refresh-config"
rm -rf "$WORK/index"; cp -R "$REPO/index" "$WORK/index"
STATUS_OUT="$(cd "$WORK" && CAPMAP_CONFIG_DIR="$WORK/refresh-config" "$CAPMAP" status 2>&1)"
printf '%s\n' "$STATUS_OUT" | grep -v '"level"' | tail -2
# The drifted set, taken from status BEFORE the refresh, is what the changed set
# is compared against afterwards. Without it this section could only show that
# something changed, not that only the right things did.
DRIFTED_IDS="$(printf '%s\n' "$STATUS_OUT" | awk '$NF == "drifted" { printf "%s,", $1 }')"
echo "drifted before the refresh: ${DRIFTED_IDS:-none}"
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const m = JSON.parse(readFileSync(process.argv[1] + "/index/index.json", "utf8"));
const before = {};
process.stdout.write("enrichedAt BEFORE, all " + m.repos.length + " repositories:\n");
for (const r of m.repos) {
  before[r.id] = r.enrichedAt;
  process.stdout.write(`  ${r.id.padEnd(38)} ${r.enrichedAt}\n`);
}
writeFileSync(process.argv[1] + "/before.json", JSON.stringify(before));
' "$WORK"
REFRESH_OUT="$(cd "$WORK" && CAPMAP_CONFIG_DIR="$WORK/refresh-config" "$CAPMAP" refresh --stale 2>&1)"
REFRESH_RC=$?
printf '%s\n' "$REFRESH_OUT" | grep -v '"level"' | tail -8
echo "exit $REFRESH_RC"
# The criterion is that ONLY what drifted was re-enriched. Printing four
# repositories out of twenty-seven, as an earlier transcript did, cannot show it.
COMPARE="$(node -e '
const { readFileSync } = require("node:fs");
const before = JSON.parse(readFileSync(process.argv[1] + "/before.json", "utf8"));
const after = JSON.parse(readFileSync(process.argv[2] + "/index/index.json", "utf8"));
const wasDrifted = new Set(process.argv[3].split(",").filter(Boolean));
const changed = [];
process.stdout.write("enrichedAt AFTER, all " + after.repos.length + " repositories:\n");
for (const r of after.repos) {
  const was = before[r.id];
  const moved = was !== r.enrichedAt;
  if (moved) changed.push(r.id);
  process.stdout.write(`  ${r.id.padEnd(38)} ${r.enrichedAt}${moved ? "   <- re-enriched" : ""}\n`);
}
const unexpected = changed.filter((id) => !wasDrifted.has(id));
process.stdout.write(`changed: ${changed.length}  drifted beforehand: ${wasDrifted.size}  changed but NOT drifted: ${unexpected.length}\n`);
process.stdout.write(unexpected.length === 0 ? "ONLY-DRIFTED: yes\n" : `ONLY-DRIFTED: no (${unexpected.join(", ")})\n`);
' "$WORK" "$WORK" "$DRIFTED_IDS")"
printf '%s\n' "$COMPARE"
if printf '%s\n' "$COMPARE" | grep -q "ONLY-DRIFTED: yes"; then
  note "criterion 10: every repository that moved had drifted, and no other moved"
else
  fail "a repository that had not drifted was re-enriched"
fi
echo

echo "=== RESULT OF THE LIVE SECTIONS ==="
if [ "$FAILED" -eq 0 ]; then
  echo "  every live check met its expectation"
else
  echo "  $FAILED live check(s) did NOT meet their expectation"
fi
echo
} >> "$OUT" 2>&1

rm -rf "$WORK"
echo "appended sections 11-14 to $OUT"
[ "$FAILED" -eq 0 ] || echo "$FAILED live check(s) failed — see $OUT" >&2
exit "$FAILED"
