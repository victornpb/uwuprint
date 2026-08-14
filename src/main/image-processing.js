const path = require('path');
const sharp = require('sharp');
const { dither } = require('./dither.js');

const IMAGE_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.gif',
	'.tiff',
	'.bmp',
]);

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

async function renderImage(inputPath, options = {}) {
	if (!IMAGE_EXTENSIONS.has(path.extname(inputPath).toLowerCase())) {
		throw new Error(
			'Choose a supported image file (PNG, JPEG, WebP, GIF, TIFF, or BMP).',
		);
	}
	let image = sharp(inputPath, { animated: false });
	const metadata = await image.metadata();
	const originalPreview = await sharp(inputPath, { animated: false })
		.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
		.png()
		.toBuffer();
	if (options.crop?.width > 0 && options.crop?.height > 0) {
		const left = clamp(Math.round(options.crop.left || 0), 0, metadata.width - 1);
		const top = clamp(Math.round(options.crop.top || 0), 0, metadata.height - 1);
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
		.resize({ width: 384, fit: 'inside', withoutEnlargement: !options.scaleToWidth })
		.raw()
		.toBuffer({ resolveWithObject: true });
	const padded = Buffer.alloc(384 * info.height, 255);
	const leftPadding = Math.floor((384 - info.width) / 2);
	for (let y = 0; y < info.height; y++)
		data.copy(padded, y * 384 + leftPadding, y * info.width, (y + 1) * info.width);

	dither(padded, 384, info.height, options.dither).copy(padded);
	const png = await sharp(padded, {
		raw: { width: 384, height: info.height, channels: 1 },
	})
		.png()
		.toBuffer();
	return {
		pixels: padded,
		width: 384,
		height: info.height,
		preview: `data:image/png;base64,${png.toString('base64')}`,
		original: `data:image/png;base64,${originalPreview.toString('base64')}`,
	};
}

module.exports = { IMAGE_EXTENSIONS, renderImage };
