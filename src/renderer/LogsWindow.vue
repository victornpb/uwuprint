<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useTheme } from './composables/useTheme.js';

const state = reactive({ logs: [], showTimestamps: true, bluetoothLogging: false, levelFilter: 'all', scopeFilter: 'all', atBottom: true });
const logList = ref(null);
useTheme();
const levels = ['debug', 'log', 'info', 'warn', 'error'];
const scopes = computed(() => [...new Set(state.logs.map((entry) => entry.scope || entry.source).filter(Boolean))].sort());
const visibleLogs = computed(() => state.logs.filter((entry) =>
	(state.levelFilter === 'all' || entry.level === state.levelFilter) &&
	(state.scopeFilter === 'all' || (entry.scope || entry.source) === state.scopeFilter),
));

function scrollToTop() {
	if (!logList.value) return;
	logList.value.scrollTop = 0;
	state.atBottom = false;
}

function scrollToBottom() {
	if (!logList.value) return;
	logList.value.scrollTop = logList.value.scrollHeight;
	state.atBottom = true;
}

function handleScroll() {
	if (!logList.value) return;
	const distanceFromBottom = logList.value.scrollHeight - logList.value.scrollTop - logList.value.clientHeight;
	state.atBottom = distanceFromBottom <= 4;
}

async function setBluetoothLogging(enabled) {
	state.bluetoothLogging = (await window.desktop.setLogOptions({ bluetooth: enabled })).bluetooth;
}

onMounted(async () => {
	state.logs = await window.desktop.getLogs();
	state.bluetoothLogging = (await window.desktop.getLogOptions()).bluetooth;
	const updateLogs = (logs) => {
		const shouldStickToBottom = state.atBottom;
		state.logs = logs;
		void nextTick(() => {
			if (shouldStickToBottom) scrollToBottom();
		});
	};
	window.desktop.onLogs(updateLogs);
	window.desktop.onLogOptionsChanged((options) => {
		state.bluetoothLogging = options.bluetooth;
	});
	void nextTick(scrollToBottom);
});
</script>

<template>
	<main class="logs-window">
		<header class="logs-header">
			<div>
				<h1>Logs</h1>
				<p>Recent application activity</p>
			</div>
			<div class="log-controls">
				<label class="timestamp-toggle"><input v-model="state.showTimestamps" type="checkbox" /> Timestamps</label>
				<label class="timestamp-toggle"><input :checked="state.bluetoothLogging" type="checkbox" @change="setBluetoothLogging($event.target.checked)" /> Bluetooth communication</label>
				<select v-model="state.levelFilter" aria-label="Filter by level">
					<option value="all">All levels</option>
					<option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
				</select>
				<select v-model="state.scopeFilter" aria-label="Filter by scope">
					<option value="all">All scopes</option>
					<option v-for="scope in scopes" :key="scope" :value="scope">{{ scope }}</option>
				</select>
				<button class="secondary" type="button" :disabled="!visibleLogs.length" @click="scrollToTop">Top</button>
				<button class="secondary" type="button" :disabled="!visibleLogs.length" @click="scrollToBottom">Bottom</button>
				<span v-if="state.logs.length">{{ visibleLogs.length }} / {{ state.logs.length }}</span>
			</div>
		</header>
		<section v-if="state.logs.length" ref="logList" class="log-list" aria-live="polite" @scroll="handleScroll">
			<article v-for="(entry, index) in visibleLogs" :key="`${entry.timestamp}-${index}`" class="log-entry" :class="{ 'timestamps-hidden': !state.showTimestamps }">
				<time v-if="state.showTimestamps">{{ entry.timestamp }}</time>
				<strong :class="`log-${entry.level}`">{{ entry.level }}</strong>
				<span class="log-scope">{{ entry.scope || entry.source }}</span>
				<span class="log-source">{{ entry.source }}</span>
				<pre>{{ entry.message }}</pre>
			</article>
		</section>
		<p v-else class="empty-logs">No activity has been logged yet.</p>
	</main>
</template>

<style scoped>
.logs-window {
	height: 100vh;
	display: flex;
	flex-direction: column;
	background: var(--sys-content-bg);
	color: var(--sys-text-primary);
	user-select: text;
	-webkit-user-select: text;
}

.logs-header {
	padding: 16px 20px 14px;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	border-bottom: 1px solid var(--sys-border);
	background: var(--sys-sidebar-bg);
}

.log-controls {
	display: flex;
	align-items: center;
	gap: 8px;
}

.log-controls button {
	padding: 3px 8px;
	font-size: 11px;
}

.log-controls select {
	padding: 3px 5px;
	font-size: 11px;
}

.timestamp-toggle {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	margin-right: 4px;
	color: var(--sys-text-secondary);
	font-size: 11px;
	user-select: none;
}

h1 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

p,
.logs-header span {
	margin: 3px 0 0;
	color: var(--sys-text-secondary);
	font-size: 12px;
}

.log-list {
	flex: 1;
	overflow: auto;
	padding: 8px 0;
	font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.log-entry {
	display: grid;
	grid-template-columns: 82px 52px 70px 52px minmax(0, 1fr);
	gap: 10px;
	align-items: baseline;
	padding: 5px 20px;
	border-bottom: 1px solid color-mix(in srgb, var(--sys-border), transparent 45%);
	user-select: text;
}

.log-entry.timestamps-hidden {
	grid-template-columns: 52px 70px 52px minmax(0, 1fr);
}

time,
.log-source,
.log-scope {
	color: var(--sys-text-secondary);
}

strong {
	font-size: 10px;
	font-weight: 600;
	text-transform: uppercase;
}

.log-warn,
.log-error {
	color: var(--sys-status-danger);
}

.log-info,
.log-log,
.log-debug {
	color: var(--sys-accent);
}

pre {
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
}

.empty-logs {
	padding: 20px;
}
</style>
