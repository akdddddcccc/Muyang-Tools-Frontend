const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("taskMapDesktop", {
  isDesktop: true,
  getLaunchProject: () => ipcRenderer.invoke("task-map:get-launch-project"),
  openProject: () => ipcRenderer.invoke("task-map:open-project"),
  saveProject: (input) => ipcRenderer.invoke("task-map:save-project", input),
  setDirtyState: (dirty) => ipcRenderer.send("task-map:set-dirty-state", dirty),
  closeWindow: () => ipcRenderer.invoke("task-map:close-window"),
  exportFile: (input) => ipcRenderer.invoke("task-map:export-file", input),
  exportPdf: (input) => ipcRenderer.invoke("task-map:export-pdf", input),
  requestCore: (input) => ipcRenderer.invoke("task-map:core-request", input),
  onProjectOpened: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("task-map:project-opened", listener);
    return () => ipcRenderer.removeListener("task-map:project-opened", listener);
  },
});
