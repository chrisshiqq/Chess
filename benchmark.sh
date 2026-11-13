#!/usr/bin/env bash
set -u

cd "$(dirname "$0")" || {
  echo "ERROR: Cannot switch to the project directory."
  exit 1
}

# Usage: benchmark.sh [depth] [play|analysis|both] [latest|cpuperf|profile]
DEPTH="${1:-12}"
MODE="${2:-play}"
PATHMODE="${3:-latest}"

pause_exit() {
  local code="${1:-0}"
  if [[ -t 0 ]]; then
    echo "Press any key to exit..."
    read -r -n 1 -s
    echo
  fi
  exit "$code"
}

fail() {
  echo
  echo "Benchmark was not started."
  pause_exit 1
}

if ! [[ "$DEPTH" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Invalid depth \"${DEPTH}\". Expected an integer from 1 to 255."
  fail
fi
if ! DEPTH_VALUE=$((10#$DEPTH)) 2>/dev/null; then
  echo "ERROR: Invalid depth \"${DEPTH}\". Expected an integer from 1 to 255."
  fail
fi
if (( DEPTH_VALUE < 1 || DEPTH_VALUE > 255 )); then
  echo "ERROR: Invalid depth \"${DEPTH}\". Expected an integer from 1 to 255."
  fail
fi
DEPTH="$DEPTH_VALUE"

MODE_LC="$(printf '%s' "$MODE" | tr '[:upper:]' '[:lower:]')"
case "$MODE_LC" in
  play|analysis|both) ;;
  *)
    echo "ERROR: Invalid mode \"${MODE}\". Expected play, analysis, or both."
    fail
    ;;
esac

PATH_LC="$(printf '%s' "$PATHMODE" | tr '[:upper:]' '[:lower:]')"
case "$PATH_LC" in
  latest|cpuperf|profile) ;;
  *)
    echo "ERROR: Invalid path \"${PATHMODE}\". Expected latest, cpuperf, or profile."
    fail
    ;;
esac

OUT="scripts/bench-d${DEPTH}-${PATHMODE}.txt"

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node was not found in PATH."
  fail
fi
if [[ ! -f "scripts/bench-search.mjs" ]]; then
  echo "ERROR: scripts/bench-search.mjs was not found."
  fail
fi
if [[ ! -f "scripts/bench-worker.mjs" ]]; then
  echo "ERROR: scripts/bench-worker.mjs was not found."
  fail
fi
if [[ ! -f "src/engine/js/search.js" ]]; then
  echo "ERROR: src/engine/js/search.js was not found."
  fail
fi

echo "Running modular engine benchmark: depth=${DEPTH}, mode=${MODE}, path=${PATHMODE}"
echo "Output will be written to: ${OUT}"
echo

EXIT_CODE=0
node scripts/bench-search.mjs "$DEPTH" "$MODE" "$PATHMODE" > "$OUT" 2>&1 || EXIT_CODE=$?

if [[ -f "$OUT" ]]; then
  cat "$OUT"
else
  echo "ERROR: Benchmark did not create ${OUT}."
  EXIT_CODE=1
fi

echo
echo "Log saved: ${OUT}"
if [[ "$EXIT_CODE" -ne 0 ]]; then
  echo "ERROR: Benchmark exited with code ${EXIT_CODE}."
fi
pause_exit "$EXIT_CODE"
