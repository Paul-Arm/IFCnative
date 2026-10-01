# openproject-ifc_hub: IFC Hub in OpenProject

OpenProject-Plugin (Rails-Engine) mit zwei Teilen:

1. **Projektmodul „IFC Hub“.** Die Hub-Oberfläche wird ganzseitig im Projekt eingebettet (iframe), mit automatischer Anmeldung.
2. **Speichertyp „IFC Hub“** unter *Administration → Dateien → Externe Dateispeicher*. Hub-Modelle und -Dateien lassen sich im Tab **„Dateien“ der Arbeitspakete** verlinken, öffnen, herunterladen und **hochladen**. Ein Upload erzeugt im Hub einen Commit, also eine neue Version.

## 1. Projektmodul und Einbettung

- Menüpunkt **„IFC Hub“** in jedem Projekt, in dem das Modul aktiv ist.
- **Automatische Anmeldung.** Das Plugin stellt pro Seitenaufruf ein kurzlebiges, HMAC-signiertes Ticket aus (JWT/HS256, 120 s, einmalig). Der Hub prüft es und legt den Benutzer bei Bedarf an. Ein zweites Passwort gibt es nicht.
- **Verknüpfung.** Beim ersten Öffnen wählt ein Projektadministrator (Recht *IFC Hub verwalten*), ob ein **neues** Hub-Projekt angelegt oder ein **vorhandenes** verknüpft wird. Beim Verknüpfen bleiben Modelle und Historie erhalten. Normale Mitglieder sehen bis dahin einen Hinweis. Gelöst wird die Verknüpfung im Hub unter *Einstellungen → OpenProject*.
- **Rollen folgen OpenProject** und werden bei jedem Öffnen abgeglichen:

  | Recht in OpenProject      | Rolle im Hub  |
  | ------------------------- | ------------- |
  | `view_ifc_hub`            | `viewer`      |
  | `edit_ifc_hub`            | `contributor` |
  | `manage_ifc_hub`          | `maintainer`  |
  | OpenProject-Administrator | `owner`       |

- **Deep-Links.** `/projects/<id>/ifc_hub/m/<modell>` öffnet direkt eine Modellseite im Hub. Die Adresszeile folgt der Navigation im Hub (`postMessage`).

## 2. Speichertyp „IFC Hub“

- **Struktur.** Die oberste Ebene sind die Hub-Projekte des Benutzers, darunter Ordner und Modelle. IFC- und Markdown-Modelle erscheinen mit Endung (`Turm.ifc`).
- **Anmeldung.** Kein OAuth: Pro Anfrage signiert das Plugin ein 5-Minuten-Token für den jeweiligen Benutzer. Es gelten dessen Hub-Rechte.
- **Öffnen.** Ist das Hub-Projekt verknüpft, öffnet die Datei im eingebetteten Hub des OpenProject-Projekts, sonst direkt im Hub.
- **Download und Upload** laufen direkt zwischen Browser und Hub über signierte Links (5 bzw. 15 min). „Neuer Ordner“ in der Ordnerauswahl legt den Ordner im Hub-Projekt an.
- **Upload bei gleichem Namen.** „Ersetzen“ committet eine neue Version desselben Modells. „Beide behalten“ legt ein weiteres Modell mit Zähler an.
- **Commit-Nachricht.** Vor jedem Upload fragt ein Dialog die Nachricht ab, vorbelegt mit dem Bezug zum Arbeitspaket („Hochgeladen aus OpenProject (Arbeitspaket #77)“). Der Dialog hat bewusst kein „Abbrechen“, weil OpenProjects Upload-Toast sonst hängen bleibt. Abbrechen geht vorher in der Datei- bzw. Ordnerauswahl.
- **Automatisch aktiviert.** Beim Öffnen des Menüpunkts „IFC Hub“ und direkt nach dem Verknüpfen fragt das Plugin den Hub, welches Hub-Projekt dazugehört. Es aktiviert dann den Speicher im Projekt, mit diesem Hub-Projekt als Projektordner. Ein bewusst auf „inaktiv“ gestellter Projektordner bleibt unverändert.
- **Frontend-Teil.** Den Upload erlaubt OpenProjects Angular-Code nur für Nextcloud, OneDrive und SharePoint. `frontend/module/main.ts` ergänzt `StorageUploadService#setUploadStrategy` um den Typ `Storages::IfcHubStorage`. Das erfordert einen **Neubau des Frontends** im Image (Build-Ziel `full`).

**Einrichten:**
1. *Administration → Dateien → Externe Dateispeicher → + Speicher → IFC Hub*
2. Host eintragen (siehe unten).
3. In Projekten, die mit dem Hub verknüpft sind, aktiviert das Plugin den Speicher selbst. Sonst unter *Projektkonfiguration → Dateien* von Hand hinzufügen.

Damit normale Mitglieder den Tab „Dateien“ nutzen können, brauchen ihre Rollen die OpenProject-Rechte für Dateiverknüpfungen: *Dateiverknüpfungen ansehen* bzw. *verwalten*.

## 3. Abgleich mit dem BCF-Modul (beide Richtungen)

Voraussetzung: Im Projekt sind die Module **„IFC Hub“ und „BCF“** aktiv und das Projekt ist mit einem Hub-Projekt verknüpft.

| OpenProject (BCF-Modul) | IFC Hub | Richtung |
| --- | --- | --- |
| IFC-Modell (IFC-Datei) | Modell der Art `ifc` | neue Datei ↔ neuer Commit. OpenProject konvertiert Hub-Stände für seinen Viewer |
| BCF-Thema (Arbeitspaket + BCF-Issue) | Issue der Art `bcf`, gleiche Topic-GUID | Titel, Beschreibung, offen/geschlossen, betroffene Objekte (GUIDs aus Viewpoints ↔ Issue-GUIDs), Kommentare |

- **Auslöser.** Änderungen in OpenProject (IFC-Datei, Journal eines Arbeitspakets) starten nach 10 Sekunden einen Abgleich. Der Hub meldet Änderungen per signiertem Webhook (`POST /ifc_hub/webhook`). Zusätzlich gleicht OpenProject **alle 5 Minuten** ab, falls ein Webhook verloren geht. Pro Projekt läuft nie mehr als ein Abgleich gleichzeitig (GoodJob).
- **Konflikte.** Wurde seit dem letzten Abgleich nur eine Seite geändert, gewinnt diese. Wurden beide geändert, gewinnt die jüngere. Stände und Zuordnungen stehen in der Tabelle `ifc_hub_sync_links`.
- **Nicht übertragen werden:** Löschungen, geänderte oder gelöschte Kommentare, interne Kommentare in OpenProject, Issues der Art `virtual` im Hub, Modelle ohne IFC-Datei. Die Demo-Modelle von OpenProject enthalten nur das Viewer-Format XKT.
- **Status.** Aus „geschlossen“ im Hub wird der erste geschlossene Status in OpenProject. Erlaubt der Workflow den Wechsel nicht, werden nur die übrigen Felder übernommen.
- **Autoren.** Kommentare und Commits erscheinen unter dem zugeordneten Benutzer. Kennt OpenProject den Hub-Autor nicht, schreibt das System, mit dem Namen des Autors vorangestellt.

## Konfiguration

**OpenProject (Umgebungsvariablen):**

| Variable                                   | Bedeutung                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `IFC_HUB_URL`                              | Adresse, unter der der **Browser** den Hub erreicht, z. B. `http://10.10.17.29:8787` |
| `IFC_HUB_SHARED_SECRET`                    | gemeinsames Secret, mindestens 32 Zeichen; im Hub `OPENPROJECT_SHARED_SECRET`        |
| `OPENPROJECT_SSRF_PROTECTION_IP_ALLOWLIST` | **IP des Hubs.** OpenProject blockiert Server-Anfragen an private IPs (SSRF-Schutz) |

**Speicher „IFC Hub“, Feld *Host*:** Adresse, unter der der **OpenProject-Server** den Hub erreicht. Aus einem Container heraus ist das oft nicht dieselbe wie `IFC_HUB_URL`.

**Hub (`server/`):**

| Variable                    | Bedeutung                                                             |
| --------------------------- | --------------------------------------------------------------------- |
| `OPENPROJECT_SHARED_SECRET` | dasselbe Secret; aktiviert Anmelde- und Datei-API                     |
| `OPENPROJECT_URL`           | Adresse, unter der der Browser OpenProject öffnet → `frame-ancestors` |
| `OPENPROJECT_INTERNAL_URL`  | Adresse, unter der der **Hub-Server** OpenProject erreicht (Webhook für den Abgleich); Standard: `OPENPROJECT_URL` |

**Hinweise:**
- **Browser-Speicher.** Der Hub speichert seine Sitzung im `localStorage`. Am einfachsten laufen Hub und OpenProject auf demselben Host, andere Ports genügen. Dann gelten sie als „same-site“, und der Browser partitioniert den Speicher im iframe nicht.
- **CSP.** Das Plugin ergänzt `frame-src` auf allen Seiten um die Hub-Adresse und `ifcnative:`. Über dieses Schema startet „Im Editor öffnen“ im eingebetteten Hub den Desktop-Editor. Fehlt es, ersetzt der Browser den Hub durch „Dieser Inhalt ist blockiert“.
- **HTTP.** OpenProject verlangt für Upload-Ziele eigentlich HTTPS. Das Plugin lässt auch HTTP zu, für interne Hubs ohne TLS. Läuft OpenProject per HTTPS, muss auch der Hub HTTPS haben, sonst sperrt der Browser den Upload (Mixed Content).

## Installation (Docker)

Siehe `deploy/openproject-local/Dockerfile`:

- **Ziel `plugin`:** all-in-one-Image, nur Ruby, baut in Sekunden. Einbettung und Speicher funktionieren, nur der Upload aus OpenProject fehlt.
- **Ziel `full`:** all-in-one-Image, zusätzlich wird OpenProjects Angular-Frontend mit dem Plugin neu gebaut. Das braucht **mehrere GB RAM** in Docker. Dieses Ziel nutzt die lokale Testumgebung.
- **Ziel `server`:** Basis `-slim-bim` für das offizielle Compose-Setup; das Frontend kommt aus `full`. Bauen, prüfen und ausrollen beschreibt `deploy/openproject-server/README.md` (lokaler Build, Übertragung per Datei oder Registry).

**Bei jedem OpenProject-Update** muss das Image mit der neuen Basisversion neu gebaut werden. Das Plugin nutzt interne OpenProject-Schnittstellen (Menüs, Rechte, CSP, Storage-Adapter, Upload-Service), die sich zwischen Versionen ändern können.

## Aufbau

```
lib/open_project/ifc_hub/engine.rb           Modul, Rechte, Menüpunkt, Registry-Anbindung
lib/open_project/ifc_hub/configuration.rb    ENV-Konfiguration, Hub-Origin
lib/open_project/ifc_hub/ticket.rb           HS256-Ticket (Einbettung)
lib/open_project/ifc_hub/storage_token.rb    HS256-Token (Datei-API)
lib/open_project/ifc_hub/storage_sync.rb     Speicher im Projekt automatisch aktivieren
lib/open_project/ifc_hub/frame_src_hook.rb   CSP frame-src auf allen Seiten (Turbo)
lib/open_project/ifc_hub/project_sync.rb     Abgleich IFC-Modelle + BCF-Themen (beide Richtungen)
lib/open_project/ifc_hub/hub_client.rb       HTTP-Client für die Sync-API des Hubs
lib/open_project/ifc_hub/sync_triggers.rb    Auslöser (IFC-Modell, Journal) -> Job
lib/open_project/ifc_hub/webhook.rb          Prüfung des Hub-Webhooks
app/workers/ifc_hub/                         SyncProjectJob, SyncAllJob (Cron 5 min)
app/controllers/ifc_hub/webhooks_controller.rb  POST /ifc_hub/webhook
db/migrate/                                  Tabelle ifc_hub_sync_links
app/controllers/ifc_hub/embed_controller.rb  Seite + CSP frame-src
app/models/storages/ifc_hub_storage.rb       Speichertyp
app/common/storages/adapters/providers/ifc_hub/  Abfragen, Registry, Assistent, Prüfungen
app/components/storages/admin/forms/         Formular (Name + Host)
frontend/module/main.ts                      Upload-Strategie + Commit-Dialog (Angular)
config/routes.rb                             /projects/:id/ifc_hub(/*pfad)
```

Lizenz: GPL-3.0, weil das Plugin in OpenProject (GPL-3.0) geladen wird.
