<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DITHERING_GROUPS, DITHERING_OPTIONS } from '../dithering.js';

const emit = defineEmits(['apply', 'close']);
const props = defineProps({
	image: { type: Object, required: true },
	options: { type: Object, required: true },
	standalone: { type: Boolean, default: false },
});

const choices = ref(DITHERING_OPTIONS.map((option) => ({ ...option, preview: '', error: '' })));
const completed = ref(0);
const selectedValue = ref(props.options.dither);
const selectedChoice = computed(() =>
	choices.value.find((choice) => choice.value === selectedValue.value),
);
const selectedIndex = computed(() =>
	choices.value.findIndex((choice) => choice.value === selectedValue.value),
);
const previousChoice = computed(() => choices.value[selectedIndex.value - 1]);
const nextChoice = computed(() => choices.value[selectedIndex.value + 1]);
let active = true;

function moveSelection(direction) {
	const choice = choices.value[selectedIndex.value + direction];
	if (choice?.preview) selectedValue.value = choice.value;
}

function handleKey(event) {
	if (event.key === 'ArrowLeft') {
		event.preventDefault();
		moveSelection(-1);
	}
	if (event.key === 'ArrowRight') {
		event.preventDefault();
		moveSelection(1);
	}
}

async function renderChoices() {
	const options = JSON.parse(JSON.stringify(props.options));
	for (const choice of choices.value) {
		try {
			const result = await window.desktop.renderImage(props.image.path, {
				...options,
				dither: choice.value,
			});
			if (!active) return;
			choice.preview = result.preview;
		} catch (error) {
			if (!active) return;
			choice.error = error.message;
		} finally {
			if (active) completed.value++;
		}
	}
}

onMounted(() => {
	renderChoices();
	window.addEventListener('keydown', handleKey);
});
onBeforeUnmount(() => {
	active = false;
	window.removeEventListener('keydown', handleKey);
});
</script>

<template>
	<div :class="{ 'modal-backdrop': !standalone, 'comparison-window': standalone }" @click.self="!standalone && emit('close')">
		<section class="dither-comparison" :class="{ modal: !standalone, standalone }">
			<header class="comparison-header">
				<div class="header-copy">
					<h2>Compare dithering</h2>
					<p>{{ image.name }}</p>
				</div>
				<button v-if="!standalone" class="secondary close-button" @click="emit('close')">Close</button>
			</header>
			<div class="comparison-progress">{{ completed }} of {{ choices.length }} previews ready · Use ← and → to compare.</div>
			<div class="comparison-body">
				<div class="dither-grid">
					<section v-for="group in DITHERING_GROUPS" :key="group.label" class="dither-group">
						<h3>{{ group.label }}</h3>
						<button v-for="option in group.options" :key="option.value"
							class="dither-choice" type="button"
							:class="{ selected: option.value === selectedValue }"
							:disabled="!choices.find((choice) => choice.value === option.value)?.preview"
							@click="selectedValue = option.value">
							<img v-if="choices.find((choice) => choice.value === option.value)?.preview"
								class="choice-thumbnail" :src="choices.find((choice) => choice.value === option.value).preview"
								:alt="`${option.label} thumbnail`" />
							<span v-else class="choice-thumbnail choice-loading"><i class="spinner" /></span>
							<span>{{ option.label }}</span>
						</button>
					</section>
				</div>
				<div class="full-preview">
					<div class="preview-heading"><strong v-if="selectedChoice">{{ selectedChoice.label }}</strong></div>
					<img v-if="selectedChoice?.preview" :src="selectedChoice.preview"
						:alt="`${selectedChoice.label} full-size preview`" />
					<div v-else class="preview-loading"><i class="spinner" /><span>Rendering preview…</span></div>
					<small>384px print width</small>
					<div class="preview-navigation"><button class="secondary preview-step" type="button"
						:disabled="!previousChoice?.preview" @click="moveSelection(-1)">←</button><strong
						class="preview-count">{{ selectedIndex + 1 }} / {{ choices.length }}</strong><button class="secondary preview-step"
						type="button" :disabled="!nextChoice?.preview" @click="moveSelection(1)">→</button></div>
				</div>
			</div>
			<footer><span /><div><button
				:disabled="!selectedChoice?.preview" @click="emit('apply', selectedValue)">Use {{ selectedChoice?.label || 'this dithering' }}</button></div></footer>
		</section>
	</div>
</template>

<style scoped>
.dither-comparison { width: min(1200px, calc(100vw - 32px)); height: min(690px, calc(100vh - 32px)); overflow: hidden; display: flex; flex-direction: column; }
.comparison-window { width: 100vw; height: 100vh; }
.dither-comparison.standalone { width: 100%; height: 100%; max-height: none; border-radius: 0; background: var(--sys-content-bg); }
.comparison-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--sys-border); background: var(--sys-sidebar-bg); }
.header-copy { min-width: 0; }
.dither-comparison h2 { margin: 0; font-size: 15px; }
.dither-comparison p { margin: 3px 0 0; color: var(--sys-text-secondary); font-size: 11px; }
.close-button { flex: none; }
.comparison-progress { margin: 0; padding: 7px 18px; color: var(--sys-text-secondary); font-size: 10px; border-bottom: 1px solid var(--sys-border); }
.comparison-body { display: grid; grid-template-columns: 440px minmax(0, 1fr); min-height: 0; flex: 1; }
.dither-grid { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow-y: auto; padding: 12px 8px 12px 10px; background: var(--sys-sidebar-bg); border-right: 1px solid var(--sys-border); }
.dither-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.dither-group h3 { grid-column: 1 / -1; margin: 5px 4px 2px; color: var(--sys-text-secondary); font-size: 10px; font-weight: 500; }
.dither-choice { min-height: 146px; padding: 6px; border: 0; border-radius: 6px; background: transparent; color: var(--sys-text-primary); display: flex; flex-direction: column; align-items: stretch; gap: 6px; text-align: left; font-size: 11px; box-shadow: none; }
.dither-choice:hover:not(:disabled) { background: var(--sys-sidebar-hover); }
.dither-choice.selected { background: var(--sys-sidebar-active); font-weight: 600; }
.dither-choice:disabled { background: transparent; color: var(--sys-text-secondary); cursor: wait; }
.choice-thumbnail { width: 100%; height: 108px; flex: none; object-fit: contain; background: #fff; border: 1px solid var(--sys-border); border-radius: 4px; }
.choice-loading { display: grid; place-items: center; background: var(--sys-control-bg); }
.full-preview { min-width: 0; min-height: 0; overflow: auto; padding: 18px 24px; background: var(--sys-content-bg); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.preview-heading { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; }
.preview-heading > strong { font-size: 13px; font-weight: 600; }
.preview-navigation { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: auto; padding-top: 10px; }
.preview-count { color: var(--sys-text-secondary); font-size: 11px; font-weight: 500; }
.preview-step { min-width: 30px; padding: 5px 8px; }
.full-preview img { width: min(384px, 100%); max-height: 470px; height: auto; background: #fff; border: 1px solid var(--sys-border); image-rendering: pixelated; }
.full-preview small { color: var(--sys-text-secondary); font-size: 10px; }
.preview-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--sys-text-secondary); font-size: 12px; }
.dither-comparison footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 18px; border-top: 1px solid var(--sys-border); background: var(--sys-sidebar-bg); }
.dither-comparison footer div { display: flex; gap: 8px; }
@media (max-width: 760px) {
	.comparison-body { grid-template-columns: 1fr; overflow-y: auto; }
	.dither-grid { max-height: 300px; }
	.full-preview { min-height: 300px; }
	.footer-hint { display: none; }
}
</style>
