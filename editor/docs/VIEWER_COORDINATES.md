# Viewer-Koordinaten, Grid und Kamera

Die IFC behält ihre Originalkoordinaten. Der Fragments-Import verschiebt
Geometrie mit `COORDINATE_TO_ORIGIN` in einen lokalen Modellraum. Die gespeicherte
Koordinationsmatrix und `model.object.matrixWorld` bilden Picks und Bearbeitungen
wieder auf die IFC-Weltkoordinaten ab.

## Präzision und Lebenszyklus

- Das Grid-Mesh folgt der Kamera auf der CPU in 10-m-Schritten. Seine
  Model-View-Matrix verrechnet den großen Versatz in double precision, bevor
  kleine lokale Werte an den GPU-Shader gehen. `cameraPosition` im Vertex-Shader
  zu addieren ist bei Vermessungskoordinaten ungenau. Das Grid schreibt keinen
  Tiefenwert; zu feine Linien werden am Horizont ausgeblendet.
- Nach Änderungen an der Liste geöffneter Modelle wird der erste verbleibende
  Modellursprung zum Szenenursprung. Alle Basis-, Subset- und Delta-Modelle sowie
  Kamera und Kameraziel erhalten denselben Versatz; IFC-Daten bleiben unverändert.
- Beim Neuladen einer Revision bleibt der bisherige Szenenursprung erhalten,
  auch wenn Fragments beim Entladen des letzten Modells `baseCoordinates` leert.
  Die Kamera wird bei einer Bearbeitung nicht erneut eingepasst.
- Beim Hinzufügen/Öffnen richtet sich die Kamera auf das aktive Modell.
  Explizites „Auf Modell zoomen“ umfasst die geladenen Modelle. Ausgeblendete
  ersetzte Geometrie wird bei den Grenzen nicht berücksichtigt.
- Kameraberechnungen verwenden eigene Bounding-Boxen statt des gemeinsam
  genutzten `BoundingBoxer` der Bibliothek. Überholte asynchrone Fokus-Anfragen
  werden verworfen. Leere oder ungültige Grenzen lösen keinen Kamerasprung aus.
- „Kamera zurücksetzen“ berechnet eine Schrägansicht am aktiven Modell.
  Near/Far-Clipping passt sich dem Abstand zum Kameraziel an, auch für kleine
  Proben und Bohrkerne.
- Eine IFC-Storey-Elevation wird nur verwendet, wenn sie nahe an der sichtbaren
  Modellunterkante liegt. Insbesondere eine Platzhalter-Elevation von 0 darf
  bei georeferenzierten Placements das Grid nicht 100 m unter das Modell setzen.

## Regressionen

Vorher reproduzierbar: kleines Beispielmodell öffnen, anschließend
`tests/fixtures/attribution/diagnostik-einzelergebnisse.ifc` hinzufügen und das
kleine Modell schließen. Die Kamera blieb bei X ≈ 32.455.187 m und das Grid
verschwand. Mit der Korrektur liegt dieselbe Ansicht bei X ≈ 18 m; das Grid
bleibt auch vor dem Schließen bei den großen Koordinaten sichtbar.

`npm run test:ifc` prüft GPU-Rundung nach CPU-Kompensation, Grid-Höhe,
unveränderte IFC-Picks und relative Modellpositionen beim Rebase sowie die
Kamerapolitik bei Revisionen und Dokumentwechseln. Zusätzlich im Browser
prüfen: Drehen/Zoomen, Objekt fokussieren, Kamera zurücksetzen und eine
Materialdarstellung speichern, ohne die Kamera zu versetzen.
