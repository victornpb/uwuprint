<script setup>
const props = defineProps({
	imageName: { type: String, required: true },
	preview: { type: String, default: '' },
	progress: { type: Number, required: true },
	orientation: { type: String, default: 'top-to-bottom' },
	transferStats: { type: Object, default: null },
	showTransferStats: { type: Boolean, default: false },
});

function formatBytes(bytes) {
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function transferLabel() {
	if (!props.transferStats) return '';
	const stats = props.transferStats;
	return `${formatBytes(stats.transferredBytes)} / ${formatBytes(stats.totalBytes)} · ${stats.transferredPackets} / ${stats.totalPackets} packets · Avg ${formatBytes(stats.averageBytesPerSecond)}/s`;
}
</script>

<template>
	<div class="modal-backdrop print-progress-backdrop">
		<section class="modal print-progress-dialog" role="status" aria-live="polite" aria-labelledby="printing-title">
			<header class="print-progress-header">
				<div>
					<p>Printing</p>
					<h2 id="printing-title">Sending your image to the printer</h2>
				</div>
			</header>
			<div class="print-progress-body">
					<div v-if="preview" class="printing-preview">
						<div :class="['printing-preview-image', { 'print-orientation-reversed': orientation === 'bottom-to-top' }]">
						<img :src="preview" :alt="`Printing preview for ${imageName}`" />
						<span class="printing-preview-printed" :style="{ height: `${progress}%` }"><img :src="preview" alt="" /></span>
						<i class="printing-preview-line" :style="{ top: `${progress}%` }" />
					</div>
				</div>
				<div v-else class="printing-preview-empty">Preparing preview…</div>
				<div class="print-progress-copy">
					<strong>{{ imageName }}</strong>
					<div class="print-progress-track"><i :style="{ width: `${progress}%` }" /></div>
					<p v-if="showTransferStats && transferStats" class="transfer-stats">{{ transferLabel() }}</p>
				</div>
			</div>
		</section>
	</div>
</template>

<style scoped>
.print-progress-backdrop {
	background: rgba(0, 0, 0, 0.28);
}

.print-progress-dialog {
	width: min(420px, calc(100vw - 32px));
	overflow: hidden;
}

.print-progress-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
	padding: 18px 20px 16px;
	border-bottom: 1px solid var(--sys-border);
	background: color-mix(in srgb, var(--sys-sidebar-bg) 72%, var(--sys-content-bg));
}

.print-progress-header p {
	margin: 0;
	color: var(--sys-text-secondary);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.35px;
	text-transform: uppercase;
}

.print-progress-header h2 {
	margin: 2px 0 0;
	font-size: 17px;
	letter-spacing: -0.2px;
}

.print-progress-body {
	padding: 18px 20px 20px;
}

.printing-preview,
.printing-preview-empty {
	position: relative;
	display: grid;
	place-items: center;
	min-height: 130px;
	overflow: hidden;
	border: 1px solid var(--sys-border);
	border-radius: 8px;
	background: var(--sys-sidebar-bg);
}

.printing-preview-image {
	position: relative;
	display: grid;
	max-width: 100%;
	max-height: 235px;
}

.printing-preview-image img {
	display: block;
	max-width: 100%;
	max-height: 235px;
	object-fit: contain;
	image-rendering: pixelated;
	opacity: 0.32;
}

.printing-preview-image.print-orientation-reversed {
	transform: rotate(180deg);
}

.printing-preview-printed {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	overflow: hidden;
	pointer-events: none;
	transition: height 0.15s linear;
}

.print-orientation-reversed .printing-preview-printed {
	top: auto;
	bottom: 0;
}

.printing-preview-printed img {
	width: 100%;
	max-width: none;
	height: auto;
	opacity: 1;
}

.printing-preview-line {
	position: absolute;
	left: 0;
	width: 100%;
	height: 1px;
	background: var(--sys-accent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--sys-accent) 20%, transparent);
	pointer-events: none;
	transition: top 0.15s linear;
}

.print-orientation-reversed .printing-preview-line {
	top: auto;
	bottom: 0;
}

.printing-preview-empty {
	color: var(--sys-text-secondary);
	font-size: 12px;
}

.print-progress-copy {
	display: grid;
	gap: 9px;
	margin-top: 16px;
}

.print-progress-copy strong {
	overflow: hidden;
	font-size: 13px;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.print-progress-track {
	height: 4px;
	overflow: hidden;
	border-radius: 999px;
	background: var(--sys-border);
}

.print-progress-track i {
	display: block;
	height: 100%;
	border-radius: inherit;
	background: var(--sys-accent);
	transition: width 0.15s linear;
}

.print-progress-copy .transfer-stats {
	margin: 0;
	color: var(--sys-text-secondary);
	font-size: 11px;
}
</style>
