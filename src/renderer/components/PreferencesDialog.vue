<script setup>
defineProps({
	preferences: { type: Object, required: true },
	appInfo: { type: Object, required: true },
	activeTab: { type: String, required: true },
	printerStatus: { type: Object, required: true },
	rememberedDevices: { type: Array, required: true },
	marginDisplay: { type: Function, required: true },
});

defineEmits(['close', 'update:activeTab', 'set-margin', 'feed', 'retract', 'forget-device']);
</script>

<template>
	<div class="modal-backdrop" @click.self="$emit('close')">
		<section class="modal preferences-modal">
			<div class="preferences-header"><h2>Preferences</h2><button class="icon-button" @click="$emit('close')">×</button></div>
			<div class="preferences-body">
				<aside class="preferences-sidebar">
					<button :class="{ active: activeTab === 'general' }" @click="$emit('update:activeTab', 'general')">⚙️ General</button>
					<button :class="{ active: activeTab === 'layout' }" @click="$emit('update:activeTab', 'layout')">📄 Print preferences</button>
					<button :class="{ active: activeTab === 'connection' }" @click="$emit('update:activeTab', 'connection')">📶 Connection</button>
					<button :class="{ active: activeTab === 'devices' }" @click="$emit('update:activeTab', 'devices')">🖨 Devices</button>
					<button :class="{ active: activeTab === 'notifications' }" @click="$emit('update:activeTab', 'notifications')">🔔 Notifications</button>
				</aside>
				<main class="preferences-content">
					<template v-if="activeTab === 'general'">
						<section class="settings-section"><div class="section-heading"><h3>General</h3><p>Choose the application theme.</p></div>
							<label class="setting-field"><span><strong>Theme</strong><small>Select light, dark, or follow system setting.</small></span><select v-model="preferences.appearance.theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
							<label class="setting-field"><span><strong>Margin units</strong><small>Choose how margin values are displayed.</small></span><select v-model="preferences.printer.marginUnits"><option value="px">Pixels</option><option value="mm">Millimetres</option></select></label>
							<label v-if="appInfo.isMacOS" class="toggle-row"><span><strong>Quit when the window is closed</strong><small>Quit the app instead of keeping it open in the Dock when you close the window.</small></span><input v-model="preferences.application.quitOnWindowClose" type="checkbox" /></label>
						</section>
					</template>
					<template v-else-if="activeTab === 'layout'">
						<section class="settings-section"><div class="section-heading"><h3>Print quality</h3><p>Balance darkness, detail, and printhead heat.</p></div>
							<label class="setting-field"><span><strong>Print Intensity</strong><small>Controls the printer’s dot intensity.</small></span><select v-model.number="preferences.printer.quality"><option :value="1">1 · Lightest</option><option :value="2">2 · Light</option><option :value="3">3 · Medium</option><option :value="4">4 · Dark</option><option :value="5">5 · Darkest</option></select></label>
						</section>
						<section class="settings-section"><div class="section-heading"><h3>Paper movement</h3></div>
							<label class="setting-field"><span><strong>Print orientation</strong><small>Choose the direction in which image rows are sent to the printer.</small></span><select v-model="preferences.printer.orientation"><option value="top-to-bottom">Top to bottom</option><option value="bottom-to-top">Bottom to top</option></select></label>
							<div class="setting-field margin-field-group"><span><strong>Print margins</strong><small>Feed paper before and after the image</small></span><div class="margin-field-rows">
								<label class="margin-inner-row"><span class="checkbox-label"><input v-model="preferences.printer.marginTopEnabled" type="checkbox" /> Top</span><div class="margin-input"><input :value="marginDisplay('marginTop')" @input="$emit('set-margin', 'marginTop', $event)" type="number" min="0" max="500" /><em>{{ preferences.printer.marginUnits }}</em></div></label>
								<label class="margin-inner-row"><span class="checkbox-label"><input v-model="preferences.printer.marginBottomEnabled" type="checkbox" /> Bottom</span><div class="margin-input"><input :value="marginDisplay('marginBottom')" @input="$emit('set-margin', 'marginBottom', $event)" type="number" min="0" max="500" /><em>{{ preferences.printer.marginUnits }}</em></div></label>
							</div></div>
							<label class="setting-field"><span><strong>Between pages</strong><small>Feed this amount between queued images.</small></span><div class="margin-input"><input :value="marginDisplay('marginBetween')" @input="$emit('set-margin', 'marginBetween', $event)" type="number" min="0" max="500" aria-label="Between pages margin" /><em>{{ preferences.printer.marginUnits }}</em></div></label>
							<div class="setting-field"><span><strong>Move amount</strong><small>Pixels to feed forward or retract backward.</small></span><div class="inline-control"><input v-model.number="preferences.printer.manualFeed" type="number" min="1" max="500" /><button class="secondary" @click="$emit('retract')">Retract</button><button class="secondary" @click="$emit('feed')">Feed</button></div></div>
						</section>
						<section class="settings-section"><div class="section-heading"><h3>Queue settings</h3></div><label class="setting-field"><span><strong>Print order</strong><small>Choose whether queued items print from first to last or last to first.</small></span><select v-model="preferences.queue.order"><option value="first-to-last">First to last</option><option value="last-to-first">Last to first</option></select></label><label class="toggle-row"><span><strong>Pause countdown on mouse movement</strong><small>Pause auto-continue after the pointer moves more than 10px.</small></span><input v-model="preferences.queue.cancelCountdownOnMouseMove" type="checkbox" /></label></section>
					</template>
					<template v-else-if="activeTab === 'connection'">
						<section class="settings-section"><div class="section-heading"><h3>Disconnect</h3><p>Manage connection lifecycle.</p></div>
							<label class="setting-field"><span><strong>Disconnect after printing</strong><small>Automatically disconnect after the most recent print.</small></span><select v-model.number="preferences.advanced.disconnectAfter"><option :value="0">Never</option><option :value="30">30 seconds</option><option :value="60">1 minute</option><option :value="300">5 minutes (default)</option><option :value="900">15 minutes</option></select></label>
							<label class="setting-field"><span><strong>Remembered-printer timeout</strong><small>How long Print searches before opening the device list.</small></span><select v-model.number="preferences.advanced.connectTimeout"><option :value="5">5 seconds</option><option :value="10">10 seconds</option><option :value="15">15 seconds (default)</option><option :value="30">30 seconds</option><option :value="60">1 minute</option></select></label>
						</section>
						<section class="settings-section"><div class="section-heading"><h3>Connection tuning</h3></div><label class="setting-field"><span><strong>Packet delay</strong><small>Pause between Bluetooth chunks. Increase it if prints are incomplete or scrambled.</small></span><div class="inline-control"><input v-model.number="preferences.advanced.chunkDelay" type="number" min="0" max="500" /><span class="unit">ms</span></div></label></section>
					</template>
					<template v-else-if="activeTab === 'devices'">
						<section class="settings-section"><div class="section-heading"><h3>Remembered printers</h3><p>Clicking Print searches these printers first.</p></div><p v-if="!rememberedDevices.length" class="muted">No printers remembered yet.</p><div v-for="name in rememberedDevices" :key="name" class="setting-field"><strong>{{ name }}</strong><button class="clear-link" @click="$emit('forget-device', name)">Forget</button></div></section>
					</template>
					<template v-else-if="activeTab === 'notifications'">
						<section class="settings-section"><div class="section-heading"><h3>Notifications</h3><p>Choose which printer events you want to be notified</p></div><label class="toggle-row"><span><strong>Notifications</strong><small>Turn on or off all system notifications</small></span><input v-model="preferences.notifications.enabled" type="checkbox" /></label><div :class="['notification-options', { disabled: !preferences.notifications.enabled }]"><label v-for="[key, label] in [['lowBattery', 'Low battery'], ['paper', 'Out of paper'], ['lid', 'Lid open'], ['temperature', 'Printer too hot'], ['printComplete', 'Print complete']]" :key="key" class="toggle-row"><span>{{ label }}</span><input v-model="preferences.notifications[key]" :disabled="!preferences.notifications.enabled" type="checkbox" /></label></div></section>
					</template>
				</main>
			</div>
		</section>
	</div>
</template>
