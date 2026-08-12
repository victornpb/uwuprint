const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  chooseImages: () => ipcRenderer.invoke("choose-images"),
  pasteImage: () => ipcRenderer.invoke("paste-image"),
  renderImage: (filePath, options) =>
    ipcRenderer.invoke("render-image", filePath, options),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onOpenImages: (callback) =>
    ipcRenderer.on("open-images", (_event, paths) => callback(paths)),
  onBluetoothDevices: (callback) =>
    ipcRenderer.on("bluetooth-devices", (_event, devices) => callback(devices)),
  selectBluetoothDevice: (deviceId) =>
    ipcRenderer.invoke("select-bluetooth-device", deviceId),
  cancelBluetoothSelection: () =>
    ipcRenderer.invoke("cancel-bluetooth-selection"),
  showNotification: (notification) =>
    ipcRenderer.invoke("show-notification", notification),
  getAccentColor: () => ipcRenderer.invoke("get-accent-color"),
  onAccentColorChanged: (callback) =>
    ipcRenderer.on("accent-color-changed", (_event, color) => callback(color)),
});
