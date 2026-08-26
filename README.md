# IFCnative

Werkzeugkasten rund um das native Erstellen, Ansehen und Bearbeiten von IFC-Modellen (STEP/SPF). Das Repository ist ein Monorepo: Jede App liegt in einem eigenen Root-Ordner mit eigenem `src/`, Build-Setup und `docs/`.

## Apps

| Ordner                              | App                        | Technologie                               | Beschreibung                                                                                                                                                                     |
| ----------------------------------- | -------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [editor/](editor/README.md)         | **IFCnative Editor 1.x**   | React 19, Vite, Tauri 2, ThatOpen/web-ifc | Haupt-App: Desktop-IFC-Builder und -Viewer mit Mosaic-Panes, Relationship-Graph, Psets/Katalog-Bearbeitung und NSIS-Installer.                                                   |
| [editor-2.0/](editor-2.0/README.md) | **Editor 2.0** (in Arbeit) | Tauri 2, Rust (ifc-lite), React           | Nachfolger-Generation, bestehend aus zwei Teil-Apps: `app/` (Tauri-Desktop-Client) und `hub/` (IFC-Hub-Server für Projekt-/Versionsverwaltung). Planungsdokumente unter `docs/`. |
| [native-windows/](native-windows/)  | **NativeWindows**          | .NET 10, Avalonia, xBIM                   | Nativer Windows-Desktop-Versuch: `src/` (App), `tests/` (Testrunner), `docs/` (Rewrite-Protokoll).                                                                               |
| [ifc-to-glb/](ifc-to-glb/README.md) | **ifc2glb**                | .NET 10, xBIM                             | CLI-Konverter IFC → GLB: `src/IfcToGlb.Core` (Bibliothek), `src/IfcToGlb.Cli` (Kommandozeile), `samples/` (Testmodelle).                                                         |
| [server/](server/README.md)         | **IFC-VCS-Server**         | Node.js/TypeScript                        | Versionskontroll-Server für IFC-Modelle (lokale Daten unter `.ifc-vcs-data/`).                                                                                                   |

## Schnellstart (Haupt-App)

```powershell
cd editor
npm install
npm run dev          # Vite-Dev-Server
npm run tauri:dev    # Desktop-App (Tauri)
npm run test:ifc     # Tests
```

Voraussetzungen: Node.js ≥ 22.13.0 sowie die [Tauri-Windows-Prerequisites](https://v2.tauri.app/start/prerequisites/) für Desktop-Builds.

## .NET-Apps bauen

```powershell
# NativeWindows-Tests
dotnet run --project native-windows/tests/IFCnative.NativeWindows.Tests.csproj

# ifc2glb
dotnet build ifc-to-glb/src/IfcToGlb.Cli/IfcToGlb.Cli.csproj -c Release
```

## CI

`.github/workflows/editor2-windows.yml` baut und testet Editor 2.0 (`editor-2.0/app` + `editor-2.0/hub`) bei Änderungen an diesen Pfaden.
