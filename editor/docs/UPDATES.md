# Editor-Updates aus Azure Blob Storage

## Einmalig einrichten

Container `editor` im Storage-Account `stifctool` anlegen. Der Editor lädt über
HTTPS und einen Container-SAS mit Leserecht (`sp=r`). Kein Schreib- oder
Listenrecht für die App nötig. Uploads erfolgen weiterhin manuell mit deinem
Azure-Zugang. Für Desktop-Anfragen ist keine Blob-CORS-Konfiguration nötig.

Den SAS-Token in die lokale, von Git ausgeschlossene Datei `editor/.env` eintragen:

```dotenv
IFCNATIVE_UPDATE_SAS_TOKEN="sv=...&sp=r&...&sig=..."
```

Eine Vorlage liegt in `editor/.env.example`. Die `.env` wird beim Desktop-Build
gelesen; der Token wird fest in die App eingebaut. Nach einer Änderung den
Installer neu bauen. Eine gleichnamige Prozess-Umgebungsvariable hat Vorrang.
Die `.env` muss auf den Rechnern der App-Nutzer nicht vorhanden sein.

`editor/update-channel.json` enthält die Basis-URL und den öffentlichen Schlüssel:

```json
{
  "baseUrl": "https://stifctool.blob.core.windows.net/editor",
  "publicKey": "Inhalt der updater.key.pub"
}
```

Der öffentliche Schlüssel und der lokale SAS wurden eingerichtet. Mit leerem
Token meldet die Einstellungsseite, dass der Dienst noch nicht eingerichtet ist.
Ein führendes `?` am Token ist erlaubt. Der SAS ist wie gewünscht fest in der
App eingebaut und kann daher aus der App ausgelesen werden. Sein Ablaufdatum
muss auch ältere Installationen abdecken: Ein abgelaufener Token verhindert
deren Update-Suche. Bei Rotation den neuen Token veröffentlichen, solange der
alte noch funktioniert.

## Schlüssel, Zertifikate und GitHub

Die Tauri-Schlüssel liegen lokal im Projektverzeichnis, sind aber **nicht in Git
getrackt**. Stand der Prüfung: 15.09.2026.

| Datei / Ort | Zweck | Git / Veröffentlichung |
| --- | --- | --- |
| `editor/.release-keys/updater.key` | Privater Tauri-Schlüssel zum Signieren der Updates | Ignoriert; niemals nach GitHub oder Azure hochladen |
| `editor/.release-keys/updater.key.pub` | Öffentlicher Tauri-Prüfschlüssel als Datei | Der gesamte Schlüsselordner ist ignoriert |
| `editor/update-channel.json` → `publicKey` | Öffentlicher Prüfschlüssel für die App | Darf in Git stehen und wird in die App eingebaut; kein Geheimnis |
| `editor/.env` | Azure-SAS mit Leserecht | Ignoriert; Token wird beim Build in die App eingebaut |
| `C:\Users\paul.armerling\Downloads\MKP_Codesignatur.pfx` | Windows-Code-Signing-Zertifikat mit privatem Schlüssel | Außerhalb des Repos; zusätzlich sind `*.pfx` und `*.p12` ignoriert |

Der vollständige lokale Tauri-Schlüsselordner ist
`C:\Users\paul.armerling\vscode\IFCnative\editor\.release-keys\`.
Der private Schlüssel ist aktuell ohne Passwort angelegt. Ihn separat und sicher
sichern; für zukünftige Releases denselben Schlüssel verwenden. Ein neu erzeugter
Schlüssel passt nicht zu dem Prüfschlüssel bereits installierter Apps.

Die `.exe.sig` ist eine veröffentlichbare Signatur, kein Schlüssel und kein
Zertifikat. Sie wird mit dem Installer hochgeladen. Private Schlüssel, PFX,
Passwörter und `.env` gehören weder ins Upload-Verzeichnis noch in Git.
Builds und vorbereitete Uploads sind ebenfalls ignoriert (`src-tauri/target/`,
`release/`). `.env.example` enthält nur die leere Vorlage und darf in Git stehen.

Vor einem Commit vom Repository-Stamm aus prüfen:

```powershell
git check-ignore -v editor/.release-keys/updater.key editor/.release-keys/updater.key.pub editor/.env
git ls-files --cached -- '*.key' '*.pfx' '*.p12' '*.pem' 'editor/.release-keys/*' 'editor/.env'
```

Der erste Befehl muss die Ignore-Regeln zeigen, der zweite darf keine Dateien
ausgeben. `.gitignore` schützt nicht vor `git add -f` und entfernt keine bereits
getrackten Dateien. Schlüssel deshalb niemals mit `-f` hinzufügen.

## Container-Struktur

```text
editor/
  latest.json
  releases/
    1.4.14/
      IFCnative_1.4.14_x64-setup.exe
      IFCnative_1.4.14_x64-setup.exe.sig
  patchnotes/
    1.4.14.json
```

Neue Versionen kommen jeweils in einen neuen Versionsordner. Bestehende
Installer nicht ersetzen. Für `latest.json` und Patchnotes `Content-Type:
application/json` und `Cache-Control: no-cache` setzen. Installer:
`application/octet-stream`. Die Verzeichnisse entstehen durch Blob-Namen mit `/`.

## Manuelles Release

Alle Befehle im Verzeichnis `editor` ausführen:

1. Version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` und
   `src-tauri/tauri.conf.json` gemeinsam erhöhen; `Cargo.lock` über Cargo aktualisieren.
2. `patchnotes/<Version>.json` anlegen (Beispiel: `patchnotes/1.4.14.json`).
   Felder: `version`, `title`, `publishedAt` (ISO-Datum), `changes` (Textliste).
3. `npm run test:ifc`, `npm run test:updates`, `npx tsc --noEmit` und
   `cargo test --manifest-path src-tauri/Cargo.toml --lib` ausführen.
4. `npm run desktop:installer` bauen. Wenn Windows-Code-Signing auch für die
   App-EXE gewünscht ist, dieses im Tauri-Bundle-Schritt konfigurieren.
5. Den fertigen NSIS-Installer mit deinem Windows-Code-Signing-Zertifikat signieren.
6. **Danach** `npm run release:prepare` ausführen. Das Skript prüft die
   Windows-Signatur und Produktversion, erzeugt die zusätzliche Tauri-Signatur,
   prüft deren Schlüssel-ID und erstellt `release/azure-<Version>/` mit
   Installer, `.sig`, Patchnotes und `latest.json`. Es lädt nichts hoch.
   Optional: `npm run release:prepare -- <Installerpfad> <Patchnotespfad>`.
7. `releases/<Version>/` und `patchnotes/<Version>.json` manuell hochladen.
8. **`latest.json` zuletzt hochladen/ersetzen.** Damit wird die Version angeboten.

### Windows-Installer signieren (PowerShell)

Beispiel für 1.4.14, im Verzeichnis `editor` ausführen. Den Versionswert beim
nächsten Release anpassen. Das Passwort wird verdeckt abgefragt und nicht als
Literal in die Shell-History geschrieben; SignTool erhält es als Prozessargument.

```powershell
$releaseVersion = '1.4.14'
$releaseInstaller = Join-Path (Get-Location) "src-tauri\target\release\bundle\nsis\IFCnative_${releaseVersion}_x64-setup.exe"
$releaseSignTool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.28000.0\x64\signtool.exe'
$releasePfx = 'C:\Users\paul.armerling\Downloads\MKP_Codesignatur.pfx'
$releasePassword = Read-Host 'PFX-Passwort' -AsSecureString
$releaseCredential = [System.Net.NetworkCredential]::new('', $releasePassword)
try {
    & $releaseSignTool sign /f $releasePfx /p $releaseCredential.Password /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 $releaseInstaller
    if ($LASTEXITCODE -ne 0) { throw 'Windows-Signierung fehlgeschlagen.' }
} finally {
    Remove-Variable releaseCredential, releasePassword
}
npm run release:prepare
```

Nur die EXE mit dem Windows-Zertifikat signieren. Die `.exe.sig` erzeugt
`release:prepare` anschließend mit dem Tauri-Schlüssel. Die App-EXE selbst kann
bei Bedarf zusätzlich vor dem Verpacken signiert werden; sie ist kein separater
Upload im aktuellen Update-Ablauf.

### Upload und Test

Für 1.4.14 entsteht lokal `editor/release/azure-1.4.14/`. Dessen **Inhalt** in den
Container `editor` hochladen, ohne eine zusätzliche Ebene `azure-1.4.14/`:

1. `releases/1.4.14/IFCnative_1.4.14_x64-setup.exe` und die zugehörige `.exe.sig`.
2. `patchnotes/1.4.14.json`.
3. Zuletzt `latest.json` im Container-Stamm ersetzen.

Die Blob-Pfade erzeugen die Ordnerdarstellung automatisch. Der Upload erfolgt
mit deinem Azure-Zugang; der in die App eingebaute SAS erlaubt nur Lesen.
Anschließend in einer installierten älteren Version unter Einstellungen →
Updates & Patchnotes manuell suchen, Patchnotes prüfen und Download/Installation
starten. Nach dem Neustart muss die App 1.4.14 anzeigen.

Eine neue Versionsnummer braucht einen neuen Build. Nur Manifest oder Dateiname
zu ändern aktualisiert die Version im Programm nicht; `release:prepare` prüft
deshalb die Produktversion des Installers.

Nach Schritt 6 den Installer nicht erneut signieren oder anderweitig verändern:
Die Tauri-Signatur bezieht sich auf die exakten heruntergeladenen Bytes. Nach
einer Änderung `release:prepare` erneut ausführen.

Anderer privater Schlüsselpfad: `TAURI_SIGNING_PRIVATE_KEY_PATH` setzen.
Bei einem passwortgeschützten Schlüssel zusätzlich
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` setzen. Den Schlüssel niemals in den
Blob-Container hochladen. Die Windows-Signatur und die Tauri-Update-Signatur
sind verschiedene Signaturen; das Vorbereitungsskript übernimmt die zweite.

## Changelog / Patchnotes

Die Änderungen werden pro Release **manuell** in `editor/patchnotes/<Version>.json`
geschrieben und mit dem Quellcode versioniert. Es gibt keine automatische
Übernahme aus Git-Commits. Beispiel:

```json
{
  "version": "1.4.14",
  "title": "Test-Update 1.4.14",
  "publishedAt": "2026-09-15T10:00:00.000Z",
  "changes": [
    "Test des Update-Ablaufs von Version 1.4.13 auf 1.4.14."
  ]
}
```

`release:prepare` prüft Versionsnummer und Felder, kopiert die JSON-Datei in den
Upload-Ordner und erzeugt aus Titel und Änderungsliste das Feld `notes` in
`latest.json`. `publishedAt` wird als `pub_date` übernommen. Damit stammen die
separaten Patchnotes und der Manifest-Text aus derselben Datei. Das Beispiel
vor einem echten Release durch die tatsächlichen Änderungen und das Datum ersetzen.

## Manifest

`release:prepare` erzeugt dieses Format. Die Installer-URL enthält keinen SAS;
die App ergänzt ihren eingebauten Token nach Prüfung von Host und Container.

```json
{
  "version": "1.4.14",
  "notes": "Zusammenfassung als Text",
  "pub_date": "2026-09-15T10:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://stifctool.blob.core.windows.net/editor/releases/1.4.14/IFCnative_1.4.14_x64-setup.exe",
      "signature": "Inhalt der .sig-Datei"
    }
  }
}
```

## Verhalten im Editor

- Erste Prüfung nach ca. 15 Sekunden, anschließend alle sechs Stunden; beim
  Zurückkehren aus Standby wird eine fällige Prüfung nachgeholt.
- Ein kleiner Hinweis oben rechts erscheint nur für neuere Versionen, ohne
  Fokuswechsel, Ton oder modalen Dialog.
- Schließen oder „In einer Woche“ blendet alle Update-Hinweise sieben Tage aus,
  auch nach einem App-Neustart. Die Suche läuft weiter.
- Einstellungen → Updates & Patchnotes: automatische Suche an/aus, manuelle
  Prüfung, Pause aufheben, Patchnotes und Installation mit Fortschritt.
- Keine Downloads oder Installationen ohne Klick. Geänderte IFC-Dateien müssen
  gespeichert sein; dies wird vor und nach dem Download geprüft.
- Tauri prüft die Update-Signatur vor der Installation. Windows startet danach
  den Installer im passiven Modus und anschließend den Editor neu. Der Prozess
  endet dabei ohne `pagehide`/`beforeunload`; der Editor leert deshalb vorher
  den Autosave-Wiederherstellungsstand (nur wenn keine offene Wiederherstellung
  aussteht) und schließt ausgelagerte Panel-Fenster mit.
- Fehlgeschlagene Hintergrundprüfungen erzeugen weder Benachrichtigung noch
  Fehlerbox; sie erscheinen nur als Hinweis unter „Zuletzt geprüft“. Ein
  bekanntes Ergebnis (verfügbares Update) bleibt dabei erhalten. Nur eine
  manuelle Prüfung zeigt den Fehler prominent.
- Fehlerursachen werden unterschieden (ohne URL oder SAS preiszugeben):
  offline/Proxy, Zugriff abgelehnt (HTTP 401/403 → abgelaufener SAS), Manifest
  fehlt (404), ungültige Antwort, Dienst nicht erreichbar. Bei 401/403/404 sendet
  die App dazu einmalig einen HEAD-Request auf `latest.json`.
- Proxy: reqwest nutzt die manuellen Windows-Proxy-Einstellungen (Registry
  `ProxyEnable`/`ProxyServer`) sowie `HTTPS_PROXY`/`HTTP_PROXY`. PAC-Skripte und
  WPAD-Autoerkennung werden **nicht** ausgewertet; in solchen Netzen meldet die
  Suche „Keine Verbindung“. Die App selbst arbeitet davon unbeeinflusst offline.
- Fehlen separate Patchnotes, wird der Text aus `latest.json` angezeigt.

**Erstinstallation:** Version 1.4.11 enthält noch keinen Updater. Nutzer müssen
die erste Version mit eingerichteter Update-Verbindung einmal manuell installieren.
Danach können neuere Versionen aus dem Editor installiert werden.

Technische Grundlage: [Tauri Updater](https://v2.tauri.app/plugin/updater/).
