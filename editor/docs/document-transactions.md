# Dokument-Transaktionen

Der Editor hält pro geöffnetem Dokument eine `WorkspaceDocumentSession`.
`documentTransaction.ts` ist der gemeinsame Übergang für Dokumentrevision,
Undo/Redo, Auswahl, Textcache, Speicherstatus und Geometrieinvalidierung.

## Eine Änderung übernehmen

1. Die Fachoperation erzeugt aus dem aktuellen Dokument ein neues Dokument.
   Für mehrere Schreiboperationen `batchNativeDocument(base, draft => …)` verwenden.
2. `createDocumentTransaction(base, next, summary)` ermittelt das Entity-Delta
   und entscheidet anhand der geänderten Attribute, ob Geometrie betroffen ist.
3. `commitDocumentTransaction(session, transaction, options)` übernimmt die
   Änderung einmal, erhöht die Revision und legt einen Undo-Eintrag an.

Ein leeres Delta lässt die Session unverändert. Bei veralteter Ausgangsversion
werden unabhängige Änderungen zusammengeführt. Überschneiden sich Änderungen
an derselben Entity oder kollidieren neue STEP-IDs, wird die Transaktion abgelehnt.
Der Workspace meldet den Konflikt, ohne einen Teil der Änderung zu übernehmen.

Der Batch besitzt isolierte, intern veränderbare Indexcontainer. Bestehende
Fachoperationen aktualisieren sie während des synchronen Callbacks. Beim Abschluss
werden Entities normalisiert und die abgeleiteten Indizes einmal konsistent
aufgebaut. Zwischenstände dürfen den Callback nicht verlassen oder als
History-Snapshots gespeichert werden. Eine Exception lässt das Ausgangsdokument
unverändert. Verschachtelte Batches gehören zur äußeren Transaktion.

## Viewer und Historie

Property-, Mengen-, Gruppen- und reine Namens-/Beschreibungsänderungen benötigen
keine neue Geometrie. Ihr Undo/Redo lässt Viewer-Snapshot und Viewer-Revision
unverändert. Geometrieänderungen behalten den bestehenden Live-Mirror mit einer
ausstehenden Neuberechnung als Absicherung. Bei geometrischem Undo/Redo wird der
Viewer aus dem wiederhergestellten Dokument neu aufgebaut.

`readDocumentText` liefert Speichern, Recovery und Viewer denselben Textstand.
Serialisierte Dokumente werden nach ihrer unveränderlichen Objektidentität gecacht;
das Lesen bestätigt keine Speicherung. `refreshDocumentViewer` aktualisiert Textcache
und Viewer gemeinsam. Ein bloßer Ladeauftrag über `requestDocumentViewerLoad`
behält den vorhandenen Datei-/Byte-Snapshot, solange keine Geometrieaktualisierung
aussteht.

## Gemeinsame Import- und Mutationspfade

Dateien und Hub-Stände werden in `documentLoading.ts` über denselben Worker- und
Session-Aufbau geladen. Mehrfachimporte werden nacheinander geparst, um parallele
Worker-Speicherspitzen zu vermeiden. Erst nach erfolgreichem Laden der gesamten
Gruppe übernimmt der Workspace die Tabs und die Liste kürzlich geöffneter Dateien.

Einzelne und mehrere Properties verwenden dieselben Entity- und Beziehungsfabriken.
`mergeNativePropertySetValues` ergänzt fehlende Namen in einem Durchlauf und
aktualisiert Referenzliste und Property-Zusammenfassung einmal. Bestehende Werte
werden beibehalten; leere oder doppelte Namen erzeugen keine zusätzlichen Felder.
Einfügen und Ersetzen teilen sich die inkrementelle Pflege der Kernindizes.

Import und Entity-Diff lesen STEP-Records über `stepScanner.ts`. Der Diff baut
seinen Rückreferenzindex einmal auf und verwendet ihn zur Zuordnung betroffener
Produkte. Formatierungsleerzeichen werden beim Vergleich ignoriert, Leerzeichen
innerhalb von STEP-Strings bleiben relevant.

## Speichern

`captureDocumentSave` friert Dokument, Session-ID, Revision und IFC-Text für einen
Speichervorgang ein. `acknowledgeDocumentSave` entfernt den Änderungsstatus nur,
wenn genau diese Revision noch aktuell ist. Weitere Edits oder Undo während eines
lokalen Speichervorgangs oder Hub-Commits bleiben als ungespeichert markiert.
Strg+S verwendet denselben Speicherpfad wie das Menü.

Desktop-Speichern wartet auf den Dateidialog und schreibt über eine temporäre
Datei im Zielverzeichnis, die das Ziel nach vollständigem Schreiben ersetzt.
Abbruch und Schreibfehler bestätigen keine Speicherung. Im Browser wird die
File System Access API verwendet, falls verfügbar. Beim Download-Fallback ist
der tatsächliche Speichererfolg unbekannt; Änderungsstatus und Recovery bleiben
deshalb erhalten.

## Prüfung und Messung

Die Portal-/IDS-Prüfung der Attribuierung läuft entprellt in einem Worker;
Antworten veralteter Prüfaufträge werden verworfen. Eingeklappte Panels pausieren
ihre Effects über React Activity. Die Tabelle rendert nur den sichtbaren Ausschnitt
plus Puffer; ihre Statistik wird bei Datenänderungen neu berechnet.

- `npm run test:ifc`: Fachtests und Regressionen in `transactions.test.ts`.
- `npx tsc --noEmit` und `npm run lint`: Typen und statische Prüfung.
- `cargo test --lib` in `src-tauri`: Desktop-Dateizugriff und atomarer Dateiersatz.
- `npx tsx scripts/benchmark-transactions.ts`: identisches Modell mit 100.000
  Entities, 100 und 1.000 Property-Änderungen, Einzeloperationen gegen Batch.
  Der Benchmark prüft auch Entity- und Property-Indexgleichheit beider Ergebnisse.
- Mit `--merge` vergleicht derselbe Benchmark 1.000 einzelne Property-Ergänzungen
  mit einer gemeinsamen Ergänzung im identischen Modell.
- `npm run schema:identities`: Attributpositionen für IFC2X3, IFC4 und IFC4X3 aus
  der installierten `web-ifc`-Schemadeklaration neu erzeugen.
