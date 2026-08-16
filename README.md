<div align="center">
  <img src="src/assets/app-icon.png" alt="uwuPrint icon" width="96">
  <h1>uwuPrint</h1>
  <p>Print images in one click to Bluetooth thermal cat printers.</p>
  <p>
    <a href="https://github.com/victornpb/uwuprint/releases">Download for macOS</a> ·
    <a href="https://github.com/victornpb/uwuprint/releases">Download for Windows</a> ·
    <a href="https://github.com/victornpb/uwuprint/releases">Download for Linux</a>
  </p>
</div>

<p align="center">
  <img src="docs/main.png" alt="uwuPrint image queue, thermal print preview, and image controls" width="920">
</p>

uwuPrint is a cross-platform desktop application for Bluetooth thermal printers. It turns images into the printer's monochromatic format, lets you adjust the result, and sends it to the printer with a single action.


### File Explorer and Finder Integration

Send one or multiple images directly from macOS Finder Quick Actions or the Windows Explorer context menu.

<p align="center">
  <img src="docs/finder-and-explorer-integration.png" alt="The uwuPrint print action in the Finder Quick Actions menu" width="760">
</p>

### Dithering options

Compare different algorithms side by side to choose the right look for sharp text, illustrations, or photos.

<p align="center">
  <img src="docs/dither-algorithms.png" alt="Comparison view of multiple dithering algorithms supported in uwuPrint" width="760">
</p>

### Other Features

- **Print Preview**: Converts images to the printer's 384-pixel format to preview the exact output before printing.
- **Image Adjustments**: Controls for contrast, brightness, and sharpening. Includes multiple dithering algorithms with a comparison view, image inversion, and level normalization.
- **Queued Printing**: Queue multiple images, set print margins, adjust spacing between prints, and specify the number of copies. Includes manual paper feed and retract controls.
- **Supported Formats**: PNG, JPEG, WebP, GIF, TIFF, and BMP. Support for drag-and-drop and pasting from the clipboard.
- **Light / Dark mode**: Choose your prefered theme for the App UI.

## Preferences

Configure the application and printer defaults, print direction; feed margins and units; between-page spacing; and print intensity.

<p align="center">
  <img src="docs/print-preferences.png" alt="uwuPrint print preferences" width="48%">
  <img src="docs/dark-and-light-theme.png" alt="uwuPrint general preferences with theme and integration settings" width="48%">
</p>

## Download

Get the latest packages from [GitHub Releases](https://github.com/victornpb/uwuprint/releases).

| Platform | Packages |
| --- | --- |
| [macOS](https://github.com/victornpb/uwuprint/releases) | DMG and ZIP |
| [Windows](https://github.com/victornpb/uwuprint/releases) | Installer and portable EXE |
| [Linux](https://github.com/victornpb/uwuprint/releases) | AppImage and DEB |

## Compatibility

uwuPrint discovers nearby compatible Bluetooth thermal printers and displays connection status, paper presence, lid status, temperature, battery level, and transfer progress.

| Model | Status |
| --- | --- |
| `GB01` | ❓ Untested |
| `GB02` | ❓ Untested |
| `GB03` | ❓ Untested |
| `GT01` | ❓ Untested |
| `MX05` | ❓ Untested |
| `MX06` | ✅ Tested |
| `MX08` | ❓ Untested |
| `MX09` | ❓ Untested |
| `YT01` | ❓ Untested |
| `_ZZ00` | ❓ Untested |

Have another model? Please [report your results in the compatibility issue](https://github.com/victornpb/uwuprint/issues/1) so we can expand this list.

<p align="center">
  <img src="docs/real-photo.jpg" alt="A Bluetooth thermal printer printing an image with uwuPrint" width="560">
</p>

## Build from source

This repository contains the Electron and Vue application.

```sh
npm install
AGENT=1 npm run dev
```

Useful commands:

```sh
AGENT=1 npm run test        # Check entrypoints and build the renderer
AGENT=1 npm start           # Build and launch the production app
AGENT=1 npm run make:mac    # Package macOS as DMG
AGENT=1 npm run make:win    # Package Windows as installer and portable EXE
AGENT=1 npm run make:linux  # Package Linux as AppImage and DEB
AGENT=1 npm run make        # Package macOS, Windows, and Linux
```

## License

This project is currently distributed as an unlicensed, private-use application.
