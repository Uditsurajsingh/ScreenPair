import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("screenPair", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: settings => ipcRenderer.invoke("settings:save", settings),
  listModels: () => ipcRenderer.invoke("models:list"),
  chooseTemplate: () => ipcRenderer.invoke("template:choose"),
  addBackgroundFiles: () => ipcRenderer.invoke("background:add"),
  clearBackgroundFiles: () => ipcRenderer.invoke("background:clear"),
  capture: () => ipcRenderer.invoke("capture"),
  analyze: payload => ipcRenderer.invoke("analyze", payload),
  addStep: payload => ipcRenderer.invoke("session:add", payload),
  listSteps: () => ipcRenderer.invoke("session:list"),
  clearSteps: () => ipcRenderer.invoke("session:clear"),
  exportReport: () => ipcRenderer.invoke("report:export"),
  showInFolder: filePath => ipcRenderer.invoke("path:open", filePath)
});
