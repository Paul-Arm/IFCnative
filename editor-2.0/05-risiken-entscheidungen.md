# 05 — Risiken, offene Fragen, Entscheidungen

## Risiken (in M0 zu verifizieren)

### R1 — WebGPU in WebView2 (Windows)
Der ifc-lite-Renderer ist WebGPU-basiert; Tauri nutzt auf Windows WebView2 (Chromium/Edge). WebGPU ist in aktuellen WebView2-Versionen verfügbar, kann aber von Runtime-Version und GPU-Treibern abhängen (ältere Firmen-PCs!).
**Mitigation:** M0-Spike auf Ziel-Hardware; ggf. WebView2-Feature-Flags setzen; Fallback ist die dokumentierte Three.js-Integration von ifc-lite (WebGL 2) als zweiter Render-Pfad hinter derselben Viewer-Schnittstelle.

### R2 — STEP-Id-/Byte-Stabilität beim Export
1.x garantiert: unveränderte Entities bleiben beim Export unangetastet (wichtig für Diffs, Fremdsystem-Referenzen, Reviews). Ob `exportToStep(applyMutations)` express-Ids und Formatierung unveränderter Zeilen stabil hält, ist zu prüfen.
**Mitigation:** M0-Roundtrip-Test; falls instabil: Export-Nachbearbeitung in der Domänenschicht (Original-Zeilen für untouched Entities wiederverwenden — Overlay-Modell liefert die nötige Information) oder Upstream-PR. Der GlobalId-basierte Versionierungskern ist gegen Renummerierung immun (semantischer Diff bleibt leer), das Risiko betrifft also v. a. textuelle Diffs/Reviews.

### R3 — Umlaute/`\X2\`-Kodierung
Deutsche Fachinhalte (Katalog, Portal, BWD) verlangen korrekte STEP-Escapes. 1.x hat dafür `stepEncoding.ts` mit Tests.
**Mitigation:** ifc-lite bringt dafür ein eigenes Paket (`@ifc-lite/encoding`), das gemäß E8 verwendet wird; unsere `stepEncoding`-Testfälle laufen in M0 als Abnahme dagegen; bei Lücken Patch/Upstream.

### R4 — ifc-lite-Reifegrad und API-Drift
Junges, sehr aktives Projekt (36+ Pakete). API-Brüche und Lücken (z. B. Composite-Property-Typen LIST/ENUM/BOUNDED/TABLE, MaterialLayer-Usages, Approvals) sind zu erwarten.
**Mitigation:** Versionen pinnen; alle ifc-lite-Zugriffe hinter dünnen Adaptern in `src/ifc/` kapseln (eine Austauschstelle); Lücken über `StoreEditor.addEntity` in der eigenen Domänenschicht schließen; Upstream-Beiträge (MPL-2.0, aktiver Maintainer) einplanen.

### R5 — Feature-Lücken gegenüber 1.x-Spezialitäten
Beziehungsgraph-Editing, Spatial-Reparenting, Welt-Frame-Mathematik auf georeferenzierten Sites, Löschkaskaden-Semantik, Portal-Determinismus (GUIDs aus ExternalId) sind 1.x-Eigenleistungen ohne ifc-lite-Pendant.
**Mitigation:** bewusst als Domänenschicht eingeplant (siehe `02-funktionsparitaet.md`, Kennzeichnung P/N); die portierten 1.x-Tests sichern die Semantik.

### R6 — Rendering editierter Geometrie
Live-Mirror (Mesh-Patch nach Edit) ist im ifc-lite-Renderer nicht als fertiges Feature dokumentiert; 1.x hat dafür viel Logik (Ghost-Mesh-Vermeidung, Operations-Queue).
**Mitigation:** M4-Aufgabe mit Fallback „Modell neu berechnen" (Voll-Retessellierung des betroffenen Elements über den nativen Pfad ist dank Rust-Geschwindigkeit akzeptabel).

### R7 — Zwei Server-Komponenten
ifc-lite-Server (Geometrie/Cache) und `/server` (Versionierung) sind getrennte Dienste mit getrennter Auth.
**Mitigation:** Desktop-Betrieb braucht keinen von beiden; Team-Setup dokumentieren; mittelfristig prüfen, ob der Versionierungsdienst ifc-lite-Parsing serverseitig mitnutzen kann.

## Offene Fragen (Entscheidung beim Auftraggeber)

1. **Versionierungs-UI:** reicht Commit/Diff gegen `/server` (M6), oder sind Branches/Merge (Server-„Later phases") für 2.0 gewünscht?
2. **Code-Signing:** Authenticode-Zertifikat vorhanden/beschaffbar (EV-Zertifikat für sofortige SmartScreen-Reputation)? Ohne Signatur warnt SmartScreen beim Installer-Download.
3. **MSI-Variante:** wird ein Firmen-Rollout per Gruppenrichtlinie gebraucht (dann MSI/WiX zusätzlich zu NSIS in M7), oder reicht NSIS + Auto-Update?

## Getroffene Entscheidungen

| # | Entscheidung | Begründung |
| --- | --- | --- |
| E1 | Tauri v2 statt Electron | Windows-Ziel, kleiner Footprint, Rust-Backend = nativer ifc-lite-Fast-Path ohne Zusatzprozess |
| E2 | ifc-lite ersetzt web-ifc/ThatOpen **und** den eigenen STEP-Parser | ein Kern für Parsen/Geometrie/Mutationen/Export statt drei Stacks; Performance; MPL-2.0 kompatibel |
| E3 | Funktionsreferenz = React-Viewer, nicht Avalonia-App | Vorgabe des Auftraggebers; Avalonia-Inventar dient nur als Checkliste |
| E4 | Direkt-Commit + Undo/Redo + Batch-Vorschau (kein Draft-Gate) | bewährtes 1.x-Verhalten; Draft-Gate war schon in 1.x verworfen; Vorschau deckt den Review-Bedarf bei Massenedits |
| E5 | Domänenschicht in TypeScript, nicht Rust | Portierbarkeit der getesteten 1.x-Logik (Katalog/Portal/Prüfung); Rust nur für Parse/Geometrie/IO |
| E6 | `/server` bleibt Versionierungs-Backend | GlobalId-Diff-Kern ist produktionsreif und geteilt (`src/ifc/versioning`); `@ifc-lite/diff` ergänzt den lokalen Zweiervergleich |
| E7 | 1.x-Testsuiten als Verhaltensspezifikation | ~100 Tests definieren Editier-/Katalog-/Portal-Semantik unabhängig von der alten Implementierung |
| E8 | **ifc-lite-zuerst** (Vorgabe Auftraggeber, 2026-07-28) | jede Funktion nutzt das passende der 38 Pakete; Eigenbau nur bei „deutlich besser/kein Pendant" — Paketkatalog mit Entscheidung je Paket in `03-kernfeatures.md` §5. Konsequenzen: Undo/Redo aus `mutations`, `encoding` statt `stepEncoding.ts`, `lists` statt eigenem Tabellen-Export, `lens` statt eigener Färbelogik, Katalogprüfung primär über `ids` |
| E9 | **Kein i18n, UI nur deutsch** (Vorgabe Auftraggeber, 2026-07-28) | keine Fremdsprachen nötig; ifc-lite-Reports auf `de` konfiguriert; spart Abstraktionsschicht |
| E10 | **Portal ganz ans Ende** (Vorgabe Auftraggeber, 2026-07-28) | MKP-Portal-Migration als letzter Backlog-Punkt nach M7; 1.x bleibt bis dahin für Portal-Arbeit im Einsatz |
| E11 | **Richtiger Installer + `.ifc`-Standardprogramm** (Vorgabe Auftraggeber, 2026-07-28) | NSIS-Installer ab M0 mit fileAssociations (`.ifc`, `.ifczip`, `.ifcx`, `.ids`, `.bcf`), RegisteredApplications/Capabilities für „Standard-Apps", Single-Instance-Doppelklick-Öffnen; Windows-`UserChoice`-Schutz beachtet (App bietet „Als Standard festlegen"-Hinweis, erzwingt nichts) |

## Referenzen

- ifc-lite: <https://github.com/LTplus-AG/ifc-lite> (Guides: `docs/guide/` — u. a. `mutations.md`, `desktop.md`, `server.md`, `ids.md`, `geometry.md`, `viewer-api.md`, `federation.md`, `collab.md`, `mcp.md`)
- 1.x-Funktionsreferenz: `/src` (v1.4.8), Tests unter `/tests`
- Historische Scope-Dokumente: `IFC_EDITOR_SCOPE.md`, `OPENCLAW_V2_PLAN.md`, `WINDOWS_NATIVE_REWRITE.md`, `NATIVE_WINDOWS_VISIBLE_FUNCTIONS_PLAN.md`
- Versionierungs-Server: `/server/README.md`
