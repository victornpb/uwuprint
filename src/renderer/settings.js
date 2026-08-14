function normalizedPrinterName(name) {
	return String(name || '')
		.replace(/\s*\([^)]*\)\s*$/, '')
		.trim()
		.toUpperCase();
}

const DEFAULT_PREFERENCES = {
	printer: {
		energy: 39321,
		quality: 5,
		speed: 0,
		marginTop: 10,
		marginTopEnabled: false,
		marginBottom: 50,
		marginBottomEnabled: true,
		marginBetween: 50,
		marginUnits: 'px',
		manualFeed: 20,
	},
	advanced: { chunkDelay: 20, disconnectAfter: 300, connectTimeout: 15 },
	queue: { cancelCountdownOnMouseMove: true },
	appearance: { theme: 'system' },
	notifications: {
		enabled: true,
		lowBattery: true,
		paper: true,
		lid: true,
		temperature: true,
		printComplete: true,
	},
};

export { normalizedPrinterName };

export function loadRememberedDevices(storage = localStorage) {
	return [
		...new Set(
			JSON.parse(storage.getItem('uwuprint-remembered-devices') || '[]')
				.map(normalizedPrinterName)
				.filter(Boolean),
		),
	];
}

export function saveRememberedDevices(devices, storage = localStorage) {
	storage.setItem('uwuprint-remembered-devices', JSON.stringify(devices));
}

export function loadPreferences(storage = localStorage) {
	const saved = JSON.parse(storage.getItem('uwuprint-preferences') || '{}');
	const preferences = {
		printer: { ...DEFAULT_PREFERENCES.printer, ...(saved.printer || {}) },
		advanced: { ...DEFAULT_PREFERENCES.advanced, ...(saved.advanced || {}) },
		queue: { ...DEFAULT_PREFERENCES.queue, ...(saved.queue || {}) },
		appearance: { ...DEFAULT_PREFERENCES.appearance, ...(saved.appearance || {}) },
		notifications: { ...DEFAULT_PREFERENCES.notifications, ...(saved.notifications || {}) },
	};
	if (saved.printer?.postFeed !== undefined)
		preferences.printer.marginBottom = saved.printer.postFeed;
	if (preferences.printer.quality === 0) preferences.printer.quality = 5;
	return preferences;
}

export function savePreferences(preferences, storage = localStorage) {
	storage.setItem('uwuprint-preferences', JSON.stringify(preferences));
}

export function createImageOptions() {
	return {
		rotation: 0,
		contrast: 1,
		brightness: 0,
		normalize: false,
		sharpen: 0,
		invert: false,
		trimBlank: false,
		scaleToWidth: false,
		dither: 'floyd-steinberg',
		crop: { left: 0, top: 0, width: 0, height: 0 },
	};
}

export const isImagePath = (filePath) =>
	/\.(png|jpe?g|webp|gif|tiff?|bmp)$/i.test(filePath);
