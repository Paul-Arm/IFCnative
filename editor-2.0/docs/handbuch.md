# IFCnative Editor 2.0 — Handbuch

Stand: M0–M6 abgeschlossen, M7 (Politur & Release) in Arbeit. Beschrieben ist
ausschließlich, was in dieser Version vorhanden ist; die Beschriftungen im Text
sind die Beschriftungen der Oberfläche.

Ergänzende Dokumente: [`../04-roadmap.md`](../04-roadmap.md) (Meilensteine und
Stand), [`../app/README.md`](../app/README.md) (Entwicklung, Befehle),
[`../hub/README.md`](../hub/README.md) (Hub-Dienst, API).

---

## 1. Erste Schritte

### Installation (Windows)

Der Windows-Installer ist ein NSIS-Setup und wird von der GitHub-Action
„Editor 2.0 Windows-Build" gebaut (Artefakt `ifcnative-editor-2.0-windows`).

- Installation nach Program Files, mit Startmenü-Eintrag und Deinstallation
  über „Apps & Features".
- Installiert wird für alle Nutzer des Rechners (`perMachine`) — das Setup
  fragt deshalb nach Administratorrechten.
- Setup-Sprache: Deutsch.
- Das Setup ist **nicht signiert**. Windows SmartScreen meldet deshalb einen
  unbekannten Herausgeber; über „Weitere Informationen" → „Trotzdem ausführen"
  lässt sich die Installation fortsetzen. Die Signierung ist bewusst
  zurückgestellt (Entscheidung E12).

### Standardprogramm für .ifc

Der Installer registriert die Endungen `.ifc`, `.ifczip`, `.ifcx`, `.ids`,
`.bcf` und `.bcfzip` und meldet die App bei Windows als mögliches
Standardprogramm an. **Welches Programm eine Endung öffnet, entscheidet
Windows nur über den Nutzer** — die Zuordnung ist über den UserChoice-Hash
geschützt, kein Programm darf sie im Hintergrund setzen.

Beim ersten Start zeigt die App deshalb eine Hinweisleiste:

> IFCnative als Standardprogramm für .ifc festlegen: Windows-Einstellungen →
> Standard-Apps

- **Einstellungen öffnen** springt direkt auf die Windows-Seite
  „Standard-Apps" (`ms-settings:defaultapps`). Dort unter „Standardwerte nach
  Dateityp festlegen" die Endung `.ifc` auf IFCnative Editor setzen.
- **Nicht mehr anzeigen** (oder das ×) blendet den Hinweis dauerhaft aus.

Die Leiste erscheint nur in der Desktop-Anwendung, nicht im Browser-Betrieb.

### Modell öffnen

Drei Wege führen zum gleichen Ergebnis:

1. **Kopfzeile → „IFC öffnen"** — Dateidialog, Mehrfachauswahl möglich; jede
   Datei landet in einem eigenen Tab.
2. **Doppelklick im Explorer** auf eine `.ifc`-Datei, sofern IFCnative als
   Standardprogramm eingetragen ist.
3. **„Öffnen mit" → IFCnative Editor** im Explorer-Kontextmenü.

Läuft die App bereits, wird kein zweites Fenster gestartet: Die Datei wird an
die laufende Instanz durchgereicht (Single-Instance), das Fenster kommt nach
vorn und die Datei erscheint als neuer Tab. Auch ein Doppelklick bei
geschlossener App funktioniert — die App merkt sich den Pfad und öffnet ihn,
sobald die Oberfläche bereit ist.

Während des Parsens zeigt die Statusleiste unten den Fortschritt („Parse …",
Phase und Prozent). Eine unlesbare Datei erzeugt keine leere Oberfläche,
sondern eine Fehlermeldung in der Statusleiste.

### Die Kopfzeile

| Element | Bedeutung |
| --- | --- |
| **IFC öffnen** | Dateidialog |
| **Exportieren** | Bearbeitungsstand als IFC-Datei schreiben; die Zahl in Klammern nennt die offenen Änderungen. Der Pfeil ▾ daneben öffnet weitere Exportformate (siehe 5) |
| **↶ / ↷** | Rückgängig / Wiederholen; der Tooltip nennt die betroffene Operation |
| **Workspace** | Auswahlliste der Fenster-Layouts |
| **Layout sichern** | aktuelles Layout unter eigenem Namen ablegen |
| **Zoom** | Schieberegler für die Skalierung der Oberfläche (70–125 %) |
| **Dunkel / Hell** | Farbschema umschalten |

Darunter liegen die Dokument-Tabs (ein Tab je geöffnetem Modell, mit Punkt bei
offenen Änderungen und Rückfrage vor dem Schließen).

Ganz unten die **Statusleiste**: Betriebsart (Desktop/Browser), IFC-Schema,
Anzahl Entities, aktuelle Auswahl und der Änderungsstand („Keine Änderungen"
bzw. „*n* Änderungen (nicht exportiert)").

---

## 2. Workspaces und Panes

Die Oberfläche besteht aus **Panes** (Panels) in einem teilbaren Raster. Jedes
Pane hat einen festen Zweck; welche Panes zu sehen sind und wie sie liegen,
bestimmt der **Workspace**.

- Trenner zwischen Panes lassen sich ziehen; über die Titelleiste eines Panes
  kann es verschoben, geteilt oder geschlossen werden.
- Der Workspace-Wechsel in der Kopfzeile lädt ein anderes Layout. Jeder
  Workspace merkt sich sein eigenes Layout.
- **Layout sichern** legt das aktuelle Raster als eigenen Workspace ab; er
  erscheint danach in derselben Liste. Layouts und Workspaces überleben den
  Neustart (lokale Ablage im Browser-/App-Speicher).

Eingebaute Workspaces:

| Workspace | Enthaltene Panes |
| --- | --- |
| Editor | Struktur · 3D-Viewer · Inspector |
| Review | 3D-Viewer · Notizen · Inspector |
| Graph | Struktur · Graph · Inspector |
| Koordination | 3D-Viewer · Lens · Struktur |
| Daten | Struktur · Pset Batch · Objektkatalog |
| Auswertung | Listen · 3D-Viewer |
| Bauen | Struktur · 3D-Viewer · Baukasten |
| Prüfung | Prüfzentrum · 3D-Viewer · Inspector |
| Hub | IFC-Hub · 3D-Viewer |
| Start | Kürzlich verwendet · Notizen |

**Gemeinsame Auswahl:** Alle Panes arbeiten auf derselben Auswahl des aktiven
Dokuments. Ein Klick im Strukturbaum markiert das Objekt auch im Viewer, im
Graph und im Inspector — und umgekehrt.

---

## 3. Die Panes im Einzelnen

### 3.1 Struktur

Die räumliche Hierarchie des Modells (Projekt → Standort → Gebäude → Geschoss)
mit den enthaltenen Bauteilen. Der Baum ist virtualisiert und bleibt auch bei
sehr großen Modellen flüssig.

- **Suchfeld** („Suchen (Name, Typ, #Id) …"): filtert nach Name, IFC-Typ oder
  ExpressId; rechts steht die Trefferzahl, sonst die Zeilenzahl.
- **Alles aufklappen / Alles zuklappen**.
- Auswahl: Klick = ein Objekt, **Strg-Klick** = zur Auswahl hinzufügen,
  **Umschalt-Klick** = Bereich zwischen Ankerzeile und Klick.
- Doppelklick fokussiert das Objekt im 3D-Viewer.

Modelle ohne räumliche Struktur melden „Keine räumliche Struktur im Modell."

### 3.2 3D-Viewer

Darstellung über WebGPU. Die Szene wird streamend aufgebaut; der Status
(geladene Meshes) steht im Pane.

**Navigation:** linke Maustaste ziehen = Orbit, mittlere/rechte Maustaste oder
Umschalt+links = Verschieben, Mausrad = Zoom. Ein Klick ohne Bewegung wählt das
getroffene Objekt aus (Strg-Klick erweitert die Auswahl), ein Klick ins Leere
hebt die Auswahl auf.

Werkzeugleiste:

| Schaltfläche | Wirkung |
| --- | --- |
| **Zoom auf Modell** | Kamera auf die gesamte Szene |
| **Isolieren** | nur die Auswahl zeigen; erneuter Klick hebt die Isolation auf |
| **Ausblenden** | Auswahl unsichtbar schalten |
| **Alles zeigen** | Ausblendungen und Isolation zurücknehmen |
| **X-Ray** | nicht ausgewählte Bauteile durchscheinend darstellen |
| **Schnitt** | Achse wählen (Auswahlliste), Position über den Schieberegler, ein-/ausschalten über **Schnitt an / Schnitt aus** |
| **Ansicht: Iso / Oben / Vorne / Links** | feste Kamerastandpunkte |
| **Modell neu berechnen** | Geometrie aus dem aktuellen Bearbeitungsstand neu aufbauen |
| **automatisch** | Neuberechnung 2 s nach der letzten Änderung; standardmäßig aus |

**Modell neu berechnen** ist der wichtigste Punkt beim Bearbeiten: Die 3D-Szene
stammt aus *einem* Byte-Stand des Modells und kennt spätere Änderungen nicht.
Neue Körper aus dem Baukasten, geänderte Maße, Öffnungen und Löschungen werden
erst nach einem Klick sichtbar. Die Zahl am Knopf nennt die Änderungen seit dem
letzten Geometrie-Stand. Die Neuberechnung exportiert die Sitzung intern und
liest sie neu ein — bei großen Modellen dauert das spürbar, deshalb ist die
automatische Neuberechnung bewusst abgeschaltet.

Färbungen und Ausblendungen aus **Lens** und **Prüfzentrum** wirken auf dieselbe
Szene.

### 3.3 Inspector

Details des zuletzt ausgewählten Objekts, umschaltbar über fünf Knöpfe:

**Übersicht** — Identität (Klasse, Name, GlobalId; die GlobalId lässt sich per
Klick in die Zwischenablage kopieren) und eine Zusammenfassung mit der Anzahl
von Eigenschaftssätzen, Mengensätzen und Beziehungen.

**Eigenschaften** — alle Property Sets des Objekts, je Satz ein Block:

- Kopfzeile mit **Umbenennen**, **Duplizieren**, **Löschen**.
- Tabelle der Properties mit typgerechten Eingabefeldern (Text, Zahl,
  Wahrheitswert, Datum). Ungültige Eingaben werden nicht übernommen; die
  Übernahme erfolgt beim Verlassen des Feldes.
- Lösch-Knopf je Zeile, Fußzeile mit Name/Typ/Wert und **Hinzufügen** für eine
  neue Property.
- Ein neues Pset legt das Eingabefeld über der Liste an
  (z. B. `Pset_WallCommon`).
- Das Suchfeld rechts in der Werkzeugleiste filtert die angezeigten
  Eigenschaften.

**Mengen** — dasselbe für Mengensätze (Qto, z. B. `Qto_WallBaseQuantities`) mit
Mengenart und Wert.

**Beziehungen** — ein- und ausgehende Beziehungen des Objekts, nach Art
gruppiert, mit Sprung zum jeweiligen Partnerobjekt.

**Platzierung** — reine Anzeige: die Platzierungskette des Objekts, jeweils in
Modelleinheit und in Metern, dazu die Längeneinheit des Modells. Objekte ohne
Repräsentation melden das ausdrücklich.

Jede Änderung im Inspector läuft über die Command-Pipeline und ist damit
rückgängig zu machen.

### 3.4 Graph

Beziehungsgraph rund um das ausgewählte Objekt.

- **Preset** (Auswahlliste): Übersicht, Räumlich, Eigenschaften, Ressourcen,
  Geometrie — jedes Preset schaltet eine Gruppe von Beziehungsarten frei.
- **Tiefe** 1–5: wie viele Kanten weit die Nachbarschaft aufgebaut wird.
- **Beziehungsarten (n/m)**: Feinfilter je Art mit Farbpunkt, dazu **Alle** und
  **Keine**.
- **Knoten suchen …** hebt passende Knoten hervor.
- **Auswahl als Anker** baut den Graphen um das zuletzt gewählte Objekt neu
  auf.
- **Layout zurücksetzen** verwirft von Hand verschobene Knoten.

Bearbeiten im Graph:

- Zwei Knoten verbinden (Ziehen von Anschlusspunkt zu Anschlusspunkt) öffnet
  den Dialog **Beziehung anlegen** mit Von/Nach und der Auswahl der
  Beziehungsart. Angeboten werden nur Arten, die für dieses Paar zulässig sind.
- **Beziehung löschen** entfernt die ausgewählte Kante (auch mit `Entf`).
- **Objekt löschen …** öffnet den Dialog **Objekt löschen** mit dem
  Kaskadenplan: Er listet vorab alle Objekte und Beziehungen, die mitgelöscht
  werden. Erst die Bestätigung führt die Löschung aus — als ein Schritt, der
  sich in einem Zug rückgängig machen lässt.

### 3.5 Lens

Regelbasiertes Einfärben und Ausblenden im 3D-Viewer.

- Auswahlliste der Presets: **Nach IFC-Klasse**, **Struktur**,
  **Gebäudehülle**, **Öffnungen & Erschließung**, **Nach Material**;
  „Keine Lens" schaltet ab.
- Nach der Auswertung zeigt die Tabelle je Regel Farbe, Bezeichnung und
  Trefferzahl; darunter stehen die Anzahl eingefärbter und ausgeblendeter
  Objekte sowie die Rechenzeit.
- **Zurücksetzen** nimmt die Färbung zurück.

Wird die Färbung im Viewer anderweitig aufgehoben, meldet das Pane „Im Viewer
zurückgesetzt — Preset erneut wählen, um es anzuwenden." Nach Änderungen am
Modell wertet die Lens automatisch neu aus.

### 3.6 Pset Batch

Massenbearbeitung von Eigenschaften über die aktuelle Mehrfachauswahl. Zeilen
der Matrix sind Properties, Spalten die ausgewählten Objekte.

**Auswahl bestimmen** (obere Leiste): entweder Mehrfachauswahl aus Struktur
oder Viewer (Strg-/Umschalt-Klick) oder abfragebasiert:

- **IFC-Klasse …** mit Vorschlagsliste der im Modell vorkommenden Klassen
  (samt Anzahl),
- optional **Pset**, **Property**, Operator und **Wert** als Filter — entweder
  alle drei Felder oder keines,
- **Auswahl setzen** ersetzt die Auswahl im gesamten Editor; rechts erscheint
  die Trefferzahl.

**Aktionen:**

- **Neues Pset …** + **Anlegen**: legt den Satz auf allen ausgewählten Objekten
  an, vorhandene werden übersprungen.
- Einzelne Zelle bearbeiten: direkt in der Matrix, ohne Vorschau.
- Zeilenaktionen: Wert für alle Objekte setzen, Property auf allen Objekten
  löschen; neue Property über die Fußzeile für alle Objekte anlegen.
- **CSV exportieren**: Matrix als CSV (Semikolon, UTF-8-BOM — direkt in
  deutschem Excel lesbar).
- **CSV importieren**: dieselbe Datei zurücklesen. Der Abgleich läuft über die
  GlobalId, übernommen werden nur echte Abweichungen.

**Vorschau vor jeder Massenaktion:** Setzen, Löschen und CSV-Import öffnen
einen Dialog mit der Liste alt → neu je Objekt. Erst nach Bestätigung wird
geschrieben — als *ein* Schritt (ein Undo, ein Eintrag im Änderungsprotokoll).

Die Matrix hebt Abweichungen innerhalb der Auswahl hervor und zeigt je Property
die Abdeckung (auf wie vielen der ausgewählten Objekte sie vorkommt).

### 3.7 Objektkatalog

Import und Prüfung des openSIM-Objektkatalogs.

- **Katalog importieren** liest die openSIM-Arbeitsmappe (`.xlsx`); die
  Variante — Diagnostik (BWD) oder Monitoring (MON) — wird automatisch erkannt
  und lässt sich über **Variante** umschalten. Neben dem Dateinamen steht die
  Zahl der Klassen, **Entfernen** wirft den Katalog wieder hinaus.
  Auffälligkeiten des Imports erscheinen als Diagnoseliste über dem Detail.
- Links die durchsuchbare **Klassenliste**, rechts das Klassendetail mit den
  Merkmalen je Merkmalsgruppe (Merkmal, Typ, Einheit, Pflicht, LoI, Gewerke).
- Der Katalog gilt anwendungsweit — einmal importiert, steht er für alle
  geöffneten Modelle bereit.

**Prüfung** (unterhalb des Klassendetails) vergleicht die aktuelle Auswahl
(bis zu 25 Objekte je Durchlauf) mit der gewählten Katalogklasse und meldet
Befunde nach Schwere. Wo möglich gibt es **Quick-Fixes** — einzeln oder für
alle gleichartigen Befunde. Zusätzlich lassen sich alle Merkmalsgruppen der
Klasse auf die Auswahl anwenden. Jede Aktion ist rückgängig zu machen.

**IDS-Export:** Im Klassendetail erzeugt die Schaltfläche mit dem Hinweis
„Pflichtmerkmale als IDS-1.0-Dokument herunterladen" aus der Katalogklasse ein
IDS-Dokument. Dasselbe Dokument lässt sich im Prüfzentrum direkt übernehmen
(siehe 3.10).

### 3.8 Listen

Bauteillisten und Auswertungen.

- **Vorlage** (Auswahlliste): Wände, Türen, Fenster, Räume, Zonen & Systeme,
  Übersicht (alle Bauteile).
- **Spalten**: Der Spaltenwähler bietet die im Modell tatsächlich gefundenen
  Spalten (Attribute, Psets, Mengen) an; Spalten lassen sich hinzufügen und
  entfernen. Klick auf einen Spaltenkopf sortiert.
- **Gruppieren nach**: mehrstufig; jede gewählte Spalte erscheint als Knopf und
  lässt sich per Klick wieder entfernen. Gruppen zeigen Summen der numerischen
  Spalten.
- **CSV exportieren** schreibt die Liste mit Semikolon-Trennung (deutsches
  Excel).
- Klick auf eine Zeile wählt das Objekt aus und fokussiert es im Viewer.

Angezeigt werden höchstens 500 Datenzeilen; die Kopfzeile nennt die
Gesamtzahl und die Zahl der angezeigten Zeilen. Der CSV-Export umfasst die
vollständige Liste.

### 3.9 Baukasten

Bauteile mit Extrusionskörper erzeugen und ändern. Drei Modi:

**Neues Bauteil** — Klasse (Wand, Decke / Platte, Stütze, Träger, Allgemeines
Bauteil (Proxy)), Profil (Rechteck (Breite × Tiefe) oder Kreis (Radius)), Maße
und Position, dazu der räumliche Elternknoten (vorausgewählt ist der im
Strukturbaum gewählte Knoten, sonst ein Geschoss). Alle Längen in Metern. Nach
dem Anlegen meldet die Statuszeile die neue ExpressId, und das Bauteil ist
ausgewählt.

**Auswahl bearbeiten** — Maße einer bestehenden Extrusion ändern (auch bei
gerade erst erzeugten Bauteilen) und das Bauteil verschieben (numerische
Eingabe).

**Öffnung** — schneidet eine Öffnung in das ausgewählte Bauteil
(`IfcOpeningElement` + Beziehung „voids"). Die Zulässigkeit der Kombination
wird geprüft.

Alle drei Modi schreiben über die Command-Pipeline und sind rückgängig zu
machen. Der Hinweis am Fuß des Panes gilt uneingeschränkt: Neue Körper werden
im 3D erst nach **Modell neu berechnen** sichtbar.

### 3.10 Prüfzentrum

Führt Prüfungen über das aktive Modell aus und macht die Befunde bedienbar.

**Quellen** (Kopfzeile, einzeln an-/abwählbar):

| Quelle | Inhalt |
| --- | --- |
| Modell-Diagnostik | Projekt/Einheiten, doppelte GlobalIds, Platzierung, Repräsentation, Containment |
| Objektinfo-IDs | die aus 1.x übernommenen Objektinfo-Regeln |
| IDS | Prüfung gegen geladene IDS-Dokumente |
| Kollisionen | geometrische Kollisionsprüfung |

**Prüfen** startet den Lauf; hinter jeder Quelle steht die Zahl ihrer Befunde,
der Tooltip nennt Befunde, geprüfte Objekte und Laufzeit. Fällt eine Quelle
aus, bleiben die übrigen bedienbar.

**IDS-Bereich:**

- **IDS-Datei laden** (`.ids`/`.xml`, Mehrfachauswahl möglich).
- Ist ein Objektkatalog importiert: Klasse wählen und
  **aus Objektkatalog-Klasse übernehmen** — die Pflichtmerkmale werden als
  IDS-Anforderungen übernommen.
- Die Liste zeigt je Dokument die Zahl der Spezifikationen, **Entfernen**
  nimmt es wieder heraus. Ohne geladenes IDS liefert die IDS-Quelle keine
  Befunde.

Geprüft wird immer der **Bearbeitungsstand**, nicht die Originaldatei.

**Mit den Befunden arbeiten:**

- Filterleiste: Schwere (Fehler / Warnung / Hinweis), Quelle und Suchtext;
  die Zähler nennen Befunde je Schwere sowie bestandene und geprüfte Objekte.
- Klick auf einen Befund wählt das betroffene Objekt aus und fokussiert es im
  Viewer.
- **Im 3D markieren** färbt Fehler rot und Warnungen orange;
  **Markierung aufheben** nimmt das zurück.
- **Betroffene isolieren** setzt die Auswahl auf alle betroffenen Objekte der
  gefilterten Fehlschläge (das Isolieren selbst erledigt die
  Viewer-Werkzeugleiste).
- **BCF exportieren** schreibt ein `.bcfzip` mit einem Topic je angezeigtem
  Befund samt den GlobalIds der betroffenen Objekte — die Datei lässt sich in
  jedem BCF-fähigen Werkzeug öffnen.

Rechts steht der Stand des letzten Laufs. Nach Änderungen am Modell erscheint
„Modell geändert — neu prüfen"; die angezeigten Befunde sind dann veraltet.

### 3.11 IFC-Hub

Projekt-, Modell- und Versionsverwaltung. Der Hub ist ein eigener Dienst; die
App ist nur sein Client.

**Dienst starten** (lokal, ohne Docker):

```bash
cd editor-2.0/hub
npm install
npm start          # http://127.0.0.1:8711
```

Standardablage ist `~/.ifcnative/hub` (Katalog + Blobs), einstellbar über
`HUB_DATA_DIR`; Port über `HUB_PORT`, Bind-Adresse über `HUB_HOST`. Ist
`HUB_TOKEN` gesetzt, verlangen alle Routen ein Bearer-Token. Für den Teambetrieb
liegt ein Dockerfile bei. Einzelheiten: [`../hub/README.md`](../hub/README.md).

*Hinweis:* Der Hub startet in dieser Version **nicht** automatisch mit der App
mit — die Verdrahtung als Tauri-Sidecar steht noch aus. Der Dienst muss
separat laufen.

**Verbindungsleiste im Pane:** Basis-URL (Standard
`http://127.0.0.1:8711`), optionales **Token**, **Autor** (wird beim Sichern
mitgeschickt) und **Verbinden** (Prüfung über `/api/health`). Der farbige Punkt
zeigt den Zustand: verbunden, getrennt, prüfe …, ungeprüft.

**Arbeiten mit Ständen:**

- Links die Spalten **Projekte** und **Modelle**, jeweils mit **Neu** zum
  Anlegen.
- **Stand sichern** legt das aktive Dokument als neue Version im gewählten
  Modell ab; vorher wird eine Nachricht abgefragt (vorbelegt mit Datum und
  Uhrzeit). Gesichert wird der Bearbeitungsstand, nicht die Originaldatei.
- Die Ständeliste zeigt je Stand Nachricht, Erstellzeitpunkt, Schema,
  Objektzahl und Größe. **Öffnen** holt einen Stand als neuen Tab in die App.
- Zwei Stände ankreuzen und **Vergleichen** öffnet die Vergleichsansicht mit
  Hinzugefügt / Entfernt / Geändert je Objekt. Bei geänderten Objekten werden
  die betroffenen Komponenten benannt (z. B. `pset:Pset_WallCommon`) — der
  Vergleich ist objekt- und komponentengenau, aber nicht feldgenau.
- Klick auf ein Objekt im Vergleich sucht es über die GlobalId im aktiven
  Dokument, wählt es aus und fokussiert es. Kommt die GlobalId dort nicht vor,
  wird das gemeldet.
- **Zur Ständeliste** verlässt die Vergleichsansicht.

Meldungen und Fehler des Dienstes stehen unverändert unter der Werkzeugleiste
— ein nicht laufender Hub erscheint nie als leere Liste.

### 3.12 Notizen

Freies Textfeld für Projektnotizen. Der Inhalt wird lokal gespeichert und
überlebt den Neustart.

### 3.13 Kürzlich verwendet

Liste der zuletzt geöffneten Dateien mit Schema, Anzahl Entities und
Öffnungszeitpunkt. **Leeren** löscht die Liste. Die Einträge sind eine
Gedächtnisstütze — geöffnet wird über „IFC öffnen".

---

## 4. Bearbeiten, Rückgängig, Tastatur

Alle Änderungen laufen über eine gemeinsame Command-Pipeline. Folgen daraus:

- Jede Änderung ist rückgängig zu machen — auch Massenaktionen, Löschungen mit
  Kaskade und Geometrie-Operationen. Eine Massenaktion ist dabei genau *ein*
  Schritt.
- Der Stapel wird je Dokument geführt; das Umschalten des Tabs verwirft nichts.
- Die Tooltips der Knöpfe ↶/↷ nennen die betroffene Operation
  („Rückgängig: …").
- Änderungen liegen zunächst nur in der Sitzung. Erst **Exportieren** schreibt
  sie in eine Datei.

| Taste | Wirkung |
| --- | --- |
| `Strg`+`Z` | Rückgängig |
| `Strg`+`Umschalt`+`Z` oder `Strg`+`Y` | Wiederholen |
| `Entf` (im Graph) | ausgewählte Beziehung bzw. ausgewähltes Objekt löschen |
| `Strg`+Klick | Auswahl erweitern (Struktur, Viewer) |
| `Umschalt`+Klick | Bereichsauswahl (Struktur) |
| `Umschalt`+linke Maustaste (Viewer) | Ansicht verschieben statt drehen |
| `Enter` / `Esc` in Eingabefeldern | übernehmen / verwerfen |

In Eingabefeldern greifen die Undo-Tastenkürzel bewusst nicht — dort gilt die
Textbearbeitung des Feldes.

---

## 5. Export

**Kopfzeile → Exportieren** schreibt das Modell mit allen angewendeten
Änderungen als IFC-Datei (STEP). In der Desktop-Anwendung öffnet sich der
Windows-Speichern-Dialog, im Browser-Betrieb läuft es als Download.
Vorgeschlagen wird der Name der Ausgangsdatei mit dem Zusatz `.bearbeitet.ifc`.

Der Pfeil **▾** neben der Schaltfläche öffnet die weiteren Formate: ifcZIP
(gepackt), glTF / GLB, JSON-LD, Parquet / BOS sowie CSV in vier Zuschnitten
(Entitäten, Eigenschaften, Mengen, Struktur). Diese Formate gehören zu M7 und
sind noch in Arbeit — Fehler melden sie als Meldungsfenster mit deutschem
Text.

- Exportiert wird immer das aktive Dokument.
- Das IFC-Schema der Ausgangsdatei bleibt erhalten.
- Unveränderte Entities werden byte-stabil durchgereicht; Umlaute und
  Sonderzeichen behalten ihre `\X2\`-Kodierung.
- Die Ausgangsdatei wird nicht überschrieben — der Export schreibt immer in die
  im Dialog gewählte Datei.
- Die Zahl neben „Exportieren" und der Änderungsstand in der Statusleiste
  zählen die offenen, rückgängig machbaren Änderungen der Sitzung. Sie zählen
  nicht zurück, wenn exportiert wurde; sie sinken nur durch Rückgängig.

Weitere Ausgabewege an anderer Stelle:

- **CSV** aus Pset Batch (Matrix) und aus Listen — Semikolon, UTF-8-BOM.
- **IDS** aus dem Objektkatalog (Klassendetail).
- **BCF** (`.bcfzip`) aus dem Prüfzentrum.
- **Stand sichern** in den IFC-Hub (siehe 3.11).

---

## 6. Bekannte Grenzen

- **WebGPU ist Voraussetzung für die 3D-Ansicht.** Fehlt es, meldet das Pane
  „WebGPU ist in dieser Umgebung nicht verfügbar (R1) — 3D-Ansicht
  deaktiviert." Alle anderen Panes arbeiten dann weiter; ein
  Three.js-Rückfallpfad ist nicht eingebaut.
- **3D zeigt einen Stand, nicht die laufende Sitzung.** Änderungen erscheinen
  erst nach **Modell neu berechnen** (siehe 3.2). Bei großen Modellen ist das
  spürbar teuer.
- **Der Hub muss separat gestartet werden.** Der automatische Start als
  Sidecar sowie Push/Pull zwischen lokalem und zentralem Hub sind noch nicht
  umgesetzt.
- **Der Versionsvergleich ist nicht feldgenau** — er nennt geänderte Objekte
  und Komponenten (Pset, Attribut, Mengensatz), nicht das einzelne Feld.
- **Kein Transform-Gizmo im Viewer.** Verschieben und Maßänderungen laufen
  numerisch über den Baukasten; Koordinaten lassen sich nicht im 3D picken.
- **Der Installer ist unsigniert** (SmartScreen-Warnung, E12), und es gibt
  **kein Auto-Update** — neue Versionen werden von Hand installiert. Beides ist
  in der Konfiguration vorbereitet und bewusst abgeschaltet.
- **Standardprogramm nur per Hinweis.** Windows lässt die Zuordnung nicht
  programmatisch setzen; die App kann nur die Einstellungsseite öffnen.
- **Doppelklick auf `.ids`/`.bcf`** startet zwar die App (die Endungen sind
  registriert), geladen werden diese Dateien aber im Prüfzentrum über
  „IDS-Datei laden"; als Modell lassen sie sich nicht öffnen.
- **Das MKP-Portal ist noch nicht migriert.** Login, Bäume, Zuordnen/Import und
  der Mapping-Editor kommen erst später; bis dahin bleibt die 1.x-Anwendung für
  Portal-Arbeit im Einsatz.
- Dieses Handbuch beschreibt den Stand **M0–M6**. Die M7-Themen — weitere
  Exportformate, 2D-Ableitungen (Pane „2D-Ansicht") und der
  Föderations-Workspace — entstehen gerade; was davon schon in der Oberfläche
  auftaucht, ist hier nicht beschrieben und kann sich noch ändern.
