#!/usr/bin/env bash
# Build and test the commit under verification a second time, on Linux.
#
# Committed for the same reason as verify.sh: this section was previously a
# docker command typed into a shell and summarised by hand. It is the section
# that matters most, because "expected to pass" has been wrong here twice — the
# first Linux run found a latency contract that asserted wall-clock milliseconds,
# which is a property of the machine and not of this code.
#
# Usage:  scripts/verify-linux.sh [output-file]
#         appends section 10 to the transcript verify.sh wrote.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO/docs/operations/verification-transcript.txt}"
IMAGE="${CAPMAP_LINUX_IMAGE:-node:22-bookworm-slim}"

# Native Linux by default, not emulated x86_64. Emulation is a real environment
# for path and shell assumptions but a poor one for timing: it multiplies the
# hook's own work by roughly six — 95 ms there against 10 to 24 ms on real
# hardware — so a cost measurement taken under it describes the emulator. Set
# CAPMAP_LINUX_PLATFORM=linux/amd64 to run the cross-architecture pass anyway.
case "$(uname -m)" in
  arm64|aarch64) HOST_PLATFORM="linux/arm64" ;;
  *)             HOST_PLATFORM="linux/amd64" ;;
esac
PLATFORM="${CAPMAP_LINUX_PLATFORM:-$HOST_PLATFORM}"
SHA="$(git -C "$REPO" rev-parse HEAD)"
CLONE_PARENT="$(mktemp -d)"
CLONE="$CLONE_PARENT/capmap-linux"

die() { echo "$1" >&2; exit 1; }

# The transcript claims two clean clones of ONE commit. Nothing enforced that: if
# HEAD moved between verify.sh and this script, the Linux section would be
# appended to a macOS section describing different code. Two guards now exist,
# and this is the first — check-transcript-provenance.mjs, which compares every
# commit the transcript names rather than only its header, is the second.
STATED="$(grep -m1 'Code commit under test:' "$OUT" 2>/dev/null | awk '{print $NF}')"
[ -n "$STATED" ] || die "$OUT does not name a commit; run scripts/verify.sh first"
[ "$STATED" = "$SHA" ] || die \
  "refusing to append: the transcript was generated at $STATED but HEAD is now $SHA. Re-run scripts/verify.sh."

git clone -q "$REPO" "$CLONE" || die "could not clone $REPO into $CLONE"
git -C "$CLONE" checkout -q "$SHA" || die "could not check out $SHA in the clone"

# The clone is mounted rather than cloned inside the container: the slim image
# carries no git, and mounting keeps the container's copy identical to the
# commit by construction.
{
echo "=== 10. LINUX, second clean clone of the SAME commit ==="
echo "\$ docker run --platform $PLATFORM $IMAGE  <install, build, gates, matrix, tests>"
docker run --rm --platform "$PLATFORM" -v "$CLONE:/w" -w /w "$IMAGE" bash -c '
set -u
# Failures are counted, not merely printed: the container must exit nonzero so
# the host can tell a completed run from a successful one.
FAILED=0
step() {
  local label="$1"; shift
  local o rc
  o="$("$@" 2>&1)"; rc=$?
  echo "$label   exit $rc"
  echo "$o" | tail -3
  [ "$rc" -eq 0 ] || FAILED=$((FAILED + 1))
}
# Every probe below is an assertion, not a print. They used to be echoed with
# their values interpolated, so a missing git, an unreadable index, an absent
# capmap link or a broken --version all ended with "every command in the
# container exited 0".
assert() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "$label   ok"; else echo "$label   FAILED"; FAILED=$((FAILED + 1)); fi
}
echo "commit: '"$SHA"'"
echo "host:   $(uname -srm)   node: $(node --version)"
# The slim image carries no git. Two suites shell out to it — one materialises
# fixture repositories from committed dot-git markers — and without it they fail
# with ENOENT, which says nothing about this code.
apt-get -qq update >/dev/null 2>&1 && apt-get -qq install -y --no-install-recommends git >/dev/null 2>&1
echo "git:    $(git --version 2>&1)"
assert "git present                    " git --version
echo "index generatedAt (same tracked artifact): $(node -p "require(\"/w/index/index.json\").generatedAt" 2>&1)"
assert "index manifest readable        " node -e "if(!require(\"/w/index/index.json\").generatedAt) process.exit(1)"
corepack enable >/dev/null 2>&1
step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
assert "capmap linked by install alone " test -x node_modules/.bin/capmap
step "pnpm -r build                   " pnpm -r build
echo "pnpm exec capmap --version:      $(pnpm exec capmap --version 2>&1)"
assert "capmap --version               " pnpm exec capmap --version
step "pnpm typecheck                  " pnpm typecheck
step "pnpm lint                       " pnpm lint
step "source constraints              " node scripts/check-forbidden-terms.mjs
step "hook enforcement matrix         " node scripts/hook-matrix.mjs
step "hook latency                    " node scripts/hook-latency.mjs
echo "$ ANTHROPIC_API_KEY= vitest run --coverage"
ANTHROPIC_API_KEY="" ./node_modules/.bin/vitest run --coverage --reporter=basic 2>&1 \
  | grep -E "Test Files|Tests |All files|ERROR"
[ "${PIPESTATUS[0]}" -eq 0 ] || FAILED=$((FAILED + 1))
if [ "$FAILED" -eq 0 ]; then echo "every command in the container exited 0"; else echo "$FAILED command(s) FAILED in the container"; fi
exit "$FAILED"
'
DOCKER_RC=$?
echo "exit $DOCKER_RC"
echo
} >> "$OUT" 2>&1

# The container writes node_modules into the mounted clone, so this is ~100 MB.
if [ "$DOCKER_RC" -eq 0 ]; then
  rm -rf "$CLONE_PARENT" 2>/dev/null
else
  echo "kept for inspection: $CLONE_PARENT" >&2
fi

echo "appended section 10 to $OUT"
if [ "$DOCKER_RC" -ne 0 ]; then
  echo "the Linux run FAILED (docker exit $DOCKER_RC) — see $OUT" >&2
fi
exit "$DOCKER_RC"
