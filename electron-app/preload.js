const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piFlow", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  listModels: (payload) => ipcRenderer.invoke("models:list", payload),
  createAgent: (payload) => ipcRenderer.invoke("agent:create", payload),
  sendMessage: (payload) => ipcRenderer.invoke("agent:message", payload),
  abortAgent: (payload) => ipcRenderer.invoke("agent:abort", payload),
  setModel: (payload) => ipcRenderer.invoke("agent:setModel", payload),
  setRelay: (payload) => ipcRenderer.invoke("agent:setRelay", payload),
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
  onAgentSummary: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:summary", handler);
    return () => ipcRenderer.removeListener("agent:summary", handler);
  }
});
