const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Load .env from project root into process.env
(function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
})();

let mainWindow;
const agentProcesses = new Map();
let cachedModels = null;
let weaveProcess = null;

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
  for (const agentProcess of agentProcesses.values()) {
    agentProcess.child.kill();
  }
  if (weaveProcess) {
    weaveProcess.stdin.end();
    weaveProcess.kill();
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

ipcMain.handle("models:list", async (_event, payload) => {
  if (Array.isArray(cachedModels)) {
    return cachedModels;
  }

  const cwd = payload?.folderPath && fs.existsSync(payload.folderPath) ? payload.folderPath : process.cwd();
  const models = await fetchAvailableModels(cwd);
  cachedModels = models;
  return models;
});

ipcMain.handle("agent:create", async (_event, payload) => {
  if (!payload?.folderPath || !fs.existsSync(payload.folderPath)) {
    throw new Error("Choose an existing folder before creating a PI agent.");
  }

  const now = new Date();
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const spawnArgs = ["--mode", "rpc"];
  if (payload.provider) {
    spawnArgs.push("--provider", payload.provider);
  }
  if (payload.modelId) {
    spawnArgs.push("--model", payload.modelId);
  }
  const child = spawn("pi", spawnArgs, {
    cwd: payload.folderPath,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const agentProcess = {
    id,
    child,
    buffer: "",
    isStreaming: false,
    nextRequestId: 1
  };

  agentProcesses.set(id, agentProcess);

  startWeaveLogger();
  sendToWeave({
    type: "agent_create",
    agentId: id,
    role: payload.roleLabel || "Pi Agent",
    model: payload.modelId || "default"
  });

  child.stdout.on("data", (chunk) => {
    readRpcOutput(agentProcess, chunk);
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

  const roleLabel = payload.roleLabel || "Pi Agent";

  sendRpcCommand(agentProcess, {
    type: "set_session_name",
    name: `${roleLabel} - ${payload.folderName} - ${now.toLocaleString()}`
  });
  sendRpcCommand(agentProcess, { type: "get_state" });
  sendRpcCommand(agentProcess, { type: "get_available_models" });

  if (payload.systemPrompt) {
    sendRpcCommand(agentProcess, {
      type: "prompt",
      message: payload.systemPrompt
    });
  }

  const transcript = [
    {
      role: "system",
      text: `PI RPC session starting for ${payload.folderName}.`
    }
  ];

  if (payload.roleLabel) {
    transcript.push({
      role: "system",
      text: `Agent role: ${payload.roleLabel}.`
    });
  }

  return {
    id,
    title: `${roleLabel} #${payload.index}`,
    role: payload.roleLabel || null,
    folderName: payload.folderName,
    folderPath: payload.folderPath,
    pid: child.pid,
    startedAt: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    transcript
  };
});

ipcMain.handle("agent:message", async (_event, payload) => {
  const agentProcess = agentProcesses.get(payload.id);
  if (!agentProcess || agentProcess.child.killed || !agentProcess.child.stdin.writable) {
    return { ok: false, error: "PI session is not running." };
  }

  sendRpcCommand(agentProcess, {
    type: "prompt",
    message: payload.text,
    ...(agentProcess.isStreaming ? { streamingBehavior: "steer" } : {})
  });

  sendToWeave({ type: "user_message", agentId: payload.id, text: payload.text });

  return { ok: true };
});

ipcMain.handle("agent:setModel", async (_event, payload) => {
  const agentProcess = agentProcesses.get(payload.id);
  if (!agentProcess || agentProcess.child.killed || !agentProcess.child.stdin.writable) {
    return { ok: false, error: "PI session is not running." };
  }

  sendRpcCommand(agentProcess, {
    type: "set_model",
    provider: payload.provider,
    modelId: payload.modelId
  });

  return { ok: true };
});

function fetchAvailableModels(cwd) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (models) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(Array.isArray(models) ? models : []);
    };

    const child = spawn("pi", ["--mode", "rpc"], {
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        FORCE_COLOR: "0",
        NO_COLOR: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd !== -1) {
        const rawLine = buffer.slice(0, lineEnd).replace(/\r$/, "");
        buffer = buffer.slice(lineEnd + 1);
        if (rawLine.trim()) {
          let message;
          try {
            message = JSON.parse(rawLine);
          } catch {
            message = null;
          }
          if (message?.type === "response" && message.command === "get_available_models") {
            finish(message.success ? message.data?.models : []);
            return;
          }
        }
        lineEnd = buffer.indexOf("\n");
      }
    });

    child.on("error", () => finish([]));
    child.on("exit", () => finish([]));

    const timer = setTimeout(() => finish([]), 15000);

    child.stdin.write(`${JSON.stringify({ id: "models-discovery", type: "get_available_models" })}\n`);
  });
}

function cleanOutput(chunk) {
  return chunk
    .toString("utf8")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .trim();
}

function cleanStreamingOutput(chunk) {
  return chunk.toString("utf8").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function sendRpcCommand(agentProcess, command) {
  const message = {
    id: `req-${agentProcess.id}-${agentProcess.nextRequestId++}`,
    ...command
  };

  agentProcess.child.stdin.write(`${JSON.stringify(message)}\n`);
}

function readRpcOutput(agentProcess, chunk) {
  agentProcess.buffer += chunk.toString("utf8");

  let lineEnd = agentProcess.buffer.indexOf("\n");
  while (lineEnd !== -1) {
    const rawLine = agentProcess.buffer.slice(0, lineEnd).replace(/\r$/, "");
    agentProcess.buffer = agentProcess.buffer.slice(lineEnd + 1);
    if (rawLine.trim()) {
      handleRpcMessage(agentProcess, rawLine);
    }
    lineEnd = agentProcess.buffer.indexOf("\n");
  }
}

function handleRpcMessage(agentProcess, rawLine) {
  let message;
  try {
    message = JSON.parse(rawLine);
  } catch {
    emitAgentOutput(agentProcess.id, "system", rawLine);
    return;
  }

  switch (message.type) {
    case "response":
      handleRpcResponse(agentProcess, message);
      break;
    case "agent_start":
      agentProcess.isStreaming = true;
      emitAgentStatus(agentProcess.id, "running");
      sendToWeave({ type: "agent_start", agentId: agentProcess.id });
      break;
    case "agent_end":
      agentProcess.isStreaming = false;
      emitAgentStatus(agentProcess.id, "idle");
      sendToWeave({ type: "agent_end", agentId: agentProcess.id });
      break;
    case "message_update":
      handleMessageUpdate(agentProcess, message);
      break;
    case "tool_execution_start":
      emitAgentOutput(agentProcess.id, "system", `Running ${message.toolName}.`);
      break;
    case "tool_execution_update":
      handleToolExecutionUpdate(agentProcess, message);
      break;
    case "tool_execution_end":
      handleToolExecutionEnd(agentProcess, message);
      break;
    case "queue_update":
      emitAgentStatus(agentProcess.id, "queued", {
        pendingCount: (message.steering?.length ?? 0) + (message.followUp?.length ?? 0)
      });
      break;
    case "extension_ui_request":
      handleExtensionUiRequest(agentProcess, message);
      break;
    case "extension_error":
      emitAgentOutput(agentProcess.id, "system", `Extension error: ${message.error}`);
      break;
    default:
      break;
  }
}

function handleRpcResponse(agentProcess, response) {
  if (!response.success) {
    emitAgentOutput(agentProcess.id, "system", response.error || `${response.command} failed.`);
    return;
  }

  if (response.command === "get_state" && response.data) {
    agentProcess.isStreaming = Boolean(response.data.isStreaming);
    emitAgentStatus(agentProcess.id, agentProcess.isStreaming ? "running" : "idle", {
      model: response.data.model || null,
      sessionName: response.data.sessionName || null
    });
  }

  if (response.command === "get_available_models" && response.data) {
    emitAgentModels(agentProcess.id, Array.isArray(response.data.models) ? response.data.models : []);
  }

  if (response.command === "set_model" && response.data) {
    emitAgentStatus(agentProcess.id, agentProcess.isStreaming ? "running" : "idle", {
      model: response.data
    });
  }
}

function handleMessageUpdate(agentProcess, message) {
  const event = message.assistantMessageEvent;
  if (!event) {
    return;
  }

  if (event.type === "text_delta" && event.delta) {
    emitAgentOutput(agentProcess.id, "agent", event.delta, { append: true });
    sendToWeave({ type: "message_update", agentId: agentProcess.id, delta: event.delta });
  }

  if (event.type === "error") {
    emitAgentOutput(agentProcess.id, "system", event.error || "PI reported an error.");
  }
}

function handleToolExecutionUpdate(agentProcess, message) {
  const text = textFromToolResult(message.partialResult);
  if (text) {
    emitAgentOutput(agentProcess.id, "tool", text, {
      replaceKey: message.toolCallId
    });
  }
}

function handleToolExecutionEnd(agentProcess, message) {
  const text = textFromToolResult(message.result);
  emitAgentOutput(agentProcess.id, message.isError ? "system" : "tool", text || `${message.toolName} finished.`, {
    replaceKey: message.toolCallId
  });
  sendToWeave({
    type: "tool_execution_end",
    agentId: agentProcess.id,
    toolName: message.toolName,
    result: text
  });
}

function handleExtensionUiRequest(agentProcess, request) {
  const title = request.title || request.message || request.method;
  emitAgentOutput(agentProcess.id, "system", `PI requested UI input: ${title}`);

  if (["select", "input", "editor", "confirm"].includes(request.method)) {
    agentProcess.child.stdin.write(
      `${JSON.stringify({
        type: "extension_ui_response",
        id: request.id,
        cancelled: true
      })}\n`
    );
  }
}

function textFromToolResult(result) {
  const content = result?.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item?.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function emitAgentOutput(id, role, text, options = {}) {
  const cleaned = typeof text === "string"
    ? options.append
      ? cleanStreamingOutput(text)
      : cleanOutput(text)
    : "";
  if (!cleaned) {
    return;
  }

  mainWindow?.webContents.send("agent:output", {
    id,
    role,
    text: cleaned,
    ...options
  });
}

function emitAgentStatus(id, status, details = {}) {
  mainWindow?.webContents.send("agent:status", {
    id,
    status,
    ...details
  });
}

function emitAgentModels(id, models) {
  mainWindow?.webContents.send("agent:models", {
    id,
    models
  });
}

function startWeaveLogger() {
  if (weaveProcess) return;

  const scriptPath = path.join(__dirname, "..", "weave_logger.py");
  if (!fs.existsSync(scriptPath)) {
    console.warn("[weave] weave_logger.py not found, skipping.");
    return;
  }

  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  weaveProcess = spawn(pythonCmd, [scriptPath], {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"]
  });

  weaveProcess.stderr.on("data", (chunk) => {
    console.log("[weave]", chunk.toString("utf8").trim());
  });

  weaveProcess.on("error", (err) => {
    console.error("[weave] Failed to start:", err.message);
    weaveProcess = null;
  });

  weaveProcess.on("exit", () => {
    weaveProcess = null;
  });
}

function sendToWeave(event) {
  if (!weaveProcess || weaveProcess.killed || !weaveProcess.stdin.writable) return;
  try {
    weaveProcess.stdin.write(JSON.stringify(event) + "\n");
  } catch {
    // ignore — weave logging is best-effort
  }
}
