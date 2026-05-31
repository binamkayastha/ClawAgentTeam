const AGENT_ROLES = [
  {
    id: "software-engineer",
    label: "Software Engineer",
    systemPrompt:
      "You are a senior software engineer joining this project. Focus on implementation, code quality, debugging, and pragmatic technical decisions. Work directly in the current folder, follow existing conventions, keep changes minimal and well-tested, and explain trade-offs clearly. Ask clarifying questions when requirements are ambiguous before writing code."
  },
  {
    id: "project-manager",
    label: "Project Manager",
    systemPrompt:
      "You are an experienced project manager for this project. Focus on scope, priorities, timelines, risks, and coordination. Break work into clear actionable tasks, surface dependencies and blockers, and keep the team aligned on goals. Prefer concise status summaries and explicit next steps over writing code."
  },
  {
    id: "designer",
    label: "Designer",
    systemPrompt:
      "You are a product designer for this project. Focus on user experience, interface layout, visual hierarchy, accessibility, and design consistency. Propose clear UX flows and concrete UI improvements, reference existing styles and components, and explain the reasoning behind design choices."
  },
  {
    id: "qa-tester",
    label: "QA Tester",
    systemPrompt:
      "You are a meticulous QA tester for this project. Focus on test plans, edge cases, reproduction steps, and verification. Identify potential failure modes and regressions, write clear test cases, and confirm whether behavior matches expectations. Be specific about how to reproduce and validate each issue."
  }
];

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

  const agent = await window.piFlow.createAgent({
    index: state.agents.length + 1,
    folderName: state.folder.name,
    folderPath: state.folder.path,
    roleId: role.id,
    roleLabel: role.label,
    systemPrompt: role.systemPrompt,
    ...(model ? { provider: model.provider, modelId: model.modelId } : {})
  });

  agent.role = role.label;
  state.agents.push(agent);
  renderAgents();
  showScreen("agents");
}

function renderAgents() {
  agentGrid.replaceChildren(...state.agents.map(createAgentCard));
}

function createAgentCard(agent) {
  const card = document.createElement("article");
  card.className = "agent-card";

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

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Send";

  form.append(input, mic, submit);
  form.addEventListener("submit", handleChatSubmit);
  card.append(header, messages, form);
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

populateRoleOptions();

chooseFolderButton.addEventListener("click", chooseFolder);
createFirstAgentButton.addEventListener("click", openRolePicker);
addAgentButton.addEventListener("click", openRolePicker);
roleCreateButton.addEventListener("click", confirmRolePicker);
roleCancelButton.addEventListener("click", closeRolePicker);
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

showScreen("empty");
