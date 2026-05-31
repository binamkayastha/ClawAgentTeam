const voiceState = new Map();

async function getMediaRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return new MediaRecorder(stream, { mimeType: "audio/webm" });
}

async function toggleRecording(agentId, micButton) {
  let vs = voiceState.get(agentId);

  if (vs && vs.recording) {
    vs.recording = false;
    micButton.classList.remove("recording");
    micButton.textContent = "Mic";
    if (vs.recorder && vs.recorder.state === "recording") {
      vs.recorder.stop();
    }
    return;
  }

  if (!vs) {
    try {
      const recorder = await getMediaRecorder();
      vs = { recorder, chunks: [], recording: false };
      voiceState.set(agentId, vs);
    } catch (err) {
      console.warn("Microphone access denied:", err);
      return;
    }
  }

  vs.chunks = [];
  vs.recording = true;
  micButton.classList.add("recording");
  micButton.textContent = "Stop";

  vs.recorder.ondataavailable = (e) => {
    if (e.data.size > 0) vs.chunks.push(e.data);
  };

  vs.recorder.onstop = async () => {
    console.log("[voice] onstop fired, chunks:", vs.chunks.length);
    const blob = new Blob(vs.chunks, { type: "audio/webm" });
    vs.chunks = [];
    console.log("[voice] blob size:", blob.size);
    if (blob.size === 0) return;

    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) return;

    agent.transcript.push({ role: "system", text: "Transcribing..." });
    const log = document.querySelector(`.chat-log[data-agent-id="${agentId}"]`);
    if (log) renderTranscript(log, agent.transcript);

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      console.log("[voice] sending audio to main process, bytes:", uint8.length);
      const data = await window.piFlow.transcribeAudio(uint8);
      console.log("[voice] transcription response:", data);

      agent.transcript.pop();

      if (data.transcript) {
        agent.transcript.push({ role: "user", text: data.transcript });
        if (log) renderTranscript(log, agent.transcript);
        const result = await window.piFlow.sendMessage({ id: agentId, text: data.transcript });
        if (!result.ok) {
          agent.transcript.push({ role: "system", text: result.error });
          if (log) renderTranscript(log, agent.transcript);
        }
      } else {
        agent.transcript.pop();
        agent.transcript.push({ role: "system", text: "Could not transcribe audio. Try again." });
        if (log) renderTranscript(log, agent.transcript);
      }
    } catch (err) {
      console.error("[voice] transcription error:", err);
      agent.transcript.pop();
      agent.transcript.push({ role: "system", text: `Transcription failed: ${err.message}` });
      if (log) renderTranscript(log, agent.transcript);
    }
  };

  vs.recorder.start();
}

const state = {
  folder: null,
  agents: []
};

const emptyState = document.querySelector("#emptyState");
const setupState = document.querySelector("#setupState");
const agentsState = document.querySelector("#agentsState");
const chooseFolderButton = document.querySelector("#chooseFolderButton");
const createFirstAgentButton = document.querySelector("#createFirstAgentButton");
const addAgentButton = document.querySelector("#addAgentButton");
const setupFolderName = document.querySelector("#setupFolderName");
const workspaceFolderName = document.querySelector("#workspaceFolderName");
const agentGrid = document.querySelector("#agentGrid");
const rolePicker = document.querySelector("#agentRolePicker");
const roleSelect = document.querySelector("#agentRoleSelect");
const modelSelect = document.querySelector("#agentModelSelect");
const roleCreateButton = document.querySelector("#agentRoleCreate");
const roleCancelButton = document.querySelector("#agentRoleCancel");
const summaryPanel = document.querySelector("#summaryPanel");
const summaryList = document.querySelector("#summaryList");
const relayToggle = document.querySelector("#relayToggle");

let availableModels = null;

function modelValue(model) {
  return `${model.provider}::${model.id}`;
}

function modelLabel(model) {
  return model.name || `${model.provider}/${model.id}`;
}

function parseModelValue(value) {
  if (!value) {
    return null;
  }

  const separator = value.indexOf("::");
  if (separator === -1) {
    return null;
  }

  return {
    provider: value.slice(0, separator),
    modelId: value.slice(separator + 2)
  };
}

function applyCardModelSelection(selectEl, modelInfo) {
  if (!modelInfo || !modelInfo.id) {
    return;
  }

  const value = modelValue(modelInfo);
  let option = Array.from(selectEl.options).find((item) => item.value === value);
  if (!option) {
    option = document.createElement("option");
    option.value = value;
    option.textContent = modelLabel(modelInfo);
    selectEl.append(option);
  }

  selectEl.value = value;
}

function populateModelSelect(selectEl, models, { includeDefault = true } = {}) {
  const options = [];

  if (includeDefault) {
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default (Pi decides)";
    options.push(defaultOption);
  }

  for (const model of models || []) {
    const option = document.createElement("option");
    option.value = modelValue(model);
    option.textContent = modelLabel(model);
    options.push(option);
  }

  selectEl.replaceChildren(...options);
}

function showScreen(name) {
  emptyState.classList.toggle("hidden", name !== "empty");
  setupState.classList.toggle("hidden", name !== "setup");
  agentsState.classList.toggle("hidden", name !== "agents");
  summaryPanel.classList.toggle("hidden", name !== "agents");
}

function setFolder(folder) {
  state.folder = folder;
  setupFolderName.textContent = folder.name;
  setupFolderName.title = folder.path;
  workspaceFolderName.textContent = folder.name;
  workspaceFolderName.title = folder.path;
  showScreen("setup");
}

async function chooseFolder() {
  const folder = await window.piFlow.chooseFolder();
  if (!folder) {
    return;
  }

  setFolder(folder);
}

async function openRolePicker() {
  if (!state.folder) {
    return;
  }

  roleSelect.value = AGENT_ROLES[0].id;
  rolePicker.classList.remove("hidden");
  roleSelect.focus();

  if (!availableModels) {
    populateModelSelect(modelSelect, [], { includeDefault: true });
    const loadingOption = modelSelect.querySelector("option");
    if (loadingOption) {
      loadingOption.textContent = "Loading models...";
    }

    availableModels = await window.piFlow.listModels({ folderPath: state.folder.path });
  }

  populateModelSelect(modelSelect, availableModels, { includeDefault: true });
  modelSelect.value = "";
}

function closeRolePicker() {
  rolePicker.classList.add("hidden");
}

async function confirmRolePicker() {
  const role = AGENT_ROLES.find((item) => item.id === roleSelect.value) || AGENT_ROLES[0];
  const model = parseModelValue(modelSelect.value);
  closeRolePicker();
  await addAgent(role, model);
}

async function addAgent(role, model) {
  if (!state.folder || !role) {
    return;
  }

  const index = state.agents.length + 1;
  const agentName = `${role.label} #${index}`;
  registerAgentName(agentName);

  const systemPrompt = `${role.systemPrompt}\n\n${SUMMARY_INSTRUCTION(agentName)}`;

  const agent = await window.piFlow.createAgent({
    index,
    folderName: state.folder.name,
    folderPath: state.folder.path,
    roleId: role.id,
    roleLabel: role.label,
    agentName,
    systemPrompt,
    ...(model ? { provider: model.provider, modelId: model.modelId } : {})
  });

  agent.role = role.label;
  agent.status = "idle";
  agent.agentName = agentName;
  state.agents.push(agent);
  renderAgents();
  showScreen("agents");
}

function agentCanAbort(agent) {
  return agent?.status === "running" || agent?.status === "queued";
}

function updateAbortButton(agentId) {
  const agent = state.agents.find((item) => item.id === agentId);
  const abortButton = document.querySelector(`.abort-button[data-agent-id="${agentId}"]`);
  if (!abortButton || !agent) {
    return;
  }

  abortButton.disabled = !agentCanAbort(agent);
}

async function abortAgent(agent) {
  if (!agent || !agentCanAbort(agent)) {
    return;
  }

  const result = await window.piFlow.abortAgent({ id: agent.id });
  if (!result.ok) {
    agent.transcript.push({ role: "system", text: result.error });
    const log = document.querySelector(`.chat-log[data-agent-id="${agent.id}"]`);
    if (log) {
      renderTranscript(log, agent.transcript);
    }
  }
}

function renderAgents() {
  agentGrid.replaceChildren(...state.agents.map(createAgentCard));
}

function createAgentCard(agent) {
  if (!agent.status) {
    agent.status = "idle";
  }

  const card = document.createElement("article");
  card.className = `agent-card agent-color-${agent.colorIndex ?? 0}`;

  const header = document.createElement("div");
  header.className = "agent-card-header";

  const title = document.createElement("h2");
  title.textContent = agent.title;

  const meta = document.createElement("span");
  meta.className = "agent-status";
  meta.dataset.agentId = agent.id;
  meta.textContent = agent.startedAt;

  const cardModelSelect = document.createElement("select");
  cardModelSelect.className = "agent-model-select";
  cardModelSelect.dataset.agentId = agent.id;
  cardModelSelect.ariaLabel = `Model for ${agent.title}`;
  populateModelSelect(cardModelSelect, availableModels || [], { includeDefault: false });
  applyCardModelSelection(cardModelSelect, agent.modelInfo);
  cardModelSelect.addEventListener("change", async () => {
    const model = parseModelValue(cardModelSelect.value);
    if (!model) {
      return;
    }

    await window.piFlow.setModel({ id: agent.id, provider: model.provider, modelId: model.modelId });
  });

  header.append(title, cardModelSelect, meta);

  const messages = document.createElement("div");
  messages.className = "chat-log";
  messages.dataset.agentId = agent.id;
  renderTranscript(messages, agent.transcript);

  const form = document.createElement("form");
  form.className = "chat-entry";
  form.dataset.agentId = agent.id;

  const input = document.createElement("input");
  input.type = "text";
  input.name = "message";
  input.placeholder = "Talk to agent";
  input.autocomplete = "off";
  input.ariaLabel = `Message ${agent.title}`;

  const mic = document.createElement("button");
  mic.type = "button";
  mic.className = "mic-button";
  mic.textContent = "Mic";
  mic.ariaLabel = `Voice input for ${agent.title}`;
  mic.title = "Voice input";

  const abort = document.createElement("button");
  abort.type = "button";
  abort.className = "abort-button";
  abort.dataset.agentId = agent.id;
  abort.textContent = "Stop";
  abort.disabled = true;
  abort.ariaLabel = `Stop ${agent.title}`;
  abort.title = "Stop the current agent turn (Escape while typing)";
  abort.addEventListener("click", () => abortAgent(agent));

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Send";

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !agentCanAbort(agent)) {
      return;
    }

    event.preventDefault();
    abortAgent(agent);
  });

  mic.addEventListener("click", () => toggleRecording(agent.id, mic));

  form.append(input, mic, abort, submit);
  form.addEventListener("submit", handleChatSubmit);
  card.append(header, messages, form);
  updateAbortButton(agent.id);
  return card;
}

function renderTranscript(container, transcript) {
  container.replaceChildren(
    ...transcript.map((message) => {
      const bubble = document.createElement("p");
      bubble.className = `chat-message ${message.role}`;
      bubble.textContent = message.text;
      return bubble;
    })
  );
  container.scrollTop = container.scrollHeight;
}

function appendTranscript(agent, payload) {
  if (payload.replaceKey) {
    const existing = agent.transcript.find((message) => message.replaceKey === payload.replaceKey);
    if (existing) {
      existing.text = payload.text;
      existing.role = payload.role;
      return;
    }

    agent.transcript.push({
      role: payload.role,
      text: payload.text,
      replaceKey: payload.replaceKey
    });
    return;
  }

  if (payload.append) {
    const last = agent.transcript[agent.transcript.length - 1];
    if (last?.role === payload.role && last.streaming) {
      last.text += payload.text;
      return;
    }

    agent.transcript.push({
      role: payload.role,
      text: payload.text,
      streaming: true
    });
    return;
  }

  const last = agent.transcript[agent.transcript.length - 1];
  if (last?.streaming) {
    delete last.streaming;
  }

  agent.transcript.push({ role: payload.role, text: payload.text });
}

async function handleChatSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const input = form.elements.message;
  const text = input.value.trim();
  if (!text) {
    return;
  }

  const agent = state.agents.find((item) => item.id === form.dataset.agentId);
  if (!agent) {
    return;
  }

  agent.transcript.push({ role: "user", text });
  const log = form.parentElement.querySelector(".chat-log");
  renderTranscript(log, agent.transcript);
  input.value = "";

  const result = await window.piFlow.sendMessage({ id: agent.id, text });
  if (!result.ok) {
    agent.transcript.push({ role: "system", text: result.error });
    renderTranscript(log, agent.transcript);
  }
}

function populateRoleOptions() {
  roleSelect.replaceChildren(
    ...AGENT_ROLES.map((role) => {
      const option = document.createElement("option");
      option.value = role.id;
      option.textContent = role.label;
      return option;
    })
  );
}

function formatSummaryTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendSummaryEntry(payload) {
  const entry = document.createElement("article");
  entry.className = "summary-entry";
  if (payload.ack) {
    entry.classList.add("summary-entry-ack");
  }

  const header = document.createElement("div");
  header.className = "summary-entry-header";

  const sender = document.createElement("strong");
  sender.className = "summary-entry-sender";
  sender.textContent = payload.fromName;

  const time = document.createElement("time");
  time.className = "summary-entry-time";
  time.dateTime = payload.timestamp;
  time.textContent = formatSummaryTime(payload.timestamp);

  header.append(sender, time);

  const body = document.createElement("p");
  body.className = "summary-entry-text";
  const prefix = payload.ack ? "ACK — " : "";
  body.textContent = `${prefix}${payload.text}`;

  if (payload.depth) {
    const depth = document.createElement("span");
    depth.className = "summary-entry-depth";
    depth.textContent = `depth ${payload.depth}/${MAX_RELAY_DEPTH}`;
    entry.append(header, body, depth);
  } else {
    entry.append(header, body);
  }

  summaryList.append(entry);
  summaryList.scrollTop = summaryList.scrollHeight;
}

populateRoleOptions();

chooseFolderButton.addEventListener("click", chooseFolder);
createFirstAgentButton.addEventListener("click", openRolePicker);
addAgentButton.addEventListener("click", openRolePicker);
roleCreateButton.addEventListener("click", confirmRolePicker);
roleCancelButton.addEventListener("click", closeRolePicker);
relayToggle.addEventListener("change", async () => {
  await window.piFlow.setRelay({ enabled: relayToggle.checked });
});
rolePicker.addEventListener("click", (event) => {
  if (event.target === rolePicker) {
    closeRolePicker();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !rolePicker.classList.contains("hidden")) {
    closeRolePicker();
  }
});

window.piFlow.onAgentOutput((payload) => {
  if (!payload.text) {
    return;
  }

  const agent = state.agents.find((item) => item.id === payload.id);
  if (!agent) {
    return;
  }

  appendTranscript(agent, payload);
  const log = document.querySelector(`.chat-log[data-agent-id="${payload.id}"]`);
  if (log) {
    renderTranscript(log, agent.transcript);
  }
});

window.piFlow.onAgentStatus((payload) => {
  const agent = state.agents.find((item) => item.id === payload.id);
  if (!agent) {
    return;
  }

  agent.status = payload.status;
  updateAbortButton(payload.id);
  if (payload.model && typeof payload.model === "object") {
    agent.modelInfo = payload.model;
    agent.model = modelLabel(payload.model);

    const cardModelSelect = document.querySelector(`.agent-model-select[data-agent-id="${payload.id}"]`);
    if (cardModelSelect) {
      applyCardModelSelection(cardModelSelect, payload.model);
    }
  } else if (typeof payload.model === "string") {
    agent.model = payload.model;
  }

  const status = document.querySelector(`.agent-status[data-agent-id="${payload.id}"]`);
  if (status) {
    const suffix = payload.pendingCount ? ` (${payload.pendingCount} queued)` : "";
    status.textContent = `${payload.status}${suffix}`;
    status.title = agent.model || "";
  }
});

window.piFlow.onAgentModels((payload) => {
  const agent = state.agents.find((item) => item.id === payload.id);
  if (!agent) {
    return;
  }

  if (Array.isArray(payload.models) && payload.models.length) {
    availableModels = payload.models;
  }

  const cardModelSelect = document.querySelector(`.agent-model-select[data-agent-id="${payload.id}"]`);
  if (cardModelSelect) {
    populateModelSelect(cardModelSelect, payload.models, { includeDefault: false });
    applyCardModelSelection(cardModelSelect, agent.modelInfo);
  }
});

window.piFlow.onAgentSummary((payload) => {
  appendSummaryEntry(payload);
});

window.piFlow.onAgentRelay((payload) => {
  const agent = state.agents.find((item) => item.id === payload.id);
  if (!agent) {
    return;
  }

  agent.transcript.push({ role: "relay", text: payload.text });
  const log = document.querySelector(`.chat-log[data-agent-id="${payload.id}"]`);
  if (log) {
    renderTranscript(log, agent.transcript);
  }
});

showScreen("empty");
