const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piFlow", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  listModels: (payload) => ipcRenderer.invoke("models:list", payload),
  getStoredState: () => ipcRenderer.invoke("storage:get-state"),
  createAgent: (payload) => ipcRenderer.invoke("agent:create", payload),
  sendMessage: (payload) => ipcRenderer.invoke("agent:message", payload),
  setModel: (payload) => ipcRenderer.invoke("agent:setModel", payload),
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
  }
});
