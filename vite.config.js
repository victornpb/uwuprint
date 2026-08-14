const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
	root: 'src',
	base: './',
	plugins: [vue()],
	build: { outDir: '../dist', emptyOutDir: true },
});
