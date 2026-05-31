# Idea of what to build

Multi-agent real-time conversation system — like a Zoom call but with AI agents.

## 2 Main components (BE and FE)

### BE: Python script based
BE Requirements
- Need to talk to agents
- Each agent is a Pi session
- Ability to launch and manage pi processes

### FE: ElectronJS
- Each agent is shown as a Rectangle on screen (ie. Zoom call design)
- Each agent has a chat box

#### User Actions
- give folder access
- Add agent
- talk to agent (text or voice)

User flow: Prompt the user to add a folder. This opens up a local folder navigation. Once added, prompt the user to create an agent or set of agents. Once agent(s) are created, present the "Zoom" Agent screen.

---

## Progress

### Done
- [x] Electron app with folder selection, agent creation, agent grid UI
- [x] Pi RPC subprocess management (one per agent card, streaming output)
- [x] Text chat input per agent card
- [x] Voice input — mic button records audio via MediaRecorder (webm/opus)
- [x] Python backend (FastAPI) with `/transcribe` endpoint
- [x] Google Cloud Speech-to-Text integration (REST transport, uses ADC)
- [x] Audio sent from renderer → Electron main process (IPC) → backend (HTTP) → Google API → transcript injected as user message

### Next
- [ ] Persist conversation history (database or file-based)
- [ ] Support multiple agent backends (Claude, Codex, etc.) beyond Pi
- [ ] Text-to-speech for agent responses (Qwen TTS already in repo)
- [ ] Stream transcription for real-time voice input
