#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ── Platform check ────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "ERROR: This project requires Apple Silicon macOS." >&2
  exit 1
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Install it from https://nodejs.org or via nvm." >&2
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if (( NODE_MAJOR < 18 )); then
  echo "ERROR: Node.js 18+ required (found $(node --version))." >&2
  exit 1
fi

# ── Python ────────────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "ERROR: Python 3.11+ is not installed. Install it from https://python.org." >&2
  exit 1
fi

PYTHON_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")
PYTHON_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
if (( PYTHON_MAJOR < 3 || (PYTHON_MAJOR == 3 && PYTHON_MINOR < 11) )); then
  echo "ERROR: Python 3.11+ required (found $(python3 --version))." >&2
  exit 1
fi

# ── pi CLI ────────────────────────────────────────────────────────────────────
echo "Installing pi coding agent..."
npm install -g @earendil-works/pi-coding-agent

# ── Electron app ─────────────────────────────────────────────────────────────
echo "Installing Electron app dependencies..."
npm install

# ── Python venv + mlx-audio ───────────────────────────────────────────────────
echo "Setting up Python venv and installing mlx-audio..."
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -q -U pip
.venv/bin/python -m pip install -q -r requirements.txt

echo ""
echo "Setup complete."
echo ""
echo "  Electron app:  npm start"
echo "  TTS:           ./run \"Hello world\""
echo ""
echo "Before running pi agents, set your provider API key, e.g.:"
echo "  export ANTHROPIC_API_KEY=..."
echo "  export GOOGLE_API_KEY=..."
