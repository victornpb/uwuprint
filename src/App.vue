<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { BlePrinter } from "./ble-printer.js";

const images = ref([]);
const appInfo = ref({ name: "App", slug: "app", tagline: "", version: "" });
const selectedId = ref(null);
const processing = ref(false);
const printing = ref(false);
const printProgress = ref(0);
const postFeedForPrint = ref(true);
const queueOptions = ref({ pause: true, feedBetween: false });
const autoContinueSeconds = ref(0);
const countdown = ref(0);
const countdownPaused = ref(false);
let countdownTimer;
let countdownStartPointer;
const renderTasks = new Map();
const showContinue = ref(false);
const queueIndex = ref(0);
const showPicker = ref(false);
const showPreferences = ref(false);
const activePreferenceTab = ref("printer");
const showOtherDevices = ref(false);
const devices = ref([]);
const preferences = ref(
  JSON.parse(
    localStorage.getItem("uwuprint-preferences") ||
      JSON.stringify({
        autoConnect: false,
        autoConnectOnStartup: true,
        printer: {
          energy: 39321,
          quality: 5,
          speed: 0,
          postFeed: 55,
          manualFeed: 20,
        },
        advanced: { chunkDelay: 20, disconnectAfter: 300 },
        queue: { cancelCountdownOnMouseMove: true },
        notifications: {
          enabled: true,
          lowBattery: true,
          paper: true,
          lid: true,
          temperature: true,
          printComplete: true,
        },
      }),
  ),
);
preferences.value.printer = {
  energy: 39321,
  quality: 5,
  speed: 0,
  postFeed: 55,
  manualFeed: 20,
  ...(preferences.value.printer || {}),
};
preferences.value.advanced = {
  chunkDelay: 20,
  disconnectAfter: 300,
  ...(preferences.value.advanced || {}),
};
preferences.value.queue = {
  cancelCountdownOnMouseMove: true,
  ...(preferences.value.queue || {}),
};
if (typeof preferences.value.autoConnectOnStartup !== "boolean")
  preferences.value.autoConnectOnStartup = true;
if (preferences.value.printer.quality === 0)
  preferences.value.printer.quality = 5;
const printerStatus = ref({
  connected: false,
  message: "Disconnected",
  paper: "Unknown",
  lid: "Unknown",
  temperature: "Normal",
  battery: "Unknown",
  busy: false,
  buffer: "Ready",
});
const printer = new BlePrinter(
  updatePrinterStatus,
  () => preferences.value.autoConnect,
  (progress) => {
    printProgress.value = progress;
  },
);
let disconnectTimer;
const selected = computed(() =>
  images.value.find((image) => image.id === selectedId.value),
);
const supportedDevices = computed(() =>
  devices.value.filter((device) => device.supported),
);
const otherDevices = computed(() =>
  devices.value.filter((device) => !device.supported),
);
const isImagePath = (filePath) =>
  /\.(png|jpe?g|webp|gif|tiff?|bmp)$/i.test(filePath);

function defaults() {
  return {
    rotation: 0,
    contrast: 1,
    brightness: 0,
    dither: "floyd-steinberg",
    crop: { left: 0, top: 0, width: 0, height: 0 },
  };
}
function savePreferences() {
  localStorage.setItem(
    "uwuprint-preferences",
    JSON.stringify(preferences.value),
  );
}
function maybeNotify(event, title, body) {
  if (
    preferences.value.notifications.enabled &&
    preferences.value.notifications[event]
  )
    window.desktop.showNotification({ title, body });
}

function updatePrinterStatus(next) {
  const previous = printerStatus.value;
  printerStatus.value = next;
  if (next.connected && next.deviceName)
    localStorage.setItem("uwuprint-preferred-printer", next.deviceName);
  if (next.battery === "Low" && previous.battery !== "Low")
    maybeNotify(
      "lowBattery",
      `${appInfo.value.name} battery low`,
      "Charge the MX06 printer soon.",
    );
  if (next.paper === "Out of paper" && previous.paper !== "Out of paper")
    maybeNotify(
      "paper",
      `${appInfo.value.name} needs paper`,
      "Load a new thermal paper roll.",
    );
  if (next.lid === "Open" && previous.lid !== "Open")
    maybeNotify(
      "lid",
      `${appInfo.value.name} lid open`,
      "Close the printer lid before printing.",
    );
  if (next.temperature === "Too hot" && previous.temperature !== "Too hot")
    maybeNotify(
      "temperature",
      `${appInfo.value.name} is cooling down`,
      "The printhead is too hot. Wait before printing again.",
    );
}

function addImages(paths) {
  const added = [];
  for (const path of paths)
    if (!images.value.some((image) => image.path === path)) {
      const image = {
        id: crypto.randomUUID(),
        path,
        name: path.split("/").pop(),
        options: defaults(),
        preview: null,
        pixels: null,
        width: 0,
        height: 0,
        processing: true,
        error: null,
      };
      images.value.push(image);
      added.push(image);
    }
  if (!selectedId.value && images.value[0])
    selectedId.value = images.value[0].id;
  // Sharp rendering is deliberately serialized. Starting a large group of IPC
  // image jobs at once could leave the final queue item waiting indefinitely.
  void renderAddedImages(added);
}
async function renderAddedImages(added) {
  for (const image of added) await renderImage(image);
}
async function chooseImages() {
  addImages(await window.desktop.chooseImages());
}
async function pasteFromClipboard() {
  try {
    const { paths: filePaths, formats } = await window.desktop.pasteFiles();
    if (filePaths.length) {
      addImages(filePaths);
      return;
    }
    const imagePath = await window.desktop.pasteImage();
    if (imagePath) {
      addImages([imagePath]);
      return;
    }
    printerStatus.value = {
      ...printerStatus.value,
      message: `Clipboard does not contain an image (${formats.join(", ") || "no supported formats"})`,
    };
  } catch (error) {
    printerStatus.value = {
      ...printerStatus.value,
      message: `Could not read clipboard: ${error.message}`,
    };
  }
}
function handlePaste(event) {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
  event.preventDefault();
  pasteFromClipboard();
}
function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}
async function handleDrop(event) {
  const droppedFiles = [...event.dataTransfer.files];
  // Browsers can expose the rendered image as an in-memory File. Preserve its
  // bytes instead of re-downloading an often protected CDN URL.
  const imageFile = [
    ...[...event.dataTransfer.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile()),
    ...droppedFiles,
  ].find((file) => file?.type.startsWith("image/") && file.size > 0);
  if (imageFile) {
    try {
      const dataUrl = await readAsDataUrl(imageFile);
      const { path: importedPath } =
        await window.desktop.importDroppedImageDataUrl(dataUrl);
      if (importedPath) return addImages([importedPath]);
    } catch (error) {
      // Continue to the URL representation below.
    }
  }
  const files = droppedFiles
    .map(window.desktop.getPathForFile)
    .filter(isImagePath);
  if (files.length) return addImages(files);
  printerStatus.value = {
    ...printerStatus.value,
    message:
      "This browser drag did not include image data. Use Copy Image, then paste.",
  };
}
async function renderSelected() {
  if (!selected.value) return;
  processing.value = true;
  try {
    await renderImage(selected.value);
  } finally {
    processing.value = false;
  }
}
async function renderImage(image) {
  const options = JSON.parse(JSON.stringify(image.options));
  const key = JSON.stringify(options);
  const existing = renderTasks.get(image.id);
  if (existing?.key === key) return existing.task;
  image.processing = true;
  const task = window.desktop
    .renderImage(image.path, options)
    .then((result) => {
      // Ignore an older render that finishes after newer image controls changed.
      if (renderTasks.get(image.id)?.key === key) {
        Object.assign(image, result);
        image.error = null;
      }
    })
    .catch((error) => {
      if (renderTasks.get(image.id)?.key === key) {
        image.error = error.message;
        printerStatus.value = {
          ...printerStatus.value,
          message: error.message,
        };
      }
    })
    .finally(() => {
      if (renderTasks.get(image.id)?.key === key) {
        image.processing = false;
        renderTasks.delete(image.id);
      }
    });
  renderTasks.set(image.id, { key, task });
  return task;
}
function decodePixels(base64) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
async function openPicker() {
  devices.value = [];
  showOtherDevices.value = false;
  showPicker.value = true;
  try {
    await printer.connect();
    showPicker.value = false;
  } catch (error) {
    if (error.name !== "NotFoundError")
      printerStatus.value = { ...printerStatus.value, message: error.message };
  }
}
async function selectDevice(device) {
  device.connecting = true;
  printerStatus.value = {
    ...printerStatus.value,
    message: `Connecting to ${device.name}…`,
  };
  await window.desktop.selectBluetoothDevice(device.id);
}
async function closePicker() {
  await window.desktop.cancelBluetoothSelection();
  showPicker.value = false;
}
async function printSelected() {
  if (!selected.value?.pixels) await renderSelected();
  if (!selected.value?.pixels) return false;
  printing.value = true;
  printProgress.value = 0;
  try {
    await printer.print(
      decodePixels(selected.value.pixels),
      selected.value.width,
      selected.value.height,
      {
        ...preferences.value.printer,
        chunkDelay: preferences.value.advanced.chunkDelay,
        postFeedEnabled: postFeedForPrint.value,
      },
    );
    updatePrinterStatus({ ...printerStatus.value, message: "Print complete" });
    maybeNotify(
      "printComplete",
      `${appInfo.value.name} print complete`,
      `${selected.value.name} finished printing.`,
    );
    scheduleDisconnect();
    return true;
  } catch (error) {
    printerStatus.value = { ...printerStatus.value, message: error.message };
    return false;
  } finally {
    printing.value = false;
  }
}
async function printAll() {
  queueIndex.value = 0;
  await printQueueItem();
}
async function printQueueItem() {
  if (!images.value[queueIndex.value]) return;
  selectedId.value = images.value[queueIndex.value].id;
  await nextTick();
  postFeedForPrint.value =
    queueOptions.value.feedBetween &&
    queueIndex.value < images.value.length - 1;
  const didPrint = await printSelected();
  if (!didPrint) return;
  if (queueIndex.value < images.value.length - 1) {
    if (queueOptions.value.pause) openContinue();
    else {
      queueIndex.value++;
      await printQueueItem();
    }
  }
}
function openContinue() {
  showContinue.value = true;
  countdown.value = autoContinueSeconds.value;
  countdownPaused.value = false;
  countdownStartPointer = null;
  clearInterval(countdownTimer);
  startCountdown();
}
function startCountdown() {
  if (!countdown.value) return;
  countdownPaused.value = false;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (--countdown.value <= 0) continueQueue();
  }, 1000);
}
function pauseCountdown() {
  clearInterval(countdownTimer);
  if (countdown.value) countdownPaused.value = true;
}
function handleCountdownMouseMove(event) {
  if (
    !showContinue.value ||
    !countdown.value ||
    !preferences.value.queue.cancelCountdownOnMouseMove
  )
    return;
  if (!countdownStartPointer)
    countdownStartPointer = { x: event.clientX, y: event.clientY };
  else if (
    Math.hypot(
      event.clientX - countdownStartPointer.x,
      event.clientY - countdownStartPointer.y,
    ) > 10
  )
    pauseCountdown();
}
async function continueQueue() {
  clearInterval(countdownTimer);
  showContinue.value = false;
  queueIndex.value++;
  await printQueueItem();
}
function cancelQueue() {
  clearInterval(countdownTimer);
  showContinue.value = false;
  countdownPaused.value = false;
  queueIndex.value = 0;
}
function onContinueKey(event) {
  if (showContinue.value && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    continueQueue();
  }
}
function removeImage(id) {
  const index = images.value.findIndex((image) => image.id === id);
  images.value.splice(index, 1);
  if (id === selectedId.value)
    selectedId.value =
      images.value[index]?.id || images.value[index - 1]?.id || null;
}
async function refreshStatus() {
  try {
    await printer.requestStatus();
  } catch (error) {
    printerStatus.value = { ...printerStatus.value, message: error.message };
  }
}
function motionStatus(message) {
  updatePrinterStatus({ ...printerStatus.value, message });
  setTimeout(() => {
    if (printerStatus.value.connected && !printing.value)
      updatePrinterStatus({ ...printerStatus.value, message: "Ready" });
  }, 900);
}
async function feedPaper() {
  try {
    await printer.feedPaper(preferences.value.printer.manualFeed);
    motionStatus("Paper fed");
  } catch (error) {
    printerStatus.value = { ...printerStatus.value, message: error.message };
  }
}
async function retractPaper() {
  try {
    await printer.retractPaper(preferences.value.printer.manualFeed);
    motionStatus("Paper retracted");
  } catch (error) {
    printerStatus.value = { ...printerStatus.value, message: error.message };
  }
}
function resetImageControls() {
  if (selected.value) selected.value.options = defaults();
}
function resetControl(key, value) {
  if (selected.value) selected.value.options[key] = value;
}
function clearQueue() {
  clearInterval(countdownTimer);
  showContinue.value = false;
  countdownPaused.value = false;
  renderTasks.clear();
  images.value = [];
  selectedId.value = null;
}
function disconnectPrinter() {
  clearTimeout(disconnectTimer);
  printer.disconnect();
  printerStatus.value = {
    ...printerStatus.value,
    connected: false,
    busy: false,
    message: "Disconnected",
  };
}
function openMarginSettings() {
  activePreferenceTab.value = "printer";
  showPreferences.value = true;
}
function scheduleDisconnect() {
  clearTimeout(disconnectTimer);
  const seconds = Number(preferences.value.advanced.disconnectAfter);
  if (!seconds) return;
  disconnectTimer = setTimeout(() => {
    printer.disconnect();
    updatePrinterStatus({
      ...printerStatus.value,
      connected: false,
      message: "Disconnected after printing",
    });
  }, seconds * 1000);
}

watch(preferences, savePreferences, { deep: true });
watch(() => selected.value?.id, renderSelected);
watch(() => selected.value?.options, renderSelected, { deep: true });
watch(
  [() => printerStatus.value.connected, printing, () => images.value.length],
  ([connected, isPrinting, imageCount]) =>
    window.desktop.updatePrinterMenu({
      connected,
      printing: isPrinting,
      hasImages: imageCount > 0,
    }),
  { immediate: true },
);
watch(
  () => queueOptions.value.pause,
  (enabled) => {
    if (!enabled) {
      autoContinueSeconds.value = 0;
      pauseCountdown();
    }
  },
);
onMounted(() => {
  window.desktop.getAppInfo().then((info) => {
    appInfo.value = info;
    document.title = info.name;
  });
  window.desktop.getAccentColor?.().then((color) => {
    document.documentElement.style.setProperty("--os-accent", color);
  });
  window.desktop.onAccentColorChanged?.((color) => {
    document.documentElement.style.setProperty("--os-accent", color);
  });

  window.desktop.onOpenImages(addImages);
  window.desktop.onMenuAction((action) => {
    const actions = {
      "add-images": chooseImages,
      "add-from-clipboard": pasteFromClipboard,
      "clear-queue": clearQueue,
      connect: openPicker,
      disconnect: disconnectPrinter,
      "refresh-status": refreshStatus,
      "feed-paper": feedPaper,
      "retract-paper": retractPaper,
      "print-image": printSelected,
      "print-all": printAll,
      preferences: () => {
        showPreferences.value = true;
        activePreferenceTab.value = "printer";
      },
    };
    actions[action]?.();
  });
  window.desktop.onBluetoothDevices((list) => {
    devices.value = list;
  });
  const preferredPrinter = localStorage.getItem("uwuprint-preferred-printer");
  if (preferences.value.autoConnectOnStartup && preferredPrinter)
    printer.reconnectKnown(preferredPrinter, true).catch((error) => {
      printerStatus.value = { ...printerStatus.value, message: error.message };
    });
  window.addEventListener("keydown", onContinueKey);
  window.addEventListener("mousemove", handleCountdownMouseMove);
});
onBeforeUnmount(() => {
  clearInterval(countdownTimer);
  window.removeEventListener("keydown", onContinueKey);
  window.removeEventListener("mousemove", handleCountdownMouseMove);
});
</script>

<template>
  <main
    tabindex="-1"
    @keydown="onContinueKey"
    @paste="handlePaste"
    @dragover="handleDragOver"
    @drop.prevent="handleDrop"
  >
    <header>
      <div>
        <h1>{{ appInfo.name }}</h1>
        <p>{{ appInfo.tagline }}</p>
      </div>
      <div class="connection">
        <span :class="['dot', { connected: printerStatus.connected }]" />{{
          printerStatus.message
        }}<button v-if="!printerStatus.connected" @click="openPicker">
          Connect</button
        ><button v-else class="secondary" @click="disconnectPrinter">
          Disconnect</button
        ><button
          class="icon-button"
          title="Preferences"
          @click="
            showPreferences = true;
            activePreferenceTab = 'printer';
          "
        >
          ⚙
        </button>
      </div>
    </header>
    <section class="paper-toolbar">
      <strong>Paper</strong
      ><input
        v-model.number="preferences.printer.manualFeed"
        type="number"
        min="1"
        max="500"
      /><span>px</span
      ><button
        class="secondary"
        :disabled="!printerStatus.connected"
        @click="retractPaper"
      >
        Retract</button
      ><button
        class="secondary"
        :disabled="!printerStatus.connected"
        @click="feedPaper"
      >
        Feed
      </button>
    </section>
    <section class="layout">
      <aside class="queue">
        <div class="queue-header">
          <h2>Queue</h2>
          <div>
            <button v-if="images.length" class="clear-link" @click="clearQueue">
              Clear</button
            ><button class="add" @click="chooseImages">Add images</button
            ><button class="secondary" @click="pasteFromClipboard">
              Add from clipboard
            </button>
          </div>
        </div>
        <div v-if="!images.length" class="empty">
          Drop images here<br />or add files.
        </div>
        <div class="image-list">
          <article
            v-for="(image, index) in images"
            :key="image.id"
            :class="['image-item', { selected: image.id === selectedId }]"
            @click="selectedId = image.id"
          >
            <img v-if="image.preview" :src="image.preview" alt="" />
            <div>
              <strong>{{ image.name }}</strong
              ><small
                >{{
                  image.width
                    ? `${image.width} × ${image.height}`
                    : image.error ||
                      (image.processing ? "Processing…" : "Not rendered")
                }}
                · #{{ index + 1 }}</small
              >
            </div>
            <button
              class="remove"
              title="Remove image"
              @click.stop="removeImage(image.id)"
            >
              ×
            </button>
          </article>
        </div>
        <div v-if="images.length" class="queue-actions bottom-actions">
          <label
            ><input v-model="queueOptions.pause" type="checkbox" /> Pause
            between items</label
          ><label v-if="queueOptions.pause"
            >Auto continue
            <select v-model.number="autoContinueSeconds">
              <option :value="0">Off</option>
              <option :value="5">5 sec</option>
              <option :value="10">10 sec</option>
              <option :value="30">30 sec</option>
            </select></label
          ><label
            ><input v-model="queueOptions.feedBetween" type="checkbox" /> Feed
            between items <small>{{ preferences.printer.postFeed }} px</small
            ><button
              class="margin-shortcut"
              title="Edit print margin"
              @click.prevent="openMarginSettings"
            >
              ⚙
            </button></label
          ><button
            :disabled="!printerStatus.connected || printing"
            :title="
              !printerStatus.connected ? 'Connect a printer to print' : ''
            "
            @click="printAll"
          >
            Print all
          </button>
        </div>
      </aside>
      <section class="workspace">
        <div v-if="selected" class="preview-card">
          <div class="preview-title">
            <span
              >Print preview · {{ selected.width || 384 }} ×
              {{ selected.height || "…" }}</span
            ><span v-if="processing">Processing…</span>
          </div>
          <div class="paper">
            <img
              v-if="selected.preview"
              :src="selected.preview"
              alt="Processed thermal print preview"
            />
          </div>
        </div>
        <div v-else class="empty canvas-empty">Add an image to start.</div>
      </section>
      <aside class="controls" v-if="selected">
        <div class="controls-heading">
          <h2>Image controls</h2>
          <button class="clear-link" @click="resetImageControls">Reset</button>
        </div>
        <label
          >Rotation<select v-model.number="selected.options.rotation">
            <option :value="0">0°</option>
            <option :value="90">90°</option>
            <option :value="180">180°</option>
            <option :value="270">270°</option>
          </select></label
        ><label
          >Contrast <output>{{ selected.options.contrast.toFixed(2) }}</output
          ><input
            v-model.number="selected.options.contrast"
            @dblclick="resetControl('contrast', 1)"
            type="range"
            min="0.5"
            max="2"
            step="0.05" /></label
        ><label
          >Brightness <output>{{ selected.options.brightness }}</output
          ><input
            v-model.number="selected.options.brightness"
            @dblclick="resetControl('brightness', 0)"
            type="range"
            min="-80"
            max="80"
            step="1" /></label
        ><label
          >Dithering<select v-model="selected.options.dither">
            <option value="floyd-steinberg">Floyd–Steinberg</option>
            <option value="threshold">Threshold</option>
          </select></label
        ><label class="post-feed-toggle"
          ><input v-model="postFeedForPrint" type="checkbox" /> Feed paper after
          print <small>{{ preferences.printer.postFeed }} px</small
          ><button
            class="margin-shortcut"
            title="Edit print margin"
            @click.prevent="openMarginSettings"
          >
            ⚙
          </button></label
        ><button
          class="print"
          :disabled="!printerStatus.connected || processing || printing"
          :title="!printerStatus.connected ? 'Connect a printer to print' : ''"
          @click="printSelected"
        >
          Print image
        </button>
        <div v-if="printing" class="progress">
          <span>Printing {{ printProgress }}%</span>
          <div><i :style="{ width: `${printProgress}%` }" /></div>
        </div>
      </aside>
    </section>
    <section class="status-strip">
      <span><b>Paper</b>{{ printerStatus.paper }}</span
      ><span><b>Lid</b>{{ printerStatus.lid }}</span
      ><span><b>Temperature</b>{{ printerStatus.temperature }}</span
      ><span><b>Battery</b>{{ printerStatus.battery }}</span
      ><span><b>Printer</b>{{ printerStatus.busy ? "Busy" : "Ready" }}</span
      ><button
        class="status-refresh clear-link"
        :disabled="!printerStatus.connected"
        @click="refreshStatus"
      >
        Refresh status
      </button>
    </section>
    <div v-if="showPicker" class="modal-backdrop" @click.self="closePicker">
      <section class="modal">
        <div class="modal-header">
          <div>
            <h2>Connect a printer</h2>
            <p>Nearby Bluetooth devices appear as they are discovered.</p>
          </div>
          <button class="icon-button" @click="closePicker">×</button>
        </div>
        <label class="auto-connect"
          ><input v-model="preferences.autoConnect" type="checkbox" />
          Automatically reconnect to this printer</label
        >
        <div class="device-section">
          <h3>
            Supported printers <em>{{ supportedDevices.length }}</em>
          </h3>
          <button
            v-for="device in supportedDevices"
            :key="device.id"
            :disabled="device.connecting"
            :class="['device-row', { connecting: device.connecting }]"
            @click="selectDevice(device)"
          >
            <span
              ><strong>{{ device.name }}</strong
              ><small
                >MX/GB/GT compatible · {{ device.id.slice(-6) }}</small
              ></span
            ><span
              ><i v-if="device.connecting" class="spinner" />{{
                device.connecting ? "Connecting…" : "Connect"
              }}</span
            >
          </button>
          <p v-if="!supportedDevices.length" class="muted">
            Searching for MX06 and compatible printers…
          </p>
        </div>
        <div class="device-section">
          <button
            class="section-toggle"
            @click="showOtherDevices = !showOtherDevices"
          >
            <span
              >Other Bluetooth devices <em>{{ otherDevices.length }}</em></span
            ><span>{{ showOtherDevices ? "⌃" : "⌄" }}</span></button
          ><template v-if="showOtherDevices"
            ><button
              v-for="device in otherDevices"
              :key="device.id"
              :disabled="device.connecting"
              :class="['device-row', { connecting: device.connecting }]"
              @click="selectDevice(device)"
            >
              <span
                ><strong>{{ device.name }}</strong
                ><small>Bluetooth LE · {{ device.id.slice(-6) }}</small></span
              ><span
                ><i v-if="device.connecting" class="spinner" />{{
                  device.connecting ? "Connecting…" : "Connect"
                }}</span
              >
            </button>
            <p v-if="!otherDevices.length" class="muted">
              No other devices found yet.
            </p></template
          >
        </div>
      </section>
    </div>
    <div
      v-if="showPreferences"
      class="modal-backdrop"
      @click.self="showPreferences = false"
    >
      <section class="modal preferences-modal">
        <div class="preferences-header">
          <h2>Preferences</h2>
          <button class="icon-button" @click="showPreferences = false">
            ×
          </button>
        </div>
        <div class="preferences-body">
          <aside class="preferences-sidebar">
            <button
              :class="{ active: activePreferenceTab === 'printer' }"
              @click="activePreferenceTab = 'printer'"
            >
              🖨 Printer
            </button>
            <button
              :class="{ active: activePreferenceTab === 'connection' }"
              @click="activePreferenceTab = 'connection'"
            >
              🔌 Connection
            </button>
            <button
              :class="{ active: activePreferenceTab === 'notifications' }"
              @click="activePreferenceTab = 'notifications'"
            >
              🔔 Notifications
            </button>
            <button
              :class="{ active: activePreferenceTab === 'advanced' }"
              @click="activePreferenceTab = 'advanced'"
            >
              ⚙️ Advanced
            </button>
          </aside>
          <main class="preferences-content">
            <template v-if="activePreferenceTab === 'printer'">
              <section class="settings-section">
                <div class="section-heading">
                  <h3>Print quality</h3>
                  <p>Balance darkness, detail, and printhead heat.</p>
                </div>
                <label class="setting-field"
                  ><span
                    ><strong>Print energy</strong
                    ><small>Higher values print darker.</small></span
                  ><input
                    v-model.number="preferences.printer.energy"
                    type="number"
                    min="1"
                    max="65535" /></label
                ><label class="setting-field"
                  ><span
                    ><strong>Print density</strong
                    ><small
                      >Controls the printer’s dot concentration.</small
                    ></span
                  ><select v-model.number="preferences.printer.quality">
                    <option :value="1">1 · Lightest</option>
                    <option :value="2">2 · Light</option>
                    <option :value="3">3 · Medium</option>
                    <option :value="4">4 · Dark</option>
                    <option :value="5">5 · Darkest</option>
                  </select></label
                >
              </section>
              <section class="settings-section">
                <div class="section-heading">
                  <h3>Paper movement</h3>
                  <p>Move paper forward or backward by the selected amount.</p>
                </div>
                <label class="setting-field"
                  ><span
                    ><strong>Post-print feed</strong
                    ><small>Extra paper after each image.</small></span
                  ><input
                    v-model.number="preferences.printer.postFeed"
                    type="number"
                    min="0"
                    max="500"
                /></label>
                <div class="setting-field">
                  <span
                    ><strong>Move amount</strong
                    ><small
                      >Pixels to feed forward or retract backward.</small
                    ></span
                  >
                  <div class="inline-control">
                    <input
                      v-model.number="preferences.printer.manualFeed"
                      type="number"
                      min="1"
                      max="500"
                    /><button
                      class="secondary"
                      :disabled="!printerStatus.connected"
                      @click="retractPaper"
                    >
                      Retract</button
                    ><button
                      class="secondary"
                      :disabled="!printerStatus.connected"
                      @click="feedPaper"
                    >
                      Feed
                    </button>
                  </div>
                </div>
              </section>
            </template>
            <template v-if="activePreferenceTab === 'connection'">
              <section class="settings-section">
                <div class="section-heading">
                  <h3>Startup behavior</h3>
                  <p>Choose what happens when {{ appInfo.name }} opens.</p>
                </div>
                <label class="toggle-row"
                  ><span
                    ><strong>Connect to last printer on startup</strong
                    ><small
                      >Reconnect automatically when a remembered printer is
                      nearby.</small
                    ></span
                  ><input
                    v-model="preferences.autoConnectOnStartup"
                    type="checkbox"
                /></label>
              </section>
              <section class="settings-section">
                <div class="section-heading">
                  <h3>Disconnect</h3>
                  <p>Manage connection lifecycle.</p>
                </div>
                <label class="setting-field"
                  ><span
                    ><strong>Disconnect after printing</strong
                    ><small
                      >Automatically disconnect after the most recent
                      print.</small
                    ></span
                  ><select
                    v-model.number="preferences.advanced.disconnectAfter"
                  >
                    <option :value="0">Never</option>
                    <option :value="30">30 seconds</option>
                    <option :value="60">1 minute</option>
                    <option :value="300">5 minutes (default)</option>
                    <option :value="900">15 minutes</option>
                  </select></label
                >
              </section>
            </template>
            <template v-if="activePreferenceTab === 'notifications'">
              <section class="settings-section">
                <div class="section-heading">
                  <h3>Notifications</h3>
                  <p>Choose which printer events should interrupt you.</p>
                </div>
                <label class="toggle-row"
                  ><span
                    ><strong>Notifications</strong
                    ><small
                      >Master switch for {{ appInfo.name }} alerts</small
                    ></span
                  ><input
                    v-model="preferences.notifications.enabled"
                    type="checkbox"
                /></label>
                <div
                  :class="[
                    'notification-options',
                    { disabled: !preferences.notifications.enabled },
                  ]"
                >
                  <label
                    v-for="[key, label] in [
                      ['lowBattery', 'Low battery'],
                      ['paper', 'Out of paper'],
                      ['lid', 'Lid open'],
                      ['temperature', 'Printer too hot'],
                      ['printComplete', 'Print complete'],
                    ]"
                    :key="key"
                    class="toggle-row"
                    ><span>{{ label }}</span
                    ><input
                      v-model="preferences.notifications[key]"
                      :disabled="!preferences.notifications.enabled"
                      type="checkbox"
                  /></label>
                </div>
              </section>
            </template>
            <template v-if="activePreferenceTab === 'advanced'">
              <section class="settings-section">
                <div class="section-heading">
                  <h3>Bluetooth transport</h3>
                  <p>These affect data delivery, not image processing.</p>
                </div>
                <label class="setting-field"
                  ><span
                    ><strong>Packet delay</strong
                    ><small
                      >Pause between Bluetooth chunks. Increase it if prints are
                      incomplete or scrambled.</small
                    ></span
                  >
                  <div class="inline-control">
                    <input
                      v-model.number="preferences.advanced.chunkDelay"
                      type="number"
                      min="0"
                      max="500"
                    /><span class="unit">ms</span>
                  </div></label
                ><label class="toggle-row"
                  ><span
                    ><strong>Pause countdown on mouse movement</strong
                    ><small
                      >Pause auto-continue after the pointer moves more than
                      10px.</small
                    ></span
                  ><input
                    v-model="preferences.queue.cancelCountdownOnMouseMove"
                    type="checkbox"
                /></label>
              </section>
            </template>
          </main>
        </div>
      </section>
    </div>
    <div v-if="showContinue" class="modal-backdrop" @click.self="cancelQueue">
      <section class="modal print-dialog">
        <h2>Ready for the next image?</h2>
        <p>
          Printed {{ queueIndex + 1 }} of {{ images.length }}.
          <span v-if="countdown && !countdownPaused"
            >Continuing in {{ countdown }} seconds.</span
          >
          <span v-else-if="countdownPaused"
            >Countdown paused with {{ countdown }} seconds left.</span
          >
          <span v-else>Press Enter or Space to continue.</span>
        </p>
        <img
          v-if="images[queueIndex + 1]?.preview"
          class="next-preview"
          :src="images[queueIndex + 1].preview"
          alt="Next image preview"
        />
        <div class="job-motion">
          <button class="secondary" @click="retractPaper">Retract</button
          ><button class="secondary" @click="feedPaper">Feed</button>
        </div>
        <footer>
          <button class="secondary" @click="cancelQueue">Cancel</button
          ><button
            v-if="countdown && !countdownPaused"
            class="secondary"
            @click="pauseCountdown"
          >
            Pause countdown</button
          ><button
            v-else-if="countdownPaused"
            class="secondary"
            @click="startCountdown"
          >
            Resume countdown ({{ countdown }})</button
          ><button autofocus @click="continueQueue">
            {{
              countdown && !countdownPaused
                ? `Continue now (${countdown})`
                : "Continue"
            }}
          </button>
        </footer>
      </section>
    </div>
  </main>
</template>

<style>
/* App specific structural adjustments */
.device-row > span:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.device-row > span:nth-child(2) {
  flex: initial;
}
.status-strip {
  grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
}
.status-refresh {
  align-self: center;
  margin: 0;
  padding: 4px 8px;
  font-size: 11px;
  white-space: nowrap;
}
.preferences-modal {
  width: 760px;
  height: 560px;
  max-width: 95vw;
  max-height: 95vh;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.preferences-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--sys-border);
  background: var(--sys-sidebar-bg);
  border-radius: 12px 12px 0 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.preferences-header h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.preferences-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-radius: 0 0 12px 12px;
  overflow: hidden;
}
.preferences-sidebar {
  width: 180px;
  background: var(--sys-sidebar-bg);
  border-right: 1px solid var(--sys-border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.preferences-sidebar button {
  background: transparent;
  color: var(--sys-text-primary);
  text-align: left;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 500;
  border: none;
  box-shadow: none;
}
.preferences-sidebar button:hover:not(:disabled) {
  background: var(--sys-sidebar-hover);
}
.preferences-sidebar button.active {
  background: var(--sys-sidebar-active);
}
.preferences-content {
  flex: 1;
  background: var(--sys-content-bg);
  overflow-y: auto;
  min-height: 0;
  height: 100%;
}
.settings-section {
  padding: 20px 20px 0;
}
.settings-section + .settings-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--sys-border);
}
.section-heading h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.section-heading p {
  margin: 4px 0 12px;
  color: var(--sys-text-secondary);
}
.setting-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  flex-wrap: wrap;
}
.setting-field > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  flex: 1 1 200px;
}
.setting-field small {
  color: var(--sys-text-secondary);
  font-size: 11px;
}
.setting-field input,
.setting-field select,
.inline-control {
  flex-shrink: 1;
  width: 200px;
  max-width: 100%;
}
.setting-field input,
.setting-field select {
  padding: 6px 8px;
  border: 1px solid var(--sys-control-border);
  border-radius: 6px;
  background: var(--sys-control-bg);
}
.setting-field + .setting-field,
.setting-field + .toggle-row,
.toggle-row + .setting-field,
.toggle-row + .toggle-row,
.setting-field + .notification-options,
.toggle-row + .notification-options {
  border-top: 1px solid var(--sys-border);
}

.inline-control {
  display: flex;
  gap: 8px;
}
.inline-control button {
  padding: 6px 12px;
}
.preferences-content .toggle-row {
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toggle-row > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  flex: 1;
}
.toggle-row input {
  flex-shrink: 0;
}
.toggle-row small {
  color: var(--sys-text-secondary);
  font-size: 11px;
}
.unit {
  align-self: center;
  color: var(--sys-text-secondary);
  font-size: 12px;
}
.progress {
  margin-top: 12px;
  font-size: 11px;
  color: var(--sys-text-secondary);
}
.progress > div {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--sys-border);
}
.progress i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--sys-accent);
  transition: width 0.15s;
}
.print-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.print-dialog {
  width: min(400px, calc(100vw - 32px));
}
.next-preview {
  display: block;
  width: min(100%, 260px);
  max-height: 230px;
  margin: 16px auto 8px;
  object-fit: contain;
  image-rendering: pixelated;
  border: 1px solid var(--sys-border);
  border-radius: 6px;
  background: #fff;
}
.job-motion {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
.queue-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  font-size: 12px;
  color: var(--sys-text-primary);
}
.queue-actions label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.post-feed-toggle {
  display: flex !important;
  align-items: center;
  gap: 6px;
  margin: 12px 0 !important;
}
.post-feed-toggle input {
  width: auto !important;
}
.post-feed-toggle small {
  color: var(--sys-text-secondary);
}
.margin-shortcut {
  padding: 2px 4px;
  background: transparent;
  color: var(--sys-accent);
  font-size: 12px;
  border: none;
  box-shadow: none;
}
.queue-actions small {
  color: var(--sys-text-secondary);
}
.queue {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.image-list {
  overflow-y: auto;
  padding-bottom: 150px;
}
.bottom-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0;
  padding: 12px 16px;
  background: rgba(245, 245, 247, 0.95);
  backdrop-filter: blur(10px);
  border-top: 1px solid var(--sys-border);
}
.device-row.connecting {
  background: var(--sys-sidebar-active);
  color: var(--sys-accent);
}
</style>
