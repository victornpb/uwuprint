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
	'.svg',
]);

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

async function trimBlankBackground(image) {
	const { data, info } = await image
		.clone()
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const backgroundThreshold = 32;
	let left = info.width;
	let top = info.height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < info.height; y++) {
		for (let x = 0; x < info.width; x++) {
			const offset = (y * info.width + x) * info.channels;
			const alpha = data[offset + 3];
			const isNearWhite =
				data[offset] >= 255 - backgroundThreshold &&
				data[offset + 1] >= 255 - backgroundThreshold &&
				data[offset + 2] >= 255 - backgroundThreshold;
			if (alpha <= backgroundThreshold || isNearWhite) continue;
			left = Math.min(left, x);
			top = Math.min(top, y);
			right = Math.max(right, x);
			bottom = Math.max(bottom, y);
		}
	}
	if (right < left || bottom < top) return image;
	return image.extract({
		left,
		top,
		width: right - left + 1,
		height: bottom - top + 1,
	});
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
	if (options.trimBlank) image = await trimBlankBackground(image);

	const contrast = Number(options.contrast ?? 1);
	const brightness = Number(options.brightness ?? 0);
	let processed = image
		.flatten({ background: { r: 255, g: 255, b: 255 } })
		.greyscale();
	if (options.normalize) processed = processed.normalize();
	processed = processed.linear(contrast, brightness);
	if (options.invert) processed = processed.negate();
	const { info: unscaledInfo } = await processed
		.clone()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const unscaledWidth = unscaledInfo.width;
	processed = processed.resize({
		width: 384,
		fit: 'inside',
		withoutEnlargement: !options.scaleToWidth,
	});
	const sharpen = Number(options.sharpen ?? 0);
	if (sharpen > 0) processed = processed.sharpen(sharpen);
	const { data, info } = await processed
		.raw()
		.toBuffer({ resolveWithObject: true });
	const padded = Buffer.alloc(384 * info.height, 255);
	const leftPadding = options.alignment === 'left'
		? 0
		: options.alignment === 'right'
			? 384 - info.width
			: Math.floor((384 - info.width) / 2);
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
		contentWidth: info.width,
		unscaledWidth,
		height: info.height,
		preview: `data:image/png;base64,${png.toString('base64')}`,
		original: `data:image/png;base64,${originalPreview.toString('base64')}`,
	};
}

module.exports = { IMAGE_EXTENSIONS, renderImage };
