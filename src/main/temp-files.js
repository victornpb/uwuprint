const fs = require('fs');
const path = require('path');

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filePattern(prefix) {
	return new RegExp(
		`^${escapeRegExp(prefix)}-(clipboard|dropped)-\\d+-[a-f0-9]+\\.(png|jpe?g|webp|gif|bmp|tiff?)$`,
		'i',
	);
}

function createTempFile(tempDirectory, prefix, kind, extension, data) {
	const fileName = `${prefix}-${kind}-${Date.now()}-${Math.random()
		.toString(16)
		.slice(2)}${extension}`;
	const filePath = path.join(tempDirectory, fileName);
	fs.writeFileSync(filePath, data, { flag: 'wx' });
	return filePath;
}

function cleanupTempFiles(tempDirectory, prefix) {
	const matches = filePattern(prefix);
	for (const entry of fs.readdirSync(tempDirectory, { withFileTypes: true })) {
		if (!entry.isFile() || !matches.test(entry.name)) continue;
		const filePath = path.join(tempDirectory, entry.name);
		try {
			fs.unlinkSync(filePath);
		} catch (error) {
			// A locked or already-removed temp file should not prevent the app from quitting.
			console.warn(`Could not remove temporary file ${filePath}:`, error.message);
		}
	}
}

module.exports = { cleanupTempFiles, createTempFile };
