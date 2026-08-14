<script setup>
defineProps({
  appInfo: { type: Object, required: true },
  activeTab: { type: String, required: true },
  connected: { type: Boolean, required: true },
  deviceName: { type: String, default: '' },
  queueCount: { type: Number, required: true },
});
const emit = defineEmits(['select-tab', 'open-picker', 'open-preferences']);
</script>
<template>
  <header>
    <div><h1>{{ appInfo.name }}</h1><p>{{ appInfo.tagline }}</p></div>
    <nav class="workspace-tabs" aria-label="Workspace view">
      <button :class="{ active: activeTab === 'original' }" @click="emit('select-tab', 'original')">Original</button>
      <button :class="{ active: activeTab === 'preview' }" @click="emit('select-tab', 'preview')">Preview</button>
      <button v-if="queueCount > 1" :class="{ active: activeTab === 'preview-all' }" @click="emit('select-tab', 'preview-all')">Preview all</button>
    </nav>
    <div class="connection">
      <button class="connection-badge" title="Choose printer" @click="emit('open-picker')"><span :class="['dot', { connected }]" />{{ connected ? deviceName || 'Connected' : 'No printer' }}<span class="connection-chevron" aria-hidden="true" /></button>
      <button class="icon-button" title="Preferences" @click="emit('open-preferences')">⚙️</button>
    </div>
  </header>
</template>
