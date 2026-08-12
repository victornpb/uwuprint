const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  chooseImages: () => ipcRenderer.invoke("choose-images"),
  pasteImage: () => ipcRenderer.invoke("paste-image"),
  pasteFiles: () => ipcRenderer.invoke("paste-files"),
  importDroppedImage: (bytes, mimeType) =>
    ipcRenderer.invoke("import-dropped-image", bytes, mimeType),
  importDroppedImageDataUrl: (dataUrl) =>
    ipcRenderer.invoke("import-dropped-image-data-url", dataUrl),
  renderImage: (filePath, options) =>
    ipcRenderer.invoke("render-image", filePath, options),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onOpenImages: (callback) =>
    ipcRenderer.on("open-images", (_event, paths) => callback(paths)),
  onMenuAction: (callback) =>
    ipcRenderer.on("menu-action", (_event, action) => callback(action)),
  onBluetoothDevices: (callback) =>
    ipcRenderer.on("bluetooth-devices", (_event, devices) => callback(devices)),
  selectBluetoothDevice: (deviceId) =>
    ipcRenderer.invoke("select-bluetooth-device", deviceId),
  cancelBluetoothSelection: () =>
    ipcRenderer.invoke("cancel-bluetooth-selection"),
  showNotification: (notification) =>
    ipcRenderer.invoke("show-notification", notification),
  getAppInfo: () => ipcRenderer.invoke("app-info"),
  updatePrinterMenu: (state) => ipcRenderer.send("update-printer-menu", state),
  getAccentColor: () => ipcRenderer.invoke("get-accent-color"),
  onAccentColorChanged: (callback) =>
    ipcRenderer.on("accent-color-changed", (_event, color) => callback(color)),
});
