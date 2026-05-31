const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let agentCounter = 0;

let mainWindow;
const agentProcesses = new Map();
let cachedModels = null;
let relayEnabled = true;

const MAX_RELAY_DEPTH = 10;

function isAckSummary(text) {
  return /^\s*ACK\s*[—-]\s*no action needed\s*$/i.test((text || "").trim());
}

function extractSummary(text) {
  if (!text) {
    return null;
  }

  const lineMatches = [...text.matchAll(/^\s*(?:#{1,6}\s*|\*{1,2})?Summary:\*{0,2}\s*(.+)$/gim)];
  if (lineMatches.length) {
    return lineMatches[lineMatches.length - 1][1].trim();
  }

  const inlineMatch = text.match(/(?:^|\n)\s*(?:#{1,6}\s*|\*{1,2})?Summary:\*{0,2}\s*(.+)$/is);
  if (inlineMatch) {
    return inlineMatch[1].trim();
  }

  return null;
}

function extractSummaryFromMessages(messages) {
  if (!Array.isArray(messages)) {
    return null;
  }

  const parts = [];
  for (const msg of messages) {
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) {
      continue;
    }

    for (const block of msg.content) {
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }

  if (!parts.length) {
    return null;
  }

  return extractSummary(parts.join("\n\n"));
}

function noteSummaryCandidate(agentProcess, text) {
  const candidate = extractSummary(text);
  if (candidate) {
    agentProcess.lastSummaryText = candidate;
  }
}

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

ipcMain.handle("audio:transcribe", async (_event, buffer) => {
  const { Blob } = require("node:buffer");
  console.log("[main] audio:transcribe called, bytes:", buffer?.byteLength ?? buffer?.length);
  try {
    const audioBlob = new Blob([Buffer.from(buffer)], { type: "audio/webm" });
    const form = new FormData();
    form.append("file", audioBlob, "recording.webm");
    const res = await fetch("http://127.0.0.1:8000/transcribe", { method: "POST", body: form });
    const data = await res.json();
    console.log("[main] transcription result:", data);
    return data;
  } catch (err) {
    console.error("[main] transcription error:", err.message);
    throw err;
  }
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
  console.log("[main] spawning pi with args:", spawnArgs, "cwd:", payload.folderPath);
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

  const roleLabel = payload.roleLabel || "Pi Agent";

  const agentProcess = {
    id,
    child,
    buffer: "",
    isStreaming: false,
    nextRequestId: 1,
    name: payload.agentName || `${roleLabel} #${payload.index}`,
    currentResponse: "",
    lastSummaryText: null,
    incomingDepth: 0,
    skipNextBroadcast: false,
    systemPrompt: payload.systemPrompt || null
  };

  agentProcesses.set(id, agentProcess);

  child.stdout.on("data", (chunk) => {
    console.log("[main] stdout:", chunk.toString("utf8").slice(0, 200));
    readRpcOutput(agentProcess, chunk);
  });

  child.stderr.on("data", (chunk) => {
    console.log("[main] stderr:", chunk.toString("utf8").slice(0, 200));
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "system",
      text: cleanOutput(chunk)
    });
  });

  child.on("spawn", () => {
    console.log("[main] pi process spawned, pid:", child.pid);
  });

  child.on("error", (error) => {
    console.error("[main] pi spawn error:", error.message);
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "system",
      text: `PI session failed to start: ${error.message}`
    });
  });

  child.on("exit", (code, signal) => {
    console.log("[main] pi exited, code:", code, "signal:", signal);
    agentProcesses.delete(id);
    mainWindow?.webContents.send("agent:output", {
      id,
      role: "system",
      text: `PI session ended${signal ? ` by ${signal}` : ` with code ${code ?? 0}`}.`
    });
  });

  sendRpcCommand(agentProcess, {
    type: "set_session_name",
    name: `${roleLabel} - ${payload.folderName} - ${now.toLocaleString()}`
  });
  sendRpcCommand(agentProcess, { type: "get_state" });
  sendRpcCommand(agentProcess, { type: "get_available_models" });

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
    colorIndex: (agentCounter++) % 8,
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

  agentProcess.incomingDepth = 0;
  agentProcess.currentResponse = "";
  agentProcess.lastSummaryText = null;

  sendRpcCommand(agentProcess, {
    type: "prompt",
    message: buildAgentPrompt(agentProcess, payload.text),
    ...(agentProcess.isStreaming ? { streamingBehavior: "steer" } : {})
  });

  return { ok: true };
});

ipcMain.handle("agent:setRelay", async (_event, payload) => {
  relayEnabled = Boolean(payload?.enabled);
  return { ok: true, enabled: relayEnabled };
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

ipcMain.handle("agent:abort", async (_event, payload) => {
  const agentProcess = agentProcesses.get(payload.id);
  if (!agentProcess || agentProcess.child.killed || !agentProcess.child.stdin.writable) {
    return { ok: false, error: "PI session is not running." };
  }

  sendRpcCommand(agentProcess, { type: "abort" });
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

function buildAgentPrompt(agentProcess, text) {
  if (!agentProcess.systemPrompt) {
    return text;
  }

  const message = `${agentProcess.systemPrompt}\n\n${text}`;
  agentProcess.systemPrompt = null;
  return message;
}

function sendRpcCommand(agentProcess, command) {
  const message = {
    id: `req-${agentProcess.id}-${agentProcess.nextRequestId++}`,
    ...command
  };

  console.log("[main] sendRpcCommand:", JSON.stringify(message).slice(0, 200));
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
      break;
    case "agent_end":
      agentProcess.isStreaming = false;
      emitAgentStatus(agentProcess.id, "idle");
      finalizeTurn(agentProcess, message);
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
    console.log("[main] message_update: no assistantMessageEvent");
    return;
  }

  console.log("[main] message_update event.type:", event.type, "delta:", (event.delta || "").slice(0, 100));

  if (event.type === "text_delta" && event.delta) {
    const cleaned = cleanStreamingOutput(event.delta);
    agentProcess.currentResponse += cleaned;
    noteSummaryCandidate(agentProcess, agentProcess.currentResponse);
    emitAgentOutput(agentProcess.id, "agent", event.delta, { append: true });
  }

  if (event.type === "text_end" && typeof event.content === "string" && event.content) {
    noteSummaryCandidate(agentProcess, `${agentProcess.currentResponse}${cleanStreamingOutput(event.content)}`);
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

function emitAgentSummary(payload) {
  mainWindow?.webContents.send("agent:summary", payload);
}

function emitAgentRelay(payload) {
  mainWindow?.webContents.send("agent:relay", payload);
}

function finalizeTurn(agentProcess, endMessage = null) {
  const summaryText =
    extractSummary(agentProcess.currentResponse) ||
    agentProcess.lastSummaryText ||
    extractSummaryFromMessages(endMessage?.messages);

  agentProcess.currentResponse = "";
  agentProcess.lastSummaryText = null;

  if (agentProcess.skipNextBroadcast) {
    agentProcess.skipNextBroadcast = false;
    return;
  }

  if (!summaryText) {
    console.log("[main] finalizeTurn: no summary found for", agentProcess.name);
    return;
  }

  console.log("[main] finalizeTurn: summary from", agentProcess.name, ":", summaryText.slice(0, 120));

  const timestamp = new Date().toISOString();
  const summaryPayload = {
    fromId: agentProcess.id,
    fromName: agentProcess.name,
    text: summaryText,
    depth: agentProcess.incomingDepth + 1,
    timestamp
  };

  if (isAckSummary(summaryText)) {
    emitAgentSummary({ ...summaryPayload, ack: true });
    return;
  }

  const outgoingDepth = agentProcess.incomingDepth + 1;

  emitAgentSummary({ ...summaryPayload, depth: outgoingDepth });

  if (outgoingDepth > MAX_RELAY_DEPTH) {
    return;
  }

  broadcastSummary(agentProcess, summaryText, outgoingDepth);
}

function broadcastSummary(sender, summaryText, depth) {
  if (!relayEnabled) {
    console.log("[main] broadcastSummary: relay disabled, skipping");
    return;
  }

  const relayMessage = `[Relay depth ${depth}/${MAX_RELAY_DEPTH}]\nFrom ${sender.name}: Summary: ${summaryText}`;

  for (const [targetId, target] of agentProcesses) {
    if (targetId === sender.id) {
      continue;
    }

    if (target.child.killed || !target.child.stdin.writable) {
      console.log("[main] broadcastSummary: skipping dead/unwritable agent", target.name);
      continue;
    }

    console.log("[main] broadcastSummary: sending to", target.name);

    target.incomingDepth = depth;

    sendRpcCommand(target, {
      type: "prompt",
      message: buildAgentPrompt(target, relayMessage),
      ...(target.isStreaming ? { streamingBehavior: "steer" } : {})
    });

    emitAgentRelay({
      id: targetId,
      fromName: sender.name,
      text: relayMessage,
      depth
    });
  }
}
