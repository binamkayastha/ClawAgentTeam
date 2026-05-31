# ClawAgentTeam

Multi-agent real-time conversation system. Each agent runs as a Pi RPC session in an Electron UI with voice input via Google Cloud Speech-to-Text.

## Architecture

```
Electron App (frontend)
  ├── Agent cards with chat + mic button
  ├── MediaRecorder captures audio (webm/opus)
  └── Sends audio to Python backend via HTTP

Python Backend (backend/)
  └── POST /transcribe → Google Cloud Speech-to-Text → returns text

Pi RPC subprocesses
  └── One per agent card, managed by Electron main process
```

## Prerequisites

- Node.js 18+
- Python 3.11+
- [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed
- Google Cloud project with Speech-to-Text API enabled
- `pi` CLI installed and on PATH

## Google Cloud setup

### First-time setup

1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) if you haven't already.

2. Log in and set Application Default Credentials (ADC):

```bash
gcloud auth application-default login
```

This opens a browser. Sign in with your Google account that has access to the project. The credentials are saved locally and picked up automatically by the backend.

3. Make sure Speech-to-Text API is enabled on your project:

```bash
gcloud services enable speech.googleapis.com --project=hackaton-497919
```

### Switching Google Cloud accounts

If you already have `gcloud` configured with a different account:

```bash
# See which accounts are configured
gcloud auth list

# Switch active account
gcloud config set account YOUR_EMAIL@gmail.com

# Re-login for Application Default Credentials (this is separate from gcloud auth)
gcloud auth application-default login
```

> **Note:** `gcloud auth login` and `gcloud auth application-default login` are different. The first authenticates the `gcloud` CLI itself. The second creates credentials that libraries (like our Python backend) use. You need both.

### Verify credentials work

```bash
gcloud auth application-default print-access-token
```

If this prints a token, you're good.

## Quick start

### 1. Start the transcription backend

```bash
cd backend

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate

# Install dependencies inside the venv
pip install -r requirements.txt

# Run the server
uvicorn server:app --reload
```

The backend runs on `http://localhost:8000`. Verify with:

```bash
curl http://localhost:8000/health
```

> **Important:** Always activate the virtual environment (`source .venv/bin/activate`) before running the backend. Do NOT install packages globally.

### 2. Start the Electron app

```bash
npm install
npm start
```

### 3. Use it

1. Click **ADD FOLDER** and select your project directory.
2. Click **Add Agent** to spawn a Pi agent session.
3. Type in the chat box to talk to the agent, or click **Mic** to use voice input.
4. Click **Mic** again to stop recording — your speech is transcribed and sent to the agent automatically.

## Project structure

```
├── backend/
│   ├── server.py              # FastAPI transcription server
│   └── requirements.txt       # Python dependencies
├── electron-app/
│   ├── main.js                # Electron main process, Pi RPC management
│   ├── preload.js             # IPC bridge
│   └── src/
│       ├── index.html         # App shell
│       ├── renderer.js        # UI logic, voice recording, agent cards
│       └── styles.css         # Styles
├── tts.py                     # Qwen TTS script (standalone)
├── run                        # Qwen TTS runner (standalone)
└── plan.md                    # Original project plan
```

## What's next

- Persist conversation history (database or file-based)
- Support multiple agent backends (Claude, Codex, etc.) beyond Pi
- Add text-to-speech for agent responses
- Stream transcription for real-time voice input
