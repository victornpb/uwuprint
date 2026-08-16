import { createApp } from 'vue';
import App from './App.vue';
import DitherComparisonWindow from './DitherComparisonWindow.vue';
import LogsWindow from './LogsWindow.vue';
import './style.css';

const params = new URLSearchParams(window.location.search);
const isLogsWindow = params.has('logs');
const RootComponent = isLogsWindow
	? LogsWindow
	: params.has('dither-comparison')
	? DitherComparisonWindow
	: App;

if (!isLogsWindow) {
	for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
		const original = console[level];
		console[level] = (...args) => {
			const message = args.map((value) => value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
			window.desktop.writeLog(level, 'renderer', message);
			original(...args);
		};
	}
}
const app = createApp(RootComponent);

function showRendererError(error) {
	const message = error instanceof Error ? error.stack || error.message : String(error);
	console.error('Renderer failed to start:', error);
	const root = document.querySelector('#app');
	if (root && !root.childElementCount) {
		root.innerHTML = '<pre style="margin: 24px; white-space: pre-wrap; color: #b42318; font: 13px/1.5 ui-monospace, monospace;">UwuPrint failed to start.\n\n' + message.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character])) + '</pre>';
	}
}

app.config.errorHandler = showRendererError;
window.addEventListener('error', (event) => showRendererError(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => showRendererError(event.reason));

try {
	app.mount('#app');
} catch (error) {
	showRendererError(error);
}
