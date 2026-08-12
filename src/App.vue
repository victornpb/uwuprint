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
const showAppSettings = ref(false);
const showSettings = ref(false);
const showAdvanced = ref(false);
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
      "UwuPrint battery low",
      "Charge the MX06 printer soon.",
    );
  if (next.paper === "Out of paper" && previous.paper !== "Out of paper")
    maybeNotify(
      "paper",
      "UwuPrint needs paper",
      "Load a new thermal paper roll.",
    );
  if (next.lid === "Open" && previous.lid !== "Open")
    maybeNotify(
      "lid",
      "UwuPrint lid open",
      "Close the printer lid before printing.",
    );
  if (next.temperature === "Too hot" && previous.temperature !== "Too hot")
    maybeNotify(
      "temperature",
      "UwuPrint is cooling down",
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
async function pasteImage() {
  const imagePath = await window.desktop.pasteImage();
  if (imagePath) addImages([imagePath]);
  else
    printerStatus.value = {
      ...printerStatus.value,
      message: "Clipboard does not contain an image",
    };
}
function handlePaste(event) {
  if (
    [...event.clipboardData.items].some((item) =>
      item.type.startsWith("image/"),
    )
  ) {
    event.preventDefault();
    pasteImage();
  }
}
async function handleDrop(event) {
  addImages(
    [...event.dataTransfer.files]
      .map(window.desktop.getPathForFile)
      .filter(isImagePath),
  );
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
      "UwuPrint print complete",
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
function openMarginSettings() {
  showSettings.value = true;
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
  () => queueOptions.value.pause,
  (enabled) => {
    if (!enabled) {
      autoContinueSeconds.value = 0;
      pauseCountdown();
    }
  },
);
onMounted(() => {
  window.desktop.onOpenImages(addImages);
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
    @dragover.prevent
    @drop.prevent="handleDrop"
  >
    <header>
      <div>
        <h1>UwuPrint</h1>
        <p>MX06 thermal printer</p>
      </div>
      <div class="connection">
        <span :class="['dot', { connected: printerStatus.connected }]" />{{
          printerStatus.message
        }}<button v-if="!printerStatus.connected" @click="openPicker">
          Connect</button
        ><button
          v-else
          class="secondary"
          @click="
            clearTimeout(disconnectTimer);
            printer.disconnect();
          "
        >
          Disconnect</button
        ><button
          class="icon-button"
          title="Advanced settings"
          @click="showAdvanced = true"
        >
          ⋯</button
        ><button
          class="icon-button"
          title="Printer settings"
          @click="showSettings = true"
        >
          🖨</button
        ><button
          class="icon-button"
          title="App settings"
          @click="showAppSettings = true"
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
            ><button class="secondary" @click="pasteImage">
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
          <button
            :disabled="!printerStatus.connected || printing"
            @click="printAll"
          >
            Print all</button
          ><label
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
          >
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
        class="status-refresh"
        :disabled="!printerStatus.connected"
        @click="refreshStatus"
      >
        Refresh status
      </button>
    </section>
    <div v-if="showPicker" class="modal-backdrop">
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
    <div v-if="showAppSettings" class="modal-backdrop">
      <section class="modal settings">
        <div class="modal-header">
          <div>
            <h2>App settings</h2>
            <p>Preferences for how UwuPrint behaves.</p>
          </div>
          <button class="icon-button" @click="showAppSettings = false">
            ×
          </button>
        </div>
        <section class="settings-section">
          <div class="section-heading">
            <h3>Connection</h3>
            <p>Choose what happens when UwuPrint opens.</p>
          </div>
          <label class="toggle-row"
            ><span
              ><strong>Connect to last printer on startup</strong
              ><small
                >Reconnect automatically when a remembered printer is
                nearby.</small
              ></span
            ><input v-model="preferences.autoConnectOnStartup" type="checkbox"
          /></label>
        </section>
        <footer class="settings-footer">
          <button class="secondary" @click="showAppSettings = false">
            Done
          </button>
        </footer>
      </section>
    </div>
    <div v-if="showSettings" class="modal-backdrop">
      <section class="modal settings">
        <div class="modal-header">
          <div>
            <h2>Printer settings</h2>
            <p>Controls are saved automatically for this printer.</p>
          </div>
          <button class="icon-button" @click="showSettings = false">×</button>
        </div>
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
              ><small>Controls the printer’s dot concentration.</small></span
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
              ><small>Pixels to feed forward or retract backward.</small></span
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
        <section class="settings-section">
          <div class="section-heading">
            <h3>Notifications</h3>
            <p>Choose which printer events should interrupt you.</p>
          </div>
          <label class="toggle-row"
            ><span
              ><strong>Notifications</strong
              ><small>Master switch for UwuPrint alerts</small></span
            ><input v-model="preferences.notifications.enabled" type="checkbox"
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
        <footer class="settings-footer">
          <button class="secondary" @click="showSettings = false">Done</button>
        </footer>
      </section>
    </div>
    <div v-if="showAdvanced" class="modal-backdrop">
      <section class="modal settings">
        <div class="modal-header">
          <div>
            <h2>Advanced settings</h2>
            <p>Transport controls. Defaults are recommended.</p>
          </div>
          <button class="icon-button" @click="showAdvanced = false">×</button>
        </div>
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
          ><label class="setting-field"
            ><span
              ><strong>Disconnect after printing</strong
              ><small
                >Automatically disconnect after the most recent print.</small
              ></span
            ><select v-model.number="preferences.advanced.disconnectAfter">
              <option :value="0">Never</option>
              <option :value="30">30 seconds</option>
              <option :value="60">1 minute</option>
              <option :value="300">5 minutes (default)</option>
              <option :value="900">15 minutes</option>
            </select></label
          >
        </section>
        <footer class="settings-footer">
          <button class="secondary" @click="showAdvanced = false">Done</button>
        </footer>
      </section>
    </div>
    <div v-if="showContinue" class="modal-backdrop">
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
.device-row > span:first-child {
  display: grid;
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
  margin: 10px 14px;
  padding: 7px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.settings {
  width: min(680px, 100%);
  padding: 0;
}
.settings .modal-header {
  padding: 22px 24px 16px;
  border-bottom: 1px solid #eee9f0;
}
.settings-section {
  padding: 20px 24px 0;
}
.settings-section + .settings-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #eee9f0;
}
.section-heading h3 {
  margin: 0;
  font-size: 14px;
}
.section-heading p {
  margin: 4px 0 13px;
}
.setting-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 210px;
  align-items: center;
  gap: 18px;
  padding: 12px 0;
  border-top: 1px solid #f0ebf2;
}
.setting-field > span {
  display: grid;
  gap: 3px;
  font-size: 13px;
}
.setting-field small {
  color: #938998;
  font-size: 11px;
}
.setting-field input,
.setting-field select {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid #dcd4df;
  border-radius: 7px;
  background: white;
}
.inline-control {
  display: flex;
  gap: 8px;
}
.inline-control button {
  padding: 8px 12px;
}
.settings .toggle-row {
  padding: 13px 0;
}
.settings-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  padding: 16px 24px;
  border-top: 1px solid #eee9f0;
  background: #fbf9fc;
}
.settings-footer button {
  padding: 8px 16px;
}
.unit {
  align-self: center;
  color: #827884;
  font-size: 12px;
}
.paper-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 26px;
  background: #fbf9fc;
  border-bottom: 1px solid #e8e2ea;
  font-size: 13px;
  color: #62596a;
}
.paper-toolbar input {
  width: 72px;
  padding: 6px;
  border: 1px solid #dcd4df;
  border-radius: 6px;
}
.paper-toolbar button {
  padding: 7px 11px;
}
.progress {
  margin-top: 12px;
  font-size: 12px;
  color: #675d6b;
}
.progress > div {
  height: 6px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 5px;
  background: #e9e2ef;
}
.progress i {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: #7b3ff2;
  transition: width 0.15s;
}
.print-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.print-dialog {
  width: min(440px, calc(100vw - 32px));
}
.next-preview {
  display: block;
  width: min(100%, 260px);
  max-height: 230px;
  margin: 18px auto 10px;
  object-fit: contain;
  image-rendering: pixelated;
  border: 1px solid #e8e2ea;
  border-radius: 8px;
  background: #fff;
}
.job-motion {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
.controls-heading,
.queue-header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.controls-heading {
  justify-content: space-between;
}
.clear-link {
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: #7557a2;
  font-size: 12px;
}
.clear-link:hover {
  background: transparent;
  color: #55269d;
  text-decoration: underline;
}
.queue-actions {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  font-size: 12px;
  color: #675d6b;
}
.queue-actions label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.post-feed-toggle {
  display: flex !important;
  align-items: center;
  gap: 7px;
  margin: 14px 0 !important;
}
.post-feed-toggle input {
  width: auto !important;
}
.post-feed-toggle small {
  color: #938998;
}
.margin-shortcut {
  padding: 1px 5px;
  background: transparent;
  color: #7557a2;
  font-size: 13px;
}
.queue-actions small {
  color: #938998;
}
.queue {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.image-list {
  overflow: auto;
  padding-bottom: 170px;
}
.bottom-actions {
  position: absolute;
  inset: auto 0 0;
  margin: 0;
  padding: 14px 18px 18px;
  background: #fff;
  border-top: 1px solid #e8e2ea;
  box-shadow: 0 -8px 20px #34263a08;
}
.bottom-actions button:first-child {
  background: #eee9f1;
  color: #44394b;
}
.device-row.connecting {
  background: #f2edff;
  color: #5f2cc8;
  opacity: 1;
}
.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  vertical-align: -2px;
  border: 2px solid #d6c6fa;
  border-top-color: #7040d5;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
