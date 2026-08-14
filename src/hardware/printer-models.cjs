const SUPPORTED_PRINTER_NAMES = new Set([
	'_ZZ00',
	'GB01',
	'GB02',
	'GB03',
	'GT01',
	'MX05',
	'MX06',
	'MX08',
	'MX09',
	'YT01',
]);

function normalizedPrinterName(name) {
	return String(name || '')
		.replace(/\s*\([^)]*\)\s*$/, '')
		.trim()
		.toUpperCase();
}

module.exports = { SUPPORTED_PRINTER_NAMES, normalizedPrinterName };
