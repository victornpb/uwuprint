<script setup>
const props = defineProps({
	status: { type: Object, required: true },
	transferStats: { type: Object, default: null },
	showTransferStats: { type: Boolean, default: false },
	updateStatus: { type: Object, default: null },
});
const emit = defineEmits(['refresh', 'open-latest-release']);

function formatBytes(bytes) {
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function transferLabel() {
	const stats = props.transferStats;
	if (!stats) return '';
	return `${formatBytes(stats.transferredBytes)} / ${formatBytes(stats.totalBytes)} · ${stats.transferredPackets} / ${stats.totalPackets} packets · Avg ${formatBytes(stats.averageBytesPerSecond)}/s`;
}

function statusClass(field, value, status) {
	if (field === 'connection') {
		if (value === 'Lost connection') return 'status-danger';
		if (value === 'Printer needs attention') return 'status-warning';
		return status.connected ? 'status-ok' : '';
	}
	if (field === 'paper' && value === 'Out of paper') return 'status-danger';
	if (field === 'lid' && value === 'Open') return 'status-warning';
	if (field === 'temperature' && value === 'Too hot') return 'status-danger';
	if (field === 'battery' && value === 'Low') return 'status-warning';
	return '';
}
</script>

<template>
	<section class="status-strip">
		<span v-if="status.connected" :class="status.busy ? '' : 'status-ok'"><b>Printer</b><span v-if="status.busy">Busy</span><span v-else>Ready</span></span>
		<span v-else><b>Printer</b>Disconnected</span>
		<span :class="statusClass('paper', status.paper, status)"><b>Paper</b>{{ status.paper }}</span>
		<span :class="statusClass('lid', status.lid, status)"><b>Lid</b>{{ status.lid }}</span>
		<span :class="statusClass('temperature', status.temperature, status)"><b>Temperature</b>{{ status.temperature }}</span>
		<span :class="statusClass('battery', status.battery, status)"><b>Battery</b>{{ status.battery }}</span>
		<span class="status-message" :class="statusClass('connection', status.message, status)"><b>Status</b>{{ status.message }}</span>
		<button class="status-refresh clear-link" :disabled="!status.connected" aria-label="Refresh printer status" title="Refresh printer status" @click="emit('refresh')">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3.8L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.9 3.8L21 15m0 0v5m0-5h-5" /></svg>
		</button>
		<span v-if="showTransferStats && transferStats" class="transfer-stats"><b>Transfer</b>{{ transferLabel() }}</span>
		<button v-if="updateStatus?.available" class="status-update clear-link" @click="emit('open-latest-release', updateStatus.releaseUrl)">Version {{ updateStatus.latestVersion }} available</button>
	</section>
</template>
