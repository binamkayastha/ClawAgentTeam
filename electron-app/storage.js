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
  return {
    ...state,
    activeFolder: state.folders.find((folder) => folder.id === state.activeFolderId) || null,
    configDir: CONFIG_DIR,
    statePath: STATE_PATH
  };
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
}

function folderId(folderPath) {
  return crypto.createHash("sha256").update(folderPath).digest("hex").slice(0, 16);
}

module.exports = {
  getActiveFolder,
  getStateForRenderer,
  upsertFolder
};
