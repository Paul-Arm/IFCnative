# Fehlerberichte, Installationen und Updates mit Sentry

## Einrichtung

In Sentry zwei Projekte anlegen, damit Desktop- und Browser-Berichte getrennt bleiben:

| Build | Sentry-Projektvorlage | Variable in `editor/.env` oder Build-Umgebung |
| --- | --- | --- |
| Windows/Tauri | Rust | `IFCNATIVE_SENTRY_DSN` |
| Web | React | `VITE_IFCNATIVE_SENTRY_DSN` |

Die Vorlage liefert die passende Projekt-DSN; die SDK-Integration ist bereits im Code.
Kein Sentry-Auth-/API-Token nötig. Eine leere oder fehlende DSN deaktiviert den jeweiligen Client.
Die `.env` ist in Git ausgeschlossen; `.env.example` enthält nur leere Platzhalter.
Eine DSN ist die Adresse für Fehlerberichte und wird in den jeweiligen Build eingebettet.
Nach dem Eintragen neu bauen: Desktop mit `npm run desktop:installer`, Web mit `npm run build`.
Für Web-Deployments die `VITE_`-Variable in der Build-Umgebung setzen; sie ist kein Server-Geheimnis.

## Welche Daten werden gemeldet?

- Unbehandelte JavaScript-Fehler, Promise-Rejections und React-Renderfehler; zusätzlich explizit gemeldete Anwendungsfehler.
- Desktop: best-effort Rust-Panics, PC-Benutzername (`USERNAME`/`USER`) und installierte Version aus dem Rust-Paket.
- Web: Version aus `package.json`; der Browser hat keinen Zugriff auf den PC-Benutzernamen, daher wird keiner gemeldet.
- Die Namen der aktuell geöffneten IFC-Dateien (höchstens 32, ohne Verzeichnispfade).
- Fehlertext, Quelle und ein begrenzter bereinigter Stack als Zusatzfeld.

Keine IFC-Dateien oder Anhänge, keine IFC-Modellobjekte, keine Wiederherstellungsdaten,
kein Replay, Tracing oder Konsolenmitschnitt. Bekannte IFC-STEP-Inhalte werden entfernt;
URLs, lokale Windows-Pfade und erkennbare Zugangsdaten werden vor dem Versand bereinigt.
Der Desktop-SAS wird nicht als Kontext übergeben. Desktop- und Web-Client versenden keine Cookies.
Automatisches Erfassen weiterer personenbezogener Daten ist deaktiviert; der angeforderte
PC-Benutzername wird auf dem Desktop ausdrücklich als `user.username` gesetzt.

Die Stacktexte sind aktuell ein Zusatzfeld, ohne Source-Map-Upload/Symbolikation.
Native Prozessabbrüche (z. B. Zugriffsschutzverletzung, Prozess beenden) werden nicht zuverlässig erfasst;
der Panic-Hook sendet asynchron und erzwingt beim Absturz kein Warten.

## Offline und Leistung

- Desktop: eine eigene Rust-Worker-Queue, höchstens 16 Fehler. Die WebView übergibt nur kleine Berichte per IPC.
- Web: Sentry-SDK, Bereinigung, Serialisierung und HTTP laufen in einem separaten Web Worker.
  Scheitert dessen Start (z. B. CSP), bleibt Telemetrie still deaktiviert.
- `navigator.onLine === false` verwirft Berichte sofort. Bei unbemerktem Verbindungsabbruch
  begrenzen Timeouts einen Versuch auf vier Sekunden im Hintergrund.
- Nach Netzwerk-/HTTP-Fehlern mindestens 60 Sekunden Pause; `Retry-After` wird bis maximal einer Stunde berücksichtigt.
- Für Fehlerberichte keine Offline-Dateiablage oder Wiederholungswarteschlange; keine Fehlerbox wegen Sentry.
  Ein überlasteter Client verwirft Berichte. Gleichartige unmittelbar wiederholte Frontendfehler werden gedrosselt.
- Normales Beenden der App wartet nicht auf den Versand. Ein Fehlerbericht ist best-effort, kein Garant für jeden Absturz.

## Erstinstallation / erstmals erfasste Nutzer

Unter **Explore → Metrics → `editor.install`** erscheint der erste bekannte Online-Start
pro lokalem Windows-Benutzerprofil. Die Metrik ist ein Counter mit Wert `1`, verwendet
die Desktop-DSN und erzeugt kein Error-Event.

| Attribut | Bedeutung |
| --- | --- |
| `user.username` | PC-Benutzername, falls verfügbar |
| `installation.id` | Zufällige, dauerhaft gespeicherte ID pro lokalem App-Datenverzeichnis |
| `installation.first_version` | Version beim ersten erfassten Online-Start |
| `installation.first_seen_at` | Zeitpunkt dieses ersten Kontakts als Unix-Sekunden |
| `install.status` | `first_seen` |
| `app_version` | Version beim Versand |

Nach `user.username` und `installation.id` gruppieren, um Nutzer und Installationen zu sehen.
Verschiedene PCs können denselben Benutzernamen haben. Die Installations-ID unterscheidet
deren Profile, identifiziert aber keine Person über mehrere Geräte hinweg.

`installation-telemetry.json` im lokalen App-Datenverzeichnis speichert nur ID, erste Version,
ersten Kontaktzeitpunkt und Versandbestätigung, keine Benutzernamen oder IFC-Daten.
Nach HTTP-Erfolg für genau diese Installationsmetrik wird die Registrierung als versendet markiert.
Neustarts und Updates behalten die ID und melden die Registrierung danach nicht erneut.
Bei Offline-Nutzung wird auf einen Online-Kontakt gewartet; bei Netzwerkfehlern bleibt die
Registrierung offen und wird beim nächsten App-Start oder Offline→Online-Wechsel erneut versucht.
Ohne konfigurierte DSN wird keine Registrierung angelegt.

Auch bestehende Nutzer werden beim ersten Kontakt nach Einführung dieser Funktion erfasst.
`first_seen` bedeutet daher **erstmals beobachtet**, nicht nachgewiesen neu installiert.
Installationen ohne anschließenden App-Start lassen sich so nicht erfassen. Werden die lokalen
App-Daten gelöscht, entsteht beim nächsten Start eine neue ID. Ein Prozessabbruch zwischen
Serverannahme und lokaler Bestätigung kann einen erneuten Versand verursachen; für die Anzahl
Installationen die unterschiedlichen `installation.id` zählen, nicht ausschließlich die Countersumme.

## Updates pro Nutzer

Der Desktop-Updater sendet den Application-Metrics-Counter **`editor.update`** mit Wert `1`.
Die Metriken nutzen dieselbe `IFCNATIVE_SENTRY_DSN` wie die Desktop-Fehlerberichte.
Das Rust-SDK hat dafür das Feature `metrics` aktiviert; Error-Events werden hierfür nicht erzeugt.

In Sentry unter **Explore → Metrics** `editor.update` auswählen und nach `update.status`
filtern. Mit `user.username`, `update.from_version` und `update.to_version` lassen sich
Nutzer und Versionswechsel zuordnen. Die Summe mit `update.status:completed` zeigt die
bestätigten Updates; nicht alle Statuswerte zusammenzählen.

| `update.status` | Bedeutung |
| --- | --- |
| `install_started` | Der Nutzer hat die Installation ausgelöst, Download und Signaturprüfung sind abgeschlossen. Das ist noch keine Erfolgsbestätigung. |
| `completed` | Die erwartete Zielversion wurde nach der Installation gestartet. |
| `install_failed` | Tauri hat beim Starten/Installieren einen Fehler zurückgegeben. Ein späterer Abbruch im separaten Installer kann nicht erkannt werden. |

Zusätzlich enthalten die Metriken `app_version`, `platform:desktop` und die SDK-Release-/Umgebungsattribute.
Sie enthalten keine IFC-Dateinamen, Download-URLs oder SAS-Token.
Update-Suche, Download-Fortschritt, normale App-Starts und Browser-Aufrufe zählen nicht als Updates.

Vor der Installation wird ausschließlich die Quell- und Zielversion atomar in
`pending-update.json` im lokalen App-Datenverzeichnis gespeichert. Beim ersten Online-Start
der Zielversion wird der Marker einmalig verbraucht. Ein Start der alten Version meldet
keinen Erfolg; ein erneuter Installationsversuch ersetzt den Marker. Bei einem unmittelbar
gemeldeten Installationsfehler wird er entfernt. Eine Erstinstallation erzeugt keinen Marker.
Die Erfolgsmeldung funktioniert ab Updates, deren Ausgangsversion bereits diese Erfassung enthält.

Sentry-Versand läuft im Hintergrund. Der Windows-Updater wartet vor seinem Prozessende
höchstens fünf Sekunden auf die Telemetrie-Queue; ein Sentry-Ausfall verhindert das Update nicht.
Die vorhandenen Offline-, Queue- und Netzwerkgrenzen gelten weiterhin. Der Versionsmarker
ist keine Versandwarteschlange: Bei voller Queue, fehlender DSN oder Netzwerkfehlern können
Metriken verloren gehen. Scheitert das lokale Schreiben des Markers, fehlt die Erfolgsbestätigung.

## Prüfung

```powershell
npm run test:telemetry
npx tsc --noEmit
cd src-tauri
cargo test --lib
```

Die automatischen Tests prüfen Bereinigung, Dateinamen/Benutzer/Version, Offline-Verhalten,
volle Warteschlange, Netzwerkfehler-Pause und HTTP-Ratenbegrenzung ohne externe Sentry-Anfragen.
Die Installationsprüfungen testen persistente IDs, getrennte Profile, Neustarts/Updates,
Queue-Grenzen sowie HTTP-Fehler und erfolgreiche Bestätigung an einem lokalen Testserver.
Nach dem Anlegen der Projekte zusätzlich einen gezielten Testfehler im Test-Build auslösen
und im jeweiligen Sentry-Projekt prüfen. Danach offline wiederholen: keine UI-Störung, kein Versand.
Ohne echte DSN ist die Ende-zu-Ende-Zustellung nicht verifizierbar.

## SDK-Grundlagen

- [Sentry Rust SDK und Features](https://docs.rs/sentry/latest/sentry/)
- [Sentry Transport-Schnittstelle](https://docs.rs/sentry/latest/sentry/trait.Transport.html)
- [Sentry Browser SDK in Web Workers](https://docs.sentry.io/platforms/javascript/best-practices/web-workers/)
- [Sentry Rust Application Metrics](https://docs.sentry.io/platforms/rust/metrics/)
- [Application Metrics in Sentry auswerten](https://docs.sentry.io/product/explore/metrics/)

Das Desktop-SDK verwendet einen eigenen synchronen Transport ausschließlich auf dem
dedizierten Worker. Der Web-Worker verwendet den offiziellen `BrowserClient` und `makeFetchTransport`.
