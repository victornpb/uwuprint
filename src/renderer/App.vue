<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { BlePrinter } from "../hardware/ble-printer.js";
import PrinterPicker from "./components/PrinterPicker.vue";
import PrintContinuationDialog from "./components/PrintContinuationDialog.vue";
import PrintProgressDialog from "./components/PrintProgressDialog.vue";
import PreferencesDialog from "./components/PreferencesDialog.vue";
import AppHeader from "./components/AppHeader.vue";
import StatusStrip from "./components/StatusStrip.vue";
import { usePreferences } from "./composables/usePreferences.js";
import { DITHERING_GROUPS, DITHERING_OPTIONS } from "./dithering.js";
import {
  createImageOptions,
  isImagePath,
} from "./settings.js";

const images = ref([]);
const appInfo = ref({ name: "App", slug: "app", tagline: "", version: "" });
const selectedId = ref(null);
const activeWorkspaceTab = ref("preview");
const originalCanvas = ref(null);
const processing = ref(false);
const printing = ref(false);
const printProgress = ref(0);
const transferStats = ref(null);
const postFeedForPrint = ref(true);
const queueOptions = ref({ pause: true, feedBetween: false });
const autoContinueSeconds = ref(3);
const renderTasks = new Map();
const queueIndex = ref(0);
const showContinue = ref(false);
const showPicker = ref(false);
const showPreferences = ref(false);
const preferencesDialog = ref(null);
const activePreferenceTab = ref("general");
const shellIntegration = ref({ supported: false, enabled: false, label: "" });
const updateStatus = ref({
  currentVersion: "",
  latestVersion: null,
  latestPrerelease: false,
  releaseUrl: "",
  available: false,
  checkedAt: null,
  error: null,
  checking: false,
});
const showOtherDevices = ref(false);
const hoveredMarginTarget = ref(null);
const hoveredPauseTarget = ref(null);
let resumeAfterConnect = null;
const connecting = ref(false);
const devices = ref([]);
const {
  preferences,
  rememberedDevices,
  isRemembered,
  setRemembered,
  marginDisplay,
  setMargin,
} = usePreferences();
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
  (progress) => {
    printProgress.value = progress;
  },
  (stats) => {
    transferStats.value = stats;
  },
);
let disconnectTimer;
const selected = computed(() =>
  images.value.find((image) => image.id === selectedId.value),
);
const canScaleToWidth = computed(() => {
  const image = selected.value;
  return Boolean(
    image &&
    ((image.contentWidth > 0 && image.contentWidth < 384) ||
      (image.unscaledWidth > 0 && image.unscaledWidth < 384)),
  );
});
const canAlignImage = computed(() => {
  const image = selected.value;
  return Boolean(image && image.contentWidth > 0 && image.contentWidth < 384);
});
const queueItems = computed(() =>
  images.value.flatMap((image, imageIndex) =>
    Array.from(
      { length: Math.max(1, Math.min(99, Number(image.copies) || 1)) },
      (_, copyIndex) => ({
        image,
        imageIndex,
        copyIndex,
      }),
    ),
  ),
);
const printQueueItems = computed(() =>
  preferences.value.queue.order === 'last-to-first'
    ? [...queueItems.value].reverse()
    : queueItems.value,
);
const supportedDevices = computed(() =>
  devices.value.filter((device) => device.supported),
);
const otherDevices = computed(() =>
  devices.value.filter((device) => !device.supported),
);
const ditheringOptions = DITHERING_OPTIONS;
const ditheringGroups = DITHERING_GROUPS;
const ditheringIndex = computed(() =>
  ditheringOptions.findIndex((option) => option.value === selected.value?.options.dither),
);
function cycleDithering(direction) {
  if (!selected.value) return;
  const currentIndex = ditheringIndex.value < 0 ? 0 : ditheringIndex.value;
  const nextIndex = Math.max(0, Math.min(ditheringOptions.length - 1, currentIndex + direction));
  selected.value.options.dither = ditheringOptions[nextIndex].value;
}
async function openDitherComparison() {
  if (!selected.value) return;
  await window.desktop.openDitherComparison(
    { path: selected.value.path, name: selected.value.name },
    JSON.parse(JSON.stringify(selected.value.options)),
  );
}
function marginLabel(key) {
  return `${marginDisplay(key)} ${preferences.value.printer.marginUnits}`;
}
function marginHighlightHeight(key) {
  return `${Number(preferences.value.printer[key]) || 0}px`;
}
function isMarginPreviewTab() {
  return activeWorkspaceTab.value === "preview" || activeWorkspaceTab.value === "preview-all";
}
async function setShellIntegration(enabled) {
  try {
    shellIntegration.value = await window.desktop.setShellIntegration(enabled);
  } catch (error) {
    window.alert(`Could not update file-manager integration: ${error.message}`);
  }
}
async function checkForUpdates(options) {
  updateStatus.value = { ...updateStatus.value, checking: true, error: null };
  try {
    const status = await window.desktop.checkForUpdates({
      ...(options || {}),
      includePrerelease: preferences.value.application.includePrerelease,
    });
    updateStatus.value = { ...status, checking: false };
    preferences.value.application.lastUpdateCheck = status.checkedAt;
    if (options?.open && status.available) await openLatestRelease(status.releaseUrl);
  } catch (error) {
    updateStatus.value = {
      ...updateStatus.value,
      checking: false,
      checkedAt: new Date().toISOString(),
      error: error.message || "Could not check for updates.",
    };
  }
}
function openLatestRelease(url) {
  return window.desktop.openLatestRelease(url);
}
function isHoveredMargin(target, enabled) {
  return isMarginPreviewTab() && hoveredMarginTarget.value === target && enabled;
}
const pauseMarkerLabel = computed(() =>
  autoContinueSeconds.value ? `${autoContinueSeconds.value} SEC PAUSE` : "PAUSE",
);
const previewMarginStyle = computed(() => ({
  paddingTop: preferences.value.printer.marginTopEnabled
    ? `${preferences.value.printer.marginTop}px`
    : "0px",
  paddingBottom: preferences.value.printer.marginBottomEnabled
    ? `${preferences.value.printer.marginBottom}px`
    : "0px",
}));
const queuePreviewGap = computed(() =>
  queueOptions.value.feedBetween
    ? Number(preferences.value.printer.marginBetween) || 0
    : 0,
);
const queuePreviewSize = computed(() => {
  const items = queueItems.value;
  const top = preferences.value.printer.marginTopEnabled
    ? Number(preferences.value.printer.marginTop) || 0
    : 0;
  const bottom = preferences.value.printer.marginBottomEnabled
    ? Number(preferences.value.printer.marginBottom) || 0
    : 0;
  const between = queueOptions.value.feedBetween
    ? (Number(preferences.value.printer.marginBetween) || 0) * Math.max(0, items.length - 1)
    : 0;
  return {
    width: 384,
    height:
      items.reduce(
        (total, { image }) => total + (Number(image.height) || 0) + top + bottom,
        0,
      ) + between,
  };
});
function queuePreviewPageStyle() {
  return {
    paddingTop: preferences.value.printer.marginTopEnabled
      ? `${preferences.value.printer.marginTop}px`
      : "0px",
    paddingBottom: preferences.value.printer.marginBottomEnabled
      ? `${preferences.value.printer.marginBottom}px`
      : "0px",
  };
}
async function ensureOriginalPreview(image) {
  if (!image || image.original || image.originalLoading) return;
  image.originalLoading = true;
  image.originalError = null;
  try {
    // Every import path ultimately creates a local image path and uses the
    // same renderer. Re-rendering here also upgrades images added before the
    // Original payload was available.
    await renderImage(image);
    if (!image.original)
      throw new Error("The original image could not be loaded.");
  } catch (error) {
    image.originalError = error.message;
  } finally {
    image.originalLoading = false;
  }
}
async function drawOriginalCanvas() {
  const image = selected.value;
  const canvas = originalCanvas.value;
  if (!image || !canvas || !image.original) return;
  const source = new Image();
  source.src = image.original;
  await source.decode();
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  canvas.getContext("2d").drawImage(source, 0, 0);
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
  if (next.connected) clearDeviceConnections();
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

function clearDeviceConnections() {
  devices.value = devices.value.map((device) => ({ ...device, connecting: false }));
}

function addImages(paths = []) {
  window.desktop.addRecentDocuments?.(paths);
  const added = [];
  for (const path of paths)
    if (!images.value.some((image) => image.path === path)) {
      const image = {
        id: crypto.randomUUID(),
        path,
        name: path.split("/").pop(),
        options: createImageOptions(),
        preview: null,
        original: null,
        originalLoading: false,
        originalError: null,
        pixels: null,
        width: 0,
        contentWidth: 0,
        unscaledWidth: 0,
        height: 0,
        processing: true,
        error: null,
        copies: 1,
      };
      images.value.push(image);
      // Use the reactive proxy from the array so background render updates
      // invalidate the queue list immediately.
      added.push(images.value[images.value.length - 1]);
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
  try {
    const paths = await window.desktop.chooseImages();
    if (!Array.isArray(paths)) throw new Error("The image picker returned an invalid file list.");
    addImages(paths);
  } catch (error) {
    printerStatus.value = {
      ...printerStatus.value,
      message: `Could not choose images: ${error.message}`,
    };
  }
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
        if (image.options.scaleToWidth && result.unscaledWidth >= 384)
          image.options.scaleToWidth = false;
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
  if (printerStatus.value.connected) {
    clearDeviceConnections();
    showPicker.value = true;
    return;
  }
  devices.value = [];
  showOtherDevices.value = false;
  showPicker.value = true;
  try {
    await printer.connect();
    showPicker.value = false;
    const resume = resumeAfterConnect;
    resumeAfterConnect = null;
    await resume?.();
  } catch (error) {
    resumeAfterConnect = null;
    clearDeviceConnections();
    printerStatus.value = {
      ...printerStatus.value,
      connected: false,
      message: error.name === "NotFoundError" ? "Disconnected" : error.message,
    };
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
  if (printerStatus.value.connected) {
    showPicker.value = false;
    return;
  }
  await window.desktop.cancelBluetoothSelection();
  clearDeviceConnections();
  resumeAfterConnect = null;
  showPicker.value = false;
  printerStatus.value = {
    ...printerStatus.value,
    connected: false,
    message: "Disconnected",
  };
}
async function connectThen(action) {
  resumeAfterConnect = action;
  if (!rememberedDevices.value.length) {
    await openPicker();
    return;
  }
  connecting.value = true;
  try {
    await printer.connectRemembered(rememberedDevices.value, preferences.value.advanced.connectTimeout);
    const resume = resumeAfterConnect;
    resumeAfterConnect = null;
    if (printerStatus.value.connected)
      await new Promise((resolve) => setTimeout(resolve, 450));
    connecting.value = false;
    await resume?.();
  } catch (error) {
    // A cancellation is handled by closePicker. Do not create a second BLE request.
    if (resumeAfterConnect && !showPicker.value)
      printerStatus.value = {
        ...printerStatus.value,
        message: error.name === "NotFoundError" ? "Printer discovery was cancelled" : error.message,
      };
  } finally {
    connecting.value = false;
  }
}
function isConnectingPrinter() {
  return printerStatus.value.message === "Connecting to printer…";
}
function isBluetoothUnavailable() {
  return printerStatus.value.message === "Bluetooth is turned off or unavailable on this Mac.";
}
function openBluetoothSettings() {
  return window.desktop.openBluetoothSettings();
}
async function openNormalPicker() {
  connecting.value = false;
  showPicker.value = true;
  await window.desktop.cancelBluetoothSelection();
  await openPicker();
}
function printFromMenu(action) {
  if (printerStatus.value.connected) return action();
  resumeAfterConnect = action;
  return openPicker();
}
async function printSelected() {
  if (!printerStatus.value.connected) return connectThen(() => printSelected());
  if (!selected.value?.pixels) await renderSelected();
  if (!selected.value?.pixels) return false;
  printing.value = true;
  printProgress.value = 0;
  transferStats.value = null;
  try {
    const bottomFeed = preferences.value.printer.marginBottomEnabled
      ? Number(preferences.value.printer.marginBottom) || 0
      : 0;
    const betweenFeed =
      queueOptions.value.feedBetween && postFeedForPrint.value
        ? Number(preferences.value.printer.marginBetween) || 0
        : 0;
    await printer.print(
      decodePixels(selected.value.pixels),
      selected.value.width,
      selected.value.height,
      {
        ...preferences.value.printer,
        chunkDelay: preferences.value.advanced.chunkDelay,
        compression: preferences.value.advanced.compression,
        postFeed: bottomFeed + betweenFeed,
        marginTopEnabled: preferences.value.printer.marginTopEnabled,
        marginTop: preferences.value.printer.marginTop,
        postFeedEnabled: bottomFeed + betweenFeed > 0,
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
  if (!printerStatus.value.connected) return connectThen(() => printAll());
  queueIndex.value = 0;
  await printQueueItem();
}
async function printQueueItem() {
  const item = printQueueItems.value[queueIndex.value];
  if (!item) return;
  selectedId.value = item.image.id;
  await nextTick();
  postFeedForPrint.value =
    queueOptions.value.feedBetween &&
    queueIndex.value < printQueueItems.value.length - 1;
  const didPrint = await printSelected();
  if (!didPrint) return;
  if (queueIndex.value < printQueueItems.value.length - 1) {
    if (queueOptions.value.pause) showContinue.value = true;
    else {
      queueIndex.value++;
      await printQueueItem();
    }
  }
}
async function continueQueue() {
  showContinue.value = false;
  queueIndex.value++;
  await printQueueItem();
}
function cancelQueue() {
  showContinue.value = false;
  queueIndex.value = 0;
}
function removeImage(id) {
  const index = images.value.findIndex((image) => image.id === id);
  images.value.splice(index, 1);
  if (id === selectedId.value)
    selectedId.value =
      images.value[index]?.id || images.value[index - 1]?.id || null;
}
function removeCopy(image) {
  image.copies = Math.max(1, (Number(image.copies) || 1) - 1);
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
  if (!printerStatus.value.connected) return connectThen(feedPaper);
  try {
    await printer.feedPaper(preferences.value.printer.manualFeed);
    motionStatus("Paper fed");
  } catch (error) {
    printerStatus.value = { ...printerStatus.value, message: error.message };
  }
}
async function retractPaper() {
  if (!printerStatus.value.connected) return connectThen(retractPaper);
  try {
    await printer.retractPaper(preferences.value.printer.manualFeed);
    motionStatus("Paper retracted");
  } catch (error) {
    printerStatus.value = { ...printerStatus.value, message: error.message };
  }
}
function resetImageControls() {
  if (selected.value) selected.value.options = createImageOptions();
}
function resetControl(key, value) {
  if (selected.value) selected.value.options[key] = value;
}
function clearQueue() {
  cancelQueue();
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
async function openMarginSettings() {
  activePreferenceTab.value = "general";
  showPreferences.value = true;
  await nextTick();
  preferencesDialog.value?.focusMarginUnits();
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

watch(() => selected.value?.id, renderSelected);
watch(
  () => [activeWorkspaceTab.value, selected.value?.id],
  ([tab]) => {
    if (tab === "original") {
      void ensureOriginalPreview(selected.value).then(() => nextTick(drawOriginalCanvas));
    }
  },
);
watch(() => selected.value?.original, () => nextTick(drawOriginalCanvas));
watch(
  () => queueItems.value.length,
  (count) => {
    if (count < 2 && activeWorkspaceTab.value === "preview-all")
      activeWorkspaceTab.value = "preview";
  },
);
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
    }
  },
);
onMounted(() => {
  window.desktop.onDitherComparisonApply((dither) => {
    if (selected.value) selected.value.options.dither = dither;
  });
  window.desktop.getAppInfo().then((info) => {
    appInfo.value = info;
    document.title = info.name;
    updateStatus.value.currentVersion = info.version;
  });
  updateStatus.value.checkedAt = preferences.value.application.lastUpdateCheck;
  if (preferences.value.application.checkForUpdates)
    void checkForUpdates({ notify: true });
  window.desktop.getShellIntegration().then((state) => {
    shellIntegration.value = state;
  });
  window.desktop.onShellIntegrationChanged((state) => {
    shellIntegration.value = state;
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
      "check-for-updates": () => checkForUpdates({ open: true }),
      "clear-queue": clearQueue,
      connect: openPicker,
      disconnect: disconnectPrinter,
      "refresh-status": refreshStatus,
      "feed-paper": feedPaper,
      "retract-paper": retractPaper,
      "print-image": () => printFromMenu(printSelected),
      "print-all": () => printFromMenu(printAll),
      preferences: () => {
        showPreferences.value = true;
        activePreferenceTab.value = "general";
      },
    };
    actions[action]?.();
  });
  window.desktop.onBluetoothDevices((list) => {
    devices.value = list;
  });
  window.desktop.onPrinterDiscoveryTimeout(() => {
    connecting.value = false;
    showPicker.value = true;
    printerStatus.value = {
      ...printerStatus.value,
      message: "No remembered printer found. Choose a printer to continue…",
    };
  });
});
onBeforeUnmount(() => {
});
</script>

<template>
  <main tabindex="-1" @paste="handlePaste" @dragover="handleDragOver"
    @drop.prevent="handleDrop">
    <AppHeader :app-info="appInfo" :active-tab="activeWorkspaceTab" :connected="printerStatus.connected"
      :device-name="printerStatus.deviceName" :queue-count="queueItems.length"
      :preferences="preferences"
			:margin-display="marginDisplay" :set-margin="setMargin"
      @select-tab="(tab) => { activeWorkspaceTab = tab; if (tab === 'original') ensureOriginalPreview(selected).then(() => nextTick(drawOriginalCanvas)); }"
      @open-picker="openPicker" @open-preferences="showPreferences = true; activePreferenceTab = 'general'"
      @feed="feedPaper" @retract="retractPaper" />
    <section class="layout">
      <aside class="queue">
        <div class="queue-header">
          <div class="queue-header-top">
            <h2>Queue</h2>
            <button v-if="images.length" class="clear-link" @click="clearQueue">Clear</button>
          </div>
          <div class="queue-header-actions">
            <button class="add" @click="chooseImages">Add images</button>
            <button class="secondary" @click="pasteFromClipboard">Add from clipboard</button>
          </div>
        </div>
        <div v-if="!images.length" class="empty queue-empty">
          <span>Images you add will appear here.</span>
        </div>
        <div class="image-list">
          <article v-for="(item, index) in queueItems" :key="`${item.image.id}-${item.copyIndex}`"
            :data-image-id="item.image.id" :class="['image-item', { selected: item.image.id === selectedId }]"
            @click="selectedId = item.image.id">
            <img v-if="item.image.preview" :src="item.image.preview" alt="" />
            <div>
              <strong>{{ item.image.name }}</strong><small>{{
                item.image.width
                  ? `${item.image.width} × ${item.image.height}`
                  : item.image.error ||
                  (item.image.processing ? "Processing…" : "Not rendered")
              }}
                · Copy {{ item.copyIndex + 1 }} of {{ item.image.copies || 1 }} · #{{ index + 1 }}</small>
            </div>
            <button class="remove" :title="item.copyIndex > 0 ? 'Remove copy' : 'Remove image'"
              @click.stop="item.copyIndex > 0 ? removeCopy(item.image) : removeImage(item.image.id)">
              {{ item.copyIndex > 0 ? '−' : '×' }}
            </button>
          </article>
        </div>
        <div v-if="images.length" class="queue-actions bottom-actions">
          <label @mouseenter="hoveredMarginTarget = 'between'" @mouseleave="hoveredMarginTarget = null"><input
              v-model="queueOptions.feedBetween" type="checkbox" /> Margin
            between pages <div class="margin-input"><input :value="marginDisplay('marginBetween')"
                @input="setMargin('marginBetween', $event)" type="number" min="0" max="500" /><button class="unit-link"
                @click.prevent="openMarginSettings">{{ preferences.printer.marginUnits }}</button></div></label>
          <label style="display: flex; flex-direction: column; align-items: stretch; gap: 6px;"
            @mouseenter="hoveredPauseTarget = 'pause'" @mouseleave="hoveredPauseTarget = null">
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
              <span style="display: flex; align-items: center; gap: 4px;">
                <input v-model="queueOptions.pause" type="checkbox" />
                Pause between items
              </span>
              <span title="Prints and then pauses so you can manually tear the paper before the next label."
                style="cursor: help; color: var(--sys-text-secondary); border: 1px solid currentColor; border-radius: 50%; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; flex-shrink: 0;">?</span>
            </div>
            <select :disabled="!queueOptions.pause" v-model.number="autoContinueSeconds"
              style="margin-left: 20px; width: calc(100% - 20px);">
              <option :value="0">Click to continue</option>
              <option :value="1">1 sec</option>
              <option :value="2">2 sec</option>
              <option :value="3">3 sec</option>
              <option :value="4">4 sec</option>
              <option :value="5">5 sec</option>
              <option :value="10">10 sec</option>
              <option :value="15">15 sec</option>
              <option :value="30">30 sec</option>
            </select>
          </label>
          <button :disabled="printing" @click="printAll">Print all</button>
        </div>
      </aside>
      <section class="workspace">
        <div v-if="activeWorkspaceTab === 'original' && selected" class="preview-card edit-card">
          <div class="preview-title">
            <span>Original image</span><span>{{ selected.name }}</span>
          </div>
          <div class="editing-canvas">
            <canvas v-if="selected.original" ref="originalCanvas" aria-label="Original image canvas" />
            <span v-else-if="selected.originalLoading" class="queue-preview-loading">Loading original…</span>
            <div v-else class="original-preview-error">
              <span>{{ selected.originalError || 'Original preview is not ready yet.' }}</span>
              <button class="secondary" @click="ensureOriginalPreview(selected)">Try again</button>
            </div>
          </div>
        </div>
        <div v-else-if="activeWorkspaceTab === 'preview' && selected" class="preview-card">
          <div class="preview-title">
            <span>Print preview · {{ selected.width || 384 }} ×
              {{ selected.height || "…" }}</span><span v-if="processing">Processing…</span>
          </div>
          <div class="paper" :style="previewMarginStyle">
            <span v-if="isHoveredMargin('top', preferences.printer.marginTopEnabled)"
              class="margin-overlay margin-overlay-top" :style="{ height: marginHighlightHeight('marginTop') }" />
            <span v-if="
              isHoveredMargin('bottom', preferences.printer.marginBottomEnabled)
            " class="margin-overlay margin-overlay-bottom"
              :style="{ height: marginHighlightHeight('marginBottom') }" />
            <img v-if="selected.preview" :src="selected.preview" alt="Processed thermal print preview" />
          </div>
        </div>
        <div v-else-if="activeWorkspaceTab === 'preview-all'" class="preview-all-card">
          <div class="preview-title">
            <span>Queue preview · {{ queueItems.length }} items</span>
            <span>Total · {{ queuePreviewSize.width }} × {{ queuePreviewSize.height || '…' }} px</span>
          </div>
          <div class="queue-preview-scroll">
            <div class="queue-preview-strip">
              <template v-for="(item, index) in printQueueItems" :key="`${item.image.id}-${item.copyIndex}`">
                <div class="queue-preview-page" :style="queuePreviewPageStyle()">
                  <span v-if="isHoveredMargin('top', preferences.printer.marginTopEnabled)"
                    class="margin-overlay margin-overlay-top" :style="{ height: marginHighlightHeight('marginTop') }" />
                  <span v-if="
                    isHoveredMargin('bottom', preferences.printer.marginBottomEnabled)
                  " class="margin-overlay margin-overlay-bottom"
                    :style="{ height: marginHighlightHeight('marginBottom') }" />
                  <img v-if="item.image.preview" :src="item.image.preview"
                    :alt="`Processed preview for ${item.image.name}`" />
                  <span v-else class="queue-preview-loading">Processing…</span>
                </div>
                <div v-if="index < printQueueItems.length - 1" class="queue-preview-break" :class="{
                  'has-margin': queuePreviewGap > 0,
                  'pause-hovered': hoveredPauseTarget === 'pause',
                }" :style="{ height: `${queuePreviewGap}px` }">
                  <span v-if="hoveredMarginTarget === 'between' && queueOptions.feedBetween"
                    class="margin-overlay margin-overlay-between" />
                  <span v-if="queueOptions.pause" class="pause-marker">{{ pauseMarkerLabel }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div v-else class="empty canvas-empty">
          <h2>Start with an image</h2>
          <p>Drop an image anywhere in this window, or choose a file to prepare it for printing.</p>
          <div class="empty-actions">
            <button @click="chooseImages">Choose Image…</button>
            <button class="secondary" @click="pasteFromClipboard">Paste from Clipboard</button>
          </div>
          <span class="empty-hint">PNG, JPEG, GIF, TIFF, BMP, or WebP</span>
        </div>
      </section>
      <aside class="controls" v-if="selected">
        <div class="controls-heading">
          <h2>Image controls</h2>
          <button class="clear-link" @click="resetImageControls">Reset</button>
        </div>
        <div class="controls-body">
          <section class="control-category">
            <h3>Image transform</h3>
            <label>Rotation<select v-model.number="selected.options.rotation">
              <option :value="0">0°</option>
              <option :value="90">90°</option>
              <option :value="180">180°</option>
              <option :value="270">270°</option>
            </select></label>
            <label title="Alignment is available only when the processed image is narrower than the 384 px print width.">Alignment<select
              v-model="selected.options.alignment" :disabled="!canAlignImage">
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select></label>
            <label><span><input v-model="selected.options.trimBlank" type="checkbox" /> Trim blank space</span></label>
            <label title="Scale up is available only when the processed image is narrower than the 384 px print width."><span><input
                  v-model="selected.options.scaleToWidth" :disabled="!canScaleToWidth" type="checkbox" /> Scale up to width</span></label>
          </section>
          <section class="control-category">
            <h3>Image adjustments</h3>
            <label>Contrast <output>{{ selected.options.contrast.toFixed(2) }}</output><input
              v-model.number="selected.options.contrast" @dblclick="resetControl('contrast', 1)" type="range" min="0.5"
              max="2" step="0.05" /></label><label>Brightness <output>{{ selected.options.brightness }}</output><input
              v-model.number="selected.options.brightness" @dblclick="resetControl('brightness', 0)" type="range"
              min="-80" max="80" step="1" /></label><label>Sharpen <output>{{ selected.options.sharpen }}</output><input
              v-model.number="selected.options.sharpen" @dblclick="resetControl('sharpen', 0)" type="range" min="0"
              max="10" step="1" /></label>
            <div class="image-option-group">
              <label><span><input v-model="selected.options.normalize" type="checkbox" /> Normalize levels</span></label>
              <label><span><input v-model="selected.options.invert" type="checkbox" /> Invert (negative)</span></label>
            </div>
            <label class="dither-field">Dither
              <div class="dither-control">
                <select v-model="selected.options.dither">
                  <optgroup v-for="group in ditheringGroups" :key="group.label" :label="group.label">
                    <option v-for="option in group.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </optgroup>
                </select>
                <button class="secondary dither-step" type="button" aria-label="Previous dithering mode"
                  :disabled="ditheringIndex <= 0" @click="cycleDithering(-1)">←</button>
                <button class="secondary dither-step" type="button" aria-label="Next dithering mode"
                  :disabled="ditheringIndex < 0 || ditheringIndex >= ditheringOptions.length - 1"
                  @click="cycleDithering(1)">→</button>
              </div>
            </label>
            <button class="secondary dither-compare" type="button" :disabled="processing"
              @click="openDitherComparison">Compare dithering</button>
          </section>
          <div class="main-margin-controls">
            <div class="controls-heading"><strong>Print margins</strong></div>
            <label @mouseenter="hoveredMarginTarget = 'top'" @mouseleave="hoveredMarginTarget = null"><span><input
                  v-model="preferences.printer.marginTopEnabled" type="checkbox" /> Top</span>
              <div class="margin-input"><input :value="marginDisplay('marginTop')"
                  @input="setMargin('marginTop', $event)" type="number" min="0" max="500" /><button class="unit-link"
                  @click.prevent="openMarginSettings">{{
                    preferences.printer.marginUnits }}</button></div>
            </label>
            <label @mouseenter="hoveredMarginTarget = 'bottom'" @mouseleave="hoveredMarginTarget = null"><span><input
                  v-model="preferences.printer.marginBottomEnabled" type="checkbox" /> Bottom</span>
              <div class="margin-input"><input :value="marginDisplay('marginBottom')"
                  @input="setMargin('marginBottom', $event)" type="number" min="0" max="500" /><button class="unit-link"
                  @click.prevent="openMarginSettings">{{ preferences.printer.marginUnits }}</button></div>
            </label>
          </div>
          <div class="copies-control">
            <div class="controls-heading"><strong>Copies</strong></div>
            <div class="copies-stepper">
              <button class="secondary" @click="selected.copies = Math.max(1, (selected.copies || 1) - 1)">−</button>
              <input v-model.number="selected.copies"
                @change="selected.copies = Math.max(1, Math.min(99, Number(selected.copies) || 1))" type="number"
                min="1" max="99" />
              <button class="secondary" @click="selected.copies = Math.min(99, (selected.copies || 1) + 1)">+</button>
            </div>
          </div>
        </div>
        <div class="queue-actions bottom-actions">
          <button class="print" :disabled="processing || printing" @click="printSelected">
            Print image
          </button>
        </div>
      </aside>
    </section>
    <StatusStrip :status="printerStatus" :transfer-stats="transferStats"
      :show-transfer-stats="preferences.advanced.showTransferStats" :update-status="updateStatus"
      @refresh="refreshStatus" @open-latest-release="openLatestRelease" />
    <PrintProgressDialog
      v-if="printing"
      :image-name="selected?.name || 'Image'"
      :preview="selected?.preview"
      :progress="printProgress"
      :orientation="preferences.printer.orientation"
      :transfer-stats="transferStats"
      :show-transfer-stats="preferences.advanced.showTransferStats"
    />
    <div v-if="connecting" class="modal-backdrop">
      <section class="modal connecting-modal">
        <button class="icon-button connecting-close" aria-label="Cancel printer search" @click="closePicker">×</button>
        <div v-if="printerStatus.connected" class="connecting-icon connected-icon">✓</div>
        <div v-else-if="isBluetoothUnavailable()" class="connecting-icon">⌁</div>
        <div v-else class="connecting-icon"><i class="spinner" /></div>
        <div class="connecting-copy">
          <h2 v-if="printerStatus.connected">Printer connected</h2>
          <h2 v-else-if="isBluetoothUnavailable()">Bluetooth is turned off</h2>
          <h2 v-else-if="isConnectingPrinter()">Connecting to printer</h2>
          <h2 v-else>Looking for your printer</h2>
          <p v-if="printerStatus.connected">Getting your action ready…</p>
          <p v-else-if="isBluetoothUnavailable()">Turn it on in System Settings, then try connecting again.</p>
          <p v-else-if="isConnectingPrinter()">Establishing a Bluetooth connection.</p>
          <p v-else>Make sure it is on, nearby, and not connected to another device.</p>
        </div>
        <div v-if="isBluetoothUnavailable()" class="connecting-actions">
          <button class="secondary" @click="openBluetoothSettings">Open Bluetooth Settings</button>
        </div>
        <div v-else-if="!printerStatus.connected && !isConnectingPrinter()" class="connecting-actions">
          <button class="secondary" @click="openNormalPicker">Choose a printer…</button>
        </div>
      </section>
    </div>
    <PrinterPicker
      v-if="showPicker"
      :connected="printerStatus.connected"
      :device-name="printerStatus.deviceName"
      :supported-devices="supportedDevices"
      :other-devices="otherDevices"
      :show-other-devices="showOtherDevices"
      :bluetooth-unavailable="isBluetoothUnavailable()"
      :is-remembered="isRemembered"
      @close="closePicker"
      @disconnect="disconnectPrinter(); showPicker = false"
      @select-device="selectDevice"
      @toggle-other-devices="showOtherDevices = !showOtherDevices"
      @remember-device="setRemembered"
      @open-bluetooth-settings="openBluetoothSettings"
    />
    <PreferencesDialog
      ref="preferencesDialog"
      v-if="showPreferences"
      :preferences="preferences"
      :app-info="appInfo"
      :shell-integration="shellIntegration"
      :update-status="updateStatus"
      :active-tab="activePreferenceTab"
      :printer-status="printerStatus"
      :remembered-devices="rememberedDevices"
      :margin-display="marginDisplay"
      @close="showPreferences = false"
      @update:active-tab="activePreferenceTab = $event"
      @set-margin="setMargin"
      @feed="feedPaper"
      @retract="retractPaper"
      @forget-device="setRemembered($event, false)"
      @set-shell-integration="setShellIntegration"
      @check-for-updates="checkForUpdates"
      @open-latest-release="openLatestRelease"
    />
    <PrintContinuationDialog
      v-if="showContinue"
      :queue-index="queueIndex"
      :queue-length="printQueueItems.length"
      :next-preview="printQueueItems[queueIndex + 1]?.image.preview"
      :auto-continue-seconds="autoContinueSeconds"
      :pause-on-mouse-move="preferences.queue.cancelCountdownOnMouseMove"
      @cancel="cancelQueue"
      @feed="feedPaper"
      @retract="retractPaper"
      @continue="continueQueue"
    />

  </main>
</template>

<style>
/* App specific structural adjustments */
.device-row>span:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.device-row>span:nth-child(2) {
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
  width: 820px;
  height: calc(100vh - 48px);
  min-height: 420px;
  max-width: 95vw;
  max-height: 720px;
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
  width: 160px;
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

.settings-section+.settings-section {
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

.setting-field>span {
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

.setting-field input:not([type="checkbox"]),
.setting-field select,
.inline-control,
.margin-field-rows,
.orientation-options {
  flex-shrink: 1;
  width: 200px;
  max-width: 100%;
}

.setting-field input:not([type="checkbox"]),
.setting-field select {
  padding: 6px 8px;
  border: 1px solid var(--sys-control-border);
  border-radius: 6px;
  background: var(--sys-control-bg);
}

.orientation-options {
	display: flex;
	gap: 8px;
}

.orientation-option {
	display: flex;
	flex: 1;
	align-items: center;
	justify-content: center;
	min-width: 0;
	padding: 8px;
	border: 1px solid var(--sys-control-border);
	border-radius: 6px;
	background: var(--sys-control-bg);
	color: var(--sys-text-primary);
	font-size: 11px;
	cursor: pointer;
}

.orientation-option:has(input:checked) {
	border-color: var(--sys-accent);
	background: color-mix(in srgb, var(--sys-accent) 10%, var(--sys-control-bg));
}

.orientation-option input {
	position: absolute;
	opacity: 0;
	pointer-events: none;
}

.orientation-option span {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
}

.orientation-icon {
	display: block;
	width: 32px;
	height: 32px;
}

.setting-field .margin-input input {
  width: 72px;
}

.setting-field+.setting-field,
.setting-field+.toggle-row,
.toggle-row+.setting-field,
.toggle-row+.toggle-row,
.setting-field+.notification-options,
.toggle-row+.notification-options {
  border-top: 1px solid var(--sys-border);
}

.inline-control {
  display: flex;
  gap: 8px;
}

.inline-control button {
  padding: 6px 12px;
}

.margin-field-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.margin-inner-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.margin-inner-row .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preferences-content .toggle-row {
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toggle-row>span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  flex: 1;
}

.toggle-row>.shell-integration-setting {
  flex-direction: row;
  align-items: flex-start;
  gap: 9px;
}

.shell-integration-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--sys-accent);
}

.shell-integration-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-row.nested-toggle-row {
  margin-left: 27px;
  padding-top: 8px;
  border-top: none;
}

.toggle-row input {
  flex-shrink: 0;
}

.about-splash {
  padding: 38px 24px 30px;
  border-bottom: 1px solid var(--sys-border);
  text-align: center;
}

.about-icon {
  display: block;
  width: 64px;
  height: 64px;
  margin: 0 auto 14px;
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.about-wordmark {
  color: var(--sys-text-primary);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.8px;
}

.about-splash p {
  margin: 6px 0 8px;
  color: var(--sys-text-secondary);
  font-size: 13px;
}

.about-splash small,
.about-credit-link {
  color: var(--sys-accent);
  font-size: 11px;
}

.about-credit-link {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-weight: 400;
}

button.about-credit-link:hover:not(:disabled) {
  color: var(--sys-accent-hover);
  text-decoration: underline;
  background: transparent;
  box-shadow: none;
}

.about-section {
  padding-top: 20px;
}

.update-details {
  margin-top: 4px;
  border-top: 1px solid var(--sys-border);
}

.update-details > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--sys-border);
  font-size: 12px;
}

.update-details .update-detail-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border: 0;
  border-bottom: 1px solid var(--sys-border);
  border-radius: 0;
  background: transparent;
  color: var(--sys-text-primary);
  box-shadow: none;
  font-size: 12px;
  text-align: left;
}

.update-details .update-detail-row:hover:not(:disabled) {
  background: var(--sys-sidebar-hover);
}

.update-details span {
  color: var(--sys-text-secondary);
}

.update-details strong {
  font-weight: 500;
  text-align: right;
}

.update-details .current-version-row strong {
  user-select: text;
  cursor: text;
}

.beta-label {
  margin-left: 6px;
  color: var(--sys-status-warning);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.preferences-content p.update-error {
  margin: 12px 0 0;
  color: var(--sys-status-danger);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
}

.support-section {
  padding-bottom: 20px;
}

.support-section .section-heading,
.contact-section .section-heading {
  margin-bottom: 10px;
}

.contact-section {
  padding-top: 20px;
  padding-bottom: 28px;
}

.about-actions {
  display: flex;
  gap: 8px;
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

.margin-settings {
  display: flex;
  align-items: center;
  gap: 6px;
}

.margin-settings input {
  width: 64px;
}

.inline-toggle {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.margin-labels {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  margin: -8px 0 10px 130px;
  color: var(--sys-text-secondary);
  font-size: 11px;
}

.dither-control {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.controls label.dither-field {
  display: block;
}

.dither-control select {
  min-width: 0;
  flex: 1;
}

.dither-step {
  width: 28px;
  min-width: 28px;
  padding: 5px 0;
  line-height: 1;
}

.dither-compare {
  width: 100%;
  margin: -4px 0 12px;
}

</style>
