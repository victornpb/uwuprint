<script setup>
defineProps({ status: { type: Object, required: true } });
const emit = defineEmits(['refresh']);

function statusClass(field, value, status) {
	if (field === 'connection') return status.connected ? 'status-ok' : '';
	if (field === 'paper' && value === 'Out of paper') return 'status-danger';
	if (field === 'lid' && value === 'Open') return 'status-warning';
	if (field === 'temperature' && value === 'Too hot') return 'status-danger';
	if (field === 'battery' && value === 'Low') return 'status-warning';
	return '';
}
</script>

<template>
	<section class="status-strip">
		<span class="status-message" :class="statusClass('connection', status.message, status)"><b>Status</b>{{ status.message }}</span><span :class="statusClass('paper', status.paper, status)"><b>Paper</b>{{ status.paper }}</span><span :class="statusClass('lid', status.lid, status)"><b>Lid</b>{{ status.lid }}</span><span :class="statusClass('temperature', status.temperature, status)"><b>Temperature</b>{{ status.temperature }}</span><span :class="statusClass('battery', status.battery, status)"><b>Battery</b>{{ status.battery }}</span><span :class="status.connected ? 'status-ok' : ''"><b>Printer</b>{{ status.busy ? 'Busy' : 'Ready' }}</span><button class="status-refresh clear-link" :disabled="!status.connected" @click="emit('refresh')">Refresh status</button>
	</section>
</template>
