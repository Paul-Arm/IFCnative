# 06 — Geometrie-Kern: Echtzeit-Bearbeitung großer Modelle

**Status:** Planungsdokument (2026-08-08), basiert auf einer 14-Agent-Recherche mit adversarialer
Verifikation der Kernannahmen (Quellenliste am Ende). Ersetzt nicht die bestehende Roadmap,
sondern definiert den Weg vom heutigen Geometrie-Pfad zu einem echten Geometrie-Datenkern.

## 0. Auftrag

Effiziente **Echtzeit-Geometriebearbeitung**, auch komplex (Booleans/Öffnungen, Profile mit Bögen,
Sweeps, parametrisches Editieren), die bei **sehr großen Modellen (500 MB+ IFC, >10 Mio. Dreiecke)**
performant bleibt — in der bestehenden Tauri-v2/React-Desktop-App. Explizit freigegeben:
**IFC/STEP muss nicht erhalten bleiben** (Express-IDs, Zeilenformat, Datei-Layout) — IFC wird
reine Import-/Export-Ebene. Erhalten bleiben müssen die fachlichen Invarianten:
**GlobalId-Identität** (Versionierung/Diff), **Psets/Quantities/Klassifikationen am Objekt**,
**IDS-Prüfung**, **Georeferenzierung ohne Welt-Offset-Leak**.

## 1. Befund: Warum der heutige Pfad nicht reicht

Der autoritative Datenkern liegt heute **im WebView**: `ModelSession` ([app/src/core/session.ts](./app/src/core/session.ts))
hält den kolumnaren ifc-lite-Store + Mutations-Overlay in JS/WASM; das Rust-Backend
([app/src-tauri/src/lib.rs](./app/src-tauri/src/lib.rs), einziges natives Crate `ifc-lite-processing`)
ist ein zustandsloser Tessellierungs-Fast-Path. Daraus folgen fünf strukturelle Grenzen:

1. **STEP-Text-Roundtrip als einziger Geometrie-Pfad:** Jede Geometrie-Änderung, die der
   Live-Mirror nicht kann (alles außer Move/Yaw), läuft über `exportStep()` (synchron im
   UI-Thread) → **Voll-Re-Tessellierung des Gesamtmodells** → Viewer-Neustart
   ([app/src/panes/viewer/useGeometryRebuild.ts](./app/src/panes/viewer/useGeometryRebuild.ts)).
   Bei 500 MB sind das Sekunden bis Minuten pro Maßänderung.
2. **Datenkern im WebView:** WebView2-Heap-/ArrayBuffer-Grenzen; mehrere Vollkopien gleichzeitig
   (doc.bytes, Georef-Rebase, Export-Bytes, 16-Mio-Vertex-MeshCache, GPU-Buffer) — 500 MB IFC
   multiplizieren sich auf mehrere GB.
3. **Booleans nur im Tessellierungskernel:** Öffnungen entstehen als STEP-Records und werden erst
   beim Voll-Rebuild geschnitten. Interaktives Boolean-Editing (Öffnung ziehen, Loch folgt live)
   ist mit dieser Architektur prinzipiell nicht möglich.
4. **Parametrik-Decke:** `findExtrusion` ([app/src/domain/geometry/chain.ts](./app/src/domain/geometry/chain.ts))
   versteht nur direkte `IfcExtrudedAreaSolid` mit Rechteck-/Kreisprofil. MappedItems, CSG-Solids,
   B-Reps, LayerSetUsage, Bogen-Profile: unbearbeitbar (Fehlerwurf).
5. **Keine Nebenläufigkeit:** Commands synchron im UI-Thread, Overlay-Historie append-only,
   IPC serialisiert Meshes als JSON (`save_model_file` schickt Bytes als Zahlen-Array).

Kein schnellerer Kernel behebt das — die Grenzen sind **architektonisch** (Ort des Datenkerns,
Granularität der Re-Evaluation, Transportformat).

## 2. Marktübersicht (verifiziert, Stand 08/2026)

### 2.1 Geometrie-Kernel als Bibliothek

| Kandidat | Lizenz | Urteil für uns |
| --- | --- | --- |
| **Manifold** (C++, Mesh-CSG) | Apache-2.0 | ✅ **Bester Boolean-/Evaluations-Kern.** Garantiert mannigfaltige Ausgabe, deterministisch, TBB-parallel; produktiv in OpenSCAD (100–1000× schneller als CGAL) und Blender 4.5. Booleans auf 1-Mio-Dreieck-Meshes ~240 ms, BIM-Wandöffnungen weit darunter. **Aber:** Garantie gilt nur bei mannigfaltigen *Eingaben* (IFC-Fremdgeometrie oft nicht → Heilungsschritt Pflicht); offenes Sliver-Issue #1706 bei nahezu koplanaren Flächen (bündige Öffnungen!); Rust-Bindings jung (0.x, Bus-Faktor ~1), keine belegte BIM-Produktionsnutzung. |
| **OCCT 8.0.x** (B-Rep/NURBS) | LGPL-2.1 + „OCCT Exception" | ⚠️ **Nur als selektives Randmodul.** Sehr aktiv (8.0.1, 07/2026), vollwertigster offener Kernel (Sweeps, Fillets, Healing, STEP). **Aber:** Die Exception ist nur eine *Header*-Ausnahme, keine Linking-Exception — statisch linken löst LGPL-§6 aus → **dynamisch linken** + Hinweispflicht. Rust-Bindings nicht produktionsreif (opencascade-rs = erklärtes Hobby-WIP, Crate seit 2023 unpubliziert) → eigene schmale cxx-Bridge nötig. Booleans zu langsam/fragil für den interaktiven Pfad. IfcOpenShell-Lehre: OCCT-B-Rep ist für überwiegend facettierte IFC-Geometrie Overhead (deshalb dort CGAL-Hybrid als Default). |
| **truck / monstertruck** (Rust B-Rep) | Apache-2.0 | ❌ **Als Kern widerlegt.** Booleans panicken bei koinzidenter/berührender Geometrie (Issues #114, #57, #68) — der BIM-Normalfall (bündige Öffnungen, anliegende Decken). Pre-1.0-Middleware, bewusst ohne Shape Healing. monstertruck = junger Single-Maintainer-Fork. Höchstens langfristig als NURBS-/STEP-Zweitpfad beobachten. |
| **Fornjot** | — | ❌ Projekt am 19.06.2026 offiziell beendet und archiviert („goals were never reached"); Booleans wurden nie implementiert. |
| **fidget** (Rust, Implicit/SDF) | MPL-2.0 | ❌ Exzellente SDF-Infrastruktur, aber kein B-Rep, Meshing wenig erprobt — für BIM-Editing ungeeignet. |
| **CGAL** (exakte Kernel) | GPL (Kern-Pakete) | ❌ Robustheits-Goldstandard, aber Nef/Corefinement sind GPL → für Closed-Source nur mit GeometryFactory-Kauflizenz; zudem deutlich langsamer als Manifold. |
| **ifc-lite Exact-CSG** (vorhanden!) | MPL-2.0 | ✅ **Bleibt.** Exakte Arithmetik (Shewchuk → rational), deterministisch über Plattformen, gegen IfcOpenShell validiert, nativ Tauri-tauglich (läuft bei uns bereits). **Aber:** keine Watertight-Garantie (eigene Census #2432: zerrissene CSG-Solids im Benchmark-Korpus; bei Kernel-Fehler bleibt der Host ungeschnitten), und die `@ifc-lite/create`-Builder erzeugen *keine* Öffnungs-Booleans (Türen „v1 without cutting an opening"). |
| **web-ifc fuzzy-bools** | MPL-2.0 | 💡 Referenz: die einzige produktionsbewährte Boolean-Engine, die explizit für IFC-Koplanaritäts-Schlamperei gebaut wurde — als Vergleichsmaßstab für Robustheitstests einplanen. |
| **Sketch-Solver: FreeCAD-GCS (planegcs)** | LGPL | ✅ Einzige vollwertige Closed-Source-taugliche Option für Constraint-Sketches; libslvs (GPLv3) und JSketcher (Copyright-Assignment) scheiden aus. Alternativ schlanker Eigenbau (argmin/levenberg-marquardt) — BIM braucht nur kleinen Constraint-Umfang. |

### 2.2 OSS-CAD-Software als Basis forken?

**Nein.** FreeCAD, Dune3D, SolveSpace, BRL-CAD sind Monolithen mit fest verdrahteten
UI-Stacks (Qt/GTK) — mit Tauri/React inkompatibel; man erbt 90 % unbrauchbaren Code und baut die
UI trotzdem neu. Lizenzen blockieren zusätzlich: Dune3D/SolveSpace **GPL-3.0**, chili3d **AGPL-3.0**,
JSketcher Copyright-Abtretung, Bonsai **GPL-3.0** (nur der IfcOpenShell-Kern ist LGPL).
Bonsai belegt außerdem die Skalierungsgrenze des Native-IFC-Ansatzes im Editor: eigene Doku nennt
>50k Elemente „unreasonable", 288-MB-Modell lädt ~830 s vs. 67 s in Trimble Connect.

**Als Referenzarchitektur lesenswert** (nicht als Code): Bonsais Native-IFC-Schnitt (Modell =
einzige Wahrheit, Geometrie = invalidierbarer Cache), chili3ds Drei-Schichten-Trennung,
FreeCADs Lehren (OCAF bewusst verworfen; Topological-Naming-Problem → Referenzen nie auf
B-Rep-Subshapes, sondern auf stabile IDs richten).

### 2.3 Muster der Kommerziellen

Shapr3D/Plasticity/Onshape lizenzieren Parasolid und differenzieren über Graph-Management,
Renderer, UX. Arcol/Snaptrude/Hypar/Rayon bauen **domänenspezifische Eigen-Kernel** — Beweis,
dass das für prismatische Bau-Geometrie tragfähig ist. Übertragbare Muster:

- **Zwei Repräsentationen:** exakte/parametrische Geometrie strikt getrennt von der
  Render-Repräsentation; die UI sieht nie die exakte Geometrie (Onshape schickt nur Dreiecke + IDs).
- **Feature-DAG mit inkrementeller Re-Evaluation** (Arcol, Onshape, salsa-Muster): ein Edit
  invalidiert nur den betroffenen Teilgraphen; early cutoff; laufende Evaluationen abbrechbar.
- **Edit-Preview:** während des Drags keine Kernel-Ops — GPU-Transform des gecachten Meshes;
  topologieändernde Drags mit gedrosselter (15–30 Hz) Hintergrund-Re-Evaluation; exakter Commit
  beim Loslassen.
- **Versionierung:** append-only Command-Log/Microversion-Baum (Onshape), kein CRDT für Geometrie.
- **Rendering 2026:** GPU-driven (Compute-Culling, Multi-Draw-Indirect, Meshlets/LOD, Instancing)
  ist in wgpu produktionsreif — **verifiziert**: >10 Mio. Dreiecke interaktiv ist damit klar
  erreichbar (Bevy 0.16, nanite-webgpu mit 640 Mio.+). Einschränkung: gilt für wgpu **nativ**;
  im Browser-WebGPU fehlen Multi-Draw-Indirect & Co.
- **Out-of-core:** xeokit (Quantisierung, relative-to-center für Double-Precision) und ThatOpen
  Fragments (Binärformat ~10× kleiner als IFC-Text) als Muster für 500 MB+.

## 3. Antworten auf die Kernfragen

**„Gibt es OSS-CAD-Software als Basis?"** — Als Fork: nein (§2.2). Als Bibliothek: ja —
Manifold (Booleans/Evaluation), ifc-lite (Parser, exakter CSG, IDS), optional später OCCT
(gekrümmte Sweeps/Fillets/STEP) und FreeCAD-GCS (Sketch-Constraints).

**„Andere CAD-Grundlage als echter Datenkern, IFC nur Import/Export?"** — Ja, aber kein fremdes
Produkt, sondern ein **eigener schlanker parametrischer Kern in Rust**: BIM-Geometrie ist eine
parametrische *Rezeptur* (Profil → Extrusion → Placement-Kette → CSG-Baum) — exakt das, was IFC
ohnehin speichert. Der Kern muss diese Rezeptur **schnell, robust und inkrementell evaluieren**,
nicht frei modellieren wie ein Maschinenbau-Kernel. Das ist die Nische, in der weder OCCT
(zu schwer, falsche Repräsentation) noch reine Mesh-Kernel (keine Parametrik) passen — und genau
der Layer, den Arcol/Snaptrude/Hypar auch selbst gebaut haben. Da STEP-Erhalt nicht gefordert ist,
entfällt der stärkste Grund für den heutigen „IFC-Store als Wahrheit"-Schnitt; **GlobalId wird die
primäre Entity-Identität**, Express-IDs existieren nur noch transient beim Import/Export.

## 4. Optionen

| | Option | Bewertung |
| --- | --- | --- |
| **A** | Evolutionär: Store bleibt im WebView, Rust ausgebaut (binäres IPC, element-lokale Re-Tessellierung, Mesh-Patch-API) | **Sowieso-Baustufe** (= M0/M1 unten), als Endzustand unzureichend (Grenzen 2–4 aus §1 bleiben) |
| **A+** | Wie A, **plus Modellzustand nach Rust** (nativer ifc-lite-Store + Command-Log im Backend), Booleans element-lokal über den **vorhandenen** Exact-CSG-Kernel | **Ernsthafter Kandidat** — behebt Grenzen 1, 2, 5 ohne neuen Kernel. Ob er reicht, hängt an Messung G2 (§5) |
| **B** | OCCT als autoritativer B-Rep-Kern | **Verworfen als Kern:** falsche Repräsentation fürs Gesamtmodell (IfcOpenShell-Lehre), Booleans zu langsam für Interaktivität, Rust-Bindings nicht produktionsreif, TopoDS-Gesamtmodell = Speicherexplosion, OCAF wäre zweites Dokumentmodell (FreeCAD hat es verworfen) |
| **C** | **Eigener parametrischer Rust-Kern (ECS/Feature-DAG) + Manifold-Evaluations-Pipeline**, ifc-lite-Exact-CSG als Zweitmeinung/Fallback, OCCT *später* selektiv | **Zielbild** für echtes interaktives Boolean-/Parametrik-Editing — aber erst nach den Mess-Gates in §5 bauen |
| **D** | OSS-CAD-App forken | **Verworfen** (§2.2) |
| **E** | truck/monstertruck als B-Rep-Fundament | **Verworfen** (Verifikation: Booleans panicken beim BIM-Normalfall) |

**Entscheidungslogik:** A → A+ ist ohnehin der gemeinsame Unterbau von allem. Ob danach A+ genügt
oder C nötig ist, entscheiden drei billige Messungen — nicht Bauchgefühl. Die adversariale Kritik
hat zu Recht moniert, dass C sonst auf ungemessenen Prämissen stünde.

## 5. Phase 0 — Mess-Gates (1–2 Wochen, vor jeder Kern-Entscheidung)

Auf einem festen Korpus **realer** Modelle (mind. 10 Stück, darunter die größten verfügbaren
500-MB-Kandidaten, Revit-Exporte, MEP, Bestand mit Tessellation):

- **G1 — Feature-Hebungsquote:** Wieviel % der Produkte sind mit dem ifc-lite-Parser als
  parametrische Rezeptur hebbar (ExtrudedAreaSolid + Standardprofile + Voids + MappedItems)
  vs. nur als Mesh übernehmbar? *Niedrige Quote → C schrumpft auf „Editor für Eigen-Geometrie
  + Mesh-Viewer für den Rest" → A+ reicht.*
- **G2 — Element-lokale Boolean-Latenz des vorhandenen Exact-CSG:** Wandöffnung auf einem
  Einzelelement (einige tausend Dreiecke) — unter 100 ms? *Ja → Manifold vorerst unnötig,
  A+ deckt interaktive Öffnungen; nein → Manifold-Pfad aus C nötig.*
- **G3 — WebView2-Renderer-Grenze:** Größtes Korpus-Modell im @ifc-lite/renderer (WebGPU im
  WebView2): FPS, Heap, Ladezeit. *Trägt er 500 MB nicht → nativer wgpu-Layer wird kritischer
  Pfad und rückt von „Ausbau" auf „früh".*
- **G4 — Speicherbudget:** Peak-RAM des Gesamtsystems am größten Modell messen und ein Budget
  für die Zielmaschine (16 GB) festschreiben — inkl. Eviction-Konzept (Meshes evictbar,
  Rezepturen nicht).

## 6. Ziel-Architektur

*(Beschrieben für den Vollausbau C; A+ ist dieselbe Architektur ohne den Feature-DAG/Manifold-Teil —
der Exact-CSG evaluiert dann element-lokal.)*

### 6.1 Datenkern (Rust, Tauri-Backend — einzige Source of Truth)

- **ECS-artiger kolumnarer Store** (IFC5/IFCX-Blaupause, aber eigenes Format):
  Entity-Identität = **GlobalId**. Komponenten:
  - *Semantik:* Klasse, Psets/Quantities, Klassifikationen, Relationen (Containment, Voids/Fills,
    Material, Typ-Zuordnung) — 1:1 die heutige Fachlichkeit.
  - *Geometrie-Rezeptur* (1:1 auf IFC abbildbar): Profil (Rechteck/Kreis/Ellipse/Polygon/Bögen),
    Extrusion/Revolve/Sweep-Parameter, **Placement-Kette** (relativ, kleine lokale Koordinaten —
    1.x-Invariante), CSG-Baum (Öffnungen als Differenz-Knoten), MappedItem-/Typ-Geometrie als
    geteilte Referenz.
  - *Abgeleitete Caches* (jederzeit neu berechenbar, evictbar): evaluiertes Mesh, Meshlets/LOD,
    BVH, Bounds.
  - *Fähigkeitsstufen statt Fehlerwürfe:* Nicht hebbare Fremdgeometrie wird als Anzeige-Mesh
    geführt (editierbar: Move/Rotate/Löschen/Psets) — ehrlich ausgewiesen, kein `throw`.
- **Mutationen:** Command-Log mit inversen Commands (Undo/Redo pro Dokument), gruppiert zu
  **Microversions** (append-only Baum → Autosave, Audit, spätere Branches). Die Command-Semantik
  aus [app/src/commands/](./app/src/commands/) wird als IPC-API nachgebildet; das Frontend mutiert
  nie Rohdaten. **Persistenz + Crash-Recovery des Logs sind Teil des Designs** (Format, Ort,
  Kompaktierung — nicht nachgelagert).
- **Versionierung:** Die express-id-freie Hash-Semantik aus `src/ifc/versioning` (1.x) wird nach
  Rust portiert. **Zielkonflikt explizit:** „unveränderter Re-Export ⇒ identischer Manifest-Hash"
  ist mit Feature-Hebung + Neu-Emission nicht trivial erfüllbar → Lösung ist die
  Passthrough-Regel (§6.4): Unverstandenes und Ungeändertes wird strukturerhaltend durchgereicht,
  gehobene-aber-ungeänderte Rezepturen müssen deterministisch auf identische Strukturen
  re-emittieren (CI-Gate).

### 6.2 Geometrie-Pipeline (inkrementell, parallel, abbrechbar)

- **Feature-DAG mit Dirty-Propagation** (salsa-Muster oder handgebauter DAG): Edit invalidiert nur
  Element + Abhängige (Öffnungen ↔ Host); early cutoff bei gleichen Zwischenergebnissen;
  Evaluationen cancellable (schnelle Edit-Folgen stauen nicht).
- **Evaluation pro Element** in rayon-Workern (Speicher pro Worker gedeckelt, bounded channels —
  IfcOpenShells 60-GB-Spike als Warnbeispiel): Profil → 2D → Extrude/Revolve → CSG-Baum
  (Union aller Cutter, eine Differenz) → Mesh **mit Face-Provenienz** (Klick auf Fläche →
  verursachendes Bauteil/Öffnung).
- **Boolean-Backend:** je nach Gate G2 der vorhandene Exact-CSG (A+) oder Manifold (C; FFI gepinnt/
  vendored, dünne eigene Abstraktionsschicht, damit ein Binding-Wechsel billig bleibt). Bei zwei
  Backends gilt: **ein** Primärpfad, der andere nur als Validierungs-Zweitmeinung in Tests —
  keine drei Kernel im Produktionsgleichgewicht (Kritikpunkt Konsistenzkosten).
- **Toleranz-/Präzisionspolitik (explizit):**
  - Evaluation strikt **in lokalen Frames** (double), nie in Weltkoordinaten; Georef via
    RTC/relative-to-center bis in den Renderer (ersetzt den heutigen Median-Origin-Shift-Hack).
    `IfcMapConversion`/`TrueNorth` werden beim Export zurückgeschrieben.
  - Robustheits-Tricks (Epsilon-Overcut der Cutter) passieren **nur in der Evaluation**, nie in
    der Rezeptur — exportierte Maße bleiben exakt (sonst Mengen-/Ausschreibungsfehler).
  - `IfcGeometricRepresentationContext.Precision` wird beim Import übernommen und beim Export
    gesetzt; mm- vs. m-Modelle über die Einheiten-Skalen der 1.x-Mathematik (Testreferenz).
- **Edit-Preview** (Shapr3D-Muster): Drag = GPU-Transform des Cache-Meshes; topologieändernde
  Drags mit gedrosselter (15–30 Hz) Hintergrund-Re-Evaluation nur des betroffenen Elements;
  Commit beim Loslassen.
- **Sketch-/Profil-Editor** (später Meilenstein): FreeCAD-GCS via cxx **oder** schlanker Eigenbau;
  Diagnose redundanter/widersprüchlicher Constraints von Anfang an.
- **OCCT:** in v1 **gestrichen** (Kritikpunkt: Sidecar kostet ~80 % der Option-B-Dauerkosten).
  Gekrümmte Sweeps/Fillets werden bis dahin als „nicht editierbar" (Anzeige-Mesh) geführt.
  Wenn später nötig: eigene schmale cxx-Bridge, vendored, **dynamisch gelinkt**, isolierte Worker.

### 6.3 Renderer-Kopplung (kein JSON, kein Voll-Rebuild)

- Meshes verlassen Rust **ausschließlich binär** (Tauri-v2-Raw-Response/Custom-Protocol,
  ArrayBuffer; perspektivisch Shared Memory). Das JSON-Zahlen-Array-Muster wird eliminiert.
- **Stufe 1:** @ifc-lite/renderer bleibt, bekommt eine **Element-Patch-API**
  (`replaceMeshesForEntity`/`removeMeshesForEntity` pro GlobalId, gespeist aus Backend-Events).
  Der STEP-Export-Voll-Rebuild-Pfad stirbt; der `sceneMirror`-Sonderpfad wird dadurch
  generalisiert.
- **Stufe 2** (Zeitpunkt abhängig von Gate G3): nativer **wgpu-Layer** im Rust-Prozess
  (Child-Window unter transparentem WebView): ein Scene-Owner-Thread (single writer),
  quantisierte Geometrie (16-bit relativ zu Tile-Zentren), RTC gegen Georef-Jitter, Instancing
  für MappedItems, Compute-Culling (Frustum + Two-Pass-Hi-Z), Multi-Draw-Indirect; Meshlets
  (meshopt) als Dichte-Reserve. Verifiziert: >10 Mio. Dreiecke interaktiv ist damit Stand der
  Technik.
- **Out-of-core früh, nicht spät** (Kritikpunkt Kaltstart): Import erzeugt ein **mmap-bares
  Binär-Cache-Format** (quantisierte Geometrie-Chunks, getrennte Semantik-Tabellen, räumlicher
  Index; Fragments/xeokit-Muster, ~10× kleiner als IFC-Text). Erstes Öffnen streamt und schreibt
  den Cache; Wiederöffnen ist Sekundensache. Das adressiert den Kaltstart — den eigentlichen
  ersten Bruchpunkt bei 500 MB.

### 6.4 IFC-Import/Export (reine Randschicht)

- **Import:** ifc-lite-core/geometry nativ im Backend (verifiziert Tauri-tauglich, MPL-2.0
  unkritisch) parst STEP kolumnar; ein Übersetzer hebt erkennbare Rezepturen in Kern-Features;
  Unverstandenes → Anzeige-Mesh **plus konservierter Original-Subgraph**.
- **Passthrough-Garantie (harte Regel, K.-o.-Kriterium):** *Alles, was der Editor nicht versteht,
  kommt beim Re-Export semantisch unverändert heraus.* Unverstandene Entity-Subgraphen werden als
  Rohblöcke konserviert und mit fixierten Referenzen re-emittiert. Ziel-Schema = Quell-Schema
  (2x3 rein → 2x3 raus; keine stille Konvertierung).
- **Export:** eigener deterministischer STEP-Writer (stabile Reihenfolge/Formatierung, GlobalIds
  erhalten, Express-IDs frisch — laut Auftrag zulässig). Psets/Quantities/Klassifikationen/
  Relationen vollständig; Manifest-Hash-Stabilität als CI-Gate. **Aufwand ehrlich budgetieren:**
  der Exporter ist ein eigenes Großgewerk (IfcOpenShell-Erfahrung), kein Nebensatz — er wächst
  inkrementell mit der Hebungsquote (was nicht gehoben wird, läuft durch Passthrough).
- **Semantik-Schichten** (Pset-Editor, IDS, Katalog, Versionierungs-UI) bleiben im React-Frontend
  und lesen über paginierte IPC-View-Queries statt über einen Frontend-Store.

## 7. Meilensteine

Reihenfolge nach Nutzerwert und Risikoabbau; **jede Stufe ist eigenständig auslieferbar**.
M0/M1 sind No-Regret-Moves — sie sind unter jeder Option (A+, C) identisch nötig.

| MS | Inhalt | Abnahme |
| --- | --- | --- |
| **G** *(1–2 Wo)* | **Mess-Gates §5** auf realem Korpus | G1–G4 dokumentiert; Entscheidung A+ vs. C schriftlich in `05-risiken-entscheidungen.md` |
| **M0** *(Wochen)* | IPC/IO-Hygiene: Raw-Bytes statt JSON-Arrays; `get_geometry` als gestreamte binäre Batches (fehlende `geometry-packed-batch`-Events nachrüsten) | Ladezeit-/Speicher-Wins messbar; keine JSON-Vertexpfade mehr |
| **M1** *(Wo.–Monate)* | Element-lokale Re-Tessellierung (`retessellate_entities`) + Element-Patch-API im Viewer; Voll-Rebuild nur noch Fallback | Maßänderung/Öffnung/neues Bauteil auf 100-MB-Modell: Edit-to-Pixel < 1 s, kein Viewer-Neustart |
| **M2** *(Monate)* | **Modellzustand nach Rust:** nativer Store + Command-Log/Undo im Backend; Frontend nur View-Modelle (Query-IPC); Export im Backend; mmap-Binär-Cache fürs Wiederöffnen; 1.x-Hash-Logik nach Rust portiert | Psets/IDS/Katalog funktionieren unverändert; kein `doc.bytes` im WebView; Manifest-Paritätstests grün; 500-MB-Korpusmodell öffnet & bleibt im RAM-Budget (G4) |
| **M3** *(Monate)* | **Parametrischer Feature-Kern** (Umfang je nach Gate-Entscheidung): Feature-Hebung beim Import, Dirty-Graph, element-lokale Boolean-Evaluation (Exact-CSG oder Manifold), Live-Öffnungs-Editing; Builder/Gizmo/Edits auf Kern-Commands; `domain/geometry/emit+chain` entfällt; deterministischer Exporter + Passthrough | Öffnung ziehen = Live-Loch < 100 ms auf Referenzmodell; Golden-Master: 1.x-Body-Tests, Pset-Erhalt, Georef-Roundtrip, Passthrough-Korpus byte-/semantik-stabil |
| **M4** *(Monate)* | Komplexe Geometrie: Profil-Editor (Bögen, Arbitrary), Sketch-Solver, Sweeps (gerade), freie Rotation, Typ-/MappedItem-Editing (Typ-Edit wirkt auf alle Instanzen) | Profil einer Bestandswand editieren; MEP-Sweep verschieben; IDS-Prüfung auf editiertem Modell unverändert korrekt |
| **M5** *(parallel ab M3)* | Renderer-Ausbau nach Gate G3: Meshlets/LOD, Instancing, Compute-Culling; ggf. nativer wgpu-Layer | 500-MB-Korpusmodell: >30 FPS Orbit, Selektion < 50 ms |

**Durchgängige Leitplanken:** (a) ifc-lite bleibt für Parsing, IDS, Exact-CSG-Referenz — nur die
Rolle „autoritativer Store im WebView" endet. (b) Übergangsphase mit doppelter Wahrheit
(M1→M2) kurz halten: Feature-Flag pro Dokument, Rust früh alleinige Schreibinstanz.
(c) Performance-Budgets pro Operation vor Baubeginn fixieren (Edit-to-Pixel < 100 ms auf
Referenzmodell als Nordstern).

## 8. Risiken

1. **Feature-Hebungsquote real niedrig** (MEP/Infra/Bestand): dann liefert C wenig Mehrwert über
   A+ → genau dafür Gate G1 *vor* der Entscheidung. Mitigation im Zielbild: Fähigkeitsstufen +
   Mesh-Editing (Move/Rotate/Löschen) als ehrliche Grundfunktion für alles.
2. **Manifold-Randfälle** (nur bei C): mannigfaltige Eingaben nötig, Sliver-Issue #1706 bei
   bündigen Öffnungen → Heilungs-Pipeline, Epsilon-Overcut *nur in der Evaluation*, Exact-CSG als
   Test-Zweitmeinung, Testkorpus aus realen Modellen. Bindings pinnen/vendoren (Bus-Faktor ~1).
3. **Exporter-Aufwand unterschätzt:** deterministischer, schemakonformer Writer über 2x3/4/4x3
   ist ein Großgewerk → inkrementell wachsen lassen, Passthrough trägt den Rest; Manifest-Hash als
   CI-Gate von Tag 1.
4. **Mesh-Healing ist ein Fass ohne Boden:** robuste Reparatur beliebiger Triangle-Soups ist
   ungelöst → Healing nur als Gate für Boolean-Fähigkeit, nie als Import-Blocker; unheilbare
   Geometrie bleibt Anzeige-Mesh.
5. **Speicher bei 500 MB+:** Budget (G4) + Eviction von Anfang an; binäres IPC kopiert trotzdem →
   Chunk-Streaming-Disziplin, ggf. Shared Memory; WebView-Renderer-Grenze kann den nativen
   wgpu-Layer vorziehen (G3 entscheidet).
6. **Invarianten-Parität:** GlobalId-Hashes, Pset-Erhalt/Orphan-GC, Georef-Ketten müssen die
   Migration exakt überleben → portierte 1.x-Testsuiten als Golden-Master, CI-Gates.
7. **Team-/Zeitrisiko:** M2–M4 sind Monatsprojekte (realistisch verteilt über 1–2 Jahre neben der
   Produktpflege) → deshalb die strikte Stufigkeit mit auslieferbaren Zwischenständen und die
   Gate-Entscheidung, ob C überhaupt nötig ist.

## 9. Verifikations-Protokoll (Kurzfassung)

| Behauptung | Urteil | Kern-Erkenntnis |
| --- | --- | --- |
| OCCT-Lizenz „problemlos", Rust-Bindings produktionsreif | **teilweise** | Exception ist nur Header-Ausnahme → dynamisch linken; opencascade-rs = WIP-Hobby, Crate seit 2023 unpubliziert |
| Manifold robust/wasserdicht/schnell, gepflegte Rust-Bindings | **teilweise** | Kern stimmt (OpenSCAD/Blender-bewährt, ~240 ms auf 1-Mio-Dreieck-Booleans); Garantie nur bei mannigfaltigen Eingaben, Sliver-Issue #1706, Bindings jung, keine BIM-Produktionsnutzung |
| truck/Fornjot reif als alleiniger B-Rep-Kern | **widerlegt** | Fornjot beendet (06/2026); truck-Booleans panicken bei koinzidenter Geometrie (#114, #57, #68) |
| ifc-lite: exakter CSG + Öffnungs-Builder + Tauri-nativ | **teilweise** | Exact-CSG und Tauri-Einbettung bestätigt; Builder erzeugen **keine** Öffnungs-Booleans; Watertightness nicht garantiert (Census #2432); Kernel-Fehler ⇒ Host bleibt ungeschnitten |
| Bonsai beweist Skalierung von Native-IFC-Editing | **teilweise** | Machbarkeit ja, Skalierung nein (>50k Elemente unbenutzbar laut eigener Doku); Flaschenhals ist Parsing + Kernel + Blender-Szene, nicht monokausal Geometrie |
| wgpu: >10 Mio. Dreiecke interaktiv via GPU-driven | **bestätigt** | Bevy 0.16, nanite-webgpu (640 Mio.+); gilt für wgpu nativ, nicht Browser-WebGPU |

Vollständige Belege (URLs, Issues, Benchmarks) im Recherche-Protokoll der Planungssession vom
2026-08-08.
