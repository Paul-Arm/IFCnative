# IFC native Editor 2.0 — Planung

Ziel: eine 2.0-Version des nativen IFC-Editors als **Windows-Desktop-App auf Basis von Tauri v2**, die fachlich den Funktionsumfang des bestehenden React-IFC-Viewers/-Editors (`/src`) übernimmt und technisch auf **[ifc-lite](https://github.com/LTplus-AG/ifc-lite)** (LTplus AG / Louis Trümpler, MPL-2.0) aufsetzt — sowohl auf dessen **Rust/WASM-Kern samt WebGPU-Renderer** als auch auf dessen **Rust-Server**.

Der bestehende React-Viewer bleibt unangetastet; dieser Ordner ist die Planungs- und spätere Projektwurzel für den 2.0-Editor (analog zu `NativeWindows/` für den Avalonia-Versuch).

## Leitplanken

1. **Funktionsreferenz ist der React-Viewer** (`/src`) — nicht die Avalonia-App und nicht die aspirationalen Scope-Dokumente. Was der React-Viewer heute kann, muss 2.0 können (Paritätsmatrix in [`02-funktionsparitaet.md`](./02-funktionsparitaet.md)).
2. **Schwerpunkt-Features** (explizit gefordert):
   - Batch-Bearbeitung von Property Sets (Psets)
   - Geometrie erstellen **und** bearbeiten
   - Einbindung des Objektkatalogs (openSIM BWD/MON, xlsx)
   - IFC-Prüfung (Modell-Diagnostik, Objektkatalog-Prüfung, Objektinfo-IDs, **IDS**)
   - **alle Features von ifc-lite** verfügbar machen (Übernahmetabelle in [`03-kernfeatures.md`](./03-kernfeatures.md))
3. **Zielplattform Windows via Tauri v2.** Der ifc-lite-Rust-Kern läuft dabei **nativ** (nicht als WASM) über das dokumentierte Platform-Bridge-Muster: Rayon-Parallelität, kein 4-GB-WASM-Limit, direkter Dateizugriff — ausgelegt auf 500-MB+-Modelle.
4. **Lokal zuerst.** Die App funktioniert vollständig offline; der ifc-lite-Server und der bestehende Versionierungs-Server (`/server`) sind optionale Team-/Cloud-Bausteine.
5. **Deutschsprachige UI**, gleiche Bedienphilosophie wie 1.x (Mosaic-Panes, Workspaces, Undo/Redo mit benannten Operationen).

## Warum ifc-lite als Basis

| Bedarf 2.0 | ifc-lite liefert |
| --- | --- |
| Große IFCs schnell öffnen | Rust-Parser (~1,2 GB/s Tokenizing), Streaming-Rendering: erste Dreiecke während des Parsens |
| Rendering | WebGPU-Renderer mit Batching, Sectioning, Isolation, X-Ray, Heatmaps |
| Editieren | Mutations-API (Psets, Mengen, Attribute, positionale STEP-Argumente, Entities anlegen/löschen) mit Undo/Redo und Overlay-Modell |
| Batch-Edit | `BulkQueryEngine` (Mehrfach-Updates mit Preview), `CsvConnector`, `ChangeSetManager` |
| Geometrie erzeugen | `@ifc-lite/create` + Element-Builder (`addWallToStore`, `addColumnToStore`, `addSlabToStore`, …) inkl. Platzierung/Profil/Repräsentation |
| Prüfung | IDS 1.0 komplett (6 Facetten, Cardinality, Regex/Bounds), BCF-Export der Fehlschläge, mehrsprachige Reports (u. a. Deutsch) |
| Diff | semantischer Model-Diff (passt zu unserem GlobalId-Versionierungskern in `src/ifc/versioning`) |
| Server | Rust/Axum-Server: Parquet-Geometrie (15–50× kleiner als JSON), SSE-Streaming, Content-Addressable Cache |
| Desktop | dokumentierter Tauri-v2-Pfad: native Kompilierung von `ifc-lite-core`/`ifc-lite-geometry`, `NativeBridge`/`IPlatformBridge`, Commands wie `get_geometry_from_path` |
| Schemas | IFC2X3, IFC4, IFC4X3, IFC5/IFCX; 100 % Entity-Abdeckung IFC4/IFC4X3 |

Lizenz MPL-2.0: Nutzung/Einbettung in proprietäre Produkte zulässig; nur Änderungen an ifc-lite-Quelldateien selbst müssen unter MPL bleiben. Eigene Domänenschichten (Portal, Objektkatalog, Prüflogik) bleiben davon unberührt.

## Dokumente in diesem Ordner

| Datei | Inhalt |
| --- | --- |
| [`01-architektur.md`](./01-architektur.md) | Zielarchitektur: Tauri-Shell, Rust-Kern, React-UI, Renderer, Domänenschicht, Server-Anbindung, Projektstruktur |
| [`02-funktionsparitaet.md`](./02-funktionsparitaet.md) | Vollständige Paritätsmatrix React-Viewer 1.x → 2.0 (inkl. Lückenanalyse ifc-lite) |
| [`03-kernfeatures.md`](./03-kernfeatures.md) | Detailspezifikation der Schwerpunkt-Features + ifc-lite-Feature-Übernahmetabelle |
| [`04-roadmap.md`](./04-roadmap.md) | Meilensteine M0–M7 mit Abnahmekriterien |
| [`05-risiken-entscheidungen.md`](./05-risiken-entscheidungen.md) | Risiken, offene Fragen, zu verifizierende Annahmen, getroffene Entscheidungen |

## Abgrenzung zu den übrigen Repo-Varianten

- `/src` (React/Vite + web-ifc/ThatOpen, Electron-Shell): **Funktionsreferenz**, bleibt bestehen.
- `/NativeWindows` (C#/Avalonia): eingestellter Native-Ansatz; dessen Inventar (`NATIVE_WINDOWS_VISIBLE_FUNCTIONS_PLAN.md`) dient nur als Checkliste.
- `/IfcToGlb` (C#): durch ifc-lite-Export (glTF/GLB) ersetzt.
- `/server` (Fastify-Versionierungsserver): wird als **Kollaborations-Backend** weiterverwendet (semantische GlobalId-Diffs); der ifc-lite-Server kommt zusätzlich als **Geometrie-/Parse-Dienst** hinzu.
