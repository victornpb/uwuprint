<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';

const props = defineProps({
	preferences: { type: Object, required: true },
	marginDisplay: { type: Function, required: true },
	setMargin: { type: Function, required: true },
});
const emit = defineEmits(['feed', 'retract']);
const root = ref(null);
const state = reactive({ amountPickerOpen: false });

function maximumAmount() {
	return props.preferences.printer.marginUnits === 'mm' ? 62.5 : 500;
}

function minimumAmount() {
	return props.preferences.printer.marginUnits === 'mm' ? 0.1 : 1;
}

function presetAmounts() {
	const pixelAmounts = [10, 25, 50, 100, 200];
	return props.preferences.printer.marginUnits === 'mm'
		? pixelAmounts.map((amount) => amount / 8)
		: pixelAmounts;
}

function isSelectedPreset(amount) {
	const storedAmount = props.preferences.printer.marginUnits === 'mm'
		? Math.round(amount * 8)
		: amount;
	return props.preferences.printer.manualFeed === storedAmount;
}

function setAmount(value) {
	const amount = Math.max(minimumAmount(), Math.min(maximumAmount(), Number(value) || minimumAmount()));
	props.setMargin('manualFeed', { target: { value: amount } });
}

function choosePreset(amount) {
	setAmount(amount);
	state.amountPickerOpen = false;
}

function toggleAmountPicker() {
	state.amountPickerOpen = !state.amountPickerOpen;
}

function closeAmountPicker(event) {
	if (!root.value?.contains(event.target)) state.amountPickerOpen = false;
}

function handleKeydown(event) {
	if (event.key === 'Escape') state.amountPickerOpen = false;
}

onMounted(() => {
	document.addEventListener('pointerdown', closeAmountPicker);
	document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', closeAmountPicker);
	document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <section ref="root" class="paper-toolbar" aria-label="Paper movement">
    <span class="paper-toolbar-label">Paper</span>
    <div class="paper-jog">
      <button class="paper-action" :title="`Retract paper ${marginDisplay('manualFeed')} ${preferences.printer.marginUnits}`" aria-label="Retract paper" @click="emit('retract')"><svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 6L6 1L11 6" /></svg></button>
      <button class="paper-amount-button" :aria-expanded="state.amountPickerOpen" aria-haspopup="dialog" @click="toggleAmountPicker">
        <span>{{ marginDisplay('manualFeed') }}</span><small>{{ preferences.printer.marginUnits }}</small><i aria-hidden="true" />
      </button>
      <button class="paper-action" :title="`Feed paper ${marginDisplay('manualFeed')} ${preferences.printer.marginUnits}`" aria-label="Feed paper" @click="emit('feed')"><svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 2L6 7L11 2" /></svg></button>
    </div>
    <div v-if="state.amountPickerOpen" class="paper-popover" role="dialog" aria-label="Paper movement amount">
      <label class="paper-amount-field">
        <span>Move amount</span>
        <div><input :value="marginDisplay('manualFeed')" @input="setAmount($event.target.value)" type="number" :min="minimumAmount()" :max="maximumAmount()" :step="preferences.printer.marginUnits === 'mm' ? 0.1 : 1" aria-label="Paper movement amount" /><em>{{ preferences.printer.marginUnits }}</em></div>
      </label>
      <div class="paper-presets" role="group" aria-label="Common paper movement amounts">
        <button v-for="amount in presetAmounts()" :key="amount" :class="{ selected: isSelectedPreset(amount) }" @click="choosePreset(amount)">{{ amount }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.paper-toolbar {
	position: relative;
	display: flex;
	align-items: center;
	gap: 7px;
	font-size: 11px;
	-webkit-app-region: no-drag;
}

.paper-toolbar-label {
	color: var(--sys-text-secondary);
	font-size: 10px;
	font-weight: 600;
	text-transform: uppercase;
}

.paper-jog {
	display: inline-flex;
	min-height: 25px;
	overflow: hidden;
	border: 1px solid var(--sys-control-border);
	border-radius: 5px;
	background: var(--sys-control-bg);
}

.paper-action,
.paper-amount-button {
	border: 0;
	border-radius: 0;
	background: transparent;
	box-shadow: none;
	color: var(--sys-text-primary);
}

.paper-action {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 27px;
	padding: 0;
}

.paper-amount-button {
	display: inline-flex;
	position: relative;
	align-items: center;
	justify-content: center;
	gap: 3px;
	min-width: 68px;
	padding: 3px 18px 3px 8px;
	border-right: 1px solid var(--sys-control-border);
	border-left: 1px solid var(--sys-control-border);
	font-variant-numeric: tabular-nums;
}

.paper-amount-button small {
	color: var(--sys-text-secondary);
	font-size: 10px;
	font-weight: 500;
}

.paper-amount-button i {
	position: absolute;
	right: 7px;
	width: 5px;
	height: 5px;
	border-right: 1px solid var(--sys-text-secondary);
	border-bottom: 1px solid var(--sys-text-secondary);
	transform: translateY(-2px) rotate(45deg);
}

.paper-action:hover:not(:disabled),
.paper-amount-button:hover:not(:disabled),
.paper-amount-button[aria-expanded='true'] {
	background: var(--sys-control-hover);
}

.paper-action:active:not(:disabled),
.paper-amount-button:active:not(:disabled) {
	background: var(--sys-sidebar-active);
}

.paper-action svg {
	display: block;
	width: 12px;
	height: 8px;
	margin: auto;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.75;
}

.paper-popover {
	position: absolute;
	top: calc(100% + 7px);
	left: 50%;
	z-index: 10;
	width: 178px;
	padding: 10px;
	border: 1px solid var(--sys-control-border);
	border-radius: 8px;
	background: var(--sys-content-bg);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.1);
	transform: translateX(-50%);
}

.paper-amount-field {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 9px;
	color: var(--sys-text-secondary);
	font-size: 11px;
}

.paper-amount-field > div {
	display: flex;
	align-items: center;
	min-height: 25px;
	border: 1px solid var(--sys-control-border);
	border-radius: 4px;
	background: var(--sys-control-bg);
}

.paper-amount-field > div:focus-within {
	border-color: var(--sys-accent);
	box-shadow: 0 0 0 1px var(--sys-accent);
}

.paper-amount-field input {
	width: 46px;
	padding: 3px 2px 3px 5px;
	border: 0;
	outline: 0;
	background: transparent;
	color: var(--sys-text-primary);
	text-align: right;
	appearance: textfield;
}

.paper-amount-field input::-webkit-inner-spin-button,
.paper-amount-field input::-webkit-outer-spin-button {
	margin: 0;
	-webkit-appearance: none;
}

.paper-amount-field em {
	padding-right: 5px;
	font-size: 10px;
	font-style: normal;
}

.paper-presets {
	display: grid;
	grid-template-columns: repeat(5, 1fr);
	overflow: hidden;
	border: 1px solid var(--sys-control-border);
	border-radius: 5px;
}

.paper-presets button {
	min-width: 0;
	min-height: 25px;
	padding: 2px;
	border: 0;
	border-radius: 0;
	border-left: 1px solid var(--sys-control-border);
	background: var(--sys-control-bg);
	box-shadow: none;
	color: var(--sys-text-primary);
	font-size: 10px;
}

.paper-presets button:first-child {
	border-left: 0;
}

.paper-presets button:hover:not(:disabled) {
	background: var(--sys-control-hover);
}

.paper-presets button.selected {
	background: var(--sys-sidebar-active);
	font-weight: 600;
}

@media (max-width: 900px) {
	.paper-toolbar-label {
		display: none;
	}
}
</style>
