import { onBeforeUnmount, ref, watch } from 'vue';
import {
	loadPreferences,
	loadRememberedDevices,
	normalizedPrinterName,
	savePreferences,
	saveRememberedDevices,
} from '../settings.js';

const PIXELS_PER_MM = 8;

export function usePreferences() {
	const preferences = ref(loadPreferences());
	const rememberedDevices = ref(loadRememberedDevices());
	const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

	function applyTheme() {
		const preference = preferences.value.appearance.theme;
		const theme = preference === 'system'
			? systemTheme.matches ? 'dark' : 'light'
			: preference;
		document.documentElement.setAttribute('data-theme', theme);
	}

	function isRemembered(name) {
		return rememberedDevices.value.includes(normalizedPrinterName(name));
	}

	function setRemembered(name, remember) {
		const normalizedName = normalizedPrinterName(name);
		rememberedDevices.value = remember
			? [...new Set([...rememberedDevices.value, normalizedName])]
			: rememberedDevices.value.filter((item) => item !== normalizedName);
		saveRememberedDevices(rememberedDevices.value);
	}

	function marginDisplay(key) {
		const value = Number(preferences.value.printer[key]) || 0;
		return preferences.value.printer.marginUnits === 'mm'
			? Number((value / PIXELS_PER_MM).toFixed(1))
			: value;
	}

	function setMargin(key, event) {
		const value = Math.max(0, Number(event.target.value) || 0);
		preferences.value.printer[key] = Math.round(
			preferences.value.printer.marginUnits === 'mm' ? value * PIXELS_PER_MM : value,
		);
	}

	watch(preferences, (value) => {
		savePreferences(value);
		window.desktop.setQuitOnWindowClose(value.application.quitOnWindowClose);
	}, { deep: true, immediate: true });
	watch(() => preferences.value.appearance.theme, applyTheme, { immediate: true });
	systemTheme.addEventListener('change', applyTheme);
	onBeforeUnmount(() => systemTheme.removeEventListener('change', applyTheme));

	return { preferences, rememberedDevices, isRemembered, setRemembered, marginDisplay, setMargin };
}
