# TODO

## Code debt

- Split the remaining `src/renderer/App.vue` UI into focused queue, printer,
  preferences, and preview components. It still owns most of the application
  state and is harder to test or change safely than necessary.
- Add unit coverage for the printer protocol, dithering algorithms, image
  option validation, and BLE status parsing.
- Replace duplicated renderer/main-process image validation with a shared,
  typed boundary and a single validation path.
- Add explicit cleanup for the IPC listeners exposed by `src/preload/index.js`
  so renderer teardown does not retain callbacks.
- Verify packaging on macOS and Windows in CI, including the native `sharp`
  module and the relocated application icon.

## Product follow-up

- Decide whether the sample files currently kept in `tests/fixtures/` should be
  promoted into reproducible automated tests or removed from the repository.
