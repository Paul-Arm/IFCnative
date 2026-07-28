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
- **Neu — Katalog→IDS-Generator:** aus einer Katalogklasse (optional gefiltert nach LoI-Stufe und Gewerk) wird ein IDS-1.0-Dokument generiert (Entity-/Classification-/Property-Facetten, Pflicht = required). Damit läuft die Katalogprüfung wahlweise über dieselbe IDS-Engine wie externe Prüfregeln → einheitliches Prüfzentrum, BCF-Export, 3D-Highlight inklusive. Der generierte IDS ist exportierbar (Weitergabe an Dritte).
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

## 5. Übernahme aller ifc-lite-Features

Vollständige Liste der ifc-lite-Fähigkeiten und wie 2.0 sie exponiert. Priorität: ● Kernumfang · ◐ nach Parität · ○ Backlog/als API vorhanden.

| ifc-lite-Feature (Paket/Guide) | 2.0-Exponierung | Prio |
| --- | --- | --- |
| Parser IFC2X3/IFC4/IFC4X3/IFC5-IFCX, kolumnar (`parser`, `flavors`) | Öffnen aller Schemata; IFCX-Import | ● |
| Streaming-Geometrie + WebGPU-Renderer (`geometry`, `renderer`) | Standard-Viewer, Tessellationsqualität 5-stufig einstellbar | ● |
| Nativer Rust-Fast-Path (Tauri, `desktop`) | Backend der Windows-App | ● |
| Mutations + Undo/Redo (`mutations`) | gesamter Editierpfad | ● |
| Bulk-Edits + CSV (`BulkQueryEngine`, `CsvConnector`) | Batch-Pset-Editor | ● |
| Element-Builder / IFC von Grund auf (`create`) | Baukasten, neues Projekt | ● |
| Exakter CSG-Kernel | Öffnungen/Voids | ● |
| STEP-Export mit Mutations-Overlay (`export`) | IFC speichern | ● |
| IDS-Validierung (`ids`) | Prüfzentrum | ● |
| BCF (`bcf`) | Prüfzentrum-Export; BCF-Import/Viewer | ●/◐ |
| Query-Engine + SQL/DuckDB (`query`, `querying`) | Abfrage-basierte Auswahl, Berichts-Pane | ◐ |
| Model-Diff (`model-diff`) | Versions-/Vergleichs-UI (mit `/server`) | ◐ |
| Föderation/Merge (`federation`) | Koordinations-Workspace (mehrere Modelle) | ◐ |
| Clash Detection (`clash`) | Prüfzentrum | ◐ |
| 2D-Ableitungen (`drawing-2d`) | Grundriss-/Schnitt-Pane | ◐ |
| Export glTF/GLB, CSV, JSON-LD, Parquet (`exporting`) | Export-Menü (ersetzt IfcToGlb) | ◐ |
| Schema-Konvertierung IFC4 ↔ IFC5 | Export-Menü | ◐ |
| Server: Parquet/SSE/Cache (`server`) | optionaler Team-Modus, Thin-Client | ◐ |
| ChangeSets teilen (`ChangeSetManager`) | benannte Änderungssätze, Übergabe zwischen Instanzen | ◐ |
| Echtzeit-Kollaboration CRDT auf IFCX (`collab`, `collab-server`) | Backlog: gemeinsames Editieren | ○ |
| MCP-Server für KI-Agenten (`mcp`) | Backlog: „KI-Assistent"-Pane, Automatisierung | ○ |
| Scripting-SDK (`sdk`, `scripting-sdk`) | Backlog: Nutzer-Skripte/Makros | ○ |
| CLI (`cli`) | Backlog: Batch-Verarbeitung außerhalb der App | ○ |
| Lens/Solar-Analysen (`lens`, `solar`) | Backlog | ○ |
| Punktwolken | Backlog | ○ |
| Python-Wheel `ifclite-geom` | nicht Teil der App (Doku-Verweis) | ○ |
