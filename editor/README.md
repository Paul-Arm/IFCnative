# IFCnative

Lightweight React/Vite IFC builder and viewer with Mosaic panes, React Flow relationship graphs, and ThatOpen/web-ifc loading.

## Commands

Run all commands from this folder (`editor/`). Use Node.js 22.13.0 or newer before installing dependencies.

```bash
npm install
npm run start
npm run build
npm run tauri:dev
npm run desktop:build
npm run desktop:dist
npm run desktop:installer
npm run test:ifc
```

The Windows desktop app uses Tauri 2 with the existing Vite renderer. Install the
[Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), then use
`npm run tauri:dev` for development. `npm run desktop:build` creates the unpackaged
Windows executable and `npm run desktop:dist` (or `desktop:installer`) creates an
NSIS installer under `src-tauri/target/release/bundle/nsis`.

## Updates und manuelle Releases

Die Desktop-App unterstützt Updates aus Azure Blob Storage mit Patchnotes,
Signaturprüfung und einer für sieben Tage ausblendbaren Benachrichtigung.
Die Einrichtung und den manuellen Upload beschreibt [docs/UPDATES.md](docs/UPDATES.md).
`npm run release:prepare` bereitet nach der Windows-Signierung den Upload vor.
