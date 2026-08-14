import { onBeforeUnmount, onMounted } from 'vue';
import { loadPreferences } from '../settings.js';

export function useTheme() {
	const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

	function applyTheme() {
		const preference = loadPreferences().appearance.theme;
		const theme = preference === 'system'
			? systemTheme.matches ? 'dark' : 'light'
			: preference;
		document.documentElement.setAttribute('data-theme', theme);
	}

	onMounted(() => {
		applyTheme();
		systemTheme.addEventListener('change', applyTheme);
		window.addEventListener('storage', applyTheme);
	});
	onBeforeUnmount(() => {
		systemTheme.removeEventListener('change', applyTheme);
		window.removeEventListener('storage', applyTheme);
	});
}
