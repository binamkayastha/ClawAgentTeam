#!/usr/bin/env bash
# Tests for setup.sh using PATH-based stubs. No real installs happen for
# early-exit tests; later tests reuse the already-bootstrapped repo state.
set -uo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
OUT=""; CODE=0

ok()   { echo "  PASS: $*"; (( PASS++ )); }
fail() { echo "  FAIL: $*"; (( FAIL++ )); }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Create a temp dir of stub executables. Each arg is "cmd=script_body".
make_stubs() {
  local dir; dir=$(mktemp -d)
  for kv in "$@"; do
    local cmd="${kv%%=*}"
    local body="${kv#*=}"
    printf '#!/usr/bin/env bash\n%s\n' "$body" > "$dir/$cmd"
    chmod +x "$dir/$cmd"
  done
  echo "$dir"
}

# Isolated run: clean environment so only $stubs and /bin are in PATH.
# Use for early-exit tests — real node/python3/gcloud won't be found.
run_isolated() {
  local stubs="$1"
  OUT=$(env -i HOME="$HOME" PATH="$stubs:/bin" bash "$REPO/setup.sh" 2>&1) \
    && CODE=0 || CODE=$?
}

# Full run: prepend stubs to the real PATH.
# Use for tests that exercise venv/pip/npm steps (real tools needed for those).
run_full() {
  local stubs="$1"
  OUT=$(PATH="$stubs:$PATH" bash "$REPO/setup.sh" 2>&1) \
    && CODE=0 || CODE=$?
}

assert_fails()    {
  local desc="$1"
  if [[ $CODE -ne 0 ]]; then ok "$desc"; else fail "$desc (expected non-zero exit, got 0)"; fi
}
assert_succeeds() {
  local desc="$1"
  if [[ $CODE -eq 0 ]]; then ok "$desc"; else fail "$desc (exited $CODE): $OUT"; fi
}
assert_output()   {
  local desc="$1" pattern="$2"
  if echo "$OUT" | grep -q "$pattern"; then ok "$desc"
  else fail "$desc (pattern '$pattern' not in output)"; fi
}

# ---------------------------------------------------------------------------
# Shared stub bodies
# ---------------------------------------------------------------------------

STUB_UNAME='case "$1" in -s) echo Darwin;; -m) echo arm64;; esac'

STUB_NODE='
case "${1-}" in
  --version) echo v22.0.0; exit 0 ;;
  -e)        echo 22;      exit 0 ;;  # node -e "...major..."
esac'

STUB_PYTHON3='
case "${1-}" in
  -c)
    case "${2-}" in
      *version_info.minor*) echo 13 ;;
      *version_info.major*) echo 3  ;;
    esac
    exit 0 ;;
  -m)
    case "${2-}" in
      venv)
        dir="${3-}"
        mkdir -p "$dir/bin"
        printf "#!/bin/bash\nif [[ \"\${1-}\" == \"-m\" ]]; then exit 0; fi\n" > "$dir/bin/python"
        chmod +x "$dir/bin/python"
        exit 0 ;;
      pip) exit 0 ;;
    esac ;;
esac'

STUB_GCLOUD='
if [[ "${1-}" == "auth" && "${2-}" == "application-default" && "${3-}" == "print-access-token" ]]; then
  echo "fake-token"; exit 0
fi'

STUB_PI='echo "1.0.0"'

STUB_NPM='exit 0'

# ---------------------------------------------------------------------------
# 1. Platform guard — non-Apple Silicon
# ---------------------------------------------------------------------------
echo "--- Platform check ---"
S=$(make_stubs "uname=case \"\$1\" in -s) echo Darwin;; -m) echo x86_64;; esac")
run_isolated "$S"
assert_fails   "rejects non-arm64 Mac"
assert_output  "error mentions Apple Silicon" "Apple Silicon"
rm -rf "$S"

# ---------------------------------------------------------------------------
# 2. Node.js — missing
# ---------------------------------------------------------------------------
echo "--- Node.js checks ---"
S=$(make_stubs "uname=$STUB_UNAME")  # no node stub → not found
run_isolated "$S"
assert_fails  "rejects missing node"
assert_output "error mentions Node.js not installed" "Node.js is not installed"
rm -rf "$S"

# 3. Node.js — version too old
S=$(make_stubs "uname=$STUB_UNAME" \
  "node=case \"\${1-}\" in --version) echo v16.0.0;; -e) echo 16;; esac")
run_isolated "$S"
assert_fails  "rejects node 16"
assert_output "error mentions Node.js 18+" "Node.js 18+"
rm -rf "$S"

# ---------------------------------------------------------------------------
# 4. Python — missing
# ---------------------------------------------------------------------------
echo "--- Python checks ---"
# No python3 stub and /usr/bin excluded → truly missing
S=$(make_stubs "uname=$STUB_UNAME" "node=$STUB_NODE")
run_isolated "$S"
assert_fails  "rejects missing python3"
assert_output "error mentions Python 3.11+" "Python 3.11+"
rm -rf "$S"

# 5. Python — version too old (3.9)
S=$(make_stubs "uname=$STUB_UNAME" "node=$STUB_NODE" \
  "python3=case \"\${1-}\" in -c)
    case \"\${2-}\" in *version_info.minor*) echo 9;; *version_info.major*) echo 3;; esac
    exit 0;; esac")
run_isolated "$S"
assert_fails  "rejects python 3.9"
assert_output "error mentions Python 3.11+" "Python 3.11+"
rm -rf "$S"

# ---------------------------------------------------------------------------
# 6. gcloud — missing
# ---------------------------------------------------------------------------
echo "--- gcloud check ---"
S=$(make_stubs "uname=$STUB_UNAME" "node=$STUB_NODE" "python3=$STUB_PYTHON3")
run_isolated "$S"
assert_fails  "rejects missing gcloud"
assert_output "error mentions gcloud CLI" "gcloud CLI is not installed"
rm -rf "$S"

# ---------------------------------------------------------------------------
# 7. pi already installed → skip message
# ---------------------------------------------------------------------------
echo "--- pi CLI ---"
S=$(make_stubs "uname=$STUB_UNAME" "node=$STUB_NODE" "python3=$STUB_PYTHON3" \
  "gcloud=$STUB_GCLOUD" "pi=$STUB_PI" "npm=$STUB_NPM")
run_full "$S"
assert_output "skips pi install when present" "already installed"
rm -rf "$S"

# ---------------------------------------------------------------------------
# 8. pi missing → npm install -g is called
# ---------------------------------------------------------------------------
# Uses run_isolated so the real pi (in nvm bin) is not found.
echo "--- pi install ---"
NPM_LOG=$(mktemp)
S=$(make_stubs "uname=$STUB_UNAME" "node=$STUB_NODE" "python3=$STUB_PYTHON3" \
  "gcloud=$STUB_GCLOUD" \
  "npm=echo \"npm \$*\" >> \"$NPM_LOG\"; exit 0")
run_isolated "$S"
if grep -q "install -g @earendil-works/pi-coding-agent" "$NPM_LOG"; then
  ok "calls npm install -g for pi when missing"
else
  fail "calls npm install -g for pi when missing (not found in npm log)"
fi
rm -rf "$S"; rm -f "$NPM_LOG"

# ---------------------------------------------------------------------------
# 9. Happy path — exits 0 and prints completion message
# ---------------------------------------------------------------------------
echo "--- Happy path ---"
S=$(make_stubs "uname=$STUB_UNAME" "node=$STUB_NODE" "python3=$STUB_PYTHON3" \
  "gcloud=$STUB_GCLOUD" "pi=$STUB_PI" "npm=$STUB_NPM")
run_full "$S"
assert_succeeds "happy path exits 0"
assert_output   "happy path prints Setup complete" "Setup complete"
rm -rf "$S"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
