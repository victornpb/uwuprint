<script setup>
defineProps({ preferences: { type: Object, required: true }, connected: { type: Boolean, required: true } });
const emit = defineEmits(['feed', 'retract']);
</script>
<template>
  <section class="paper-toolbar"><strong>Paper</strong><input v-model.number="preferences.printer.manualFeed" type="number" min="1" max="500" /><span>px</span><button class="secondary" :disabled="!connected" @click="emit('retract')">Retract</button><button class="secondary" :disabled="!connected" @click="emit('feed')">Feed</button></section>
</template>
