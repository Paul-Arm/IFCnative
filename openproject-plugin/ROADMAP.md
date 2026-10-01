# OpenProject ↔ IFC Hub ↔ Editor: Roadmap

Stand 2026-10-01. Läuft testweise auf dem OpenProject-Server (10.10.17.29, 17.7.2 BIM) mit dem Hub auf Dokploy (`ifc-hub.dokploy.local`).

## BCF im Editor: Ist-Stand

| Kann der Editor | Fehlt noch |
| --- | --- |
| Issues des Hub-Projekts auflisten (BCF-Kennzeichen, „aufgefallen in“ / „behoben in“ Commit) | Issue aus der **eigenen Auswahl** anlegen. Heute geht das nur aus einer fehlgeschlagenen Prüfung. |
| Verortete Objekte im Modell auswählen (über die GUIDs) | **Viewpoint**: Kamera und Screenshot beim Anlegen; beim Öffnen auf die Kamera springen |
| BCF-Issue aus einer fehlgeschlagenen Prüfung anlegen, mit betroffenen Objekten. Es erscheint auch in OpenProject. | **Kommentare** lesen und schreiben |
| | **Status** ändern (schließen, wieder öffnen) |
| | Bezug zum OpenProject-Arbeitspaket (Nummer, Link „in OpenProject öffnen“) |

Der Abgleich mit OpenProject überträgt Titel, Beschreibung, Status, betroffene Objekte (GUIDs) und Kommentare. Viewpoints sind nur eine Standard-Kamera ohne Bild. OpenProject zeigt deshalb keine Vorschau und springt nicht an die richtige Stelle.

## Ausbau, nach Nutzen sortiert

0. **Mitglieder automatisch abgleichen** (Lücke, gefunden 2026-10-01): Im Hub wird man heute erst Mitglied, wenn man in OpenProject den Menüpunkt „IFC Hub“ öffnet (Rolle per Ticket). Wer das noch nie getan hat, bekommt beim Hochladen aus einem Arbeitspaket in der Ordnerauswahl „Keine Speicher-Verbindung“, denn der Hub findet für ihn das private Projekt nicht. Lösung: Der 5-Minuten-Abgleich (`SyncProjectJob`) überträgt die Projektmitglieder samt Rolle (über die Rechte `view`/`edit`/`manage_ifc_hub`) in das verknüpfte Hub-Projekt. Aufwand klein bis mittel.
1. **Echte Viewpoints in beide Richtungen** (größter Alltagsnutzen; Aufwand mittel bis groß):
   - Editor und Hub-Viewer speichern beim Anlegen Kamera, Auswahl und Screenshot.
   - OpenProject zeigt das Vorschaubild, und sein BCF-Viewer springt an die Stelle.
   - Umgekehrt öffnen Editor und Hub ein in OpenProject angelegtes Thema mit dessen Kamera.
   - Betrifft Hub-API, Abgleich im Plugin und Editor.
2. **BCF-Ablauf im Editor vervollständigen** (Aufwand mittel):
   - Issue aus der aktuellen Auswahl anlegen, mit Viewpoint.
   - Kommentare und Status.
   - Link zum Arbeitspaket.
   - Beim Commit ein Issue schließen, mit „behoben in Commit X“.
3. **Mehr Felder im Abgleich:** Zuständige Person (die Benutzerzuordnung über `external_links` existiert schon), Fälligkeit, Priorität. Aufwand klein bis mittel.
4. **„Im Editor öffnen“ am BCF-Arbeitspaket in OpenProject:** Modell und Viewpoint direkt im Desktop-Editor. Aufwand klein, sobald Punkt 1 steht.
5. **Prüfergebnisse in OpenProject:** Status der IDS- und Python-Prüfungen am Arbeitspaket oder als Widget auf der Projektseite. Aufwand mittel.
6. **„Mit OpenProject anmelden“ im Hub und im Editor:** OpenProject als Login-Anbieter, dann braucht man kein Zugangstoken mehr. Aufwand mittel.

**Empfohlene Reihenfolge:** 1, dann 2. Erst damit trägt der BCF-Ablauf durch: Befund im Modell anlegen, in OpenProject zuweisen und verfolgen, im Editor beheben und schließen.

Jeder Punkt betrifft mehrere Teile gleichzeitig: Editor, Hub (inklusive Port nach mkp-vapps `apps/mkp-ifc-hub`) und Plugin (neues Image, `deploy/openproject-server/install-on-server.sh`).

## OpenProject-Updates absichern

**Umgesetzt (Schritt 1):** Die Laufzeit-Patches sind durch vier Erweiterungspunkte im OpenProject-Fork ersetzt (Branch `ifc-hub/v17.7.2`, als Patch in `deploy/openproject-local/patches/`, Details dort). Im Plugin bleibt nur das Einhängen eines Callbacks in `Bim::IfcModels::IfcModel` (`IfcModelSyncTrigger`). Die Erweiterungspunkte für Upload und Ordnerauswahl liegen genau an der Dateiauswahl, die das Epic [#78519](https://community.openproject.org/work_packages/78519) umbauen will. Beim Rebase fällt eine Änderung dort sofort auf.

Plan:

1. **Patch-Fork** von `opf/openproject`, pro Version ein Branch `ifc-hub/vX.Y.Z`: offizieller Tag plus nur unsere Patch-Commits. Die Patches werden dort zu normalem Quellcode, im Idealfall als registrierbarer Erweiterungspunkt.
   - **Update:** `git rebase --onto vNEU vALT`. Konflikte zeigen genau die geänderten Stellen.
   - **Build:** weiter auf dem offiziellen `-slim-bim`-Image aufsetzen und nur den Diff des Forks als Patchdatei anwenden, vor dem Frontend-Build. Kein vollständiger Build aus dem Quellcode.
   - **Plugin:** Additiver Code (Speicheranbieter, Abgleich, Einbettung) bleibt im Plugin.
2. **Änderungsbericht:** Fingerabdrücke der Upstream-Stellen, von denen wir abhängen, mit dem neuen Image vergleichen. Ergebnis je Stelle: unverändert, geändert (mit Diff) oder fehlt.
3. **Tests:**
   - Rauchtest (`deploy/openproject-server/smoke-test.ps1`, prüft unter anderem das Admin-Formular).
   - Backend-Tests gegen einen laufenden Hub: Speicher-Abfragen, Ordner, Abgleich in beide Richtungen, CSP.
   - Browser-Tests mit headless Edge: Upload mit Commit-Dialog, Dateiauswahl „neue Version“, Speicher anlegen.
4. **Ablauf** `update-openproject.ps1 -Version X`:
   1. Images ziehen und den Änderungsbericht erstellen.
   2. Patches anwenden und bauen.
   3. Alle Tests laufen lassen.
   4. Wenn alles grün ist: Fingerabdrücke aktualisieren und den Tag ausgeben.

**Upstream:** Zu frei registrierbaren Speicheranbietern gibt es bei OpenProject kein Ticket. Laut Doku ist das geplant, interessierte Entwickler sollen sich melden. Ein eigener Feature-Vorschlag mit unserem Plugin als Beispiel würde die Angular-Patches langfristig überflüssig machen. Ein eigenes Automations-Modul (Auslöser, Bedingungen, Aktionen) ist bei OpenProject in Entwicklung ([#75927](https://community.openproject.org/work_packages/75927), [#73949](https://community.openproject.org/work_packages/73949)). Bis dahin laufen Automationen über Webhooks und z. B. n8n.

## Bekannte Eigenheiten

- **Speicher im iframe:** Hub und OpenProject auf verschiedenen Hosts sind für den Browser verschiedene „Sites“. Bei blockiertem Drittanbieter-Speicher weicht der Hub im iframe auf einen Speicher im Arbeitsspeicher aus (`server/web/nuxt.config.ts`, `storageFallbackBoot`).
- **Claude-Browser:** Der eingebaute Browser der Claude-Desktop-App zeigt keine Inhalte aus iframes einer anderen Website, auch kein reines JSON. Zum Testen der Einbettung einen normalen Browser nehmen.
- **Editor-Freigabe:** Die Hub-Adresse muss in der HTTP-Freigabe des Editors stehen (`editor/src-tauri/capabilities/default.json`), sonst scheitert „Im Editor öffnen“.
