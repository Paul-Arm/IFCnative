# 05 — Risiken, offene Fragen, Entscheidungen

## M0-Befunde (2026-07-28, `editor-2.0/app`, Tests: `tests/m0-durchstich.test.ts`)

| Risiko | Befund | Status |
| --- | --- | --- |
| R1 (WebGPU in WebView2) | im Linux-Container nicht prüfbar; App fällt sauber auf Statusmeldung zurück, Editor bleibt ohne 3D voll funktionsfähig. **Prüfung auf Windows-Zielhardware offen** (Installer aus CI-Action) | ⚠ offen |
| R2 (Export-Stabilität) | mutationsfreier Re-Export: **100 % der DATA-Zeilen byte-identisch**, alle GlobalIds unverändert (Testmodell aus `IfcCreator`; Gegenprobe mit Fremd-Tool-IFC in M1 nachziehen) | ✅ positiv |
| R3 (Umlaute/`\X2\`) | `@ifc-lite/encoding` verlustfrei für äöüÄÖÜß/µ/–/„"; Nicht-ASCII wird korrekt escaped; Umlaut-Property übersteht den vollen Mutations-Roundtrip | ✅ bestanden |
| Mutations-Roundtrip | parse → `setProperty` → `StepExporter(applyMutations)` → Reparse liefert den neuen Wert | ✅ bestanden |
| Element-Builder | `IfcCreator`: Wand + Tür erzeugt echte `IFCOPENINGELEMENT`/`IFCRELVOIDSELEMENT`/`IFCRELFILLSELEMENT`-Kette | ✅ bestanden |
| Nativer Fast-Path | `ifc-lite-processing 4.1.4` (crates.io) nativ ausgeführt: Wand/Öffnung/Tür → 3 Meshes in ~1,6 ms; camelCase-Kontrakt der `NativeBridge` verifiziert | ✅ bestanden |
| Tauri-Build unter Linux | Container hat kein webkit2gtk/gtk3 → Desktop-Build nur auf Windows/CI (`.github/workflows/editor2-windows.yml`) | ℹ Hinweis |

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

### R7 — IFC-Hub: Eigenanteil und Sidecar-Betrieb
ifc-lite hat dokumentiert **keine Versionshistorie und keine Projektverwaltung** (der Collab-Server macht nur Echtzeit-Sitzungen) — die Hub-Katalogschicht ist Eigenbau. Zudem: der Hub läuft als Node-Sidecar in der Tauri-App (Bundle-Größe, Prozess-Lebenszyklus), und der Collab-Server verlangt einen persistenten Prozess (kein Serverless).
**Mitigation:** Eigenschicht bewusst dünn halten (nur Katalog + Versions-API; Auth/Rollen/Blob-Store/Diff aus ifc-lite-Paketen); Persistenzadapter SQLite↔Postgres von Anfang an trennen; Sidecar-Start/-Stop über Tauri verwalten; Upstream beobachten — liefert ifc-lite später Projekt-/Versionsverwaltung nach, wird die Eigenschicht ersetzt (ifc-lite-zuerst).

## Offene Fragen (Entscheidung beim Auftraggeber)

1. **Versionierungs-UI — IFC-Modell-Branches (nicht git):** Der IFC-Hub versioniert IFC-Stände pro Modell (Commits mit semantischem Diff je Bauteil). „Branches/Merge" hieße: parallele Bearbeitungsstände desselben Modells (z. B. Hauptstand vs. Planungsvariante) mit Drei-Wege-Zusammenführung und Konflikterkennung **pro Entity**. **Empfehlung:** 2.0 startet mit linearer Commit-Historie + Diff (M6); Branch-UI + Entity-Merge als Backlog-Punkt dahinter.

## Getroffene Entscheidungen

| # | Entscheidung | Begründung |
| --- | --- | --- |
| E1 | Tauri v2 statt Electron | Windows-Ziel, kleiner Footprint, Rust-Backend = nativer ifc-lite-Fast-Path ohne Zusatzprozess |
| E2 | ifc-lite ersetzt web-ifc/ThatOpen **und** den eigenen STEP-Parser | ein Kern für Parsen/Geometrie/Mutationen/Export statt drei Stacks; Performance; MPL-2.0 kompatibel |
| E3 | Funktionsreferenz = React-Viewer, nicht Avalonia-App | Vorgabe des Auftraggebers; Avalonia-Inventar dient nur als Checkliste |
| E4 | Direkt-Commit + Undo/Redo + Batch-Vorschau (kein Draft-Gate) | bewährtes 1.x-Verhalten; Draft-Gate war schon in 1.x verworfen; Vorschau deckt den Review-Bedarf bei Massenedits |
| E5 | Domänenschicht in TypeScript, nicht Rust | Portierbarkeit der getesteten 1.x-Logik (Katalog/Portal/Prüfung); Rust nur für Parse/Geometrie/IO |
| E6 | ~~`/server` bleibt Versionierungs-Backend~~ **revidiert durch E14** | ursprüngliche Entscheidung verletzte den Scope „nur React-Projekt"; `/server` wird nicht weiterverwendet |
| E7 | 1.x-Testsuiten als Verhaltensspezifikation | ~100 Tests definieren Editier-/Katalog-/Portal-Semantik unabhängig von der alten Implementierung |
| E8 | **ifc-lite-zuerst** (Vorgabe Auftraggeber, 2026-07-28) | jede Funktion nutzt das passende der 38 Pakete; Eigenbau nur bei „deutlich besser/kein Pendant" — Paketkatalog mit Entscheidung je Paket in `03-kernfeatures.md` §5. Konsequenzen: Undo/Redo aus `mutations`, `encoding` statt `stepEncoding.ts`, `lists` statt eigenem Tabellen-Export, `lens` statt eigener Färbelogik, Katalogprüfung primär über `ids` |
| E9 | **Kein i18n, UI nur deutsch** (Vorgabe Auftraggeber, 2026-07-28) | keine Fremdsprachen nötig; ifc-lite-Reports auf `de` konfiguriert; spart Abstraktionsschicht |
| E10 | **Portal ganz ans Ende** (Vorgabe Auftraggeber, 2026-07-28) | MKP-Portal-Migration als letzter Backlog-Punkt nach M7; 1.x bleibt bis dahin für Portal-Arbeit im Einsatz |
| E11 | **Richtiger Installer + `.ifc`-Standardprogramm** (Vorgabe Auftraggeber, 2026-07-28) | NSIS-Installer ab M0 mit fileAssociations (`.ifc`, `.ifczip`, `.ifcx`, `.ids`, `.bcf`), RegisteredApplications/Capabilities für „Standard-Apps", Single-Instance-Doppelklick-Öffnen; Windows-`UserChoice`-Schutz beachtet (App bietet „Als Standard festlegen"-Hinweis, erzwingt nichts) |
| E12 | **Code-Signing zurückgestellt** (Auftraggeber, 2026-07-28) | Authenticode-Zertifikat ist vorhanden, wird aber vorerst nicht eingebunden; Aktivierung jederzeit möglich (Signier-Schritt im Build vorbereiten, aber deaktiviert lassen). Bis dahin SmartScreen-Warnung beim Installer-Download akzeptiert |
| E13 | **MSI später** (Auftraggeber, 2026-07-28) | nur NSIS + Auto-Update im Planungsumfang; MSI/WiX für Firmen-Rollout wandert in den Backlog |
| E15 | **React bleibt, kein Vue-Umstieg** (Auftraggeber, 2026-07-28) | kein fachlicher Gewinn; tragende Bibliotheken (react-mosaic, React Flow) sind React-nativ; 1.x-Referenz ist React; M1 wäre wegzuwerfen. Kern (Session/Modell/Viewer-Fassade/Tauri-Brücke) bleibt framework-freies TS, ein späterer Wechsel bliebe UI-Neuaufbau statt Kern-Neuaufbau |
| E14 | **IFC-Hub statt `/server`** (Vorgabe Auftraggeber, 2026-07-28) | Projekt-/Versionsverwaltung der IFCs als Dienst auf ifc-lite-Bausteinen (`collab-server` via `startCollabServer()`, `diff`, `cache`, `server-bin`/`-client`) + dünner Eigenschicht für Katalog/Historie (ifc-lite hat beides nicht). **Eine Codebasis, zwei Betriebsarten:** eingebettet als Tauri-Sidecar (Standalone-Verwaltung auf dem PC) und zentral deployt (Docker) fürs Team. Spezifikation in `03-kernfeatures.md` §6, Umsetzung M6 |

## Referenzen

- ifc-lite: <https://github.com/LTplus-AG/ifc-lite> (Guides: `docs/guide/` — u. a. `mutations.md`, `desktop.md`, `server.md`, `ids.md`, `geometry.md`, `viewer-api.md`, `federation.md`, `collab.md`, `mcp.md`)
- 1.x-Funktionsreferenz: `/src` (v1.4.8), Tests unter `/tests`
- Historische Scope-Dokumente: `IFC_EDITOR_SCOPE.md`, `OPENCLAW_V2_PLAN.md`, `WINDOWS_NATIVE_REWRITE.md`, `NATIVE_WINDOWS_VISIBLE_FUNCTIONS_PLAN.md`
- Historisch (nicht weiterverwendet, siehe E14): `/server/README.md`
