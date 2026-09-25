# OpenProject mit Plugin „IFC Hub“ auf dem Server

Das Image wird **lokal** gebaut und fertig auf den Server gebracht. Dort läuft
kein Build, nur ein Image-Tausch im offiziellen Compose-Setup
([opf/openproject-docker-compose](https://github.com/opf/openproject-docker-compose),
Branch `stable/17`).

| Datei                         | Zweck                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `build-image.ps1`             | baut das Image (Ziel `server` aus `../openproject-local/Dockerfile`), optional Export/Push |
| `smoke-test.ps1`, `smoke/`    | startet das Image mit leerer Datenbank wie auf dem Server und prüft Plugin und Frontend   |
| `docker-compose.override.yml` | kommt auf den Server neben die `docker-compose.yml`: eigenes Image, Plugin-Konfiguration  |
| `.env.example`                | die zusätzlichen Einträge für die `.env` auf dem Server                                   |

## Das Image

- **Basis:** `openproject/openproject:<Version>-slim-bim`, das offizielle slim-Image mit BIM-Edition und IFC-Konvertern (IfcConvert, xeokit). Das einfache `-slim` hat keine Konverter; OpenProject könnte dann keine IFC-Modelle anzeigen, auch nicht die aus dem Hub-Abgleich.
- **Dazu kommen:** die Plugin-Quellen und OpenProjects Angular-Frontend, neu gebaut mit dem Frontend-Teil des Plugins (Upload, Commit-Dialog, Dateiauswahl).
- **Das Frontend wird in einer Zwischenstufe gebaut** (Ziel `full`, braucht einige GB Docker-Speicher) und nur kopiert. Das Server-Image enthält keine Build-Werkzeuge.
- **Tag:** `<OpenProject-Version>-ifchub-<Git-Commit>`, z. B. `17.7.2-ifchub-1a2b3c4`. Bei uncommitteten Änderungen an Plugin oder Dockerfile wird `-dirty` angehängt. So ist jedes Image einem Commit zugeordnet; zurück geht es mit dem vorherigen Tag.

## 1. Lokal bauen und prüfen

```powershell
./deploy/openproject-server/build-image.ps1 -Export
./deploy/openproject-server/smoke-test.ps1 -ImageRef ifcnative/openproject-ifc-hub:<tag>
```

- **Dauer:** Der erste Build dauert einige Minuten, spätere kommen ohne Änderungen am Plugin aus dem Cache.
- **`-Export`** schreibt `dist/openproject-ifc-hub_<tag>.tar.gz` plus eine `.sha256`-Datei.
- **Mit Registry** statt Datei: `-Registry <host[:port]> -Push`. Ohne `-Registry` wird nie gepusht.
- **Der Rauchtest** braucht rund 3 bis 5 Minuten und prüft:
  - Migrationen, auch die des Plugins,
  - Web-Healthcheck und laufenden Worker,
  - im Image: Plugin, Rechte, Projektmodul, Speichertyp, Cron-Job, IFC-Konverter,
  - über HTTP: dass das ausgelieferte Frontend den Plugin-Teil enthält und der Webhook fremde Aufrufe ablehnt.

  Mit `-Keep` bleibt die Umgebung auf http://localhost:8090 stehen (admin/admin).

## 2. Auf den Server bringen

**Als Datei:**

```bash
scp dist/openproject-ifc-hub_<tag>.tar.gz* <server>:/tmp/
ssh <server>
cd /tmp && sha256sum -c openproject-ifc-hub_<tag>.tar.gz.sha256 && docker load -i openproject-ifc-hub_<tag>.tar.gz
```

**Aus einer Registry:** In der `.env` `IFC_HUB_PULL_POLICY=missing` setzen, dann holt `docker compose pull` das Image. Die Registry muss vom Server erreichbar sein, bei HTTP-Registries als `insecure-registries` in der Docker-Konfiguration des Servers eingetragen.

## 3. Einmalig einrichten

Im Compose-Ordner auf dem Server:

1. **Sichern:**
   - die Datenbank: `docker compose exec -T db pg_dump -U postgres openproject > openproject-$(date +%F).sql`
   - das Volume `opdata` (Anhänge).
2. **`docker-compose.override.yml`** aus diesem Ordner daneben legen.
3. **`.env` ergänzen** (Vorlage: `.env.example` hier):
   - `IFC_HUB_OPENPROJECT_IMAGE`: der Tag aus Schritt 1
   - `IFC_HUB_URL`: die Hub-Adresse aus Sicht des Browsers
   - `IFC_HUB_SHARED_SECRET`: ein neues Secret, z. B. `openssl rand -hex 32`
   - `IFC_HUB_SSRF_ALLOWLIST`: die IP des Hubs
4. **Prüfen:** `docker compose config | grep -E "image:|IFC_HUB"`. Web, Worker, Cron und Seeder sollten das neue Image zeigen.
5. **Starten:** `docker compose up -d`. Der Seeder führt die Migrationen aus, auch die Tabelle `ifc_hub_sync_links` des Plugins. Kontrolle mit `docker compose logs seeder`.

Anschließend den **Hub** aktualisieren (Dokploy), mit dem Stand dieses Branches und diesen Umgebungsvariablen:

| Variable                    | Wert                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `OPENPROJECT_SHARED_SECRET` | dasselbe Secret wie `IFC_HUB_SHARED_SECRET`                                               |
| `OPENPROJECT_URL`           | Adresse, unter der der Browser OpenProject öffnet, z. B. `http://10.10.17.29`             |
| `OPENPROJECT_INTERNAL_URL`  | nur falls der Hub-Container OpenProject unter einer anderen Adresse erreicht              |

Die neuen Tabellen des Hubs (`external_links`, `access_tokens`) legt er beim Start selbst an.

**In OpenProject** (als Admin):

1. Unter *Administration → Dateispeicher* einen Speicher „IFC Hub“ anlegen. *Host* ist die Hub-Adresse aus Sicht des OpenProject-Containers.
2. In den Projekten unter *Projekteinstellungen → Module* „IFC Hub“ aktivieren. Beim ersten Öffnen verknüpft man das Projekt mit einem Hub-Projekt; dabei wird der Speicher automatisch aktiviert, und der Abgleich startet.

## 4. Update, Rollback, OpenProject-Update

- **Plugin-Update:**
  1. Lokal committen und bauen.
  2. Das Image übertragen.
  3. In der `.env` den neuen Tag eintragen.
  4. `docker compose up -d`.
- **Rollback:** den vorherigen Tag eintragen und `docker compose up -d`. Um ganz zum Original zurückzukehren, die Override-Datei entfernen. Die Plugin-Tabelle bleibt in der Datenbank und stört nicht.
- **OpenProject-Update:** Das bisherige `docker compose pull` aktualisiert Web, Worker, Cron und Seeder **nicht mehr**, weil ihr Image jetzt festgelegt ist. Stattdessen:
  1. Lokal mit der neuen Version bauen und prüfen: `build-image.ps1 -OpenProjectVersion <neu>`, danach den Rauchtest.
  2. Das Image übertragen und den neuen Tag eintragen.
  3. Die Plugin-Funktionen einmal von Hand testen.

  Das Plugin nutzt interne Schnittstellen von OpenProject (Storage-Adapter, Upload-Service, Menüs), die sich zwischen Versionen ändern können. Den `hocuspocus`-Dienst weiter wie im offiziellen Setup aktualisieren.

## Hinweise

- **All-in-one statt Compose:** Läuft OpenProject als einzelner Container, `--target full` statt `server` bauen. Dieselben Umgebungsvariablen wie in `../openproject-local/docker-compose.yml` setzen.
- **HTTPS:** Läuft OpenProject per HTTPS, braucht auch der Hub HTTPS, sonst blockiert der Browser eingebettete Seiten und Uploads (Mixed Content).
- **Same-site:** Hub und OpenProject am besten auf demselben Host (andere Ports genügen). Dann behandelt der Browser das iframe nicht als Drittanbieter.
