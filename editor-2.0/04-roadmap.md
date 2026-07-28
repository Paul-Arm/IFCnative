# 04 — Roadmap

Meilensteine sind so geschnitten, dass jeder ein lauffähiges, demonstrierbares Inkrement liefert. Reihenfolge: Risiko zuerst (M0), dann Lesen → Editieren → Schwerpunkt-Features → Team-Features.

## M0 — Technischer Durchstich (Spike, ~1–2 Wochen)

> **Stand 2026-07-28:** umgesetzt in `editor-2.0/app` (Frontend + Tests + Tauri-Backend + CI-Workflow für den Windows-Installer). Befunde in `05-risiken-entscheidungen.md` → „M0-Befunde"; offen sind die Windows-Punkte (WebGPU-Check R1, Installer-/Doppelklick-Abnahme), die den ersten CI-Build auf `windows-latest` brauchen.

Ziel: die drei größten technischen Annahmen beweisen, bevor Struktur entsteht.

- Tauri-v2-Projekt (Scaffold via `create-ifc-lite`, dann angepasst) mit React/Vite-Frontend.
- **Richtiger Installer von Anfang an:** NSIS-Installer (Program Files, Startmenü, Uninstall), `bundle.fileAssociations` für `.ifc`/`.ifczip`, Single-Instance-Plugin + CLI-Args → Explorer-Doppelklick öffnet die Datei in der laufenden Instanz; Registrierung unter „Standard-Apps" (RegisteredApplications/Capabilities).
- ifc-lite nativ im Tauri-Backend: `get_geometry_from_path` + Streaming-Events; ein 300–500-MB-IFC öffnet und rendert streamend; zweites Öffnen über `@ifc-lite/cache` messen.
- **WebGPU in WebView2 verifizieren** (Risiko R1); Fallback Three.js-Integration prüfen.
- Mutations-Roundtrip: Property ändern → `exportToStep(applyMutations)` → Reparse → Wert korrekt, **unveränderte Entities byte-stabil?** (Risiko R2), Umlaute über `@ifc-lite/encoding` gegen unsere `\X2\`-Testfälle (Risiko R3).
- Element-Builder-Probe: Wand + Öffnung erzeugen, Export in Fremdviewer prüfen.
- `@ifc-lite/diff`-Detailtiefe prüfen: liefert es Feld-genaue Änderungen je Entity (für die Hub-Diff-UI in M6), oder braucht es den `entityFieldDiff`-Port aus `src/ifc/versioning`?

**Abnahme:** Installer installiert; Doppelklick auf `.ifc` im Explorer öffnet die Demo-App mit Modell; Groß-IFC < 10 s bis erste Dreiecke; Editier-Roundtrip beweisbar korrekt; Go/No-Go-Notiz je Risiko in `05-risiken-entscheidungen.md` nachgetragen.

## M1 — Viewer-Parität (Lesen)

> **Stand 2026-07-28:** Kernumfang umgesetzt in `editor-2.0/app` — Mosaic-Shell mit 5 Workspaces + eigenen Layouts, Multi-Dokument-Tabs, Statusleiste, Theme/UI-Zoom, Notizen/Recents, Crash-Boundary; virtualisierter Strukturbaum mit Suche und Mehrfachauswahl; Inspector (Übersicht/Eigenschaften mit Edit/Mengen/Beziehungen); React-Flow-Beziehungsgraph (Presets, Tiefe 1–5, Filter, Pinnen, Suche); Viewer mit Picking/Auswahl-Sync, Orbit/Pan/Zoom, benannten Ansichten, Isolation/Ausblenden, X-Ray (Ghost), Schnittebenen; Lens-Pane mit 5 Presets und Farb-/Hidden-Brücke zum Viewer. Größte Datei < 300 Zeilen. Offen: Abnahme auf Windows-Hardware (WebGPU, R1) und Gegenprobe mit großen Fremd-Tool-IFCs.

- App-Shell: Mosaic-Panes, Workspaces (5 eingebaute + eigene), Multi-Dokument-Tabs, Statusleiste, Theme, UI-Skalierung, Recents, Notizen, Crash-Boundary.
- Strukturbaum (virtualisiert, Suche, Multi-Select), Inspector lesend (Übersicht, Psets, Platzierung, Beziehungen, Ressourcen), Referenzen ein-/ausgehend.
- Viewer: Auswahl-Sync, Zoom/Kamera, Schnittebenen, Isolation, X-Ray, benannte Ansichten; **Lens-Pane** (`@ifc-lite/lens`, regelbasiertes Färben/Filtern mit Presets).
- Beziehungsgraph lesend: Presets, Tiefe, Filter, Layouts, Pinnen, Suche.

**Abnahme:** jedes 1.x-Referenzmodell lässt sich öffnen und vollständig inspizieren; Lese-Parität laut `02-funktionsparitaet.md` abgehakt.

## M2 — Editierkern

> **Stand 2026-07-28:** Kernumfang umgesetzt. Command-Pipeline (run/undo, Stapel je Dokument, Audit-Log, Strg+Z/Y, Header-Buttons mit Operations-Tooltip); Inspector schreibend (Pset anlegen/umbenennen/duplizieren/löschen, typisierte Property-Werte mit Validierung, Identität, Mengen); Beziehungs-Editing mit Sitzungs-Overlay über dem statischen CSR-Graphen, Endpunkt-Legalitätsregeln, Beziehung anlegen per Knoten-Verbinden im Graph, Beziehung/Objekt löschen mit Kaskadenplan-Dialog, Reklassifizierung; 23 Verhaltenstests mit Byte-Vergleich (30 gesamt). Zwei durch Tests gefundene Kern-Defekte behoben (B1 Extractor-Verdrahtung — verhinderte Property-Verlust beim Export; B3 Attribut-Undo). Offen aus dem M2-Plan: Domänen-Writer für Material/Klassifikation/Gruppen (→ mit M3 zusammengelegt), Raw-STEP-Editor („Erweitert").

- Command-Pipeline: Mutations, Undo/Redo, Audit-Log, Dirty-Flag, Export-Guard.
- Inspector schreibend: Identität, typisierte Pset-/Qto-Werte, Pset umbenennen/duplizieren/löschen, Beziehungen anlegen/ändern/löschen (endpoint-legal), Typzuweisung.
- Domänenschicht-Writer über `addEntity`: Materialien (einfach/Schichten/Profile/Bestandteile), Klassifikation/Dokument/Bibliothek, Gruppen/Zonen/Systeme, Freigaben/Constraints, Einheiten.
- Entity-Löschung mit Kaskadenplan-Dialog.
- Graph schreibend: Knoten/Kanten anlegen, verbinden, löschen, Copy/Paste.
- Portierte Verhaltenstests aus `tests/ifc.test.ts` (Editier-Semantik) laufen grün.

**Abnahme:** Editier-Parität laut Matrix; Fremdviewer-Roundtrip nach repräsentativer Editiersitzung fehlerfrei.

## M3 — Batch-Psets + Objektkatalog

> **Stand 2026-07-28: umgesetzt.** Batch-Pset-Matrix mit Abdeckungs-Badge, Divergenz-Hervorhebung, Vorschau-Dialog vor jeder Massenaktion (alt→neu je Objekt), abfragebasierter Auswahl (Klasse + Property-Filter über BulkQueryEngine inkl. Overlay-Sicht) und CSV-Roundtrip (Semikolon+BOM, GlobalId-Matching, nur echte Diffs, ein Undo-Schritt). Objektkatalog: openSIM-Import (Diagnostik+Monitoring) in der domain-Schicht, Prüfung mit 6 Befundarten + Quick-Fixes, „Pset(s) auf Auswahl anwenden", **Katalog→IDS-Generator** mit LoI-Filter. Listen-Pane über @ifc-lite/lists (Presets, Spalten-Discovery, mehrstufige Gruppierung mit Summen, CSV). 39 Tests grün. Hinweis: @ifc-lite/query.whereProperty ist wegen der leeren PropertyTable des kolumnaren Parses nicht nutzbar (dokumentiert) — Abfragen laufen über BulkQueryEngine/entityIndex.

- Batch-Pset-Matrix (Parität) + Vorschau über `BulkQueryEngine.preview()`.
- Abfrage-basierte Auswahl (`@ifc-lite/query`).
- xlsx/CSV-Roundtrip (`CsvConnector`), Datums-/Typ-Validierung.
- Objektkatalog-Import (beide Kinds), Katalog-Pane, Anwenden auf Auswahl, Katalogprüfung + Quick-Fixes, Katalog→IDS-Generator.
- **Listen-Pane** (`@ifc-lite/lists`): Bauteillisten mit Spalten-Picker, Gruppierung/Aggregation, CSV-Export.
- Portierte `tests/catalog.test.ts` grün.

## M4 — Geometrie erstellen/bearbeiten

- Baukasten mit Profilbibliothek (inkl. Positionsmarker), Platzierung Parent/Welt, Koordinaten-Pick.
- Transform-Gizmo (W/R) mit Mutation-Commit; numerischer Placement-Editor; Welt-Frame-Mathematik.
- Maßänderung bestehender Extrusionen; Körper zuweisen/entfernen.
- Öffnungen/Füllungen mit exaktem CSG; Live-Mirror + „Modell neu berechnen"-Fallback.
- Portierte Geometrie-/Placement-/Einheiten-Tests grün.

## M5 — Prüfzentrum

- Modell-Diagnostik, Objektinfo-Prüfung (Portierung), IDS-Runner (Worker), Clash Detection.
- Vereinheitlichte Findings-UI, 3D-Highlight/Isolation, deutscher Report, BCF-Export.
- Quick-Fix-Framework über Command-Pipeline.

## M6 — IFC-Hub: Projekt- & Versionsverwaltung (Standalone + Team)

- Hub-Dienst (eine Codebasis): Katalogschicht Projekte → Modelle → Versionsstände auf `collab-server`-Bausteinen (Auth/Rollen/Blob-Store via `startCollabServer()`), content-addressed IFC-Ablage.
- **Standalone:** Hub als Tauri-Sidecar (`localhost`, SQLite + App-Datenverzeichnis), null Konfiguration; Projekt-Browser-Pane, „Stand sichern", Historie, Stand zurückholen.
- **Team:** dasselbe Artefakt als Docker-Deployment (Postgres + S3/Filesystem, JWT-Rollen); Push/Pull lokaler ↔ zentraler Hub (nur fehlende Blobs).
- Versions-Diff über `@ifc-lite/diff` mit 3D-Highlight; Feld-Diff-Fallback aus `src/ifc/versioning` falls nötig (M0-Prüfpunkt); ChangeSets (`ChangeSetManager`), Herkunftsanzeige (`@ifc-lite/provenance`).
- Lokaler Datei-Vergleich (Datei A vs. B) über `@ifc-lite/diff`.
- Optional: Parse-/Geometrie-Offload über `server-client`/`server-bin` für Thin Clients.

**Abnahme:** siehe `03-kernfeatures.md` §6 (Standalone-Commit/Historie ohne Konfiguration; Team-Betrieb mit Rollen und Push/Pull; leerer Diff bei unverändertem Re-Export).

## M7 — Politur & Release

- Föderations-/Koordinations-Workspace (`merge`), 2D-Ableitungen (`drawing-2d`), Export-Menü (glTF/CSV/JSON-LD/Parquet/IFC5), ifcZIP.
- Performance-Pass (1-GB-Modell), Handbuch (deutsch).
- Installer-Finalisierung: Auto-Update (Tauri Updater), „Als Standard festlegen"-Hinweisdialog beim ersten Start. Code-Signing-Schritt im Build vorbereitet, aber deaktiviert (Zertifikat vorhanden, Einsatz zurückgestellt — E12); MSI-Variante im Backlog (E13).

## Nachgelagert (Backlog, in dieser Reihenfolge)

1. Erweiterungssystem produktiv öffnen (`extensions`/`sandbox`): kundenspezifische Prüf-/Export-Plugins.
2. Scripting/Makros (`sdk`), CLI-Workflows (`cli`, z. B. CI-Modellprüfung).
3. MCP/KI-Assistent (`mcp`).
4. Echtzeit-Kollaboration (`collab`/`collab-server`, CRDT auf IFCX).
5. Embedding (`embed-sdk`), Punktwolken (`pointcloud`), Solar (`solar`).
6. IFC-Modell-Branches + Entity-Merge im IFC-Hub (Drei-Wege-Vergleich, Konfliktdialog je Entity) — Empfehlung aus `05-risiken-entscheidungen.md` Frage 1; Echtzeit-Räume des Collab-Servers (gemeinsames Editieren) gehören zu Backlog-Punkt 4.
7. MSI/WiX-Installer für Firmen-Rollout (E13); Code-Signing aktivieren, sobald gewünscht (E12).
8. **Ganz am Ende: MKP-Portal-Migration** (Login, Bäume, Zuordnen/Import, Mapping-Editor, Mock-Modus; `tests/portal.test.ts` als Referenz). Bis dahin bleibt 1.x für Portal-Arbeit im Einsatz.

## TestStrategie (durchgängig)

- **Verhaltensreferenz:** die 1.x-Testsuiten (`ifc`, `catalog`, `portal`, `versioning` — zusammen ~100 Tests) werden je Meilenstein auf die neue Domänenschicht portiert; sie definieren die Editier-Semantik unabhängig vom alten Parser.
- Vitest für Domäne/Commands, Playwright-Rauchtests für die Shell, ein Windows-CI-Runner für Tauri-Builds.
- Golden-File-Tests: Referenz-IFCs → Editieroperation → erwarteter STEP-Output.
