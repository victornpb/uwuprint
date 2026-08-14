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
		<section class="modal print-dialog">
			<h2>Ready for the next image?</h2>
			<p>
				Printed {{ queueIndex + 1 }} of {{ queueLength }}.
				<span v-if="countdown && !countdownPaused">Continuing in {{ countdown }} seconds.</span>
				<span v-else-if="countdownPaused">Countdown paused with {{ countdown }} seconds left.</span>
				<span v-else>Press Enter or Space to continue.</span>
			</p>
			<img v-if="nextPreview" class="next-preview" :src="nextPreview" alt="Next image preview" />
			<div class="job-motion">
				<button class="secondary" @click="emit('retract')">Retract</button>
				<button class="secondary" @click="emit('feed')">Feed</button>
			</div>
			<footer>
				<button class="secondary" @click="emit('cancel')">Cancel</button>
				<button v-if="countdown && !countdownPaused" class="secondary" @click="pauseCountdown">Pause
					countdown</button>
				<button v-else-if="countdownPaused" class="secondary" @click="startCountdown">Resume countdown ({{
					countdown }})</button>
				<button autofocus @click="continueQueue">{{ countdown && !countdownPaused ? `Continue now
					(${countdown})` : 'Continue' }}</button>
			</footer>
		</section>
	</div>
</template>
