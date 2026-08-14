<script setup>
defineProps({
	preferences: { type: Object, required: true },
	marginDisplay: { type: Function, required: true },
	setMargin: { type: Function, required: true },
});
const emit = defineEmits(['feed', 'retract', 'open-settings']);
</script>
<template>
  <section class="paper-toolbar"><strong>Paper</strong><input :value="marginDisplay('manualFeed')" @input="setMargin('manualFeed', $event)" type="number" min="1" max="500" /><button class="unit-link" @click="emit('open-settings')">{{ preferences.printer.marginUnits }}</button><button class="secondary" @click="emit('retract')">Retract</button><button class="secondary" @click="emit('feed')">Feed</button></section>
</template>
