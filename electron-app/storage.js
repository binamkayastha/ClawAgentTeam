const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG_DIR = process.env.CLAWAGENTTEAM_CONFIG_DIR
  || path.join(os.homedir(), ".config", "clawagentteam");
const STATE_PATH = path.join(CONFIG_DIR, "app-state.json");

function createDefaultState() {
  return {
    schemaVersion: 1,
    activeFolderId: null,
    folders: [],
    projects: {}
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Failed to load app state from ${STATE_PATH}: ${error.message}`);
    }
    return createDefaultState();
  }
}

function saveState(state) {
  const normalized = normalizeState(state);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const tmpPath = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, STATE_PATH);
  return normalized;
}

function upsertFolder(folderPath) {
  const state = loadState();
  const now = new Date().toISOString();
  const normalizedPath = path.resolve(folderPath);
  const id = folderId(normalizedPath);
  const existing = state.folders.find((folder) => folder.id === id);

  const folder = {
    id,
    name: path.basename(normalizedPath) || normalizedPath,
    path: normalizedPath,
    addedAt: existing?.addedAt || now,
    lastOpenedAt: now,
    metadata: existing?.metadata || {}
  };

  if (existing) {
    Object.assign(existing, folder);
  } else {
    state.folders.push(folder);
  }

  state.activeFolderId = id;
  ensureProjectBucket(state, id);
  saveState(state);

  return folder;
}

function getActiveFolder() {
  const state = loadState();
  return state.folders.find((folder) => folder.id === state.activeFolderId) || null;
}

function getStateForRenderer() {
  const state = loadState();
  const activeFolder = state.folders.find((folder) => folder.id === state.activeFolderId) || null;
  return {
    ...state,
    activeFolder,
    activeProject: activeFolder ? state.projects[activeFolder.id] : null,
    configDir: CONFIG_DIR,
    statePath: STATE_PATH
  };
}

function saveProjectSnapshot(folderIdValue, snapshot) {
  const state = loadState();
  const folder = state.folders.find((item) => item.id === folderIdValue);
  if (!folder) {
    throw new Error("Cannot save project data for an unknown folder.");
  }

  const project = ensureProjectBucket(state, folderIdValue);
  project.agents = sanitizeAgents(snapshot?.agents);
  project.chatHistory = project.agents.flatMap((agent) =>
    agent.transcript.map((message) => ({
      agentId: agent.id,
      agentTitle: agent.title,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp || agent.updatedAt || new Date().toISOString()
    }))
  );
  project.metadata = {
    ...(project.metadata || {}),
    updatedAt: new Date().toISOString()
  };

  saveState(state);
  return project;
}

function normalizeState(value) {
  const state = {
    ...createDefaultState(),
    ...(value && typeof value === "object" ? value : {})
  };

  state.schemaVersion = 1;
  state.folders = Array.isArray(state.folders)
    ? state.folders
        .filter((folder) => folder && typeof folder.path === "string")
        .map((folder) => ({
          id: typeof folder.id === "string" ? folder.id : folderId(path.resolve(folder.path)),
          name: typeof folder.name === "string" && folder.name ? folder.name : path.basename(folder.path) || folder.path,
          path: path.resolve(folder.path),
          addedAt: folder.addedAt || new Date().toISOString(),
          lastOpenedAt: folder.lastOpenedAt || folder.addedAt || new Date().toISOString(),
          metadata: folder.metadata && typeof folder.metadata === "object" ? folder.metadata : {}
        }))
    : [];

  state.projects = state.projects && typeof state.projects === "object" ? state.projects : {};
  for (const folder of state.folders) {
    ensureProjectBucket(state, folder.id);
  }

  if (!state.folders.some((folder) => folder.id === state.activeFolderId)) {
    state.activeFolderId = state.folders[0]?.id || null;
  }

  return state;
}

function ensureProjectBucket(state, folderIdValue) {
  state.projects[folderIdValue] ||= {
    chatHistory: [],
    agents: [],
    metadata: {}
  };
  return state.projects[folderIdValue];
}

function folderId(folderPath) {
  return crypto.createHash("sha256").update(folderPath).digest("hex").slice(0, 16);
}

function sanitizeAgents(agents) {
  if (!Array.isArray(agents)) {
    return [];
  }

  return agents.map((agent) => {
    const now = new Date().toISOString();
    return {
      id: stringOrFallback(agent.id, crypto.randomUUID()),
      title: stringOrFallback(agent.title, "Pi Agent"),
      role: typeof agent.role === "string" ? agent.role : null,
      folderName: stringOrFallback(agent.folderName, ""),
      folderPath: stringOrFallback(agent.folderPath, ""),
      startedAt: stringOrFallback(agent.startedAt, ""),
      status: stringOrFallback(agent.status, "saved"),
      model: typeof agent.model === "string" ? agent.model : null,
      modelInfo: agent.modelInfo && typeof agent.modelInfo === "object" ? agent.modelInfo : null,
      restored: Boolean(agent.restored),
      updatedAt: now,
      transcript: sanitizeTranscript(agent.transcript)
    };
  });
}

function sanitizeTranscript(transcript) {
  if (!Array.isArray(transcript)) {
    return [];
  }

  return transcript
    .filter((message) => message && typeof message.text === "string")
    .map((message) => ({
      role: stringOrFallback(message.role, "system"),
      text: message.text,
      ...(message.replaceKey ? { replaceKey: String(message.replaceKey) } : {}),
      ...(message.timestamp ? { timestamp: String(message.timestamp) } : {})
    }));
}

function stringOrFallback(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

module.exports = {
  getActiveFolder,
  getStateForRenderer,
  saveProjectSnapshot,
  upsertFolder
};
