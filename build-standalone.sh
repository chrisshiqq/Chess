#!/usr/bin/env bash
set -u

cd "$(dirname "$0")" || {
  echo "[ERROR] Cannot switch to the project directory."
  exit 1
}

pause_exit() {
  local code="${1:-0}"
  if [[ -t 0 ]]; then
    read -r -n 1 -s -p "Press any key to exit..."
    echo
  fi
  exit "$code"
}

fail() {
  echo
  echo "Build failed."
  pause_exit 1
}

echo "========================================"
echo " Chinese Chess - Standalone Build"
echo "========================================"
echo

if [[ ! -f "src/App.tsx" ]]; then
  echo "[ERROR] src/App.tsx not found"
  fail
fi
if [[ ! -f "src/worker/chess-worker.ts" ]]; then
  echo "[ERROR] src/worker/chess-worker.ts not found"
  fail
fi
if [[ ! -f "package.json" ]]; then
  echo "[ERROR] package.json not found"
  fail
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] node not found in PATH"
  echo "        Install Node.js or add it to PATH"
  fail
fi

if [[ ! -d "node_modules" ]]; then
  echo "[INFO] node_modules missing, running npm install..."
  npm install
  if [[ $? -ne 0 ]]; then
    echo "[ERROR] npm install failed"
    fail
  fi
  echo
fi

echo "[1/1] Building standalone bundle ..."
npm run build:standalone
if [[ $? -ne 0 ]]; then
  echo "[ERROR] standalone build failed"
  fail
fi

echo
echo "========================================"
echo " Build OK"
echo " Output: dist-standalone/index.html"
echo "========================================"
pause_exit 0
