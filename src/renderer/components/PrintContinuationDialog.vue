<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const emit = defineEmits(['cancel', 'feed', 'retract', 'continue']);
const props = defineProps({
	queueIndex: { type: Number, required: true },
	queueLength: { type: Number, required: true },
	nextPreview: { type: String, default: '' },
	autoContinueSeconds: { type: Number, required: true },
	pauseOnMouseMove: { type: Boolean, required: true },
});
const countdown = ref(props.autoContinueSeconds);
const countdownPaused = ref(false);
let timer;
let startPointer;

function clearTimer() { clearInterval(timer); }
function continueQueue() { clearTimer(); emit('continue'); }
function startCountdown() {
	if (!countdown.value) return;
	countdownPaused.value = false;
	clearTimer();
	timer = setInterval(() => { if (--countdown.value <= 0) continueQueue(); }, 1000);
}
function pauseCountdown() {
	clearTimer();
	if (countdown.value) countdownPaused.value = true;
}
function handleMouseMove(event) {
	if (!countdown.value || !props.pauseOnMouseMove) return;
	if (!startPointer) startPointer = { x: event.clientX, y: event.clientY };
	else if (Math.hypot(event.clientX - startPointer.x, event.clientY - startPointer.y) > 10) pauseCountdown();
}
function handleKey(event) {
	if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); continueQueue(); }
}
onMounted(() => {
	startCountdown();
	window.addEventListener('mousemove', handleMouseMove);
	window.addEventListener('keydown', handleKey);
});
onBeforeUnmount(() => {
	clearTimer();
	window.removeEventListener('mousemove', handleMouseMove);
	window.removeEventListener('keydown', handleKey);
});
</script>

<template>
	<div class="modal-backdrop" @click.self="emit('cancel')">
		<section class="modal print-dialog" role="dialog" aria-modal="true" aria-labelledby="continue-title">
			<header class="print-dialog-header">
				<div>
					<p class="print-dialog-kicker">Print queue</p>
					<h2 id="continue-title">Ready for the next image</h2>
				</div>
				<button class="icon-button" aria-label="Cancel print queue" @click="emit('cancel')">×</button>
			</header>
			<div class="print-dialog-body">
				<div class="queue-progress">
					<div><strong>Image {{ queueIndex + 1 }} of {{ queueLength }} printed</strong><span>Next image is ready when you are.</span></div>
					<div class="queue-progress-track"><i :style="{ width: `${((queueIndex + 1) / queueLength) * 100}%` }" /></div>
				</div>
				<div v-if="nextPreview" class="next-image">
					<span>Up next</span>
					<div><img :src="nextPreview" alt="Next image preview" /></div>
				</div>
				<div class="continue-timing">
					<strong v-if="countdown && !countdownPaused">Continuing automatically in {{ countdown }} seconds</strong>
					<strong v-else-if="countdownPaused">Automatic continuation is paused</strong>
					<strong v-else>Press Enter or Space to continue</strong>
					<button v-if="countdown && !countdownPaused" class="clear-link" @click="pauseCountdown">Pause countdown</button>
					<button v-else-if="countdownPaused" class="clear-link" @click="startCountdown">Resume countdown ({{ countdown }})</button>
				</div>
				<div class="paper-actions">
					<span>Paper</span>
					<button class="secondary" @click="emit('retract')">Retract</button>
					<button class="secondary" @click="emit('feed')">Feed</button>
				</div>
			</div>
			<footer class="print-dialog-footer">
				<button class="secondary" @click="emit('cancel')">Cancel queue</button>
				<button v-if="countdown && !countdownPaused" autofocus @click="continueQueue">Continue now ({{ countdown }})</button>
				<button v-else autofocus @click="continueQueue">Continue</button>
			</footer>
		</section>
	</div>
</template>

<style scoped>
.print-dialog {
	width: min(420px, calc(100vw - 32px));
	overflow: hidden;
}

.print-dialog-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	padding: 18px 20px 16px;
	border-bottom: 1px solid var(--sys-border);
	background: color-mix(in srgb, var(--sys-sidebar-bg) 72%, var(--sys-content-bg));
}

.print-dialog-header h2 {
	margin: 2px 0 0;
	font-size: 17px;
	letter-spacing: -0.2px;
}

.print-dialog-kicker {
	margin: 0;
	color: var(--sys-text-secondary);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.35px;
	text-transform: uppercase;
}

.print-dialog-body {
	padding: 18px 20px 20px;
}

.queue-progress {
	display: grid;
	gap: 9px;
}

.queue-progress > div:first-child {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	gap: 16px;
}

.queue-progress strong {
	font-size: 13px;
	font-weight: 600;
}

.queue-progress span {
	color: var(--sys-text-secondary);
	font-size: 12px;
	text-align: right;
}

.queue-progress-track {
	height: 4px;
	overflow: hidden;
	border-radius: 999px;
	background: var(--sys-border);
}

.queue-progress-track i {
	display: block;
	height: 100%;
	border-radius: inherit;
	background: var(--sys-accent);
	transition: width 0.2s ease;
}

.next-image {
	margin-top: 18px;
}

.next-image > span,
.paper-actions > span {
	display: block;
	margin-bottom: 7px;
	color: var(--sys-text-secondary);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.35px;
	text-transform: uppercase;
}

.next-image > div {
	display: grid;
	place-items: center;
	min-height: 96px;
	padding: 12px;
	border: 1px solid var(--sys-border);
	border-radius: 8px;
	background: var(--sys-sidebar-bg);
}

.next-image img {
	display: block;
	max-width: 100%;
	max-height: 150px;
	object-fit: contain;
	image-rendering: pixelated;
}

.continue-timing {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 14px;
	margin-top: 16px;
	padding: 10px 12px;
	border-radius: 7px;
	background: var(--sys-sidebar-bg);
}

.continue-timing strong {
	font-size: 12px;
	font-weight: 500;
}

.paper-actions {
	display: flex;
	align-items: center;
	gap: 7px;
	margin-top: 17px;
}

.paper-actions > span {
	margin: 0 auto 0 0;
}

.print-dialog-footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 14px 20px;
	border-top: 1px solid var(--sys-border);
	background: var(--sys-sidebar-bg);
}
</style>
