# Materialien

Öffnen über **Fenster → Materialien** oder **3D-Rechtsklick → Material ändern**.
Das Panel gehört zum aktiven IFC-Dokument. Die Liste zeigt Materialfarbe,
Name, Kategorie und direkte Zuordnungen innerhalb der aktuellen Auswahl.

- **Allgemein:** Material anlegen, Name, Beschreibung und Kategorie bearbeiten.
  IFC2X3 unterstützt in `IfcMaterial` nur den Namen.
- **Farbe:** RGB/Hex-Farbe und Transparenz (0 % = deckend, 100 % = unsichtbar).
  Weitere Felder: Reflexionsmodell, Glanz-/Metallanteil und Rauheit.
  PHYSICAL steht nur für IFC4X3 zur Verfügung. Der Viewer muss die erweiterten
  Renderingparameter unterstützen; der Editor schreibt sie in die IFC-Datei.
- **Eigenschaften:** Material-Property-Sets lesen, einfache Werte hinzufügen
  und bearbeiten. Vorlagen für Dichte, Wärmeleitfähigkeit, spezifische
  Wärmekapazität, Elastizitätsmodul und Querdehnzahl; außerdem freie Namen,
  IFC-Datentypen und vorhandene IFC-Einheiten. Ohne explizite Einheit gelten
  die IFC-Regeln für den jeweiligen Maßtyp und die Projekteinheiten.

**Der Auswahl zuordnen** ersetzt direkte Materialzuordnungen aller gültigen
ausgewählten Objekte. Nicht ausgewählte Mitglieder einer gemeinsamen
Zuordnung bleiben erhalten. Beim Zuordnen eines farbigen Materials und beim
Speichern seiner Darstellung werden direkte Objekt-/Geometrie-Oberflächenstile
durch die Materialdarstellung ersetzt. Das gilt auch für importierte BReps und
Mapped Representations. Nur die benötigten Geometriepfade werden kopiert;
andere Benutzer gemeinsamer Repräsentationen behalten ihre Farbe und Position.
Kurvenstile und Präsentationslayer bleiben erhalten. Vorhandene indizierte
Farb-/Texturkarten werden am neu eingefärbten Geometriezweig nicht übernommen,
damit die gewählte Materialfarbe sichtbar ist. Anschließend lädt der Viewer neu.

Solange das Material-Panel geöffnet ist, zeigt ein gelber Rahmen die Auswahl;
die Materialfarbe bleibt sichtbar. Bei bereits zugeordneten Materialien aus
älteren Editorständen einmal **Der Auswahl zuordnen** oder **Darstellung
speichern** ausführen, um die alten Geometriefarben zu ersetzen.

## Daten und Grenzen

- Farben werden über `IfcMaterialDefinitionRepresentation` und
  `IfcSurfaceStyleRendering` gespeichert, einschließlich der für IFC2X3
  erforderlichen `IfcPresentationStyleAssignment`-Zwischenstufe.
- Beim Bearbeiten gemeinsam genutzter Stile werden nur die Pfade des
  gewählten Materials kopiert. Andere Materialien, Texturen und nicht
  bearbeitete Renderingattribute bleiben erhalten.
- Einfache Eigenschaften werden als `IfcPropertySingleValue` mit typisiertem
  Wert gespeichert: Zahlenmaße als Zahlen, Texte korrekt STEP-escaped.
  IFC4 verwendet `IfcMaterialProperties`, IFC2X3
  `IfcExtendedMaterialProperties`. Geteilte Property-Instanzen werden beim
  Bearbeiten kopiert. Bestehende Beschreibungen und explizite Einheiten
  bleiben erhalten, sofern die Einheit nicht bewusst geändert wird.
- Komplexe Listen-, Tabellen-, Referenz- und begrenzte Werte sowie
  vordefinierte IFC2X3-Material-Property-Klassen werden erhalten. Sie werden
  nicht in einfache Werte umgewandelt; das Formular bearbeitet derzeit
  einfache Materialeigenschaften der angebotenen IFC-Datentypen.
- Alle Änderungen sind normale Dokumenttransaktionen mit Undo/Redo und
  werden mit der IFC-Datei gespeichert. Technische Materialwerte erfordern
  keine neue Geometriekonvertierung.

Schemaquellen: [IfcMaterialProperties](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcMaterialProperties.htm),
[IfcSurfaceStyleRendering](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/FINAL/HTML/schema/ifcpresentationappearanceresource/lexical/ifcsurfacestylerendering.htm)
und die installierten web-ifc-Schemakonstruktoren für IFC2X3/IFC4/IFC4X3.

Regressionen: `tests/materials.test.ts` (inklusive echter web-ifc-Auswertung
von RGB/Alpha und Maßwerten), ausgeführt mit `npm run test:ifc`.
