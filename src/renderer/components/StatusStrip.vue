<script setup>
defineProps({ status: { type: Object, required: true } });
const emit = defineEmits(['refresh']);
</script>

<template>
	<section class="status-strip">
		<span class="status-message"><b>Status</b>{{ status.message }}</span><span><b>Paper</b>{{ status.paper }}</span><span><b>Lid</b>{{ status.lid }}</span><span><b>Temperature</b>{{ status.temperature }}</span><span><b>Battery</b>{{ status.battery }}</span><span><b>Printer</b>{{ status.busy ? 'Busy' : 'Ready' }}</span><button class="status-refresh clear-link" :disabled="!status.connected" @click="emit('refresh')">Refresh status</button>
	</section>
</template>
