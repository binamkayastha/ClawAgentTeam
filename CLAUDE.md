# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Multi-agent real-time conversation system. Electron frontend with voice input, Python backend for speech-to-text, Pi RPC subprocesses as agent backends.

## How to run

### Backend (terminal 1)

```bash
cd backend
source .venv/bin/activate
uvicorn server:app --reload
```

Requires Google Cloud ADC: run `gcloud auth application-default login` first.

### Frontend (terminal 2)

```bash
npm install
npm start
```

### TTS (optional, Apple Silicon only)

```bash
./run "Hello world"                        # generate and play speech
./run "Hello world" --voice ryan           # specify voice
./run "Hello world" --output out.wav --no-play
```

Available voices: `serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan`

## Setup on a new machine

```bash
./setup.sh
```

Installs Node.js dependencies, the `pi` CLI (`@earendil-works/pi-coding-agent`), backend Python venv, TTS Python venv, and configures Google Cloud ADC.

## Key architecture decisions

- Voice audio goes: renderer (MediaRecorder) → main process (IPC) → Python backend (HTTP) → Google Speech API (REST transport). Direct fetch from renderer to backend doesn't work due to Electron's `file://` security restrictions.
- Google Speech client uses `transport="rest"` instead of gRPC — gRPC hangs on some networks.
- Backend uses Application Default Credentials (ADC) via `gcloud auth application-default login`. No service account key file needed.

## Project structure

- `electron-app/main.js` — Electron main process, Pi RPC management, audio transcription IPC handler
- `electron-app/preload.js` — IPC bridge exposing `piFlow` API to renderer
- `electron-app/src/renderer.js` — UI logic, voice recording, agent cards
- `backend/server.py` — FastAPI server with `/transcribe` endpoint (Google Cloud Speech)
- `backend/requirements.txt` — Python dependencies for the backend
- `tts.py` + `run` — Standalone Qwen3-TTS TTS using `mlx-audio` (Apple Silicon only)
- `plan.md` — Project plan with progress tracking
- `feature-gaps/windows-and-linux-support` — Research on cross-platform TTS options
