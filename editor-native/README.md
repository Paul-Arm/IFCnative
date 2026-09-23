# IFCnative (nativ)

Nativer IFC-Editor für Windows – komplett in **Rust**: eigener STEP-Parser, eigenes
editierbares Dokumentmodell, eigener Geometrie-Kernel und eigener GPU-Renderer
(wgpu → Direct3D 12/Vulkan). Die Oberfläche ist mit egui gebaut (Docking-Layout,
frei anordenbare Panels). Keine Web-Technologie, kein JavaScript, keine IFC-Fremdbibliothek.

## Aufbau

| Crate | Inhalt |
| --- | --- |
| `crates/ifc-doc` | STEP-Parser (parallel), Schema-Tabellen IFC2X3/IFC4/IFC4X3, Dokumentmodell mit Undo/Redo, Modellabfragen (Raumstruktur, Psets, Mengen, Typ, Material, Klassifikation, Gruppen, Einheiten), Editier-Operationen, IDS-Prüfung, Modellvergleich, CSV/XLSX-Export |
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
Speichern ~0,3 s.

## Funktionen

- Öffnen/Speichern (`.ifc`, `.ifczip`), mehrere Dokumente als Tabs, zuletzt geöffnete
  Dateien, Drag & Drop, Neues Projekt (Schema, Geschosse), Autosicherung
- 3D: Orbit/Pan/Zoom zum Cursor, Drehen um angeklickten Punkt, WASD/QE,
  Standardansichten, Perspektive/Orthografisch, Auswahl (Klick, Strg, Rahmen),
  Ausblenden/Isolieren/Alles zeigen, X-Ray, Schnittebenen (Achsen oder an Fläche),
  Messen mit Punktfang, Einfärben nach Klasse/Geschoss/Material/Eigenschaft,
  Bildschirmfoto
- Struktur: räumlich/Typen/flach, Suche (Name, Klasse, GlobalId, Tag, #Id),
  Sichtbarkeit je Knoten, Drag & Drop in Geschosse, Kontextmenü
- Eigenschaften: alle Attribute (Enums als Auswahl), Psets und Mengen
  bearbeiten/anlegen/umbenennen/löschen, geteilte Psets optional trennen,
  Typ, Material zuweisen/anlegen, Klassifikationen, Beziehungen,
  Roh-STEP bearbeiten, Klasse ändern
- Pset-Stapel: Werte über viele Objekte setzen/entfernen, Werteverteilung,
  CSV-Import (GlobalId/Tag/Name → Pset.Eigenschaft)
- Erstellen: Wände, Decken, Stützen, Träger, … als Quader/Zylinder, Reihen,
  Geschosse; Verschieben/Drehen; Abmessungen von Extrusionen ändern; Duplizieren
- Prüfung: GlobalIds, Raumstruktur, Platzierung, Geometrie, Psets, Öffnungen,
  ungenutzte Daten – mit Ein-Klick-Korrekturen
- IDS 1.0: alle Facetten, Restriktionen, Kardinalitäten; Bericht als CSV
- Vergleich zweier Modellstände (GlobalId-basiert, Attribute/Psets/Typ/Material/
  Platzierung/Geometrie)
- Gruppen/Systeme/Zonen, Materialbibliothek mit Schichtaufbauten,
  Tabellenansicht mit editierbaren Spalten, Statistik mit Volumen/Flächen,
  Beziehungsgraph
- Export: Auswahl als IFC, Eigenschaften als CSV/XLSX, Geometrie als GLB/OBJ

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
