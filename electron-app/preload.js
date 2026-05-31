const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piFlow", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  listModels: (payload) => ipcRenderer.invoke("models:list", payload),
  createAgent: (payload) => ipcRenderer.invoke("agent:create", payload),
  sendMessage: (payload) => ipcRenderer.invoke("agent:message", payload),
  abortAgent: (payload) => ipcRenderer.invoke("agent:abort", payload),
  setModel: (payload) => ipcRenderer.invoke("agent:setModel", payload),
  claimMic: (payload) => ipcRenderer.invoke("mic:claim", payload),
  releaseMic: () => ipcRenderer.invoke("mic:release"),
  setRelay: (payload) => ipcRenderer.invoke("agent:setRelay", payload),
  transcribeAudio: (buffer) => ipcRenderer.invoke("audio:transcribe", buffer),
  onAgentOutput: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:output", handler);
    return () => ipcRenderer.removeListener("agent:output", handler);
  },
  onAgentStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:status", handler);
    return () => ipcRenderer.removeListener("agent:status", handler);
  },
  onAgentModels: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:models", handler);
    return () => ipcRenderer.removeListener("agent:models", handler);
  },
  onMicState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("mic:state", handler);
    return () => ipcRenderer.removeListener("mic:state", handler);
  },
  onAgentSummary: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:summary", handler);
    return () => ipcRenderer.removeListener("agent:summary", handler);
  },
  onAgentRelay: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:relay", handler);
    return () => ipcRenderer.removeListener("agent:relay", handler);
  }
});
