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

# ── gcloud CLI ────────────────────────────────────────────────────────────────
if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud CLI is not installed." >&2
  echo "Install it from https://cloud.google.com/sdk/docs/install, then re-run this script." >&2
  exit 1
fi

# ── pi CLI ────────────────────────────────────────────────────────────────────
echo "Installing pi coding agent..."
npm install -g @earendil-works/pi-coding-agent

# ── Electron app ──────────────────────────────────────────────────────────────
echo "Installing Electron app dependencies..."
npm install

# ── Backend venv ──────────────────────────────────────────────────────────────
echo "Setting up backend Python venv..."
if [[ ! -x backend/.venv/bin/python ]]; then
  python3 -m venv backend/.venv
fi
backend/.venv/bin/python -m pip install -q -U pip
backend/.venv/bin/python -m pip install -q -r backend/requirements.txt

# ── TTS venv ──────────────────────────────────────────────────────────────────
echo "Setting up TTS Python venv..."
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -q -U pip
.venv/bin/python -m pip install -q -r requirements.txt

# ── Google Cloud ADC ─────────────────────────────────────────────────────────
echo ""
if gcloud auth application-default print-access-token &>/dev/null; then
  echo "Google Cloud ADC: already configured."
else
  echo "Google Cloud ADC is not configured. Running login..."
  gcloud auth application-default login
fi

echo ""
echo "Setup complete."
echo ""
echo "  Backend:   cd backend && source .venv/bin/activate && uvicorn server:app --reload"
echo "  Frontend:  npm start"
echo "  TTS:       ./run \"Hello world\""
echo ""
echo "Before running pi agents, set your provider API key, e.g.:"
echo "  export ANTHROPIC_API_KEY=..."
echo "  export GOOGLE_API_KEY=..."
