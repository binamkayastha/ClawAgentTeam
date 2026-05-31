# CLAUDE.md

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

## Key architecture decisions

- Voice audio goes: renderer (MediaRecorder) → main process (IPC) → Python backend (HTTP) → Google Speech API (REST transport). Direct fetch from renderer to backend doesn't work due to Electron's `file://` security restrictions.
- Google Speech client uses `transport="rest"` instead of gRPC — gRPC hangs on some networks.
- Backend uses Application Default Credentials (ADC) via `gcloud auth application-default login`. No service account key file needed.

## Project structure

- `electron-app/main.js` — Electron main process, Pi RPC management, audio transcription IPC handler
- `electron-app/preload.js` — IPC bridge exposing `piFlow` API to renderer
- `electron-app/src/renderer.js` — UI logic, voice recording, agent cards
- `backend/server.py` — FastAPI server with `/transcribe` endpoint
- `plan.md` — Project plan with progress tracking
