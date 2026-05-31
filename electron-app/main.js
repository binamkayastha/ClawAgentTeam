const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

let mainWindow;
const agentProcesses = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: "PI Agent Flow",
    backgroundColor: "#f7f8f6",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const child of agentProcesses.values()) {
    child.kill();
  }
});

ipcMain.handle("folder:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a project folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  return {
    name: path.basename(folderPath) || folderPath,
    path: folderPath
  };
});

ipcMain.handle("agent:create", async (_event, payload) => {
  const now = new Date();
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const child = spawn("pi", [], {
    cwd: payload.folderPath,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  agentProcesses.set(id, child);

  child.stdout.on("data", (chunk) => {
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "agent",
      text: cleanOutput(chunk)
    });
  });

  child.stderr.on("data", (chunk) => {
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "system",
      text: cleanOutput(chunk)
    });
  });

  child.on("error", (error) => {
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "system",
      text: `PI session failed to start: ${error.message}`
    });
  });

  child.on("exit", (code, signal) => {
    agentProcesses.delete(id);
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "system",
      text: `PI session ended${signal ? ` by ${signal}` : ` with code ${code ?? 0}`}.`
    });
  });

  return {
    id,
    title: `Pi Agent #${payload.index}`,
    folderName: payload.folderName,
    folderPath: payload.folderPath,
    pid: child.pid,
    startedAt: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    transcript: [
      {
        role: "system",
        text: `PI session starting for ${payload.folderName}.`
      }
    ]
  };
});

ipcMain.handle("agent:message", async (_event, payload) => {
  const child = agentProcesses.get(payload.id);
  if (!child || child.killed || !child.stdin.writable) {
    return { ok: false, error: "PI session is not running." };
  }

  child.stdin.write(`${payload.text}\n`);
  return { ok: true };
});

function cleanOutput(chunk) {
  return chunk
    .toString("utf8")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .trim();
}
