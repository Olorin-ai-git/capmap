# Sections 1 to 4b: build from nothing, the quality gates, the tests, the
# index, and the two scans — the deterministic pipeline and the writing one.
# Sourced by scripts/verify.sh, which owns the shell, the clone, the helpers and
# the redirection into the transcript. Split out because the runner passed the
# 200-line ceiling this repository applies to its own scripts — a ceiling that
# had quietly exempted every .sh in the directory, so the longest file in the
# repository was the one it was least true of.

echo "=== 1. BUILD FROM NOTHING ==="
echo "\$ ls packages/capmap-cli/dist"; ls packages/capmap-cli/dist 2>&1 | head -1; echo
step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
echo "\$ ls -l node_modules/.bin/capmap"; ls -l node_modules/.bin/capmap 2>&1 | head -1
assert "capmap linked by install alone" test -x node_modules/.bin/capmap
echo
step "pnpm -r build" pnpm -r build
echo "\$ the four entry points exist"
assert "packages/capmap-core/dist/index.js" test -f packages/capmap-core/dist/index.js
assert "packages/capmap-cli/dist/bin.js  " test -f packages/capmap-cli/dist/bin.js
assert "packages/capmap-mcp/dist/server.js" test -f packages/capmap-mcp/dist/server.js
assert "hooks/dist/gate-hook.js          " test -f hooks/dist/gate-hook.js
echo
step "pnpm exec capmap --version" pnpm exec capmap --version

echo "=== 2. QUALITY GATES ==="
step "pnpm typecheck" pnpm typecheck
step "pnpm lint" pnpm lint
step "node scripts/check-forbidden-terms.mjs" node scripts/check-forbidden-terms.mjs

echo "=== 3. TESTS AND COVERAGE (criterion 11) ==="
echo "\$ ANTHROPIC_API_KEY= vitest run --coverage"
ANTHROPIC_API_KEY="" ./node_modules/.bin/vitest run --coverage --reporter=basic 2>&1 \
  | grep -E "Test Files|Tests |All files|ERROR| FAIL "
TESTS_RC=${PIPESTATUS[0]}
echo "exit $TESTS_RC"; echo
record "vitest run --coverage" "$TESTS_RC"

echo "=== 4. INDEX IDENTITY (criteria 1, 2) ==="
step "node scripts/report-index.mjs" node scripts/report-index.mjs

# Criterion 1 says the scan COMPLETES, which reading a tracked index cannot
# show. The dry run exercises the whole deterministic pipeline over every
# configured repository and writes nothing, so it neither needs a credential nor
# disturbs the index the sections above and below are about.
echo "=== 4a. FULL SCAN, deterministic half (criterion 1) ==="
echo "\$ capmap scan --dry-run"
SCAN_OUT="$(./node_modules/.bin/capmap scan --dry-run 2>&1)"; SCAN_RC=$?
SCANNED=$(printf '%s\n' "$SCAN_OUT" | grep -c 'repository scanned')
# Defaulted to -1 rather than empty: an empty value makes the comparison below a
# bash error rather than a mismatch, and a comparison that errors is a comparison
# that passes.
CONFIGURED=$(node -p "require('$CLONE/config/repos.json').repos.length" 2>/dev/null || echo -1)
UNAVAILABLE=$(printf '%s\n' "$SCAN_OUT" | grep -c '(unavailable)')
echo "repositories scanned: $SCANNED"
echo "configured:           $CONFIGURED"
echo "unavailable:          $UNAVAILABLE"
printf '%s\n' "$SCAN_OUT" | grep -v '"level"' | tail -3
echo "exit $SCAN_RC"
# The command exits 0 when a repository is unavailable — it is a result, not a
# fault. For criterion 1 it is a fault: a scan that skipped a configured
# repository has not shown that the scan completes over the estate.
if [ "$SCANNED" -ne "$CONFIGURED" ] || [ "$UNAVAILABLE" -ne 0 ]; then
  echo "MISMATCH: $SCANNED of $CONFIGURED repositories scanned, $UNAVAILABLE unavailable"
  record "capmap scan --dry-run covered every configured repository" 1
fi
echo
record "capmap scan --dry-run" "$SCAN_RC"
