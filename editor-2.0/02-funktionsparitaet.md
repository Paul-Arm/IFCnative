# 02 — Funktionsparität: React-Viewer 1.x → Editor 2.0

Quelle: vollständiges Feature-Inventar des React-Viewers (`/src`, Stand v1.4.8). Grundregel (Leitplanke 1): **bei jeder Zeile wird die ifc-lite-Lösung bevorzugt**; P/N nur, wo kein Paket existiert oder unsere Lösung deutlich besser ist (Begründungen in `03-kernfeatures.md` §5). Legende **Ansatz**:
- **L** = direkt durch ifc-lite-Paket abgedeckt
- **L+** = ifc-lite-Basis + eigene Aufsatzlogik
- **P** = Portierung eigenen 1.x-Codes (Logik existiert, wird auf ifc-lite-Store umgezogen)
- **N** = Neuentwicklung
- **T** = Tauri-Shell

## App-Shell / Dokumente

| 1.x-Funktion | 2.0-Ansatz | Anmerkung |
| --- | --- | --- |
| Mosaic-Panes (15 Stück), schließen/wiederherstellen | P | gleiche Pane-Liste, Titel deutsch |
| Workspaces: Editor/Review/Prüfung/Build/Koordination + eigene | P | Persistenz statt localStorage über Tauri-Store |
| Panes in echte OS-Fenster lösen | T | Tauri-Multi-Window statt `window.open`-Portal |
| Multi-Dokument-Tabs (Schema, Entity-Zahl, Dirty-Punkt, Schließen-Bestätigung) | P | je Tab ein ifc-lite-Store + Mutations-Overlay |
| IFC öffnen / mehrere hinzufügen / exportieren | L+T | nativer Pfad-Parse; Export `exportToStep(applyMutations)` |
| ifcZIP öffnen/schreiben | N+T | Zip-Handling in Rust (1.x konnte es nur in der Avalonia-Variante) |
| Undo/Redo (20 Schritte, benannte Operationen, Tooltips) | L | Undo/Redo-Stacks von `@ifc-lite/mutations` (Ctrl+Z/Ctrl+Shift+Z); eigener Anteil nur Operationsnamen/Tooltips |
| Audit-Log (Pseudocode-Zeile je Operation) | P | in Command-Pipeline |
| Statusleiste (Schema, Entities, Auswahl, Gespeichert/Ungespeichert), UI-Skalierung 70–125 % | P | |
| Theme hell/dunkel/System | P | |
| Tastatur: Undo/Redo, Delete, `.` zentrieren, Ctrl+F Pset-Suche, W/R/Esc Gizmo, Graph Copy/Paste | P | |
| Kürzlich verwendet (max 16) + Notizen-Pane | P+T | Dateisystem statt localStorage; Emergency-Save bleibt |
| Crash-Boundary mit Emergency-Save + Layout-Reset | P | |
| Beispielprojekt laden | L | `@ifc-lite/create` statt `builder.ts` |

## 3D-Viewer

| 1.x-Funktion | 2.0-Ansatz | Anmerkung |
| --- | --- | --- |
| Auswahl per Klick, Mehrfachauswahl, Sync Baum↔Graph↔Viewer↔Inspector | L+ | GPU-Picking (Color-ID) des Renderers + eigener Selection-Store |
| Multi-Modell-Szene (jeder Tab ein Modell, koordiniert) | L+ | Föderation ist ifc-lite-Feature |
| Zoom auf Modell / Kamera zurücksetzen / benannte Ansichten | L | ViewCube: N (kleine eigene Komponente) |
| Transform-Gizmo Verschieben/Rotieren mit Commit in IFC-Placement | N über L | Gizmo-Overlay + `setPositionalAttribute` auf Placement; Details `03-kernfeatures.md` |
| Live-Mirror editierter Geometrie ohne Voll-Reparse | L+ | Renderer-Patch (Mesh ersetzen/entfernen); Fallback „Modell neu berechnen" bleibt |
| Koordinaten picken + Koordinaten-Zwischenablage für Builder | P | Welt-/Modellkoordinaten-Mathematik aus `coordinateMapping.ts` übernehmen |
| Fortschrittsbalken Konvertierung, „3D laden"-Aufschub großer Modelle | L | Streaming-First macht Aufschub meist unnötig; Schwelle bleibt konfigurierbar |
| **neu in 2.0** | L | Schnittebenen, Isolation/Verstecken, X-Ray, Storey-Färbung, Heatmaps, Messen (sofern Renderer-Feature, sonst N) |

## Struktur & Graph

| 1.x-Funktion | 2.0-Ansatz | Anmerkung |
| --- | --- | --- |
| Virtualisierter Spatial-Baum mit Suche, Multi-Select (füttert Batch-Pset) | P | Datenquelle: ifc-lite Spatial-Hierarchie |
| Kontextmenü: IFC-legale Kind-Klassen je Parent, Löschen, Kamera | P | Regeln aus `constants.ts`/`relationshipRules.ts` |
| Graph (React Flow): Presets Übersicht/Räumlich/Eigenschaften/Ressourcen/Geometrie | P | `nativeGraph.ts` auf Store-Adapter umziehen |
| Tiefensteuerung 1–25, Beziehungstyp-Filter, Layouts columns/tension, Pinnen, Positionen persistent | P | `graphLayout.ts` ist UI-frei portierbar |
| Expand/Collapse je Knoten, Suche mit Vor/Zurück | P | |
| Kante in Leere ziehen → neuer verbundener Knoten (Klassen-/Beziehungswahl) | P | Schreiben via Domänenschicht (`addEntity`) |
| Zwei Knoten verbinden (endpoint-legal gefiltert), Beziehung löschen | P | |
| Copy/Paste von Knoten (verbunden/unverbunden) als echte IFC-Entities | P | |
| Graph-Warnungen für illegale Beziehungen | P | |

## Inspector

| 1.x-Funktion | 2.0-Ansatz | Anmerkung |
| --- | --- | --- |
| Übersicht: Modellstatistik, Identität (Klasse/Name/Beschreibung/GlobalId), typspezifische Attribute, räumlicher Pfad, Referenzen ein-/ausgehend, Einheiten | L+ | Attribute via `setProperty`/IfcRoot-Attribute; Klassenwechsel (Reclass) via Domänenschicht |
| Rohe STEP-Argumente editieren („Erweitert") | L+ | über positionale Attribute + `addEntity`-Ersatz; Sicherheitsnetz Verifikations-Reparse |
| Psets/Mengen: Suche, typisierte Werte (LABEL/TEXT/REAL/…/LIST/ENUM/BOUNDED/TABLE), Zeile hinzufügen/löschen, Pset umbenennen/duplizieren/löschen, Qto-Erzeugung | L+ | Kern über Mutations-API; Composite-Typen ggf. Domänenschicht |
| Platzierung: numerisch X/Y/Z lokal/Welt, Abmessungen des Swept Solid, Referenzkette als Chips | P über L | Weltkoordinaten-Frames aus 1.x übernehmen |
| Beziehungen: anlegen/ändern/löschen, Typzuweisung (`IFCRELDEFINESBYTYPE`) | P | |
| Material einfach + Materialstil (Farbe/Transparenz), Schichten (LayerSet/-Usage), Profile (ProfileSet/-Usage), Bestandteile (ConstituentSet) | P | reine `addEntity`-Domänenschicht; ifc-lite liest Materialien bereits |
| Gruppe/Zone/System/Asset-Zuordnung | P | |
| Klassifikation/Dokument/Bibliothek-Referenzen | P | |
| Freigaben (IfcApproval) & Constraints (IfcObjective) | P | |
| Einheiten anzeigen/SI-Einheit ergänzen | P | |

## Pset-Batch (Schwerpunkt — Details in `03-kernfeatures.md`)

| 1.x-Funktion | 2.0-Ansatz |
| --- | --- |
| Matrix je Pset: Zeilen = Properties, Spalten = ausgewählte Objekte, Abdeckungs-Badge n/m | P über L (`BulkQueryEngine`) |
| Divergente Werte hervorgehoben; Commit-on-blur | P |
| Neues Pset für ganze Auswahl (idempotent) | L+ |
| Pset aus Objektkatalog-Klasse auf Auswahl anwenden | P |
| Neue Property auf alle (Pset wird wo nötig angelegt) | L+ |
| Datentyp zentral je Property-Zeile ändern | L+ |
| **neu:** CSV/xlsx-Roundtrip, Preview vor Anwendung, Filter-basierte Auswahl | L (`CsvConnector`, `engine.preview()`) + N |

## Geometrie (Schwerpunkt — Details in `03-kernfeatures.md`)

| 1.x-Funktion | 2.0-Ansatz |
| --- | --- |
| Baukasten: Klasse, Name, Tag, Profile (Rechteck/Zylinder/Ellipse/Dreieck/Positionsmarker), Maße, Platzierung Parent/Welt, Koordinatenquelle Pick/Clipboard | L+ (Element-Builder) + P (Profilbibliothek) |
| Körper an Bestandsobjekt zuweisen / entfernen (Placement-Reparatur) | L+ |
| Placement numerisch/Gizmo ändern, Rotation, Welt-Frames auf georeferenzierten Sites | P über L |
| Löschkaskaden-Plan mit Dialog (Kinder, Beziehungen, exklusive Ressourcen) | P |
| **neu:** Öffnungen/Voids mit exaktem CSG, Wand/Decke/Stütze-Presets, Maßänderung bestehender Extrusionen | L (exakter CSG-Kernel, Builder, `setPositionalAttribute` z. B. `IfcRectangleProfileDef.XDim`) |

## Objektkatalog & Portal (Schwerpunkt — Details in `03-kernfeatures.md`)

| 1.x-Funktion | 2.0-Ansatz |
| --- | --- |
| xlsx-Import Diagnostik (openSIM BWD) / Monitoring (openSIM MON), Kind-Erkennung | P |
| Klassenliste mit Suche, Detailansicht, Import-Diagnostik | P |
| Katalog-Prüfung je Entity mit Quick-Fixes (Pset/Klassifikation ergänzen) | P |
| Klassenvorschlag beim Import | P |
| MKP-Portal: Keycloak-Login, Bauwerk/Projekt-Wahl, Diagnostik-/Monitoring-Baum, Zuordnen/Kinder/Komplettimport, deterministische GUIDs, Mapping-Editor + FreeCAD-Mapping-Roundtrip, Mock-Modus | P — **Backlog, ganz hinten** (nach M7); bis dahin 1.x für Portal-Arbeit weiterverwenden |

## Prüfung (Schwerpunkt — Details in `03-kernfeatures.md`)

| 1.x-Funktion | 2.0-Ansatz |
| --- | --- |
| Parser-/Modell-Diagnostik (Einheiten, Schema, Platzierung/Repräsentation, hängende Referenzen, Containment, Endpunkt-Kompatibilität) | L+ / P |
| Objektinfo-Prüfung `ePset_Objektinformation` (8 Finding-Arten, ID-Register, Referenzliste) | P |
| Beziehungslegalität in allen Erzeugen-Menüs + Graph-Warnungen | P |
| Export-Guard (Geometrie-Zusammenfassung, Verifikations-Reparse) | P |
| **neu:** IDS 1.0 (6 Facetten, Regex/Bounds/Enum), BCF-Export der Fehlschläge, 3D-Highlight rot/grün, deutscher Report, Clash Detection | L |

## Import/Export & Versionierung

| 1.x-Funktion | 2.0-Ansatz | Anmerkung |
| --- | --- | --- |
| IFC/STEP Import (einzeln/mehrfach, Worker) | L/T | zweites Öffnen beschleunigt über `@ifc-lite/cache` (`.ifc-lite`-Binärcache) |
| Export IFC (nur bei Dirty neu serialisieren) | L+ | Ziel: unveränderte Entities byte-stabil (Overlay-Prinzip); verifizieren in M0 |
| Portal-Mapping-JSON (FreeCAD) Export/Import | P | **Backlog** (Portal ganz hinten) |
| Beispielprojekt IFC4X3 | L | |
| **neu:** glTF/GLB, CSV, JSON-LD, Parquet, IFC5/IFCX-Export; 2D-Ableitungen | L | ersetzt auch `/IfcToGlb` |
| **neu:** Bauteillisten/Schedules mit Gruppierung/Aggregation + CSV | L | `@ifc-lite/lists` — deckt zugleich den in 1.x fehlenden Tabellen-Export ab |
| **neu:** regelbasiertes Färben/Filtern (Lens) | L | `@ifc-lite/lens`, auch als Darstellungsschicht des Prüfzentrums |
| Versionierung (1.x nur als Kern in `src/ifc/versioning`, ohne UI) | L+ | **neu: IFC-Hub** (Projekte/Modelle/Versionsstände, standalone + zentral, `03-kernfeatures.md` §6); Diff über `@ifc-lite/diff`, Feld-Diff-Fallback aus `src/ifc/versioning` |

## Bewusst nicht übernommen

- Zweiter (toter) web-ifc/ThatOpen-Lesepfad, `entityDiff.ts` (express-id-basiert), `coverage.ts` — ersatzlos; Diff läuft künftig GlobalId-basiert.
- Electron-Shell und deren IPC-Protokoll — ersetzt durch Tauri.
- Eigener STEP-Parser/Serializer (`nativeDocument.ts`) — ersetzt durch ifc-lite; nur die Writer-Semantik (welche Entities/Relationen entstehen) wird als Spezifikation für die Domänenschicht übernommen, abgesichert durch die portierten Tests (`tests/ifc.test.ts` als Verhaltensreferenz).
