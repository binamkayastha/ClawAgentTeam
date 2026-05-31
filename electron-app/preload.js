const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piFlow", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  createAgent: (payload) => ipcRenderer.invoke("agent:create", payload),
  sendMessage: (payload) => ipcRenderer.invoke("agent:message", payload),
  onAgentOutput: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:output", handler);
    return () => ipcRenderer.removeListener("agent:output", handler);
  },
  onAgentStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:status", handler);
    return () => ipcRenderer.removeListener("agent:status", handler);
  }
});
