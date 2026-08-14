import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

const app = createApp(App);

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
