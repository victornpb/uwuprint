const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  systemPreferences,
} = require("electron");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { dither } = require("./dither.js");
const packageJson = require("./package.json");

const APP_NAME = packageJson.prodName || packageJson.name;
const APP_SLUG_NAME = packageJson.name;
const APP_TAGLINE = packageJson.prodTagline || packageJson.description;
const APP_VERSION = packageJson.version;
app.setName(APP_NAME);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: APP_VERSION,
  version: APP_VERSION,
  copyright: APP_TAGLINE,
});

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".tiff",
  ".bmp",
]);
let mainWindow;
let pendingOpenImages = collectImagePaths(process.argv);
let rendererReady = false;
let bluetoothSelection;
let rememberedSelectionNames = [];
let rememberedSelectionTimeoutMs = 15_000;
let rememberedSelectionTimer;
let printerDiscoveryActive = false;
let printerMenuState = { connected: false, printing: false, hasImages: false };
const SUPPORTED_PRINTER_NAMES = new Set([
  "_ZZ00",
  "GB01",
  "GB02",
  "GB03",
  "GT01",
  "MX05",
  "MX06",
  "MX08",
  "MX09",
  "YT01",
]);

function normalizedPrinterName(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toUpperCase();
}

function collectImagePaths(values) {
  return values.filter(
    (value) =>
      IMAGE_EXTENSIONS.has(path.extname(value).toLowerCase()) &&
      fs.existsSync(value),
  );
}

function flushOpenImages() {
  if (
    pendingOpenImages.length &&
    rendererReady &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send("open-images", pendingOpenImages);
    pendingOpenImages = [];
  }
}
function queueOpenImages(paths) {
  pendingOpenImages.push(
    ...paths.filter((filePath) => !pendingOpenImages.includes(filePath)),
  );
  flushOpenImages();
}

function sendMenuAction(action) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  )
    mainWindow.webContents.send("menu-action", action);
}

function createApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Preferences…",
            accelerator: "CommandOrControl+,",
            click: () => sendMenuAction("preferences"),
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "Add Images…",
            accelerator: "CommandOrControl+O",
            click: () => sendMenuAction("add-images"),
          },
          {
            label: "Add from Clipboard",
            accelerator: "CommandOrControl+Shift+V",
            click: () => sendMenuAction("add-from-clipboard"),
          },
          { type: "separator" },
          { label: "Clear Queue", click: () => sendMenuAction("clear-queue") },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "Printer",
        submenu: [
          {
            id: "printer-connect",
            label: "Connect…",
            click: () => sendMenuAction("connect"),
          },
          {
            id: "printer-disconnect",
            label: "Disconnect",
            click: () => sendMenuAction("disconnect"),
          },
          { type: "separator" },
          {
            id: "printer-refresh",
            label: "Refresh Status",
            accelerator: "CommandOrControl+R",
            click: () => sendMenuAction("refresh-status"),
          },
          { type: "separator" },
          {
            id: "printer-feed",
            label: "Feed Paper",
            click: () => sendMenuAction("feed-paper"),
          },
          {
            id: "printer-retract",
            label: "Retract Paper",
            click: () => sendMenuAction("retract-paper"),
          },
          { type: "separator" },
          {
            id: "printer-print",
            label: "Print Image",
            accelerator: "CommandOrControl+P",
            click: () => sendMenuAction("print-image"),
          },
          {
            id: "printer-print-all",
            label: "Print All",
            accelerator: "CommandOrControl+Shift+P",
            click: () => sendMenuAction("print-all"),
          },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ],
      },
    ]),
  );
  updatePrinterMenu();
}

function updatePrinterMenu() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const { connected, printing, hasImages } = printerMenuState;
  const canControl = connected && !printing;
  menu.getMenuItemById("printer-connect").enabled = !connected;
  menu.getMenuItemById("printer-disconnect").enabled = connected;
  for (const id of ["printer-refresh", "printer-feed", "printer-retract"])
    menu.getMenuItemById(id).enabled = canControl;
  menu.getMenuItemById("printer-print").enabled = !printing && hasImages;
  menu.getMenuItemById("printer-print-all").enabled = !printing && hasImages;
}

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on(
    "select-bluetooth-device",
    (event, devices, callback) => {
      event.preventDefault();
      bluetoothSelection = callback;
      const uniqueDevices = new Map();
      for (const device of devices) {
        const printerName = normalizedPrinterName(device.deviceName);
        const supported = SUPPORTED_PRINTER_NAMES.has(printerName);
        // macOS can advertise the same low-cost printer under rotating BLE IDs.
        // Collapse only supported models by name, preserving other nearby devices.
        const key = supported
          ? `printer:${printerName}`
          : `device:${device.deviceId}`;
        uniqueDevices.set(key, device);
      }
      const remembered = [...uniqueDevices.values()].find((device) =>
        rememberedSelectionNames.includes(normalizedPrinterName(device.deviceName)),
      );
      if (remembered) {
        clearTimeout(rememberedSelectionTimer);
        rememberedSelectionNames = [];
        printerDiscoveryActive = false;
        bluetoothSelection = null;
        callback(remembered.deviceId); return;
      }
      if (printerDiscoveryActive) {
        clearTimeout(rememberedSelectionTimer);
        rememberedSelectionTimer = setTimeout(() => {
          rememberedSelectionNames = [];
          printerDiscoveryActive = false;
          if (!mainWindow?.isDestroyed())
            mainWindow.webContents.send("printer-discovery-timeout");
        }, rememberedSelectionTimeoutMs);
      }
      mainWindow.webContents.send(
        "bluetooth-devices",
        [...uniqueDevices.values()].map((device) => ({
          id: device.deviceId,
          name: normalizedPrinterName(device.deviceName) || "Unnamed BLE device",
          supported: SUPPORTED_PRINTER_NAMES.has(
            normalizedPrinterName(device.deviceName),
          ),
        })),
      );
    },
  );

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) mainWindow.loadURL(devServerUrl);
  else mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    rendererReady = true;
    flushOpenImages();
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

async function renderImage(inputPath, options = {}) {
  if (!IMAGE_EXTENSIONS.has(path.extname(inputPath).toLowerCase())) {
    throw new Error(
      "Choose a supported image file (PNG, JPEG, WebP, GIF, TIFF, or BMP).",
    );
  }
  let image = sharp(inputPath, { animated: false });
  const metadata = await image.metadata();
  const originalPreview = await sharp(inputPath, { animated: false })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  if (options.crop?.width > 0 && options.crop?.height > 0) {
    const left = clamp(
      Math.round(options.crop.left || 0),
      0,
      metadata.width - 1,
    );
    const top = clamp(
      Math.round(options.crop.top || 0),
      0,
      metadata.height - 1,
    );
    image = image.extract({
      left,
      top,
      width: clamp(Math.round(options.crop.width), 1, metadata.width - left),
      height: clamp(Math.round(options.crop.height), 1, metadata.height - top),
    });
  }
  image = image.rotate(Number(options.rotation) || 0);

  const contrast = Number(options.contrast ?? 1);
  const brightness = Number(options.brightness ?? 0);
  let processed = image
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .linear(contrast, brightness);
  if (options.trimBlank)
    processed = processed.trim({
      background: { r: 255, g: 255, b: 255 },
      threshold: 8,
    });
  if (options.invert) processed = processed.negate();
  const { data, info } = await processed
    .resize({
      width: 384,
      fit: "inside",
      withoutEnlargement: !options.scaleToWidth,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const padded = Buffer.alloc(384 * info.height, 255);
  const leftPadding = Math.floor((384 - info.width) / 2);
  for (let y = 0; y < info.height; y++)
    data.copy(
      padded,
      y * 384 + leftPadding,
      y * info.width,
      (y + 1) * info.width,
    );

  const dithered = dither(padded, 384, info.height, options.dither);
  dithered.copy(padded);

  const png = await sharp(padded, {
    raw: { width: 384, height: info.height, channels: 1 },
  })
    .png()
    .toBuffer();
  return {
    pixels: padded,
    width: 384,
    height: info.height,
    preview: `data:image/png;base64,${png.toString("base64")}`,
    original: `data:image/png;base64,${originalPreview.toString("base64")}`,
  };
}

ipcMain.handle("choose-images", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: [...IMAGE_EXTENSIONS].map((extension) =>
          extension.slice(1),
        ),
      },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("paste-image", async () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;

  const filePath = path.join(
    app.getPath("temp"),
    `${APP_SLUG_NAME}-clipboard-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
  );
  await fs.promises.writeFile(filePath, image.toPNG());
  return filePath;
});

ipcMain.handle("import-dropped-image", async (_event, bytes, mimeType) => {
  const extension =
    {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/tiff": ".tiff",
    }[mimeType] || ".png";
  const filePath = path.join(
    app.getPath("temp"),
    `${APP_SLUG_NAME}-dropped-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`,
  );
  try {
    const data = Buffer.from(bytes);
    await sharp(data).metadata();
    await fs.promises.writeFile(filePath, data);
    return { path: filePath, error: null };
  } catch {
    // Safari sometimes labels a drag representation as image/png or image/webp
    // even when it contains a pasteboard placeholder. Let the renderer try the
    // accompanying source URL instead of adding an invalid queue item.
    return { path: null, error: "Browser drag did not contain image bytes." };
  }
});

ipcMain.handle("import-dropped-image-data-url", async (_event, dataUrl) => {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) return { path: null, error: "Invalid dropped image data." };
  const [, mimeType, base64] = match;
  const extension =
    {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/tiff": ".tiff",
    }[mimeType] || ".png";
  const data = Buffer.from(base64, "base64");
  try {
    await sharp(data).metadata();
    const filePath = path.join(
      app.getPath("temp"),
      `${APP_SLUG_NAME}-dropped-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`,
    );
    await fs.promises.writeFile(filePath, data);
    return { path: filePath, error: null };
  } catch {
    return { path: null, error: "Browser drag did not contain image bytes." };
  }
});

ipcMain.handle("paste-files", () => {
  const formats = clipboard.availableFormats();
  const paths = [];
  const readClipboardFormat = (format) => {
    try {
      return clipboard.read(format);
    } catch {
      return "";
    }
  };

  // Finder puts a preview/icon image on the clipboard too. Its actual files
  // are stored in this macOS plist, not necessarily as public.file-url.
  if (process.platform === "darwin") {
    const plist = readClipboardFormat("NSFilenamesPboardType");
    for (const match of plist.matchAll(/<string>([\s\S]*?)<\/string>/g)) {
      paths.push(
        match[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"'),
      );
    }
  }
  const raw = [
    "public.file-url",
    "text/uri-list",
    "NSURLPboardType",
    "com.apple.pasteboard.promised-file-url",
  ]
    .map(readClipboardFormat)
    .join("\n");
  paths.push(
    ...raw
      .split(/[\r\n]+/)
      .filter((value) => value.startsWith("file://"))
      .map((value) => {
        try {
          return require("url").fileURLToPath(value);
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
  return { paths: collectImagePaths([...new Set(paths)]), formats };
});

ipcMain.handle("render-image", async (_event, inputPath, options) => {
  const result = await renderImage(inputPath, options);
  return {
    preview: result.preview,
    original: result.original,
    pixels: result.pixels.toString("base64"),
    width: result.width,
    height: result.height,
  };
});

ipcMain.handle("select-bluetooth-device", (_event, deviceId) => {
  clearTimeout(rememberedSelectionTimer); rememberedSelectionNames = []; printerDiscoveryActive = false;
  if (bluetoothSelection) bluetoothSelection(deviceId);
  bluetoothSelection = null;
});

ipcMain.handle("cancel-bluetooth-selection", () => {
  clearTimeout(rememberedSelectionTimer); rememberedSelectionNames = []; printerDiscoveryActive = false;
  if (bluetoothSelection) bluetoothSelection("");
  bluetoothSelection = null;
});
function preparePrinterDiscovery(names, timeoutSeconds) {
  // Print scans every model we support. Remembered devices still populate the
  // settings list, but macOS rotates BLE identifiers so a model match is the
  // only stable identifier available to discovery.
  rememberedSelectionNames = [
    ...SUPPORTED_PRINTER_NAMES,
    ...(Array.isArray(names) ? names : [names]).map(normalizedPrinterName),
  ];
  clearTimeout(rememberedSelectionTimer);
  rememberedSelectionTimeoutMs = Math.max(1, Number(timeoutSeconds) || 15) * 1000;
  printerDiscoveryActive = true;
}

ipcMain.on("prepare-printer-discovery", (event, names, timeoutSeconds) => {
  preparePrinterDiscovery(names, timeoutSeconds);
  event.returnValue = true;
});
ipcMain.handle("select-remembered-printer", (_event, names, timeoutSeconds) => {
  preparePrinterDiscovery(names, timeoutSeconds);
});

ipcMain.handle("show-notification", (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

ipcMain.handle("app-info", () => ({
  name: APP_NAME,
  slug: APP_SLUG_NAME,
  tagline: APP_TAGLINE,
  version: APP_VERSION,
}));
ipcMain.on("update-printer-menu", (_event, state) => {
  printerMenuState = { ...printerMenuState, ...state };
  updatePrinterMenu();
});

ipcMain.handle("get-accent-color", () => {
  try {
    return `#${systemPreferences.getAccentColor()}`;
  } catch (e) {
    return "#007aff";
  }
});

systemPreferences.on("accent-color-changed", (event, newColor) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("accent-color-changed", `#${newColor}`);
  }
});

app.on("second-instance", (_event, argv) => {
  const paths = collectImagePaths(argv);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      queueOpenImages(paths);
    }
  } catch (error) {
    console.warn(
      "Could not bring the existing window to the foreground:",
      error.message,
    );
  }
});

// Register before Electron's ready event: macOS emits this when a file is
// dropped onto the Dock icon, including while the app is launching.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  const paths = collectImagePaths([filePath]);
  queueOpenImages(paths);
});

if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(() => {
    createApplicationMenu();
    createWindow();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
