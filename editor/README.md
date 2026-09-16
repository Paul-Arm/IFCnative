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
Es erzeugt auch `patchnotes/index.json` für den aufklappbaren Versionsverlauf.

## Kürzlich verwendete Dateien

Im Desktop-Build verwendet die IFC-Auswahl den nativen Dateidialog und speichert
den vollständigen Pfad lokal. Ein Klick auf der Startseite öffnet die Datei
anschließend direkt, auch nach einem Neustart. Alte Einträge ohne Pfad müssen
einmal erneut ausgewählt werden. Verschobene oder gelöschte Dateien zeigen einen
Fehler. Im Web-Build bleibt die erneute Dateiauswahl erforderlich, weil der
Browser keinen freien Zugriff auf lokale Dateipfade erlaubt.

`npm run test:desktop` prüft Pfaderhalt, Abbruch, fehlende Dateien und die
Migration alter Einträge.

## Fehlerberichte, Installationen und Updates mit Sentry

Die optionale Desktop-Telemetrie läuft auf einem Rust-Worker; im Web-Build läuft
das Sentry-SDK in einem Web Worker. Offline werden Berichte still verworfen.
Desktop-Updates erscheinen unter **Explore → Metrics → `editor.update`** mit Nutzername,
Quell-/Zielversion und Status; `completed` bestätigt den Start der installierten Zielversion.
**`editor.install`** erfasst den ersten bekannten Online-Start je Windows-Benutzerprofil
mit Nutzername und dauerhafter Installations-ID. Fehlgeschlagene Registrierungen werden
beim nächsten Start oder Wiederverbinden erneut versucht.
Projektvorlagen, DSN-Variablen, Datenumfang und Tests: [docs/SENTRY.md](docs/SENTRY.md).
