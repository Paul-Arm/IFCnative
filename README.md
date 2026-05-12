# IFCnative

Lightweight React/Vite IFC builder and viewer with Mosaic panes, React Flow relationship graphs, and ThatOpen/web-ifc loading.

## Commands

Use Node.js 22.13.0 or newer before installing dependencies.

```bash
npm install
npm run start
npm run build
npm run electron:dev
npm run desktop:pack
npm run desktop:dist
npm run desktop:installer
npm run test:ifc
```

The dev server uses Vite, not Expo or Metro.

Electron desktop builds use the existing Vite renderer. `npm run electron:dev` starts Vite and opens the desktop shell, `npm run desktop:pack` creates an unpacked app under `release/electron`, `npm run desktop:dist` creates a Windows zip bundle, and `npm run desktop:installer` creates an NSIS installer when the local Windows/electron-builder cache supports it.
