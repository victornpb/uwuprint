<script setup>
defineProps({
	connected: { type: Boolean, required: true },
	deviceName: { type: String, default: '' },
	supportedDevices: { type: Array, required: true },
	otherDevices: { type: Array, required: true },
	showOtherDevices: { type: Boolean, required: true },
	isRemembered: { type: Function, required: true },
});

defineEmits(['close', 'disconnect', 'select-device', 'toggle-other-devices', 'remember-device']);
</script>

<template>
	<div class="modal-backdrop" @click.self="$emit('close')">
		<section class="modal">
			<div class="modal-header">
				<div>
					<h2>Connect a printer</h2>
					<p>Nearby Bluetooth devices appear as they are discovered.</p>
				</div>
				<button class="icon-button" @click="$emit('close')">×</button>
			</div>
			<button v-if="connected" class="secondary picker-disconnect" @click="$emit('disconnect')">
				Disconnect {{ deviceName || 'printer' }}
			</button>
			<div class="device-section">
				<h3>Supported printers <em>{{ supportedDevices.length }}</em></h3>
				<button v-for="device in supportedDevices" :key="device.id" :disabled="device.connecting"
					:class="['device-row', { connecting: device.connecting }]" @click="$emit('select-device', device)">
					<span><strong>{{ device.name }}</strong><small>MX/GB/GT compatible · {{ device.id.slice(-6)
							}}</small></span>
					<span class="remember-device" @click.stop><input :checked="isRemembered(device.name)"
							type="checkbox" @change="$emit('remember-device', device.name, $event.target.checked)" />
						Remember</span>
					<span><i v-if="device.connecting" class="spinner" />{{ device.connecting ? 'Connecting…' : 'Connect'
						}}</span>
				</button>
				<p v-if="!supportedDevices.length" class="muted">Searching for MX06 and compatible printers…</p>
			</div>
			<div class="device-section">
				<button class="section-toggle" @click="$emit('toggle-other-devices')">
					<span>Other Bluetooth devices <em>{{ otherDevices.length }}</em></span><span>{{ showOtherDevices ?
						'⌃' : '⌄' }}</span>
				</button>
				<template v-if="showOtherDevices">
					<button v-for="device in otherDevices" :key="device.id" :disabled="device.connecting"
						:class="['device-row', { connecting: device.connecting }]"
						@click="$emit('select-device', device)">
						<span><strong>{{ device.name }}</strong><small>Bluetooth LE · {{ device.id.slice(-6)
								}}</small></span>
						<span><i v-if="device.connecting" class="spinner" />{{ device.connecting ? 'Connecting…' :
							'Connect' }}</span>
					</button>
					<p v-if="!otherDevices.length" class="muted">No other devices found yet.</p>
				</template>
			</div>
		</section>
	</div>
</template>
