<script setup>
import { onMounted, ref } from 'vue';
import DitherComparisonDialog from './components/DitherComparisonDialog.vue';

const comparison = ref(null);

async function applyDither(dither) {
	await window.desktop.applyDitherComparison(dither);
}

async function closeComparison() {
	await window.desktop.closeDitherComparison();
}

onMounted(async () => {
	comparison.value = await window.desktop.getDitherComparison();
});
</script>

<template>
	<DitherComparisonDialog
		v-if="comparison"
		standalone
		:image="comparison.image"
		:options="comparison.options"
		@apply="applyDither"
		@close="closeComparison"
	/>
	<div v-else class="loading">Loading dithering previews…</div>
</template>

<style scoped>
.loading { height: 100vh; display: grid; place-items: center; color: var(--sys-text-secondary); }
</style>
