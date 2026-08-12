const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  systemPreferences,
} = require("electron");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

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
let launchImages = collectImagePaths(process.argv);
let bluetoothSelection;
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

function collectImagePaths(values) {
  return values.filter(
    (value) =>
      IMAGE_EXTENSIONS.has(path.extname(value).toLowerCase()) &&
      fs.existsSync(value),
  );
}

function sendOpenImages(paths) {
  if (
    paths.length &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send("open-images", paths);
  }
}

function createWindow() {
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
        const supported = SUPPORTED_PRINTER_NAMES.has(device.deviceName);
        // macOS can advertise the same low-cost printer under rotating BLE IDs.
        // Collapse only supported models by name, preserving other nearby devices.
        const key = supported
          ? `printer:${device.deviceName}`
          : `device:${device.deviceId}`;
        uniqueDevices.set(key, device);
      }
      mainWindow.webContents.send(
        "bluetooth-devices",
        [...uniqueDevices.values()].map((device) => ({
          id: device.deviceId,
          name: device.deviceName || "Unnamed BLE device",
          supported: SUPPORTED_PRINTER_NAMES.has(device.deviceName),
        })),
      );
    },
  );

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) mainWindow.loadURL(devServerUrl);
  else mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  mainWindow.webContents.once("did-finish-load", () =>
    sendOpenImages(launchImages),
  );
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
  const { data, info } = await image
    .greyscale()
    .linear(contrast, brightness)
    .resize({ width: 384, fit: "inside", withoutEnlargement: true })
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

  if (options.dither !== "threshold") {
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < 384; x++) {
        const index = y * 384 + x;
        const oldPixel = padded[index];
        const newPixel = oldPixel < 128 ? 0 : 255;
        padded[index] = newPixel;
        const error = oldPixel - newPixel;
        const add = (target, amount) => {
          if (target >= 0 && target < padded.length)
            padded[target] = clamp(Math.round(padded[target] + amount), 0, 255);
        };
        if (x + 1 < 384) add(index + 1, (error * 7) / 16);
        if (y + 1 < info.height) {
          if (x > 0) add(index + 383, (error * 3) / 16);
          add(index + 384, (error * 5) / 16);
          if (x + 1 < 384) add(index + 385, error / 16);
        }
      }
    }
  } else {
    for (let i = 0; i < padded.length; i++)
      padded[i] = padded[i] < 128 ? 0 : 255;
  }

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
    `uwuprint-clipboard-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
  );
  await fs.promises.writeFile(filePath, image.toPNG());
  return filePath;
});

ipcMain.handle("render-image", async (_event, inputPath, options) => {
  const result = await renderImage(inputPath, options);
  return {
    preview: result.preview,
    pixels: result.pixels.toString("base64"),
    width: result.width,
    height: result.height,
  };
});

ipcMain.handle("select-bluetooth-device", (_event, deviceId) => {
  if (bluetoothSelection) bluetoothSelection(deviceId);
  bluetoothSelection = null;
});

ipcMain.handle("cancel-bluetooth-selection", () => {
  if (bluetoothSelection) bluetoothSelection("");
  bluetoothSelection = null;
});

ipcMain.handle("show-notification", (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
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
      sendOpenImages(paths);
    }
  } catch (error) {
    console.warn(
      "Could not bring the existing window to the foreground:",
      error.message,
    );
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  const paths = collectImagePaths([filePath]);
  if (mainWindow && !mainWindow.isDestroyed()) sendOpenImages(paths);
  else launchImages.push(...paths);
});

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
