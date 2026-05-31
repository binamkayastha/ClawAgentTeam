const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let mainWindow;
const agentProcesses = new Map();
let cachedModels = null;
const repoRoot = path.resolve(__dirname, "..");
const speechState = {
  owner: null,
  active: null,
  queue: []
};

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
  stopActiveSpeech();
  for (const agentProcess of agentProcesses.values()) {
    agentProcess.child.kill();
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
    nextRequestId: 1,
    currentResponseText: "",
    spokenSummaries: new Set()
  };

  agentProcesses.set(id, agentProcess);

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

  releaseSpeechControl("User sent a chat message.");

  sendRpcCommand(agentProcess, {
    type: "prompt",
    message: payload.text,
    ...(agentProcess.isStreaming ? { streamingBehavior: "steer" } : {})
  });

  return { ok: true };
});

ipcMain.handle("mic:claim", async (_event, payload) => {
  claimUserMicrophone(payload?.id || null);
  return { ok: true };
});

ipcMain.handle("mic:release", async () => {
  releaseSpeechControl("User released the microphone.");
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
      agentProcess.currentResponseText = "";
      emitAgentStatus(agentProcess.id, "running");
      break;
    case "agent_end":
      agentProcess.isStreaming = false;
      speakAgentResponse(agentProcess, null);
      emitAgentStatus(agentProcess.id, "idle");
      break;
    case "message_update":
      handleMessageUpdate(agentProcess, message);
      break;
    case "message_end":
      handleMessageEnd(agentProcess, message);
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
    agentProcess.currentResponseText += event.delta;
    emitAgentOutput(agentProcess.id, "agent", event.delta, { append: true });
  }

  if (event.type === "error") {
    emitAgentOutput(agentProcess.id, "system", event.error || "PI reported an error.");
  }
}

function handleMessageEnd(agentProcess, message) {
  speakAgentResponse(agentProcess, message.message);
}

function speakAgentResponse(agentProcess, message) {
  const text = extractMessageText(message) || agentProcess.currentResponseText;
  const speechText = extractSpeechText(text);
  if (!speechText) {
    return;
  }

  const dedupeKey = `${message?.id || ""}:${speechText}`;
  if (agentProcess.spokenSummaries.has(dedupeKey)) {
    return;
  }

  agentProcess.spokenSummaries.add(dedupeKey);
  speakSummary(speechText, agentProcess.id);
  agentProcess.currentResponseText = "";
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

function extractMessageText(message) {
  if (!message || message.role !== "assistant") {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }
        if (typeof part?.content === "string") {
          return part.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractSummaryText(text) {
  const match = text.match(/(?:^|\n)\s*Summary:\s*([^\n]+)/i);
  if (!match) {
    return "";
  }

  return match[1].trim();
}

function extractSpeechText(text) {
  return extractSummaryText(text);
}

function speakSummary(summary, agentId) {
  enqueueAgentSpeech(agentId, summary);
}

function enqueueAgentSpeech(agentId, text) {
  if (speechState.owner?.type === "user") {
    return;
  }

  const existingActiveForAgent = speechState.active?.agentId === agentId;
  speechState.queue = speechState.queue.filter((job) => job.agentId !== agentId);
  speechState.queue.push(createSpeechJob(agentId, text));

  if (existingActiveForAgent) {
    stopActiveSpeech();
    return;
  }

  pumpSpeechQueue();
}

function createSpeechJob(agentId, text) {
  return {
    agentId,
    text,
    child: null,
    cancelled: false
  };
}

function claimUserMicrophone(agentId) {
  speechState.owner = { type: "user", agentId };
  speechState.queue = [];
  stopActiveSpeech();
  emitMicState();
}

function releaseSpeechControl() {
  speechState.owner = null;
  speechState.queue = [];
  stopActiveSpeech();
  emitMicState();
}

function stopActiveSpeech() {
  const active = speechState.active;
  if (!active) {
    return;
  }

  active.cancelled = true;
  if (active.child && !active.child.killed) {
    active.child.kill();
  }
}

function pumpSpeechQueue() {
  if (speechState.active || speechState.owner?.type === "user") {
    return;
  }

  const next = speechState.queue.shift();
  if (!next) {
    speechState.owner = null;
    emitMicState();
    return;
  }

  speechState.owner = { type: "agent", agentId: next.agentId };
  speechState.active = next;
  emitMicState();

  runQwenTts(next)
    .catch((error) => {
      if (!next.cancelled) {
        emitAgentOutput(next.agentId, "system", `Qwen text-to-speech failed: ${error.message}`);
      }
    })
    .finally(() => {
      if (speechState.active === next) {
        speechState.active = null;
      }

      if (speechState.owner?.type === "agent" && speechState.owner.agentId === next.agentId) {
        speechState.owner = null;
      }

      emitMicState();
      pumpSpeechQueue();
    });
}

async function runQwenTts(job) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-tts-"));
  const outputPath = path.join(tempDir, "speech.wav");

  try {
    await runSpeechCommand(
      path.join(repoRoot, "run"),
      [job.text, "--output", outputPath, "--no-play"],
      { cwd: repoRoot },
      job
    );
    if (!job.cancelled) {
      await runSpeechCommand("afplay", [outputPath], { cwd: repoRoot }, job);
    }
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }, () => {});
  }
}

function runSpeechCommand(command, args, options, job = null) {
  return new Promise((resolve, reject) => {
    if (job?.cancelled) {
      resolve();
      return;
    }

    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "ignore", "pipe"]
    });

    if (job) {
      job.child = child;
    }

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (job?.child === child) {
        job.child = null;
      }

      if (job?.cancelled) {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `speech command exited ${signal || `with code ${code}`}`));
    });
  });
}

function emitMicState() {
  mainWindow?.webContents.send("mic:state", {
    owner: speechState.owner
  });
}
