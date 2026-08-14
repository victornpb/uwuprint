<script setup>
defineProps({ preferences: { type: Object, required: true } });
const emit = defineEmits(['feed', 'retract']);
</script>
<template>
  <section class="paper-toolbar"><strong>Paper</strong><input v-model.number="preferences.printer.manualFeed" type="number" min="1" max="500" /><span>px</span><button class="secondary" @click="emit('retract')">Retract</button><button class="secondary" @click="emit('feed')">Feed</button></section>
</template>
