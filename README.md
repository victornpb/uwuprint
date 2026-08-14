# uwuPrint

uwuPrint is a Vue and Electron desktop driver for small BLE thermal printers.

## Development

```sh
npm install
AGENT=1 npm run dev
```

All application source and the Vite entrypoint live in `src/`: the Electron main process is in
`src/main/`, its preload bridge is in `src/preload/`, the Vue renderer is in
`src/renderer/`, and all printer hardware communication is in `src/hardware/`
(connections, device discovery, packet encoding, and flow control). App assets
are in `src/assets/`.

Useful commands:

- `AGENT=1 npm run build` builds the Vite renderer.
- `AGENT=1 npm run test` checks Node entrypoints and builds the renderer.
- `AGENT=1 npm start` builds and launches the production app.

Clipboard and dropped-image imports use the operating system temp directory
while they are queued. uwuPrint removes only its own matching temp files at
startup and shutdown; unrelated temp files are left untouched.

See [TODO.md](TODO.md) for known follow-up work.
