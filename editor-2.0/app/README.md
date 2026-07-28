# IFCnative Editor 2.0 — App

Tauri-v2-Desktop-App (Windows) mit React/Vite-Frontend auf ifc-lite-Basis.
Stand gemäß [`../04-roadmap.md`](../04-roadmap.md): **M0–M6 umgesetzt, M7
(Politur & Release) in Arbeit.**

Nutzerdokumentation: [`../docs/handbuch.md`](../docs/handbuch.md) — alle
Funktionen mit den echten UI-Beschriftungen.

## Umfang

| Meilenstein | Was in dieser Codebasis steht |
| --- | --- |
| M0 | Durchstich: Parser-/Export-Roundtrip (`@ifc-lite/parser`, `@ifc-lite/mutations`, `@ifc-lite/export`), WebGPU-Viewer, NSIS-Installer mit Dateiverknüpfungen, Single-Instance + Explorer-Doppelklick, nativer Geometrie-Fast-Path im Tauri-Backend (`ifc-lite-processing`, Rayon) |
| M1 | Mosaic-Shell mit Workspaces, Multi-Dokument-Tabs, Statusleiste, Theme/UI-Zoom, Strukturbaum, Inspector (lesend), Beziehungsgraph, Viewer-Werkzeuge (Isolieren, X-Ray, Schnitt, Ansichten), Lens |
| M2 | Command-Pipeline (Undo/Redo, Audit-Log, Export-Guard), Inspector schreibend, Beziehungs-Editing im Graph, Löschung mit Kaskadenplan |
| M3 | Pset-Batch-Matrix mit Vorschau und CSV-Roundtrip, abfragebasierte Auswahl, Objektkatalog (openSIM-Import, Prüfung, Quick-Fixes, Katalog→IDS), Listen-Pane |
| M4 | Baukasten (Bauteile mit Extrusionskörper, Maßänderung, Verschieben, Öffnungen), Viewer-Neuberechnung mit Änderungs-Badge, Inspector-Modus „Platzierung" |
| M5 | Prüfzentrum: Modell-Diagnostik, Objektinfo-IDs, IDS-Prüfung, Kollisionen, gemeinsame Findings-UI, 3D-Markierung, BCF-Export |
| M6 | IFC-Hub: Dienst unter [`../hub`](../hub) (Projekte → Modelle → Versionen, content-addressed Blobs, REST-API) plus Hub-Pane mit „Stand sichern"/„Öffnen" und Versions-Diff |
| M7 | in Arbeit — Erststart-Hinweis „Standardprogramm" (E11), Auto-Update vorbereitet und deaktiviert (E12), Handbuch; Export-/2D-Themen laufen parallel |

Offene Punkte je Meilenstein stehen in den Statusnotizen der Roadmap; Befunde
und Entscheidungen in
[`../05-risiken-entscheidungen.md`](../05-risiken-entscheidungen.md).

## Befehle

### App

```bash
npm install
npm run dev          # Browser-Modus (http://127.0.0.1:5273)
npm test             # Vitest: Domäne, Commands, Roundtrips (tests/m0 … m6)
npm run build        # Typprüfung + Produktions-Build des Frontends
npm run lint         # ESLint
npm run tauri dev    # Desktop-Shell (benötigt Rust; Linux: webkit2gtk)
npm run tauri build  # Windows: NSIS-Installer
```

### Hub-Dienst

Die App ist nur Client; der Hub läuft als eigener Prozess (noch nicht als
Tauri-Sidecar verdrahtet):

```bash
cd ../hub
npm install
npm start            # http://127.0.0.1:8711
npm test             # Vitest: Service-, Diff- und HTTP-Ebene
```

Einstellungen (`HUB_PORT`, `HUB_HOST`, `HUB_DATA_DIR`, `HUB_TOKEN`) und die
HTTP-API stehen in [`../hub/README.md`](../hub/README.md).

## CI

`.github/workflows/editor2-windows.yml` hat zwei Jobs:

- **Hub-Tests (Linux)** — `npm ci && npm test` in `editor-2.0/hub`; ohne native
  Abhängigkeiten und deshalb schnell.
- **App-Tests + NSIS-Installer (Windows)** — Tests, `npm run tauri build`, die
  Installergröße im Job-Summary und der Installer als Artefakt
  (`ifcnative-editor-2.0-windows`).

Der Windows-Runner ist Pflicht: Linux-Container bringen die GTK/WebKit-
Abhängigkeiten der Tauri-Shell nicht mit, `cargo`-Builds sind dort nicht
möglich.

## Release-Themen

### Erststart-Hinweis „Standardprogramm" (E11) — aktiv

`src/shell/FirstRunHint.tsx` zeigt beim ersten Start der Desktop-App eine
schließbare Leiste mit dem Hinweis auf die Windows-Einstellungen. „Einstellungen
öffnen" ruft den Tauri-Command `open_default_apps_settings`
(`src-tauri/src/lib.rs`), der unter Windows `ms-settings:defaultapps` öffnet
(auf anderen Betriebssystemen ein No-op, `Ok(false)`). Bewusst **kein** Setzen
der Zuordnung: Windows schützt sie über den UserChoice-Hash, ein Erzwingen
würde zurückgesetzt. Das Flag liegt über `src/core/storage.ts` im localStorage
(`ifcnative2:firstRunHint.dismissed`); im Browser-Modus erscheint die Leiste
nicht.

### Auto-Update (E12) — vorbereitet, inaktiv

Im Build steckt **keine** Update-Logik. Vorbereitet sind nur Konfiguration und
Anleitung, weil Signierung und Zertifikat zurückgestellt sind:

- `src-tauri/tauri.conf.json`: Block `plugins["updater-deaktiviert"]` mit
  Platzhalter-Endpoint (GitHub-Releases `latest.json`), Platzhalter-`pubkey`
  und `windows.installMode`. JSON kennt keine Kommentare — der Block steht
  deshalb unter einem Schlüssel, den kein Plugin liest, und bleibt wirkungslos.
- `src-tauri/Cargo.toml`: `tauri-plugin-updater` als auskommentierte Zeile.

Aktivieren, sobald die Signierung freigegeben ist:

1. `npm run tauri signer generate` — privaten Schlüssel als Secret hinterlegen
   (`TAURI_SIGNING_PRIVATE_KEY`, ggf. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`),
   öffentlichen Schlüssel notieren.
2. In `tauri.conf.json` den Block `updater-deaktiviert` in `updater`
   umbenennen, die Hilfsschlüssel `aktiv`/`hinweis` entfernen, echten `pubkey`
   und echten Endpoint eintragen.
3. In `Cargo.toml` `tauri-plugin-updater = "2"` einkommentieren und in
   `src-tauri/src/lib.rs`
   `.plugin(tauri_plugin_updater::Builder::new().build())` ergänzen.
4. `updater:default` in `src-tauri/capabilities/default.json` nachtragen und
   im Frontend den Update-Aufruf ergänzen (Prüfung, Rückfrage, Neustart).
5. Release-Job so erweitern, dass er signierte Artefakte und die passende
   `latest.json` an den Endpoint veröffentlicht.

Ohne echten Schlüssel darf der Updater nicht laufen: Ein Update-Kanal ohne
Signaturprüfung ist ein Einfallstor.

### Code-Signing des Installers (E12)

Der NSIS-Installer wird unsigniert gebaut — beim ersten Start warnt SmartScreen
vor einem unbekannten Herausgeber. Das Zertifikat liegt vor, der Einsatz ist
zurückgestellt. MSI/WiX ist Backlog (E13).

## Struktur

```
src/
  core/session.ts   # Modell-Sitzung: Parser + Mutations-Overlay + STEP-Export
  core/viewer.ts    # WebGPU-Viewer (Streaming) mit R1-Fallback
  core/storage.ts   # localStorage-Persistenz (UI-Zustand, Flags)
  core/tauri.ts     # Brücke zur Shell (globales __TAURI__, keine npm-Abhängigkeit)
  shell/            # AppShell, Kopfzeile, Tabs, Statusleiste, Erststart-Hinweis
  panes/            # ein Verzeichnis je Pane; ids.ts + registry.tsx als Register
  commands/         # Command-Pipeline (Undo/Redo, Audit-Log)
  domain/           # Fachlogik: catalog, checks, geometry, hub, export
  store/            # zustand-Slices: documents, selection, ui
src-tauri/
  src/lib.rs        # Commands: Datei-IO, frontend_ready,
                    #   open_default_apps_settings, get_geometry(_from_path)
  tauri.conf.json   # NSIS, fileAssociations, withGlobalTauri, Updater-Vorlage (inaktiv)
  capabilities/     # Berechtigungen (core + dialog)
tests/              # Vitest je Meilenstein (m0-durchstich … m6-pruefung)
```
