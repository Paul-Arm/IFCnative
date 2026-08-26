# 03 — Kernfeatures im Detail

Die fünf vom Auftraggeber priorisierten Bereiche, jeweils mit Zielbild, technischer Umsetzung und Abnahmekriterien.

---

## 1. Batch-Pset-Bearbeitung

**Zielbild:** Der 1.x-„Pset Batch"-Pane (Matrix über die Mehrfachauswahl) wird zum vollwertigen Massen-Editor mit Vorschau, Regelauswahl und Tabellen-Roundtrip.

### Umsetzung

- **Auswahlquellen:** (a) Mehrfachauswahl aus Baum/Viewer/Graph wie 1.x; (b) **neu:** Abfrage-basierte Auswahl über `@ifc-lite/query` („alle IFCWALL im EG", „alle Elemente mit Pset_X.Y = Z", optional SQL) — Ergebnis wird zur Batch-Auswahl.
- **Matrix-UI (Parität):** je Pset eine Tabelle, Zeilen = Properties, Spalten = Objekte; Abdeckungs-Badge `n/m` mit Warnton; divergente Werte hervorgehoben; Commit-on-blur/Enter (behebt zugleich das offene 1.x-Todo „Inputs debouncen").
- **Schreibpfad:** alle Batch-Aktionen laufen über die `BulkQueryEngine` von `@ifc-lite/mutations`:
  - `engine.preview(query)` → **Vorschau-Dialog** (betroffene Objekte, alte → neue Werte) vor `engine.execute()`. Neu gegenüber 1.x, wo direkt geschrieben wurde.
  - Eine Batch-Aktion = **ein** Undo-Schritt = eine Audit-Zeile („Property ‚FireRating' auf 37 Objekte gesetzt").
- **Aktionen (Parität + neu):** neues Pset auf Auswahl (idempotent), Property auf Auswahl (legt fehlende Psets an), Werte je Zelle/je Zeile, Datentyp je Property zentral ändern (typisiert: LABEL/TEXT/IDENTIFIER/REAL/INTEGER/BOOLEAN/DATE/DATETIME + LIST/ENUM/BOUNDED/TABLE), Pset aus Objektkatalog-Klasse anwenden; **neu:** Wert-Formeln (z. B. aus anderem Property übernehmen), Suchen/Ersetzen über die Auswahl.
- **Tabellen-Roundtrip:** Export der Matrix als xlsx/CSV, Wiedereinlesen über `CsvConnector` (Spalten→Property-Mapping, Matching per GlobalId) — damit sind externe Massenpflege-Workflows (Excel) erstmals geschlossen. 1.x konnte xlsx nur lesen (Katalog).
- **Validierung beim Eintippen:** Datentyp-Prüfung, Datums-/Zeit-Picker (offenes 1.x-Todo), Einheiten-Hinweise aus dem Katalog.

### Abnahme

- 500 Objekte, Property setzen: ein Undo-Schritt, < 1 s, Vorschau zeigt exakt die Änderungen.
- xlsx-Export → extern ändern → Import → Diff zeigt nur die geänderten Zellen.
- Divergenz-/Abdeckungsanzeige identisch zu 1.x-Verhalten (Testreferenz `tests/ifc.test.ts`).

---

## 2. Geometrie erstellen und bearbeiten

**Zielbild:** Der 1.x-Baukasten (Extrusionskörper mit Profilbibliothek) plus echte Bearbeitung bestehender Geometrie und Öffnungen — auf Basis der ifc-lite-Element-Builder und des exakten CSG-Kernels.

### Umsetzung

- **Erstellen (Parität):** Baukasten-Pane mit Klasse (Elementtypen wie 1.x inkl. Sensor/Aktor-Technikklassen), Name/Tag, Profil (Rechteck, Zylinder, Ellipse, Dreieck, **Positionsmarker**), Maße in m, Platzierung „als Kind der Auswahl"/„am Parent"/Weltkoordinaten, Koordinatenquelle Viewer-Pick oder Zwischenablage (mehrere Textformate). Schreibpfad: ifc-lite-Element-Builder (`addColumnToStore`, `addWallToStore`, `addSlabToStore`, …) erzeugen komplette Teilgraphen (Placement + Profil + Repräsentation); für die eigenen Profile (Positionsmarker, Dreieck, Ellipse) ergänzt die Domänenschicht `IFCARBITRARYCLOSEDPROFILEDEF`-Builder.
- **Bearbeiten:**
  - Maße bestehender Extrusionen über `setPositionalAttribute` (z. B. `IfcRectangleProfileDef.XDim`, `IfcExtrudedAreaSolid.Depth`) — mit sofortigem Renderer-Mirror.
  - Platzierung numerisch (lokal/Welt) und per **Transform-Gizmo** (Verschieben W / Rotieren R) im Viewer; Drag-Ende committet eine Mutation. Die 1.x-Weltkoordinaten-Mathematik (georeferenzierte/rotierte Sites, mm/m/ft-Einheitenskalen, geteilte Extrusionsrichtungen isolieren) wird als Testreferenz übernommen.
  - Körper an Bestandsobjekt zuweisen / entfernen inkl. Placement-Reparatur (Parität).
- **Öffnungen (neu):** Workflow Host wählen → Öffnung erzeugen (`IFCOPENINGELEMENT` + `IFCRELVOIDSELEMENT`) → optional Füllung (Tür/Fenster + `IFCRELFILLSELEMENT`). Darstellung über den exakten CSG-Kernel („watertight" Boolean-Differenzen) — 1.x konnte Öffnungen gar nicht darstellen.
- **Löschen:** Kaskadenplan-Dialog wie 1.x (Kinder, referenzierende Beziehungen, exklusive Ressourcen; geteilte bleiben erhalten), umgesetzt über Tombstoning (`removeEntity`).
- **Live-Mirror:** create/replace/move/remove patchen den WebGPU-Szenengraphen direkt; „Modell neu berechnen" bleibt als Fallback mit Änderungszähler-Badge.

### Abnahme

- Jeder 1.x-Body-Test (Rechteck/Zylinder/Ellipse/Dreieck/Positionsmarker, Zuweisung, Entfernung, Placement-/Rotations-/Einheiten-Fälle) läuft grün gegen die neue Domänenschicht.
- Wand mit Tür-Öffnung: exportiertes IFC öffnet in einem Fremdviewer korrekt (Loch sichtbar).
- Gizmo-Move auf georeferenziertem Modell schreibt kleine lokale Koordinaten (kein Welt-Offset-Leak).

---

## 3. Objektkatalog-Einbindung

**Zielbild:** Der openSIM-Objektkatalog (BWD „Diagnostik" / MON „Monitoring", xlsx) bleibt die fachliche Quelle für Klassen, Psets, Merkmale, LoI und Gewerke-Marker — und wird zusätzlich zur Prüfquelle (IDS).

### Umsetzung

- **Import (Parität):** `parseCatalogWorkbook`-Portierung: Kind-Autoerkennung (Diagnostik: Klassen-Sheets + Master-Sheets; Monitoring: Property-Sheet mit Element-Spalte), Pset-/Property-/Wertetyp-/Format-/Einheit-/Pflicht-Parsing, TM-Gewerke-Marker, LoI 100–500.
- **Katalog-Pane (Parität):** Import, Kind-Wahl, durchsuchbare Klassenliste, Detailansicht, Import-Diagnostik.
- **Anwenden:** Katalog-Klasse auf Auswahl (Batch-Pset-Pfad, ein Pset je Merkmalsgruppe, leere Werte mit Katalog-Typen) + Klassifikationsreferenz („openSIM BIM Objektkatalog"); Klassenvorschlag je Entity (Parität).
- **Prüfung + Quick-Fixes (Parität):** Findings `class-mismatch | missing-classification | missing-pset | missing-property | property-type-mismatch | empty-required-value`, Fixes einzeln/alle.
- **Neu — Katalog→IDS-Generator:** aus einer Katalogklasse (optional gefiltert nach LoI-Stufe und Gewerk) wird ein IDS-1.0-Dokument generiert (Entity-/Classification-/Property-Facetten, Pflicht = required). Die Katalogprüfung läuft damit **primär über die ifc-lite-IDS-Engine** (ifc-lite-zuerst-Prinzip) → einheitliches Prüfzentrum, BCF-Export, 3D-Highlight inklusive; der generierte IDS ist exportierbar (Weitergabe an Dritte). Die portierte 1.x-Prüflogik bleibt nur dort im Spiel, wo IDS nicht reicht: Ableitung der **Quick-Fixes** (fehlendes Pset/Klassifikation anlegen) und Klassenvorschlag.
- **Portal-Kopplung (Parität):** MKP-Portal-Import nutzt die Katalog-Psets (`ePset_*`, `Pset_MarxKrontalBWD`, Verfahren-Registry, Dot-ID-Konvention) unverändert; alle 23 Portal-Tests werden als Verhaltensreferenz portiert.

### Abnahme

- Beide Katalog-xlsx-Varianten importieren mit identischem Ergebnis zu 1.x (Testreferenz `tests/catalog.test.ts`).
- Katalogklasse → IDS → Prüfung markiert dieselben Objekte wie die native Katalogprüfung.
- Portal-Komplettimport erzeugt die Referenz-IFC-Struktur (Beispiel-IFC-Test) unverändert.

---

## 4. IFC-Prüfung (Prüfzentrum)

**Zielbild:** Ein zentraler „Prüfung"-Workspace, der vier Prüfquellen zusammenführt und einheitlich berichtet.

### Prüfquellen

1. **Modell-Diagnostik** (Parität, L+/P): Schema/Einheiten fehlen, physische Produkte ohne Placement/Repräsentation, hängende Referenzen, Containment-Sanity, Beziehungs-Endpunkt-Kompatibilität, doppelte/fehlende GlobalIds.
2. **IDS 1.0** (neu, `@ifc-lite/ids`): externe IDS-Dateien laden + aus Katalog generierte IDS; alle 6 Facetten (Entity, Attribute, Property, Classification, Material, PartOf), Constraints Simple/Pattern/Enumeration/Bounds; Ausführung im Web-Worker.
3. **Objektinfo-Prüfung** (Parität, P): `ePset_Objektinformation`-Familie — 8 Finding-Arten (fehlende/doppelte/leere IDs, fehlende/mehrdeutige/leere/externe Referenzen, unreferenzierte IDs), ID-Register + Referenzliste, Click-to-open.
4. **Clash Detection** (neu, `@ifc-lite/clash`): Kollisionsprüfung innerhalb des Modells und zwischen föderierten Modellen (Koordinations-Workspace).

### UI & Berichtswesen

- Prüfzentrum-Pane: Quellen an-/abwählbar, Severity-Zähler, Filter (alle/nur Fehler/nur bestanden), Findings-Liste mit Sprung zu Entity/3D.
- 3D-Kopplung: Fehlschläge rot, optional Bestanden grün (IDS-Feature), Isolation der betroffenen Elemente.
- **BCF-Export** der Fehlschläge als Topics (`@ifc-lite/bcf`) — Übergabe an Koordinationstools; deutscher Report (ifc-lite liefert de/en/fr).
- Quick-Fixes bleiben quellenspezifisch (Katalog-Fixes, GlobalId-Reparatur, Placement-Default) und laufen über die Command-Pipeline (undo-bar).
- **Export-Guard** (Parität): vor dem Speichern Geometrie-Zusammenfassung + Verifikations-Reparse; Export mit harten Fehlern wird blockiert, Warnungen werden angezeigt.

### Abnahme

- buildingSMART-IDS-Testsuite (offizielle Testfälle) läuft mit erwartbaren Ergebnissen.
- Objektinfo-Findings identisch zu 1.x auf dem Referenzmodell.
- BCF-Datei aus Fehlschlägen öffnet in einem Fremd-BCF-Tool.

---

## 5. ifc-lite-Paketkatalog — Verwendungsentscheidung je Paket

Grundsatz (Leitplanke 1): **ifc-lite-Lösung bevorzugen**; Eigenbau nur, wenn unsere Lösung deutlich besser oder fachspezifisch ohne Pendant ist. Alle 38 Pakete aus `packages/` (Stand Juli 2026), Status: ● Kernumfang · ◐ nach Parität · ○ Backlog · ✕ nicht verwendet.

### Kern: Parsen, Daten, Geometrie, Rendering

| Paket | Zweck | Verwendung in 2.0 | Status |
| --- | --- | --- | --- |
| `@ifc-lite/parser` | STEP-Parsing IFC2X3/IFC4/IFC4X3, Entity-Extraktion, Schema-Registry | einziger Lesepfad (ersetzt web-ifc **und** eigenen Parser) | ● |
| `@ifc-lite/data` | kolumnare Datenstrukturen | Modell-Datenhaltung aller Panes | ● |
| `@ifc-lite/wasm` | WASM-Bindings des Rust-Kerns (`IfcAPI`) | Browser-/Dev-Fallback; im Tauri-Backend läuft derselbe Kern nativ | ● |
| `@ifc-lite/geometry` | Tessellierung, exakter CSG-Kernel, `GeometryProcessor` mit Platform-Bridge | Geometrie-Pipeline (nativ via Tauri-Bridge) | ● |
| `@ifc-lite/renderer` | WebGPU-Renderer, Streaming, Batching, Picking, Sectioning, X-Ray, Heatmaps | der 3D-Viewer | ● |
| `@ifc-lite/spatial` | räumlicher Index, Culling | Picking/Kamera/Nachbarschaftssuchen, Clash-Vorfilter | ● |
| `@ifc-lite/cache` | binäres Cache-Format `.ifc-lite` | lokaler Modell-Cache: zweites Öffnen großer Dateien nahezu sofort | ● |
| `@ifc-lite/encoding` | STEP-String-Kodierung | ersetzt unser `stepEncoding.ts`; Umlaut-Tests (R3) laufen dagegen | ● |
| `@ifc-lite/ifcx` | IFC5/IFCX (JSON) lesen/schreiben | IFCX-Import/-Export | ◐ |
| `@ifc-lite/pointcloud` | Punktwolken | Backlog | ○ |

### Editieren & Erzeugen

| Paket | Zweck | Verwendung in 2.0 | Status |
| --- | --- | --- | --- |
| `@ifc-lite/mutations` | Overlay-Editing (Psets, Mengen, Attribute, positionale Argumente, `addEntity`/`removeEntity`), Undo/Redo, `BulkQueryEngine`, `CsvConnector`, `ChangeSetManager` | gesamter Schreibpfad inkl. Batch; **auch Undo/Redo kommt von hier** (eigener Anteil nur Audit-Zeilen + Operationsnamen) | ● |
| `@ifc-lite/create` | IFC von Grund auf, Element-Builder (`addWallToStore` …) | Baukasten, neues Projekt, Portal-Import-Unterbau (später) | ● |
| `@ifc-lite/export` | STEP (mit Mutations-Overlay), glTF/GLB, CSV, JSON-LD, Parquet, IFC4↔IFC5 | Speichern + Export-Menü (ersetzt auch `/IfcToGlb`) | ● |
| `@ifc-lite/merge` | Modelle zusammenführen/föderieren | Koordinations-Workspace, Modell-Merge | ◐ |

### Abfragen, Auswertungen, Sichten

| Paket | Zweck | Verwendung in 2.0 | Status |
| --- | --- | --- | --- |
| `@ifc-lite/query` | Fluent-Query + SQL (DuckDB-WASM) | abfragebasierte Auswahl (Batch), Berichts-Pane | ● |
| `@ifc-lite/lists` | Bauteillisten/Schedules: konfigurierbare Spalten (Attribute/Properties/Mengen/Material/Klassifikation), Gruppierung/Aggregation, CSV-Export mit Formel-Injection-Schutz, Presets, föderationsfähig | **neues „Listen"-Pane**; ersetzt zugleich den fehlenden 1.x-xlsx-Export; Spalten-Discovery füttert den Spalten-Picker | ● |
| `@ifc-lite/lens` | regelbasiertes Einfärben/Filtern/Verstecken je Klasse/Property/Material/…, Presets, „first match wins", Ghosting | **„Lens"-Pane** statt Eigenbau-Färbelogik; Prüfzentrum nutzt Lens für rot/grün-Darstellung | ● |
| `@ifc-lite/diff` | zwei Modellstände vergleichen | Vergleichs-Pane (Datei A vs. B) **und** Versions-Diff im IFC-Hub (§6) | ◐ |
| `@ifc-lite/drawing-2d` | 2D-Ableitungen (Grundrisse/Schnitte) | 2D-Pane | ◐ |

### Prüfung & Koordination

| Paket | Zweck | Verwendung in 2.0 | Status |
| --- | --- | --- | --- |
| `@ifc-lite/ids` | IDS 1.0 komplett (6 Facetten, Regex/Bounds/Enum), Worker-Ausführung, Reports (de) | Prüfzentrum-Kern; Katalog-Prüfung läuft primär als generiertes IDS hierüber | ● |
| `@ifc-lite/bcf` | BCF lesen/schreiben | BCF-Export der Prüfergebnisse; BCF-Import/Themenliste | ●/◐ |
| `@ifc-lite/clash` | Kollisionsprüfung | Prüfzentrum/Koordination | ◐ |

### Plattform, Automatisierung, Erweiterbarkeit

| Paket | Zweck | Verwendung in 2.0 | Status |
| --- | --- | --- | --- |
| `@ifc-lite/sdk` | Scripting-API (`bim.*`) | Grundlage für Makros/Automatisierung im Editor | ◐ |
| `@ifc-lite/extensions` | Erweiterungssystem (`.iflx`: Commands, Panels, Lenses, Exporter, Kontextmenüs; Capability-Gating) | Plugin-Mechanismus der App für Zusatzmodule; Kandidat für kundenspezifische Prüf-/Exportbausteine | ◐ |
| `@ifc-lite/sandbox` | QuickJS-WASM-Sandbox (Ressourcenlimits) für Extensions/Skripte | Ausführungsumgebung für Extensions und Nutzer-Skripte | ◐ |
| `@ifc-lite/provenance` | Nachverfolgung der Änderungsherkunft | Herkunfts-Spalte im Audit-/History-Log | ◐ |
| `@ifc-lite/mcp` | MCP-Server für KI-Agenten | Backlog: „KI-Assistent" (Modell abfragen/ändern per Agent) | ○ |
| `@ifc-lite/cli` | Terminal-Toolkit (inspect/query/validate/export/clash/merge/convert) | Backlog: Batch-Verarbeitung außerhalb der App; CI-Prüfungen | ○ |
| `@ifc-lite/codegen` | Schema-Codegenerierung (intern) | nur Build-Zeit-Abhängigkeit, keine App-Funktion | ✕ |
| `create-ifc-lite` | Projekt-Scaffolding (`npx create-ifc-lite`) | einmalig beim Aufsetzen in M0 | ✕ |

### Viewer-Apps, Embedding, Server, Kollaboration

| Paket | Zweck | Verwendung in 2.0 | Status |
| --- | --- | --- | --- |
| `@ifc-lite/viewer` / `apps/viewer` | fertige Viewer-App | **Referenzimplementierung** (Undo/Redo-Verkabelung, Renderer-Nutzung, IDS-UI); unsere Mosaic-Shell bleibt eigen, weil Workspaces/Panes/Graph deutlich über den Viewer hinausgehen | Referenz |
| `@ifc-lite/embed-sdk` / `embed-protocol` | Viewer per iframe einbetten/steuern | Backlog: Modell-Weitergabe an Dritte (z. B. Portal-Webansicht) | ○ |
| `@ifc-lite/server-client` | SDK zum ifc-lite-Server (Hash/Cache/Parquet/SSE) | Parse-/Geometrie-Offload im Team-Betrieb des IFC-Hubs (§6) | ◐ |
| `@ifc-lite/server-bin` | Server-Binary-Wrapper | Deployment-Baustein des zentralen IFC-Hubs (Docker/Binary) | ◐ |
| `@ifc-lite/collab-server` | Collab-Backend: Räume, Rollen (Viewer/Commenter/Editor/Admin), JWT-Auth, content-addressed Blob-Store; programmatisch einbettbar (`startCollabServer()`) | **Baustein des IFC-Hubs** (§6) — Auth/Rollen/Blob-Store sofort, Echtzeit-Räume später | ◐ |
| `@ifc-lite/collab` | Client-CRDT (Echtzeit-Editing auf IFCX, Live-Cursor) | Backlog: gemeinsames Editieren in Echtzeit | ○ |
| `@ifc-lite/solar` | Solar-/Verschattungsanalyse | Backlog | ○ |

## 6. IFC-Hub — Projekt- & Versionsverwaltung (Standalone + Team)

**Zielbild:** Ein Dienst, der IFCs und Projekte verwaltet und versioniert — **eine Codebasis, zwei Betriebsarten**: eingebettet in der App (jeder PC verwaltet seine IFCs standalone) und zentral deployt (das ganze Team arbeitet gegen denselben Hub).

### Was ifc-lite liefert und was fehlt

Der ifc-lite-Collab-Server bietet Echtzeit-Räume (CRDT), Rollenmodell (Viewer/Commenter/Editor/Admin), JWT-Auth, content-addressed Blob-Storage und ist **programmatisch einbettbar** (`startCollabServer()`, eigene Auth-/Storage-Hooks). Er hat aber laut Doku **keine Versionshistorie und keine Projektverwaltung** — genau diese dünne Schicht bauen wir selbst (ifc-lite-zuerst: alles andere kommt aus den Paketen).

### Funktionsumfang

- **Projektstruktur:** Projekte → Modelle → Versionsstände. Ein Versionsstand = IFC-Blob (content-addressed, dedupliziert) + Metadaten (Autor, Nachricht, Zeitstempel, Schema, Entity-Zahl).
- **Versionieren aus der App:** „Stand sichern" committet den aktuellen Export in den Hub; Historie-Ansicht je Modell; Stand öffnen/zurückholen; zwei Stände vergleichen (`@ifc-lite/diff`, Ergebnis im Vergleichs-Pane mit 3D-Highlight added/removed/modified).
- **Projekt-Browser-Pane** in der App: Projekte/Modelle/Stände durchsuchen, öffnen, committen — gegen den lokalen **oder** einen zentralen Hub (umschaltbar, beide gleichzeitig verbindbar).
- **Push/Pull:** Versionsstände zwischen lokalem und zentralem Hub übertragen; content-addressed → nur fehlende Blobs wandern (Dedup wie beim ifc-lite-Server-Cache).
- **Team-Betrieb:** Rollen/Auth vom Collab-Server (JWT, Rollen je Projekt), Blob-Store auf S3/Filesystem, Postgres für den Katalog; Docker-Deployment.
- **Standalone-Betrieb:** Sidecar in der Tauri-App auf `localhost`, SQLite + App-Datenverzeichnis; null Konfiguration, läuft immer.
- **Später (Backlog):** Echtzeit-Räume des Collab-Servers aktivieren (gemeinsames Editieren, Live-Cursor), IFC-Modell-Branches + Entity-Merge (Drei-Wege), Web-Zugriff auf den zentralen Hub über `embed-sdk`.

### Technik

- Hub-Prozess: Node/TypeScript (weil `startCollabServer()` eine Node-API ist), gebündelt als Tauri-**Sidecar-Binary**; identisches Artefakt läuft im Docker-Container. Persistenzadapter: SQLite/Dateisystem (standalone) ↔ Postgres/S3 (zentral).
- Erfordert persistenten Prozess (Collab-Räume halten Zustand im Speicher) — kein Serverless; für den zentralen Betrieb ein kleiner Dauerdienst.
- Diff-Detailtiefe: primär `@ifc-lite/diff`; falls Feld-genaue Diffs je Entity fehlen (M0-Prüfpunkt), wird `entityFieldDiff`/`buildVersionManifest` aus `src/ifc/versioning` (React-Projekt) portiert.

### Abnahme

- Standalone: App ohne jede Konfiguration → IFC öffnen → „Stand sichern" → Historie zeigt Commit; alter Stand lässt sich öffnen und mit dem aktuellen vergleichen.
- Team: zentraler Hub per Docker; zwei Clients committen abwechselnd; Push/Pull synchronisiert; Rollen greifen (Viewer kann nicht committen).
- Re-Export ohne inhaltliche Änderung erzeugt einen als „identisch/leer" erkennbaren Diff.

## 7. Eigenbau nur noch hier (Begründung „deutlich besser / kein Pendant")

1. **Beziehungsgraph-Editor** (React Flow, Presets, Legalitätsregeln, Kante-ziehen-erzeugt-Entity) — kein ifc-lite-Pendant.
2. **Objektkatalog-Import + Quick-Fixes** (openSIM-xlsx-Formate) — fachspezifisch; Prüfung läuft aber über deren IDS-Engine (Katalog→IDS-Generator).
3. **Objektinfo-Prüfung** (`ePset_Objektinformation`-Querverweis-Register: Duplikate, tote/mehrdeutige Referenzen) — Querverweis-Semantik ist mit IDS-Facetten nicht abbildbar.
4. **IFC-Hub-Katalogschicht** (Projekte → Modelle → Versionshistorie, §6) — ifc-lite hat dokumentiert **keine** Versionshistorie und **keine** Projektverwaltung (der Collab-Server macht nur Echtzeit-Sitzungen); die dünne Eigenschicht sitzt auf `collab-server`/`diff`/`cache`. Feld-genauer Diff-Fallback ggf. aus `src/ifc/versioning` (React-Projekt).
5. **Welt-Frame-/Georeferenz-Mathematik, Löschkaskaden-Plan, Baum-Kindklassen-Regeln, Transform-Gizmo** — Editor-Spezifika ohne Paket-Pendant, implementiert **auf** parser/mutations/renderer.
6. **MKP-Portal-Integration** — fachspezifisch, ganz ans Ende verschoben (Backlog, siehe Roadmap).
