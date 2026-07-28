# 04 — Roadmap

Meilensteine sind so geschnitten, dass jeder ein lauffähiges, demonstrierbares Inkrement liefert. Reihenfolge: Risiko zuerst (M0), dann Lesen → Editieren → Schwerpunkt-Features → Team-Features.

## M0 — Technischer Durchstich (Spike, ~1–2 Wochen)

Ziel: die drei größten technischen Annahmen beweisen, bevor Struktur entsteht.

- Tauri-v2-Projekt mit React/Vite-Frontend, Windows-Build (NSIS + portable).
- ifc-lite nativ im Tauri-Backend: `get_geometry_from_path` + Streaming-Events; ein 300–500-MB-IFC öffnet und rendert streamend.
- **WebGPU in WebView2 verifizieren** (Risiko R1); Fallback Three.js-Integration prüfen.
- Mutations-Roundtrip: Property ändern → `exportToStep(applyMutations)` → Reparse → Wert korrekt, **unveränderte Entities byte-stabil?** (Risiko R2), Umlaute/`\X2\` korrekt (Risiko R3).
- Element-Builder-Probe: Wand + Öffnung erzeugen, Export in Fremdviewer prüfen.

**Abnahme:** Demo-App öffnet Groß-IFC < 10 s bis erste Dreiecke; Editier-Roundtrip beweisbar korrekt; Go/No-Go-Notiz je Risiko in `05-risiken-entscheidungen.md` nachgetragen.

## M1 — Viewer-Parität (Lesen)

- App-Shell: Mosaic-Panes, Workspaces (5 eingebaute + eigene), Multi-Dokument-Tabs, Statusleiste, Theme, UI-Skalierung, Recents, Notizen, Crash-Boundary.
- Strukturbaum (virtualisiert, Suche, Multi-Select), Inspector lesend (Übersicht, Psets, Platzierung, Beziehungen, Ressourcen), Referenzen ein-/ausgehend.
- Viewer: Auswahl-Sync, Zoom/Kamera, Schnittebenen, Isolation, X-Ray, benannte Ansichten.
- Beziehungsgraph lesend: Presets, Tiefe, Filter, Layouts, Pinnen, Suche.

**Abnahme:** jedes 1.x-Referenzmodell lässt sich öffnen und vollständig inspizieren; Lese-Parität laut `02-funktionsparitaet.md` abgehakt.

## M2 — Editierkern

- Command-Pipeline: Mutations, Undo/Redo, Audit-Log, Dirty-Flag, Export-Guard.
- Inspector schreibend: Identität, typisierte Pset-/Qto-Werte, Pset umbenennen/duplizieren/löschen, Beziehungen anlegen/ändern/löschen (endpoint-legal), Typzuweisung.
- Domänenschicht-Writer über `addEntity`: Materialien (einfach/Schichten/Profile/Bestandteile), Klassifikation/Dokument/Bibliothek, Gruppen/Zonen/Systeme, Freigaben/Constraints, Einheiten.
- Entity-Löschung mit Kaskadenplan-Dialog.
- Graph schreibend: Knoten/Kanten anlegen, verbinden, löschen, Copy/Paste.
- Portierte Verhaltenstests aus `tests/ifc.test.ts` (Editier-Semantik) laufen grün.

**Abnahme:** Editier-Parität laut Matrix; Fremdviewer-Roundtrip nach repräsentativer Editiersitzung fehlerfrei.

## M3 — Batch-Psets + Objektkatalog

- Batch-Pset-Matrix (Parität) + Vorschau über `BulkQueryEngine.preview()`.
- Abfrage-basierte Auswahl (`@ifc-lite/query`).
- xlsx/CSV-Roundtrip (`CsvConnector`), Datums-/Typ-Validierung.
- Objektkatalog-Import (beide Kinds), Katalog-Pane, Anwenden auf Auswahl, Katalogprüfung + Quick-Fixes, Katalog→IDS-Generator.
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

## M6 — Portal + Versionierung + Team

- MKP-Portal: Login, Bäume, Zuordnen/Import, Mapping-Editor, Mock-Modus (Portierung; `tests/portal.test.ts` grün).
- Versionierung: Commit/Push/Pull gegen `/server`, Historie- und Diff-UI (GlobalId + Feld-Diffs), ChangeSets.
- Optional: ifc-lite-Server-Anbindung (Cache/Parquet) für Team-Betrieb.

## M7 — Politur & Release

- Föderations-/Koordinations-Workspace, 2D-Ableitungen, Export-Menü (glTF/CSV/JSON-LD/Parquet/IFC5), ifcZIP.
- Performance-Pass (1-GB-Modell), Installer-Signierung, Auto-Update (Tauri Updater), Handbuch.
- Backlog-Kandidaten ab hier: Kollaboration (CRDT), MCP/KI-Assistent, Scripting-SDK, CLI, Punktwolken, Lens/Solar.

## TestStrategie (durchgängig)

- **Verhaltensreferenz:** die 1.x-Testsuiten (`ifc`, `catalog`, `portal`, `versioning` — zusammen ~100 Tests) werden je Meilenstein auf die neue Domänenschicht portiert; sie definieren die Editier-Semantik unabhängig vom alten Parser.
- Vitest für Domäne/Commands, Playwright-Rauchtests für die Shell, ein Windows-CI-Runner für Tauri-Builds.
- Golden-File-Tests: Referenz-IFCs → Editieroperation → erwarteter STEP-Output.
