# MKP Modellqualität & Attribuierung — VDC WebForm

Erste Ausbaustufe für **VDC Manager (ehemals DESITE)**. Lokale WebForm mit
wiederverwendeten Fachregeln aus IFCnative. Keine Cloud, kein Login, kein
zusätzlicher Viewer. Ergebnis des Builds ist **eine einzige `dist/index.html`**
mit eingebettetem JavaScript, CSS und Fachmodell-Schema. Zur Laufzeit ist kein
Node.js oder Webserver erforderlich.

## Starten

Aus der Repository-Wurzel, bei bereits installierten Editor-Abhängigkeiten:

```powershell
node vdc-addon/scripts/build.mjs
node vdc-addon/scripts/test.mjs
node editor/node_modules/typescript/bin/tsc -p vdc-addon/tsconfig.json
```

Auf einem frischen Checkout zunächst `npm ci --prefix editor` ausführen.
Die Build-Werkzeuge werden bewusst aus `editor/node_modules` bezogen; die
Fachmodule stammen ebenfalls aus `editor/src`. Das Add-on ist somit ein
Monorepo-Baustein, kein unabhängig installierbares npm-Paket.

Für die Browser-Demo `dist/index.html` direkt öffnen, oder:

```powershell
node vdc-addon/scripts/preview.mjs
# http://127.0.0.1:5284
```

**Demo öffnen** aktiviert ausschließlich lokale Beispieldaten. Die Demo
startet niemals automatisch als Ersatz für eine fehlgeschlagene VDC-Verbindung.

## In VDC Manager einrichten

1. In VDC Manager das gewünschte Projekt öffnen und über die Widget-Suche
   (`Ctrl+W`) **WebForms** öffnen.
2. Im WebForms-Fenster **Schraubenschlüssel → Create New Module…** wählen
   und das Modul beispielsweise **MKP Modellqualitaet** nennen.
3. Über **Open Modules Folder** den Modulordner öffnen. Die gebaute
   `dist/index.html` ersetzt dort die `index.html` im Unterordner
   `MKP Modellqualitaet.module`; die erzeugte `config.json` bleibt erhalten.
   Auf der WebForms-Startseite das Modul über den Pfeil öffnen. Bei Updates
   die Moduladresse in der eingeblendeten **Navigation Bar** mit Enter neu laden.
   Dieser Ablauf wurde in VDC Manager 4.2.1 geprüft. Module gehören zum jeweiligen
   Projekt. Ein externer Browser hat keinen Zugriff auf dessen API.
4. Unter **Eigenschaftszuordnung & Schema** die tatsächlich importierten
   Eigenschaftsnamen abgleichen. Voreinstellungen sind `IFC:Type`,
   `IFC:GlobalId` und `:` als Trennung zwischen Pset und Merkmal. Das sind
   anpassbare Importkonventionen, keine garantierten Namen in jedem Projekt.
5. **VDC-Projekt laden** anklicken. Die WebForm verwendet `vdcApp`, mit
   Rückfall auf die vorhandenen Legacy-Objekte `desiteAPI` und `desiteMD`.
6. Prüfmodell und Phase wählen. Weitere Bauwerksmodelle explizit als
   Referenzmodelle markieren und **Modell prüfen** ausführen.

Unterstützte Trennzeichen: `:`, `::`, `.`. Für IFC-Klassen werden zusätzlich
`IFC:Type`, `IFC:Entity`, `ifcType` und `IfcEntity` gesucht; die konfigurierte
Eigenschaft hat Vorrang. Ein Objekt ohne erkannte IFC-Klasse wird ausdrücklich
als **ungeprüft** gemeldet. Es wird keine IFC-Klasse erfunden.

Vorausgesetzt werden direkt aufrufbare WebForms-Funktionen mit synchronen
Rückgaben oder Promise-Rückgaben. Ein zusätzliches, nur callbackbasiertes
Bridge-Protokoll wird nicht implementiert.

Die Projektidentität stammt bevorzugt aus `getProjectInfo().ID`. In der getesteten
VDC-4.2.1-WebForm lieferte `getPropertyValue('GlobalProject', 'ID', 'xs:ID')`
`null`; dieser ältere Zugriff wird deshalb nur verwendet, wenn `getProjectInfo`
im Host nicht vorhanden ist. Ohne echte Projekt-ID wird kein Schreiben zugelassen.

## Funktionsumfang

- Phasen: Bauwerksmodell, Monitoring, Untersuchungsplanung, Diagnostik-
  Einzelergebnisse und Untersuchungsergebnisse; Katalogauswahl nach Phase/LoI.
- Fachprüfung mit der bestehenden `runPortalCheck`-Implementierung:
  Pflichtattribute, ID-Konventionen, doppelte fachliche IDs, Verfahrens-Psets
  sowie Referenzen innerhalb des Fachmodells und in gewählten Bauwerksmodellen.
- Ergänzende Katalogprüfung für Pflichtwerte in bereits vorhandenen passenden
  Psets. Keine automatische Zuordnung einer Katalogklasse nur aus der IFC-Klasse.
- Filterbare Befundliste, 50 Befunde pro Seite, Auswahl und Zoom im Host.
- Auswahl einzelner Objekte, Übernahme der 3D-Auswahl oder Auswahl des gesamten
  Prüfmodells. Die direkte Objektliste zeigt höchstens 300 Einträge; die
  3D-/Gesamtauswahl und Fachprüfung berücksichtigen auch größere Modelle.
- Sammelbearbeitung eines Merkmals mit konkretem Pset-Namen, Datentyp, neuem
  Wert und Modus **Nur leere Werte ergänzen** / **Vorhandene Werte ersetzen**.
- Vorschau mit Vorher-/Nachher-Werten. Fehlende Eigenschaften können angelegt
  werden. Vorhandene Präfix-/Suffix-Schreibweisen werden beibehalten;
  mehrdeutige Aliasnamen verhindern die Änderung.
- Schema-JSON laden oder eingebauten Stand wiederherstellen. Die Fachalgorithmen
  bleiben die aus dem Repo; ein Schemawechsel kann nicht beliebige neue
  Prüfalgorithmen hinzufügen.
- JSON-Bericht mit Schema, Phase, LoI, Referenzmodellen und Prüfgrenzen.

## Schreibverhalten

Schreiben erfolgt erst über **Änderungen anwenden**. Vorher werden Projekt-ID,
Modellzuordnung, aktuelle Werte, Datentypen, Vererbung, Formeln und der
Schreibschutz erneut geprüft. Vererbte Werte werden beim Planen übersprungen,
berechnete Eigenschaften beim Anwenden abgelehnt. Ein Snapshot, dessen
Eigenschaften sich zwischenzeitlich verändert haben, darf nicht überschrieben
werden. Rückgabecode `1` bestätigt eine Änderung; andere Codes sind Fehler.

Projekttransaktionen bündeln API-Aufrufe. Sie werden **nicht als atomarer
Rollback oder als garantierter Undo-Schritt interpretiert**. Bei einem Fehler
stoppt die Verarbeitung, zählt bestätigte Änderungen und lädt neu. Bereits
bestätigte Änderungen werden nicht automatisch zurückgenommen. Verbindungsfehler
können einen unbestätigten letzten Schreibvorgang hinterlassen; das neu geladene
Projekt ist die Wahrheit.

Die Werte werden über `setPropertyValue` in den von VDC bestimmten
Eigenschaftsspeicher geschrieben. Die originale IFC-Datei wird damit nicht
gespeichert. Die Abbildung neu angelegter Eigenschaften auf IFC-Psets hängt
von den IFC-Exporteinstellungen ab und muss am Zielsystem mit einem Export /
erneuten Import geprüft werden.

## Bewusste Grenzen dieser Ausbaustufe

- Die Projektion ist ein Attribut-Snapshot, kein IFC-Parser und kein
  Geometriemodell. Geometrieabhängige Zuordenbarkeit wird nicht geprüft.
- Keine vollständige IDS-Validierung, Geometrieprüfung oder Prüfung gegen den
  aktuellen Datenbestand des MKP-Portals. Die Prüfung bestätigt keine allgemeine
  Portal-Importfähigkeit.
- Alle Objekte werden modellweise geprüft, damit getrennte IFC-Lieferungen
  nicht versehentlich als eine Datei mit mehreren IfcBuildings behandelt werden.
- Einlesen erfolgt pro Objekt und gibt regelmäßig an die Oberfläche zurück.
  Für sehr große Projekte ist die Laufzeit in der echten WebForm zu messen.
- Kein Portal-Login, Tabellenimport, BCF-Export, Versionsvergleich oder Undo-
  Journal in dieser ersten Ausbaustufe.
- Browser-Downloads müssen für den JSON-Bericht von der WebForm unterstützt
  werden. Der Host-Exportweg ist noch nicht integriert.

## Architektur

| Datei | Verantwortung |
| --- | --- |
| `src/vdc.ts` | API-Erkennung, Snapshot, Auswahl, überprüftes Schreiben |
| `src/domain.ts` | Lesende Projektion auf bestehende IFC-Fachregeln, Katalogprüfung, Änderungsplanung |
| `src/types.ts` | Host-unabhängige Datenverträge; VDC-IDs bleiben Strings |
| `src/demo.ts` | Expliziter Demo-Host mit unabhängigen Beispieldaten |
| `src/main.ts` | WebForm-Ablauf und DOM-Oberfläche |
| `tests/addon.test.ts` | Fachregeln, Mapping und API-Fehlerverhalten |

Die vorhandene Editor-App wird nicht verändert. Das Schema wird beim Build
aus `editor/src/ifc/attribution/fachmodell-schema.json` eingebettet. Wird die
Quelle unter `schema/` geändert, zunächst wie bisher den Schema-Generator des
Editors ausführen und anschließend das Add-on neu bauen.

## Verifikation / Abnahme am Zielsystem

Automatisiert: Mapping einschließlich STEP-Zeichen, Fachregeln über den Demo-
Datensatz, Modelltrennung, Auswahl, typisierte Werte, Alias-Konflikte,
Projektwechsel, veraltete Vorschau, Schreibschutz, Vererbung/Formeln und
Teilfehler. Browser: Demo → Prüfung → Befundauswahl → Attributvorschau →
Übernahme → neue Prüfung.

**Live geprüft am 16.09.2026 mit VDC Manager 4.2.1:** Installation als natives
WebForms-Modul, Laden der Oberfläche und echte API-Verbindung zum geöffneten
Projekt `Project`. Der Host meldet 0 Objekte / 0 Modelle; das Add-on zeigt einen
Importhinweis und deaktiviert die Modellprüfung. Die installierte HTML-Datei
entspricht dem lokalen Build. 21 automatisierte Tests und TypeScript-Prüfung
bestanden.

**Am echten Modell noch offen:** Das geöffnete Projekt enthielt kein IFC-Modell.
Vor produktiver Verwendung in einer Projektkopie prüfen:

1. IFC-Klasse, Pset-Trennung, räumliche Objekte und Modellzuordnung kommen
   vollständig im Snapshot an.
2. Ein Befund wählt genau das richtige Objekt im Viewer aus.
3. Eine neue und eine vorhandene Eigenschaft schreiben, anschließend den
   Projektstand und einen IFC-Export erneut öffnen und Werte/Psets vergleichen.
4. Host-Schreibschutz und ein absichtlich veralteter Vorschauwert verhindern
   Änderungen; VDC-Transaktion bleibt nach einem Fehler geschlossen.

API-Grundlage (VDC 4.2; abgeglichen am 16.09.2026):

- [WebForms und vdcApp](https://bimdocs.thinkproject.com/vdcAPI/4.2/index.html)
- [CoreAPI: Werte, Quellen und GlobalProject-ID](https://bimdocs.thinkproject.com/vdcAPI/4.2/class_core_a_p_i.html)
- [AutomationAPI: Modelle, Schreibzugriff, Projekttransaktionen](https://bimdocs.thinkproject.com/vdcAPI/4.2/class_automation_a_p_i.html)
- [ProjectAPI: Objektauswahl und Zoom](https://bimdocs.thinkproject.com/vdcAPI/4.2/class_project_a_p_i.html)
