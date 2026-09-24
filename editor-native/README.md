# IFCnative (nativ)

Nativer IFC-Editor für Windows – komplett in **Rust**: eigener STEP-Parser, eigenes
editierbares Dokumentmodell, eigener Geometrie-Kernel und eigener GPU-Renderer
(wgpu → Direct3D 12/Vulkan). Die Oberfläche ist mit egui gebaut (Docking-Layout,
frei anordenbare Panels). Keine Web-Technologie, kein JavaScript, keine IFC-Fremdbibliothek.

## Aufbau

| Crate | Inhalt |
| --- | --- |
| `crates/ifc-doc` | STEP-Parser (parallel), Schema-Tabellen IFC2X3/IFC4/IFC4X3, Dokumentmodell mit Undo/Redo, Modellabfragen (Raumstruktur, Psets, Mengen, Typ, Material, Klassifikation, Gruppen, Einheiten), Editier-Operationen, Material-Editor, Tabellenimport, Zusammenführen, Schema-Prüfung, IDS-Prüfung, Modellvergleich, CSV/XLSX-Export |
| `crates/ifc-geom` | Geometrie-Kernel: Platzierungen, Profile (parametrisch, beliebig, zusammengesetzt, abgeleitet), Kurven (Polyline, IndexedPolyCurve, CompositeCurve, TrimmedCurve, Kreis/Ellipse, B-Spline), Extrusion, Rotation, Sweeps, Faceted/Advanced BRep, Face-Sets, Mapped Items, CSG-Primitive, Boolesche Operationen (BSP-CSG), Öffnungen, Stile/Farben |
| `app` | Desktop-App (`IFCnative.exe`) |
| `tools/gen_schema.py` | Generator der Schema-Tabellen |

## Performance-Design

- Datei wird einmal gelesen; jede Entity ist ein 16-Byte-Record, der in die
  Original-Bytes zeigt. Argumente werden erst bei Bedarf geparst.
- Paralleler Scan (Chunks mit Grenzprüfung) und paralleler Aufbau des
  Inverse-Referenz-Index (CSR + Overlay für Änderungen).
- Änderungen tauschen nur Records → Undo/Redo kostet praktisch nichts.
- Geometrie wird parallel erzeugt und **während des Ladens gestreamt**
  (Struktur und Eigenschaften sind sofort bedienbar).
- Rendering in großen GPU-Blöcken (256k Vertices), Sichtbarkeit/Auswahl/Farben
  über einen Objektstatus-Puffer – Ausblenden, Isolieren, X-Ray und Einfärben
  laden keine Geometrie neu hoch.
- Nach Edits werden nur die betroffenen Produkte neu trianguliert.

Messwerte (4 Kerne, Linux): 405 MB / 8,2 Mio. Entities → Parsen + Index in ~1,1 s,
komplettes Laden inkl. 30.300 Objekten / 6 Mio. Dreiecken ~2,5–3 s,
Schema-Prüfung aller Entities ~0,7 s, Speichern ~0,3 s.

## Funktionen

**Dateien & Dokumente**
- Öffnen/Speichern (`.ifc`, `.ifczip`), mehrere Dokumente als Tabs, zuletzt geöffnete
  Dateien, Drag & Drop, Neues Projekt (Schema, Projekt/Grundstück/Gebäude, Geschosse),
  Autosicherung mit Wiederherstellung, Notizen je Datei
- **Föderierte Ansicht**: alle geöffneten Modelle gemeinsam im 3D-Viewer (je Modell eine
  GPU-Ebene, andere Modelle optional abgeblendet, Klick wechselt das aktive Modell)
- **Modelle zusammenführen / Objekte kopieren** zwischen geöffneten Modellen
  (Projekt/Kontexte/Owner History werden abgebildet, Geschosse nach Name/Höhe zugeordnet,
  GUID-Konflikte gelöst)
- Workspaces (Panel-Layouts), Befehlspalette (Strg+K), Fenster-Menü, Tastenkürzel

**3D-Ansicht**
- Orbit/Pan/Zoom zum Cursor, Drehen um angeklickten Punkt, WASD/QE, ViewCube,
  Standardansichten, Perspektive/Orthografisch, Bodenraster, Kanten
- Auswahl (Klick, Strg, Rahmen), Ausblenden/Isolieren, X-Ray, Schnittebenen,
  Grundriss je Geschoss, Messen mit Punktfang, Koordinaten picken,
  Verschieben-/Drehen-Gizmo
- Einfärben nach Klasse/Geschoss/Material/Eigenschaft (mit Legende)
- Kontextmenü: Einfärben, Material zuweisen, „Hier hinzufügen“ (Quader/Zylinder/Markierung),
  Geometrie entfernen, gleicher Typ, GlobalId kopieren, Kopieren nach …

**Bearbeiten**
- Eigenschaften: alle Attribute (Enums als Auswahl), Psets/Mengen bearbeiten,
  anlegen, umbenennen, löschen, Datentypen, geteilte Psets optional trennen,
  Typ, Material, Klassifikationen, Dokumente/Bibliotheken/Freigaben, Beziehungen,
  Roh-STEP, Klasse ändern
- Pset-Stapel: Werte über viele Objekte setzen/entfernen/ersetzen, umbenennen,
  **Datentyp umwandeln**, leere Psets anlegen, Objekte nach Wert auswählen,
  Matrix-Bearbeitung in der Tabelle
- **Tabellenimport** (CSV/TSV/XLSX/Zwischenablage): Schlüsselspalte (GlobalId,
  #STEP-Id, Tag, Name), automatische Spaltenzuordnung (Attribute, Pset.Eigenschaft,
  `*.Eigenschaft`, Qto_ als Mengen), Vorschau alt → neu, ein Rückgängig-Schritt
- Tabelle: editierbare Spalten, alle Eigenschaften als Spalten, Export
  (Zwischenablage/CSV/XLSX)
- Erstellen: Bauteile als Quader/Zylinder/Ellipse/Polygon, Reihen, Geschosse,
  Raumstruktur ergänzen, Duplizieren, Abmessungen ändern, Teilen/Zusammenfassen
- **Material-Editor**: Materialfarbe/Transparenz, Materialeigenschaften mit Vorlagen
  (Pset_MaterialCommon/Thermal/Mechanical/Concrete/Steel/Wood …), Schichtaufbauten,
  Bestandteile und Materiallisten bearbeiten (Dicke, Anteil, Kategorie, Reihenfolge),
  Schichtverwendung (Richtung/Sinn/Versatz), Materialien zusammenführen, unbenutzte bereinigen
- Objekte einfärben (IfcStyledItem je Geometrie-Element)
- Gruppen/Systeme/Zonen/Inventar: nach Kategorie, Mitgliedschafts-Manager für die
  Auswahl, Mitglieder isolieren/ausblenden/einfärben
- Beziehungsgraph: Tiefe 1–3, Filter nach Beziehungsart, Beziehungen anlegen/lösen

**Prüfen & Auswerten**
- Modellprüfung inkl. **Schema-Konformität** aller Entities (Pflichtattribute,
  Verweise, Klassen, Aufzählungen), GlobalIds, Raumstruktur, Platzierung, Geometrie,
  Psets, Öffnungen, ungenutzte Daten – mit Ein-Klick-Korrekturen
- IDS 1.0: alle Facetten, Restriktionen, Kardinalitäten, ifcVersion, automatische
  Neuprüfung; Bericht als CSV und BCF; GlobalId-/Tag-Suche
- Kollisionsprüfung (Klassen gegen Klassen, Toleranz), BCF-Export
- Modellvergleich (GlobalId-basiert)
- Statistik, Mengenermittlung aus Geometrie (Qto_…BaseQuantities)
- **Raumbuch**: Fläche, Umfang, Höhe, Volumen je Raum aus der Geometrie, Summen je Geschoss,
  Excel-Export, Mengen zurückschreiben

**Export**
- Auswahl als IFC, Eigenschaften/Tabellen als CSV/XLSX, Geometrie als GLB/OBJ
- **Grundriss/Schnitt als SVG (1:100) und DXF** (Schnittflächen je Klasse,
  Ansichtslinien unter der Schnitthöhe)

## Bauen

```bash
cd editor-native
cargo run --release -p ifcnative-app -- pfad/zur/datei.ifc
```

Windows-Build (nativ unter Windows mit MSVC oder per Cross-Compile von Linux):

```bash
rustup target add x86_64-pc-windows-gnu
sudo apt install mingw-w64
cargo build --release --target x86_64-pc-windows-gnu -p ifcnative-app
# -> target/x86_64-pc-windows-gnu/release/IFCnative.exe
```

Installer: `installer/ifcnative.iss` (Inno Setup, registriert `.ifc`/`.ifczip`).

Tests: `cargo test --workspace`.
