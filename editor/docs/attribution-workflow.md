# IFC-Attribuierung

Öffnen über **Fenster → Bauen → IFC-Attribuierung**.

## Objekte finden und bearbeiten

- Links einen Bereich wählen. Die Tabelle zeigt dessen Objektarten; auch leere Arten bleiben auswählbar.
- Spalten am rechten Rand des Spaltenkopfs breiter oder schmaler ziehen, auch die Objektspalte und zugeklappte Pset-Gruppen. Doppelklick setzt die Standardbreite zurück. Fokussierte Ziehgriffe lassen sich mit Pfeiltasten bedienen; die Breiten werden lokal gespeichert.
- Die Tabelle rendert nur den sichtbaren Zeilenbereich mit kleinem Puffer. Eine gerade bearbeitete Zeile bleibt beim Wegscrollen erhalten. Suche, Zähler und Sammelauswahl berücksichtigen weiterhin alle passenden Objekte.
- Die Objektsuche findet Namen, IDs und Eigenschaftswerte. Die Feldsuche findet Eigenschaften und Psets einschließlich optionaler Felder. Mehrere Suchwörter können in beliebiger Reihenfolge stehen.
- Doppelklick, Enter oder F2 startet die Zellbearbeitung. Enter übernimmt und geht eine Zeile weiter, Tab ein Feld weiter; Shift kehrt die Richtung um. Esc verwirft die Eingabe. Pfeiltasten wechseln zwischen sichtbaren Zellen.
- Referenzfelder wie **UntersuchungszielID** öffnen schon mit einem Klick eine Auswahlliste. Nach ID oder Bezeichnung suchen und ein Objekt anklicken oder mit Pfeiltasten und Enter übernehmen; gespeichert wird dessen ID. Die Liste steht auch in der Sammelbearbeitung bereit. Eine eigene ID mit Enter bestätigen; Esc oder Verlassen verwirft eine unbestätigte Suche. Mehrere Untersuchungsziele lassen sich mit `;` trennen und einzeln vervollständigen. Bauteilreferenzen benötigen ein geladenes Bauwerksmodell; die Auswahl steht unter **Schema & Kontext**.
- **Nur Lücken** öffnet die betroffenen Spalten. **Nächste Lücke** springt zur nächsten betroffenen Zelle. Die Prüfung bleibt getrennt erreichbar und verlinkt Befunde in die Tabelle.

## Mehrere Objekte attribuieren

1. Gewünschte Zeilen mit den Kästchen auswählen; das Kästchen im Tabellenkopf wählt alle aktuell sichtbaren Zeilen.
2. In der Sammelbearbeitung ein Feld suchen und wählen, dann den gemeinsamen Wert eingeben.
3. **Nur leere ergänzen** oder **Vorhandene ersetzen** wählen und die Änderungsvorschau öffnen.
4. **Änderungen anwenden** schreibt den angezeigten Plan als einen Undo-Schritt. Fehlende Psets entstehen bei der Eingabe automatisch. Abgeleitete Felder und Platzierungen sind von dieser Sammelaktion ausgeschlossen.

Ein Wechsel von Bereich, Objektart, Dokument oder Schema hebt die Auswahl auf. Die Objektsuche setzt sie ebenfalls zurück; ausgeblendete Zeilen werden nicht mitbearbeitet.

## Neue Objekte anlegen

Das **+** am Baumknoten legt im passenden Kontext an, z. B. Stellen in einem Bereich oder Kanäle an einem Sensor. Im Formular steht eine Bezeichnung pro Zeile. Die Vorschau zeigt die erzeugte ID; bereits vorhandene oder doppelt eingegebene IDs verhindern die Anlage. **Strg+Enter** übernimmt die Liste als eine Änderung.

Die vorhandenen Schema-Rezepte bereiten IDs, Psets und Zuordnungen vor. Weitere Pflichtwerte ergänzt man anschließend in der Tabelle. Neue räumliche Objekte erhalten Marker; mehrere Marker werden versetzt angelegt. Alternativ erlaubt **Excel / CSV** den Tabellenimport mit Vorschau, auch vor dem ersten Objekt einer Art und einschließlich Koordinaten.

Zelländerungen werden beim Verlassen übernommen. **Strg+Z** bzw. **Rückgängig** stellt den vorherigen Modellstand wieder her. Die IFC-Datei muss anschließend wie bisher gespeichert bzw. exportiert werden.
