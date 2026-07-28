# IFCnative Editor 2.0 — App (M0-Durchstich)

Tauri-v2-Desktop-App (Windows) mit React/Vite-Frontend auf ifc-lite-Basis. Stand: **M0** gemäß [`../04-roadmap.md`](../04-roadmap.md).

## Was der M0-Stand kann

- IFC öffnen (Datei-Dialog im Browser-Modus; in der Desktop-Shell zusätzlich Explorer-Doppelklick, „Öffnen mit" und Zweitinstanz-Weiterleitung über Single-Instance).
- Parsen über `@ifc-lite/parser` (kolumnar, Off-Main-Thread-fähig), Modellinfo + Typliste + Entity-Liste.
- Property Sets ansehen und Werte editieren (`@ifc-lite/mutations`-Overlay, Commit-on-blur).
- Export als STEP mit angewendeten Mutationen (`@ifc-lite/export`); Desktop: nativer Speichern-Dialog.
- 3D-Ansicht über `@ifc-lite/renderer` (WebGPU, Streaming-Batches) mit sauberem Fallback-Hinweis ohne WebGPU (R1).
- Tauri-Backend: nativer ifc-lite-Fast-Path (`get_geometry`/`get_geometry_from_path` über `ifc-lite-processing`, Rayon) im Antwortformat der `NativeBridge` von `@ifc-lite/geometry`.
- NSIS-Installer-Konfiguration mit Dateiverknüpfungen `.ifc`/`.ifczip`/`.ifcx`/`.ids`/`.bcf` (Standardprogramm-Registrierung, E11); Signierung vorbereitet, aber deaktiviert (E12).

## Befehle

```bash
npm install
npm run dev          # Browser-Modus (http://127.0.0.1:5273)
npm test             # M0-Verifikationstests (Roundtrip, R2, R3)
npm run build        # Typprüfung + Produktions-Build des Frontends
npm run tauri dev    # Desktop-Shell (benötigt Rust; Linux: webkit2gtk)
npm run tauri build  # Windows: NSIS-Installer
```

Der Windows-Installer wird über die GitHub-Action `Editor 2.0 Windows-Build` (`.github/workflows/editor2-windows.yml`) gebaut, da Linux-Container die GTK/WebKit-Abhängigkeiten der Tauri-Shell nicht mitbringen.

## Struktur

```
src/
  core/session.ts   # Modell-Sitzung: Parser + Mutations-Overlay + STEP-Export
  core/viewer.ts    # WebGPU-Viewer (Streaming) mit R1-Fallback
  core/tauri.ts     # Brücke zur Shell (globales __TAURI__, keine npm-Abhängigkeit)
  App.tsx           # M0-Oberfläche (Modell / Entities / Eigenschaften / 3D)
src-tauri/
  src/lib.rs        # Commands: Datei-IO, frontend_ready, get_geometry(_from_path)
  tauri.conf.json   # NSIS, fileAssociations, withGlobalTauri
  capabilities/     # Berechtigungen (core + dialog)
tests/
  m0-durchstich.test.ts  # Erzeugen/Roundtrip/R2/R3/GUID-Stabilität
```

Die M1-Ausbaustufe (Mosaic-Panes, Workspaces, Strukturbaum, Graph, Lens) ersetzt die bewusst schlichte M0-Oberfläche; siehe [`../04-roadmap.md`](../04-roadmap.md).
