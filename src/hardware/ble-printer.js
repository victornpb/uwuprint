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
const equalBytes = (first, second) =>
  first.length === second.length &&
  first.every((value, index) => value === second[index]);
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BlePrinter {
  constructor(onStatus, onProgress = () => { }) {
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.device = null;
    this.writeCharacteristic = null;
    this.paused = false;
    this.manualDisconnect = false;
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

  async connect() {
    this.manualDisconnect = false;
    if (typeof navigator.bluetooth.getAvailability === "function") {
      const available = await navigator.bluetooth.getAvailability();
      if (!available) {
        const error = new Error(
          "Bluetooth is turned off or unavailable on this Mac.",
        );
        error.name = "BluetoothUnavailableError";
        this.update({ connected: false, message: error.message });
        throw error;
      }
    }
    this.update({ connected: false, message: "Searching for nearby printers…" });
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });
    this.device.addEventListener("gattserverdisconnected", () =>
      this.handleDisconnect(),
    );
    await this.connectDevice();
  }

  async connectRemembered(deviceNames, timeoutSeconds) {
    // Keep this synchronous: requestDevice must run in the original Print click.
    window.desktop.preparePrinterDiscovery([...deviceNames], timeoutSeconds);
    await this.connect();
  }

  async connectDevice() {
    this.update({ connected: false, message: "Connecting to printer…" });
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.writeCharacteristic = await service.getCharacteristic(WRITE_UUID);
    const notificationCharacteristic =
      await service.getCharacteristic(NOTIFY_UUID);
    await notificationCharacteristic.startNotifications();
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
      deviceName: this.device.name || "printer",
      message: `Connected to ${this.device.name || "printer"}`,
    });
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
  }

  update(changes) {
    this.state = { ...this.state, ...changes };
    this.onStatus(this.state);
  }

  handleNotification(data) {
    if (equalBytes(data, flowControl.pause)) {
      this.paused = true;
      this.update({ message: "Printer buffer full; waiting…", buffer: "Full" });
      return;
    }
    if (equalBytes(data, flowControl.resume)) {
      this.paused = false;
      this.update({ message: "Ready", buffer: "Ready" });
      return;
    }
    if (data[2] === 0xa3 && data.length >= 7) {
      const value = data[6];
      this.update({
        paper: value & 0x01 ? "Out of paper" : "Loaded",
        lid: value & 0x02 ? "Open" : "Closed",
        temperature: value & 0x04 ? "Too hot" : "Normal",
        battery: value & 0x08 ? "Low" : "OK",
        busy: Boolean(value & 0x80),
        message: value ? "Printer needs attention" : "Ready",
      });
    }
  }

  async send(data, chunkDelay = 20, reportProgress = false) {
    if (!this.writeCharacteristic)
      throw new Error("Connect the printer first.");
    const delayMs = Math.max(0, Math.min(500, Number(chunkDelay) || 0));
    for (let offset = 0; offset < data.length; offset += 245) {
      while (this.paused) await delay(100);
      await this.writeCharacteristic.writeValueWithoutResponse(
        data.slice(offset, offset + 245),
      );
      if (delayMs) await delay(delayMs);
      if (reportProgress)
        this.onProgress(
          Math.min(100, Math.round(((offset + 245) / data.length) * 100)),
        );
    }
  }

  async requestStatus() {
    this.update({ message: "Requesting printer status…" });
    await this.send(buildStatusRequest());
  }

  async print(pixels, width, height, settings = {}) {
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
    this.onProgress(0);
    const topFeed = settings.marginTopEnabled
      ? Math.max(0, Math.min(500, Number(settings.marginTop) || 0))
      : 0;
    if (topFeed) await this.send(buildFeedData(topFeed), settings.chunkDelay);
    await this.send(
      buildPrintData(rows, energy, { quality, speed }),
      settings.chunkDelay,
      true,
    );
    await delay(2000);
    if (settings.postFeedEnabled !== false)
      await this.send(buildFeedData(postFeed), settings.chunkDelay);
    this.onProgress(100);
  }

  disconnect() {
    this.manualDisconnect = true;
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
    }
  }

  async feedPaper(pixels) {
    await this.send(
      buildFeedData(Math.max(0, Math.min(500, Number(pixels) || 0))),
    );
  }

  async retractPaper(pixels) {
    await this.send(
      buildRetractData(Math.max(0, Math.min(500, Number(pixels) || 0))),
    );
  }
}
