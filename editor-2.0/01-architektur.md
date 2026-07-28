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
│  │   Beziehungsregeln,          │   optional (Team/Cloud):             │
│  │   Änderungs-Historie         │   ┌───────────────────────────────┐  │
│  │                              │   │ ifc-lite-Server (Rust/Axum)   │  │
│  │  ifc-lite-Pakete (TS/WASM)   │──►│  Parse/Parquet/SSE/Cache      │  │
│  │   parser, query, mutations,  │   ├───────────────────────────────┤  │
│  │   create, export, ids, bcf,  │   │ /server (Fastify, bestehend)  │  │
│  │   clash, diff, drawing-2d,   │   │  Projekte/Branches/Commits,   │  │
│  │   renderer (WebGPU)          │   │  semantischer GlobalId-Diff   │  │
│  └──────────────────────────────┘   └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Schichten

### 1. Tauri-Shell (Rust)

- Tauri v2, Ziel `windows-x86_64` (Installer: NSIS + portable, wie heute Electron-portable).
- Kompiliert `ifc-lite-core` und `ifc-lite-geometry` **nativ** (kein WASM im Backend): Rayon-Threadpool, voller RAM, direkter Dateizugriff über Pfad-Commands.
- Registriert die von ifc-lite dokumentierten Commands (`get_geometry`, `get_geometry_from_path`, Streaming-Varianten) und sendet Events (`geometry-packed-batch`, `geometry-color-update`) an das Frontend; die mitgelieferte `NativeBridge` implementiert den `IPlatformBridge`-Vertrag, den `GeometryProcessor` per `isTauri()` automatisch aktiviert.
- Zusätzliche eigene Commands: Datei öffnen/speichern (IFC, ifcZIP), Recents/Session-Persistenz (statt `localStorage`), Katalog-xlsx lesen, Kind-Fenster (Multi-Window über Tauri statt `window.open`).
- Fallback-Pfad: dieselben ifc-lite-Pakete laufen als WASM im Frontend — damit bleibt die UI im reinen Browser-Modus (Dev-Server, spätere Web-Variante) voll funktionsfähig. Die Platform-Bridge entscheidet zur Laufzeit.

### 2. Frontend (React 19 + Vite + TypeScript)

- Gleiches UI-Fundament wie 1.x: Tailwind 4 + shadcn-Primitives, `react-mosaic-component` (Panes + benannte Workspaces „Editor / Review / Prüfung / Build / Koordination" + benutzerdefinierte), `@xyflow/react` für den Beziehungsgraphen, virtualisierter Strukturbaum.
- **Kein God-Component mehr.** Die 1.x-Hauptlast (`ifc-workspace.tsx` 3907 Zeilen, `InspectorPanel.tsx` 4530, `nativeDocument.ts` 6115) wird aufgeteilt:
  - Zustand in einen Store (Zustand o. ä.) mit klaren Slices: `documents` (Multi-Tab), `selection`, `graph`, `viewer`, `history`, `catalog`, `portal`, `validation`.
  - Mutationen als **Befehlsobjekte** (Command-Pattern) über eine zentrale `applyCommand()`-Pipeline: erzeugt ifc-lite-`Mutation`s, schreibt Undo/Redo, erzeugt die menschenlesbare Zusammenfassung (Audit-Log wie 1.x `logAction`), triggert Renderer-Mirror.
- Rendering: `@ifc-lite/renderer` (WebGPU) als primärer Viewer — Streaming-First (erste Dreiecke während des Parsens), Sectioning, Isolation, X-Ray, Storey-Färbung, Heatmaps. Transform-Gizmo (Verschieben/Rotieren) wird als eigene Ebene auf dem Renderer ergänzt (siehe `03-kernfeatures.md` → Geometrie).
- WebGPU-Verfügbarkeit in WebView2 wird in M0 verifiziert; Fallback ist die dokumentierte Three.js-Integration von ifc-lite (siehe Risiko R1 in `05-risiken-entscheidungen.md`).

### 3. Modell-/Editierkern (ifc-lite)

- **Lesen:** `@ifc-lite/parser` (kolumnares Datenmodell, IFC2X3/IFC4/IFC4X3/IFC5) + `@ifc-lite/query` (+ optional SQL via DuckDB-WASM).
- **Schreiben:** `@ifc-lite/mutations` — `MutablePropertyView` (Overlay über der Originaltabelle, Original bleibt erhalten), `setProperty`/`setQuantity`/`setPositionalAttribute`, `StoreEditor.addEntity()`/`removeEntity()` (Tombstoning), Element-Builder (`addWallToStore` u. a.). Undo/Redo-Stacks pro Modell.
- **Erzeugen:** `@ifc-lite/create` für neue Modelle (ersetzt `builder.ts`/`createMinimalIfcProject`).
- **Export:** `@ifc-lite/export` — `exportToStep(store, { applyMutations: true })`, außerdem glTF/GLB, CSV, JSON-LD, Parquet, IFC5/IFCX.
- **Prüfen:** `@ifc-lite/ids` (IDS 1.0, Web-Worker), `@ifc-lite/bcf`, `@ifc-lite/clash`, Model-Diff.

### 4. Domänenschicht (eigener TypeScript-Code, portiert aus 1.x)

ifc-lite ist generisch; alles Fachspezifische bleibt eigener Code und wird aus `/src` portiert (Logik ist dort bereits UI-frei und testgedeckt):

| Modul 1.x | 2.0 |
| --- | --- |
| `catalogExcel.ts`, `catalog.ts`, `catalogValidation.ts` | Objektkatalog-Import (xlsx, Diagnostik/Monitoring), Katalog-Prüfung + Quick-Fixes; zusätzlich Katalog→IDS-Generator (neu, siehe `03-kernfeatures.md`) |
| `objectInfoValidation.ts`, `diagnosticsAssistant.ts` | Objektinfo-ID-Prüfung (`ePset_Objektinformation`), BWD-Assistent |
| `portal/*` (Client, Mapping, Import, Psets) | MKP-Portal-Integration unverändert fachlich, HTTP über Tauri (kein CORS-Proxy nötig) |
| `relationshipRules.ts`, `nativeGraph.ts`, `graphLayout.ts` | Beziehungslegalität, Graph-Nachbarschaft, Layouts (columns/tension) — arbeiten künftig auf dem ifc-lite-Store statt auf `NativeIfcDocument` |
| `versioning/*` | bleibt gemeinsame Basis mit `/server` (GlobalId-Manifeste, Feld-Diffs) |
| `stepEncoding.ts`-Wissen (Umlaute `\X2\`) | Verifikation, dass ifc-lite-Export deutsche Umlaute korrekt kodiert; sonst Patch/Upstream-PR |
| `bodyProfiles.ts` (Positionsmarker), `coordinateMapping.ts`-Semantik | Profilbibliothek + Welt-/Lokalkoordinaten-Logik über der Placement-API |

Der 1.x-eigene STEP-Parser (`nativeDocument.ts`) wird **nicht** portiert — er wird durch parser+mutations ersetzt. Wo ifc-lite-High-Level-APIs fehlen (z. B. beliebige `IFCREL*` anlegen, MaterialLayerSet-Usages, Approvals/Objectives), schreibt die Domänenschicht über `StoreEditor.addEntity()` rohe STEP-Records — dieselbe Rolle, die bisher die ~55 Writer-Funktionen hatten, aber auf schmaler, zentraler Basis.

### 5. Server (optional, Team-Betrieb)

- **ifc-lite-Server** (Docker `ghcr.io/louistrue/ifc-lite-server`): Parse-/Geometrie-Offload für Thin Clients und den Portal-/Web-Kontext; Content-Addressable Cache (Hash lokal rechnen → Upload sparen), Parquet + SSE-Streaming; Bearer-Token-Auth, Prometheus.
- **Bestehender `/server`** (Fastify): Projekte/Modelle/Branches/Commits mit semantischem GlobalId-Diff. 2.0 bekommt dafür erstmals UI: Commit-Historie, Diff-Ansicht (added/removed/modified nach GlobalId + Feld-Diffs), Push/Pull aus der App.
- Beide Dienste sind **abschaltbar**; Desktop-Betrieb ist vollständig offline möglich (nativer Rust-Pfad).

## Datenfluss (Kernszenarien)

1. **Öffnen (Desktop):** Datei-Dialog → Pfad an Tauri-Command `get_geometry_from_path` → nativer Rust-Parse mit Rayon → gepackte Geometrie-Batches als Events → Renderer zeichnet streamend; parallel liefert der Parser Entity-/Property-Tabellen ans Frontend (kolumnar).
2. **Editieren:** UI-Aktion → Command-Pipeline → ifc-lite-`Mutation` (Overlay) → Undo-Eintrag + Audit-Zeile → Renderer-Mirror (Farbe/Transform/Mesh-Patch) ohne Voll-Reparse.
3. **Export:** `exportToStep(applyMutations: true)` → Verifikations-Reparse (Guard wie 1.x) → Datei speichern über Tauri.
4. **Prüfen:** IDS-Dokument(e) + generierte Katalog-IDS → `validateIDS()` im Worker → Prüfzentrum-UI (Filter, 3D-Highlight rot/grün) → optional BCF-Export.
5. **Versionieren:** Export-Snapshot → `buildVersionManifest` → Commit an `/server` → Diff-UI über `diffManifests`/`entityFieldDiff`.

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
