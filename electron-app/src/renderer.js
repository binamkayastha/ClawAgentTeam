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

async function addAgent() {
  if (!state.folder) {
    return;
  }

  const agent = await window.piFlow.createAgent({
    index: state.agents.length + 1,
    folderName: state.folder.name,
    folderPath: state.folder.path
  });

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
  meta.textContent = agent.startedAt;

  header.append(title, meta);

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

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Send";

  form.append(input, submit);
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

chooseFolderButton.addEventListener("click", chooseFolder);
createFirstAgentButton.addEventListener("click", addAgent);
addAgentButton.addEventListener("click", addAgent);

window.piFlow.onAgentOutput((payload) => {
  if (!payload.text) {
    return;
  }

  const agent = state.agents.find((item) => item.id === payload.id);
  if (!agent) {
    return;
  }

  agent.transcript.push({ role: payload.role, text: payload.text });
  const log = document.querySelector(`.chat-log[data-agent-id="${payload.id}"]`);
  if (log) {
    renderTranscript(log, agent.transcript);
  }
});

showScreen("empty");
