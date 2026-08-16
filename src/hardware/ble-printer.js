import {
  buildFeedData,
  buildPrintData,
  buildRetractData,
  buildStatusRequest,
  flowControl,
} from "./printer-protocol.mjs";

const SERVICE_UUID = "0000ae30-0000-1000-8000-00805f9b34fb";
const WRITE_UUID = "0000ae01-0000-1000-8000-00805f9b34fb";
const NOTIFY_UUID = "0000ae02-0000-1000-8000-00805f9b34fb";
const COMMAND_NAMES = {
  0xa0: "retract",
  0xa1: "feed",
  0xa2: "print-row",
  0xa3: "status",
  0xa4: "quality",
  0xa6: "print-control",
  0xae: "flow-control",
  0xaf: "energy",
  0xbd: "speed",
  0xbe: "print-start",
  0xbf: "print-row-compressed",
};
const formatHex = (data) => Array.from(data, (value) => value.toString(16).padStart(2, "0")).join(" ");
const commandName = (command) => COMMAND_NAMES[command] || `0x${command.toString(16).padStart(2, "0")}`;

function describeFrames(data) {
  const frames = [];
  for (let offset = 0; offset + 8 <= data.length;) {
    if (data[offset] !== 0x51 || data[offset + 1] !== 0x78) {
      frames.push(`raw ${data.length - offset} bytes`);
      break;
    }
    const payloadLength = data[offset + 4];
    const frameLength = payloadLength + 8;
    if (offset + frameLength > data.length) {
      frames.push(`truncated frame at ${offset} (${data.length - offset} bytes)`);
      break;
    }
    const command = data[offset + 2];
    const payload = data.slice(offset + 6, offset + 6 + payloadLength);
    frames.push(`${commandName(command)} payload[${payloadLength}]=${formatHex(payload)}`);
    offset += frameLength;
  }
  return frames.join("; ");
}
const equalBytes = (first, second) =>
  first.length === second.length &&
  first.every((value, index) => value === second[index]);
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const connectionCancelledError = () => {
  const error = new Error("Printer connection was cancelled.");
  error.name = "ConnectionCancelledError";
  return error;
};

export class BlePrinter {
  constructor(onStatus, onProgress = () => { }, onTransferStats = () => { }, onLog = () => { }) {
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onTransferStats = onTransferStats;
    this.onLog = onLog;
    this.bluetoothLogging = false;
    this.device = null;
    this.writeCharacteristic = null;
    this.paused = false;
    this.manualDisconnect = false;
    this.connectionAttempt = 0;
    this.state = {
      connected: false,
      message: "Disconnected",
      deviceName: null,
      paper: "Unknown",
      lid: "Unknown",
      temperature: "Normal",
      battery: "Unknown",
      busy: false,
      buffer: "Ready",
    };
  }

  log(level, message) {
    if (!this.bluetoothLogging) return;
    this.onLog(level, "printer", message);
  }

  setLoggingOptions(options) {
    this.bluetoothLogging = options?.bluetooth === true;
  }

  async connect() {
    const connectionAttempt = ++this.connectionAttempt;
    this.manualDisconnect = false;
    this.log("info", "Starting printer discovery.");
    if (typeof navigator.bluetooth.getAvailability === "function") {
      const available = await navigator.bluetooth.getAvailability();
      this.log("info", `Bluetooth availability: ${available ? "available" : "unavailable"}.`);
      if (!available) {
        const error = new Error(
          "Bluetooth is turned off or unavailable on this Mac.",
        );
        error.name = "BluetoothUnavailableError";
        this.update({ connected: false, message: error.message });
        throw error;
      }
    }
    if (connectionAttempt !== this.connectionAttempt)
      throw connectionCancelledError();
    this.update({ connected: false, message: "Searching for nearby printers…" });
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });
    if (connectionAttempt !== this.connectionAttempt)
      throw connectionCancelledError();
    this.log("info", `Printer selected: ${this.device.name || "unnamed device"}.`);
    const device = this.device;
    device.addEventListener("gattserverdisconnected", () =>
      this.handleDisconnect(),
    );
    await this.connectDevice(connectionAttempt, device);
  }

  async connectRemembered(deviceNames, timeoutSeconds) {
    // Keep this synchronous: requestDevice must run in the original Print click.
    window.desktop.preparePrinterDiscovery([...deviceNames], timeoutSeconds);
    this.log("info", `Starting remembered-printer discovery (${deviceNames.length} names, ${timeoutSeconds}s timeout).`);
    await this.connect();
  }

  async connectDevice(connectionAttempt, device) {
    const ensureCurrent = () => {
      if (connectionAttempt !== this.connectionAttempt || this.device !== device)
        throw connectionCancelledError();
    };
    this.update({ connected: false, message: "Connecting to printer…" });
    this.log("info", "Opening GATT connection.");
    const server = await device.gatt.connect();
    ensureCurrent();
    this.log("info", "GATT connection opened; resolving printer service.");
    const service = await server.getPrimaryService(SERVICE_UUID);
    ensureCurrent();
    this.writeCharacteristic = await service.getCharacteristic(WRITE_UUID);
    ensureCurrent();
    this.log("info", "Write characteristic resolved; starting notifications.");
    const notificationCharacteristic =
      await service.getCharacteristic(NOTIFY_UUID);
    ensureCurrent();
    await notificationCharacteristic.startNotifications();
    ensureCurrent();
    notificationCharacteristic.addEventListener(
      "characteristicvaluechanged",
      (event) =>
        this.handleNotification(
          new Uint8Array(
            event.target.value.buffer,
            event.target.value.byteOffset,
            event.target.value.byteLength,
          ),
        ),
    );
    this.update({
      connected: true,
      deviceName: device.name || "printer",
      message: `Connected to ${device.name || "printer"}`,
    });
    this.log("info", "Printer connected; requesting initial status.");
    await this.send(buildStatusRequest());
  }

  handleDisconnect() {
    this.writeCharacteristic = null;
    const wasManual = this.manualDisconnect;
    this.update({
      connected: false,
      message: wasManual ? "Disconnected" : "Lost connection",
      busy: false,
    });
    this.log("warn", `Printer disconnected (${wasManual ? "requested" : "unexpected"}).`);
  }

  update(changes) {
    this.state = { ...this.state, ...changes };
    this.onStatus(this.state);
  }

  handleNotification(data) {
    this.log("debug", `RX notification (${data.length} bytes): ${formatHex(data)}`);
    if (equalBytes(data, flowControl.pause)) {
      this.paused = true;
      this.log("info", "RX flow-control pause; waiting for printer buffer to resume.");
      this.update({ message: "Printer buffer full; waiting…", buffer: "Full" });
      return;
    }
    if (equalBytes(data, flowControl.resume)) {
      this.paused = false;
      this.log("info", "RX flow-control resume; continuing transfer.");
      this.update({ message: "Ready", buffer: "Ready" });
      return;
    }
    if (data[2] === 0xa3 && data.length >= 7) {
      const value = data[6];
      const decoded = {
        paper: value & 0x01 ? "Out of paper" : "Loaded",
        lid: value & 0x02 ? "Open" : "Closed",
        temperature: value & 0x04 ? "Too hot" : "Normal",
        battery: value & 0x08 ? "Low" : "OK",
        busy: Boolean(value & 0x80),
        message: value ? "Printer needs attention" : "Ready",
      };
      this.log("info", `RX status response: flags=0x${value.toString(16).padStart(2, "0")} decoded=${JSON.stringify(decoded)}`);
      this.update(decoded);
    }
  }

  reportTransferStats(stats) {
    const elapsedMs = Math.max(1, performance.now() - stats.startedAt);
    const report = {
      transferredBytes: stats.transferredBytes,
      totalBytes: stats.totalBytes,
      transferredPackets: stats.transferredPackets,
      totalPackets: stats.totalPackets,
      averageBytesPerSecond: (stats.transferredBytes / elapsedMs) * 1000,
    };
    this.onTransferStats(report);
    this.log("debug", `Transfer stats: ${report.transferredBytes}/${report.totalBytes} bytes, ${report.transferredPackets}/${report.totalPackets} chunks, average ${Math.round(report.averageBytesPerSecond)} B/s.`);
  }

  async send(data, chunkDelay = 20, reportProgress = false, transferStats = null) {
    if (!this.writeCharacteristic)
      throw new Error("Connect the printer first.");
    const delayMs = Math.max(0, Math.min(500, Number(chunkDelay) || 0));
    const totalChunks = Math.ceil(data.length / 245);
    this.log("debug", `TX command frames: ${describeFrames(data)}`);
    this.log("debug", `TX ${data.length} bytes in ${totalChunks} BLE chunk${totalChunks === 1 ? "" : "s"} (delay ${delayMs}ms).`);
    for (let offset = 0; offset < data.length; offset += 245) {
      while (this.paused) await delay(100);
      const chunk = data.slice(offset, offset + 245);
      this.log("debug", `TX chunk ${Math.floor(offset / 245) + 1}/${totalChunks} (${chunk.length} bytes): ${formatHex(chunk)}`);
      try {
        await this.writeCharacteristic.writeValueWithoutResponse(chunk);
      } catch (error) {
        this.log("error", `BLE write failed at byte ${offset}/${data.length}: ${error.stack || error.message}`);
        throw error;
      }
      if (transferStats) {
        transferStats.transferredBytes += chunk.length;
        transferStats.transferredPackets += 1;
        this.reportTransferStats(transferStats);
      }
      if (delayMs) await delay(delayMs);
      if (reportProgress)
        this.onProgress(
          Math.min(100, Math.round(((offset + chunk.length) / data.length) * 100)),
        );
    }
    this.log("debug", `BLE send complete (${data.length} bytes).`);
  }

  async requestStatus() {
    this.log("info", "Requesting printer status.");
    this.update({ message: "Requesting printer status…" });
    await this.send(buildStatusRequest());
  }

  async print(pixels, width, height, settings = {}) {
    this.log("info", `Preparing print (${width}x${height}px, orientation ${settings.orientation || "default"}, compression ${settings.compression || "auto"}).`);
    const rows = [];
    const reverseOrientation = settings.orientation === "bottom-to-top";
    const firstRow = reverseOrientation ? height - 1 : 0;
    const rowStep = reverseOrientation ? -1 : 1;
    for (let y = firstRow; y >= 0 && y < height; y += rowStep) {
      const row = [];
      for (let column = 0; column < width; column++) {
        const x = reverseOrientation ? width - 1 - column : column;
        row.push(pixels[y * width + x] < 128 ? 1 : 0);
      }
      rows.push(row);
    }
    const energy = Number.isFinite(Number(settings.energy))
      ? Math.max(1, Math.min(65535, Number(settings.energy)))
      : 0x9998;
    const postFeed = Number.isFinite(Number(settings.postFeed))
      ? Math.max(0, Math.min(500, Number(settings.postFeed)))
      : 55;
    const quality = Number(settings.quality);
    const speed = Number(settings.speed);
    const topFeed = settings.marginTopEnabled
      ? Math.max(0, Math.min(500, Number(settings.marginTop) || 0))
      : 0;
    const topFeedData = topFeed ? buildFeedData(topFeed) : null;
    const printData = buildPrintData(rows, energy, {
      quality,
      speed,
      compression: settings.compression,
    });
    const postFeedData = settings.postFeedEnabled !== false
      ? buildFeedData(postFeed)
      : null;
    const transferData = [topFeedData, printData, postFeedData].filter(Boolean);
    const transferStats = {
      transferredBytes: 0,
      totalBytes: transferData.reduce((total, data) => total + data.length, 0),
      transferredPackets: 0,
      totalPackets: transferData.reduce((total, data) => total + Math.ceil(data.length / 245), 0),
      startedAt: performance.now(),
    };
    this.log("info", `Print payload prepared (${transferStats.totalBytes} bytes, ${transferStats.totalPackets} chunks, top feed ${topFeedData?.length || 0} bytes, image ${printData.length} bytes, post feed ${postFeedData?.length || 0} bytes).`);
    this.onProgress(0);
    this.reportTransferStats(transferStats);
    if (topFeedData)
      await this.send(topFeedData, settings.chunkDelay, false, transferStats);
    await this.send(printData, settings.chunkDelay, true, transferStats);
    await delay(2000);
    if (postFeedData)
      await this.send(postFeedData, settings.chunkDelay, false, transferStats);
    this.onProgress(100);
    this.reportTransferStats(transferStats);
    this.log("info", "Print transfer complete; printer settling for 2 seconds before post-feed.");
  }

  disconnect() {
    this.log("info", "Disconnect requested.");
    this.manualDisconnect = true;
    this.connectionAttempt += 1;
    this.paused = false;
    this.writeCharacteristic = null;
    const device = this.device;
    this.device = null;
    // Chromium does not reliably dispatch gattserverdisconnected when the
    // connection has already dropped. Update the UI immediately either way.
    this.update({ connected: false, message: "Disconnected", busy: false });
    // Do not use gatt.connected as a guard: Electron can report it stale while
    // the underlying GATT connection is still open.
    try {
      device?.gatt?.disconnect();
    } catch (error) {
      // The UI is already disconnected; this only means GATT was gone first.
      console.warn("BLE disconnect did not complete cleanly:", error);
      this.log("warn", `BLE disconnect did not complete cleanly: ${error.stack || error.message}`);
    }
  }

  async feedPaper(pixels) {
    this.log("info", `Feeding paper by ${pixels}px.`);
    await this.send(
      buildFeedData(Math.max(0, Math.min(500, Number(pixels) || 0))),
    );
  }

  async retractPaper(pixels) {
    this.log("info", `Retracting paper by ${pixels}px.`);
    await this.send(
      buildRetractData(Math.max(0, Math.min(500, Number(pixels) || 0))),
    );
  }
}
