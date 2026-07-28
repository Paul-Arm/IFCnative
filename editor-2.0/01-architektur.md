# 01 — Zielarchitektur

## Überblick

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tauri v2 Shell (Windows, WebView2)                                     │
│                                                                        │
│  ┌──────────────────────────────┐   ┌───────────────────────────────┐  │
│  │ Frontend (React 19 + Vite)   │   │ Rust-Backend (Tauri Commands) │  │
│  │                              │   │                               │  │
│  │  UI-Schicht                  │   │  ifc-lite-core   (nativ)      │  │
│  │   Mosaic-Panes, Workspaces,  │◄──┤  ifc-lite-geometry (nativ,    │  │
│  │   Inspector, Graph, Batch-   │IPC│    Rayon, exakter CSG-Kernel) │  │
│  │   Pset-Matrix, Prüfzentrum   │   │  Datei-IO, Recents, Session   │  │
│  │                              │   │  get_geometry(_from_path),    │  │
│  │  Domänenschicht (TypeScript) │   │  Streaming-Events             │  │
│  │   Objektkatalog, Portal,     │   └───────────────────────────────┘  │
│  │   Objektinfo-Prüfung,        │                                      │
│  │   Beziehungsregeln,          │   IFC-Hub (eine Codebasis):          │
│  │   Änderungs-Historie         │   ┌───────────────────────────────┐  │
│  │                              │   │ Projekte/Modelle/Versionen,   │  │
│  │  ifc-lite-Pakete (TS/WASM)   │──►│ Diff, Blob-Store, Collab      │  │
│  │   parser, query, mutations,  │   │                               │  │
│  │   create, export, ids, bcf,  │   │ a) eingebettet in der App     │  │
│  │   clash, diff, drawing-2d,   │   │    (Standalone, localhost)    │  │
│  │   renderer (WebGPU)          │   │ b) zentral deployt (Team)     │  │
│  └──────────────────────────────┘   └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Schichten

### 1. Tauri-Shell (Rust)

- Tauri v2, Ziel `windows-x86_64` (Verteilung: richtiger Installer, siehe eigener Abschnitt unten).
- Kompiliert `ifc-lite-core` und `ifc-lite-geometry` **nativ** (kein WASM im Backend): Rayon-Threadpool, voller RAM, direkter Dateizugriff über Pfad-Commands.
- Registriert die von ifc-lite dokumentierten Commands (`get_geometry`, `get_geometry_from_path`, Streaming-Varianten) und sendet Events (`geometry-packed-batch`, `geometry-color-update`) an das Frontend; die mitgelieferte `NativeBridge` implementiert den `IPlatformBridge`-Vertrag, den `GeometryProcessor` per `isTauri()` automatisch aktiviert.
- Zusätzliche eigene Commands: Datei öffnen/speichern (IFC, ifcZIP), Recents/Session-Persistenz (statt `localStorage`), Katalog-xlsx lesen, Kind-Fenster (Multi-Window über Tauri statt `window.open`).
- Fallback-Pfad: dieselben ifc-lite-Pakete laufen als WASM im Frontend — damit bleibt die UI im reinen Browser-Modus (Dev-Server, spätere Web-Variante) voll funktionsfähig. Die Platform-Bridge entscheidet zur Laufzeit.

### 2. Frontend (React 19 + Vite + TypeScript)

- Gleiches UI-Fundament wie 1.x: Tailwind 4 + shadcn-Primitives, `react-mosaic-component` (Panes + benannte Workspaces „Editor / Review / Prüfung / Build / Koordination" + benutzerdefinierte), `@xyflow/react` für den Beziehungsgraphen, virtualisierter Strukturbaum.
- **Kein God-Component mehr.** Die 1.x-Hauptlast (`ifc-workspace.tsx` 3907 Zeilen, `InspectorPanel.tsx` 4530, `nativeDocument.ts` 6115) wird aufgeteilt:
  - Zustand in einen Store (Zustand o. ä.) mit klaren Slices: `documents` (Multi-Tab), `selection`, `graph`, `viewer`, `history`, `catalog`, `portal`, `validation`.
  - Mutationen als **Befehlsobjekte** (Command-Pattern) über eine zentrale `applyCommand()`-Pipeline: erzeugt ifc-lite-`Mutation`s und nutzt die **Undo/Redo-Stacks von `@ifc-lite/mutations`** (kein eigener History-Mechanismus); eigener Anteil ist nur die menschenlesbare Zusammenfassung (Audit-Log wie 1.x `logAction`) und der Renderer-Mirror-Trigger.
  - Auswertungs-/Sicht-Panes kommen direkt aus ifc-lite-Paketen: **Listen** (`@ifc-lite/lists`, Bauteillisten mit Gruppierung/CSV), **Lens** (`@ifc-lite/lens`, regelbasiertes Färben/Filtern), Vergleich (`@ifc-lite/diff`), 2D (`@ifc-lite/drawing-2d`). `apps/viewer` von ifc-lite dient als Referenzimplementierung für Renderer-/IDS-/Undo-Verkabelung.
- Rendering: `@ifc-lite/renderer` (WebGPU) als primärer Viewer — Streaming-First (erste Dreiecke während des Parsens), Sectioning, Isolation, X-Ray, Storey-Färbung, Heatmaps. Transform-Gizmo (Verschieben/Rotieren) wird als eigene Ebene auf dem Renderer ergänzt (siehe `03-kernfeatures.md` → Geometrie).
- WebGPU-Verfügbarkeit in WebView2 wird in M0 verifiziert; Fallback ist die dokumentierte Three.js-Integration von ifc-lite (siehe Risiko R1 in `05-risiken-entscheidungen.md`).

### 3. Modell-/Editierkern (ifc-lite)

- **Lesen:** `@ifc-lite/parser` (kolumnares Datenmodell, IFC2X3/IFC4/IFC4X3/IFC5) + `@ifc-lite/query` (+ optional SQL via DuckDB-WASM).
- **Schreiben:** `@ifc-lite/mutations` — `MutablePropertyView` (Overlay über der Originaltabelle, Original bleibt erhalten), `setProperty`/`setQuantity`/`setPositionalAttribute`, `StoreEditor.addEntity()`/`removeEntity()` (Tombstoning), Element-Builder (`addWallToStore` u. a.). Undo/Redo-Stacks pro Modell.
- **Erzeugen:** `@ifc-lite/create` für neue Modelle (ersetzt `builder.ts`/`createMinimalIfcProject`).
- **Export:** `@ifc-lite/export` — `exportToStep(store, { applyMutations: true })`, außerdem glTF/GLB, CSV, JSON-LD, Parquet, IFC5/IFCX.
- **Prüfen:** `@ifc-lite/ids` (IDS 1.0, Web-Worker), `@ifc-lite/bcf`, `@ifc-lite/clash`, Model-Diff.

### 4. Domänenschicht (eigener TypeScript-Code, portiert aus 1.x)

ifc-lite ist generisch; **eigener Code entsteht nur noch, wo kein Paket existiert oder unsere Lösung deutlich besser ist** (Paketkatalog mit Begründungen in `03-kernfeatures.md` §5). Das Fachspezifische wird aus `/src` portiert (Logik ist dort bereits UI-frei und testgedeckt):

| Modul 1.x | 2.0 |
| --- | --- |
| `catalogExcel.ts`, `catalog.ts`, `catalogValidation.ts` | Objektkatalog-Import (xlsx, Diagnostik/Monitoring), Katalog-Prüfung + Quick-Fixes; zusätzlich Katalog→IDS-Generator (neu, siehe `03-kernfeatures.md`) |
| `objectInfoValidation.ts`, `diagnosticsAssistant.ts` | Objektinfo-ID-Prüfung (`ePset_Objektinformation`), BWD-Assistent |
| `portal/*` (Client, Mapping, Import, Psets) | MKP-Portal-Integration — **ganz ans Ende verschoben (Backlog nach M7)**; fachlich unverändert, HTTP dann über Tauri (kein CORS-Proxy nötig); bis dahin 1.x für Portal-Arbeit weiterverwenden |
| `relationshipRules.ts`, `nativeGraph.ts`, `graphLayout.ts` | Beziehungslegalität, Graph-Nachbarschaft, Layouts (columns/tension) — arbeiten künftig auf dem ifc-lite-Store statt auf `NativeIfcDocument` |
| `versioning/*` | Diff läuft primär über `@ifc-lite/diff`; die React-eigenen GlobalId-Manifeste/Feld-Diffs werden nur portiert, falls ifc-lite die Detailtiefe (Feld-genau je Entity) nicht liefert — Prüfpunkt in M0 |
| `stepEncoding.ts` | **entfällt** zugunsten `@ifc-lite/encoding`; unsere Umlaut-Tests (`\X2\`) laufen als Abnahme dagegen |
| `bodyProfiles.ts` (Positionsmarker), `coordinateMapping.ts`-Semantik | Profilbibliothek + Welt-/Lokalkoordinaten-Logik über der Placement-API |

Der 1.x-eigene STEP-Parser (`nativeDocument.ts`) wird **nicht** portiert — er wird durch parser+mutations ersetzt. Wo ifc-lite-High-Level-APIs fehlen (z. B. beliebige `IFCREL*` anlegen, MaterialLayerSet-Usages, Approvals/Objectives), schreibt die Domänenschicht über `StoreEditor.addEntity()` rohe STEP-Records — dieselbe Rolle, die bisher die ~55 Writer-Funktionen hatten, aber auf schmaler, zentraler Basis.

### 5. IFC-Hub — Projekt- & Versionsdienst (eine Codebasis, zwei Betriebsarten)

Der Hub verwaltet und versioniert IFCs/Projekte. Der frühere Plan, den Fastify-`/server` weiterzuverwenden, ist gestrichen (außerhalb des React-Scopes); der Hub wird nach dem ifc-lite-zuerst-Prinzip aus ifc-lite-Bausteinen zusammengesetzt und nur um das ergänzt, was ifc-lite **dokumentiert nicht hat** (Versionshistorie und Projektverwaltung — der Collab-Server macht ausschließlich Echtzeit-Sitzungen):

- **ifc-lite-Bausteine:** `@ifc-lite/collab-server` programmatisch eingebettet via `startCollabServer()` (Echtzeit-Räume, Rollen Viewer/Commenter/Editor/Admin, JWT-Auth, content-addressed Blob-Store), `@ifc-lite/diff` (Versionsvergleich), `@ifc-lite/cache` (Binärformat), `server-bin`/`server-client` (Parse-/Geometrie-Offload für Thin Clients).
- **Eigene dünne Schicht:** Katalog aus Projekten → Modellen → Versionsständen (Commits mit Autor/Nachricht/Zeitstempel), content-addressed IFC-Blob-Ablage, Versions-API. Feld-genaue Diffs übernimmt `@ifc-lite/diff`; reicht dessen Detailtiefe nicht, wird `entityFieldDiff` aus dem React-Projekt (`src/ifc/versioning`) portiert — das ist zulässiger Scope.
- **Betriebsart a — eingebettet (Standalone):** der Hub startet als lokaler Dienst innerhalb der Tauri-App (Sidecar auf `localhost`), Ablage in SQLite + Dateisystem im App-Datenverzeichnis. Damit hat jeder PC seine eigene IFC-/Projektverwaltung mit Historie — ohne jede Infrastruktur.
- **Betriebsart b — zentral (Team):** derselbe Hub als Docker-Deployment (Postgres + S3/Filesystem-Blob-Store, JWT-Auth). Die App verbindet sich per URL + Token; Push/Pull zwischen lokalem und zentralem Hub überträgt Versionsstände (content-addressed → nur fehlende Blobs wandern).
- Der Hub ist **abschaltbar**; die App bleibt ohne ihn voll funktionsfähig (Dateien direkt öffnen/speichern).

## Datenfluss (Kernszenarien)

1. **Öffnen (Desktop):** Datei-Dialog → Pfad an Tauri-Command `get_geometry_from_path` → nativer Rust-Parse mit Rayon → gepackte Geometrie-Batches als Events → Renderer zeichnet streamend; parallel liefert der Parser Entity-/Property-Tabellen ans Frontend (kolumnar).
2. **Editieren:** UI-Aktion → Command-Pipeline → ifc-lite-`Mutation` (Overlay) → Undo-Eintrag + Audit-Zeile → Renderer-Mirror (Farbe/Transform/Mesh-Patch) ohne Voll-Reparse.
3. **Export:** `exportToStep(applyMutations: true)` → Verifikations-Reparse (Guard wie 1.x) → Datei speichern über Tauri.
4. **Prüfen:** IDS-Dokument(e) + generierte Katalog-IDS → `validateIDS()` im Worker → Prüfzentrum-UI (Filter, 3D-Highlight rot/grün) → optional BCF-Export.
5. **Versionieren:** Export-Snapshot → Commit an den IFC-Hub (lokal eingebettet oder zentral) → Historie-/Diff-UI über `@ifc-lite/diff`; Push/Pull synchronisiert lokale und zentrale Hub-Stände.

## Installer & Dateiverknüpfung

Anforderung: richtiger Windows-Installer und Registrierung als **Standardprogramm für `.ifc`**.

- **Installer:** Tauri-Bundler mit **NSIS** (`.exe`-Installer) als Primärformat, optional zusätzlich MSI (WiX) für Firmen-Rollouts per Gruppenrichtlinie. Installation nach `Program Files`, Startmenü-Eintrag, sauberes Uninstall, optional Portable-Build als Zweitartefakt (Kontinuität zu 1.x).
- **Auto-Update:** Tauri-Updater-Plugin mit signierten Update-Manifesten; Update-Feed z. B. über GitHub Releases.
- **Dateiverknüpfungen:** deklarativ über `bundle.fileAssociations` in `tauri.conf.json` — `.ifc` (primär, `application/x-step`), dazu `.ifczip`, `.ifcx`, `.ids`, `.bcf`. Der NSIS-Installer registriert je Endung eine ProgID (`IFCnative.ifc` …) mit Icon, `shell\open\command` und `OpenWithProgIds`.
- **Standardprogramm:** zusätzlich Registrierung unter `HKLM\Software\RegisteredApplications` + `Capabilities\FileAssociations`, damit die App in Windows unter „Standard-Apps" wählbar ist. Hinweis: seit Windows 10 kann ein Installer die Nutzerwahl nicht mehr erzwingen (`UserChoice`-Schutz) — der Installer bietet die Verknüpfung an, und die App erkennt beim Start, ob sie Standard ist, und zeigt sonst einmalig einen Hinweis mit Sprung in die Windows-Einstellungen.
- **Öffnen per Doppelklick:** Dateiargumente aus dem Explorer werden über die Tauri-CLI-Args entgegengenommen; das **Single-Instance-Plugin** leitet Doppelklicks bei laufender App als „Datei hinzufügen" (neuer Tab) an die bestehende Instanz weiter. Auch Drag-and-drop von `.ifc` auf das Fenster öffnet einen neuen Tab.
- **Code-Signing:** Authenticode-Signatur für Installer + Exe (SmartScreen-Reputation); Zertifikatbeschaffung als offene Frage in `05-risiken-entscheidungen.md`.

## Vorgeschlagene Projektstruktur

```
editor-2.0/
  app/                    # Tauri-Projekt
    src-tauri/            # Rust: Shell, NativeBridge, ifc-lite nativ, Commands
    src/                  # React-Frontend
      ui/                 # Panes, Workspaces, Komponenten (klein geschnitten)
      store/              # Zustand-Slices
      commands/           # Befehlsobjekte + applyCommand-Pipeline
      domain/             # Objektkatalog, Portal, Prüfungen, Beziehungsregeln
      ifc/                # dünne Adapter auf @ifc-lite/*
    tests/                # Vitest (Domäne) + Playwright (UI-Rauchtests)
  docs/                   # diese Planungsdokumente wandern ggf. hierher
```

Node ≥ 22, Rust stable, pnpm oder npm — Entscheidung in M0.
