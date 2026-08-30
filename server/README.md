# IFC Hub — Versionskontroll-Server

Die zentrale Ablage für IFC-Modelle: **Projekte, Benutzer, Modelle und
Versionierung mit Commits + Nachricht** — wie GitHub, aber mit **semantischen,
GlobalId-basierten Diffs** statt Zeilen-Diffs. Bedienung über die eingebaute
**Web-UI** und eine **REST-API** (Client-Integration z. B. im Editor über das
Panel „IFC Hub“). Ein Projekt kann beliebig viele Modelle (= IFC-Dateien)
enthalten, jedes mit eigener Historie und eigenen Branches.

Der Server nutzt den STEP-Parser und den GlobalId-Diff des Editors
(`editor/src/ifc`, Brücke in `src/ifc/index.ts`) — Editor und Server sind sich
damit exakt einig, was „geändert“ bedeutet.

## Was er kann

- **Projekte / Ordner / Modelle / Branches / Commits** — Teams versionieren
  IFC-Modelle gemeinsam; Rollen: `owner`, `maintainer`, `contributor`,
  `viewer`. Modelle lassen sich in **Ordnern** sortieren (GitHub-artiger
  Datei-Browser in der Web-UI, verschachtelbar).
- **Semantische Commits** — jede hochgeladene IFC wird in Entities zerlegt;
  jede gerootete Entity (echte 22-Zeichen-GUID) wird versionsstabil gehasht
  (Express-Ids raus, Referenzen auf GUIDs umgeschrieben, GUID-lose
  Hilfsgeometrie in die tragende Entity gefaltet). Ein Commit ist ein Manifest
  `{globalId -> hash}`; dessen `manifestHash` ist die Content-Adresse.
- **Semantischer Diff** — Vergleich zweier Commits ist ein Mengen-Diff über
  Manifeste: `added / removed / modified` je GlobalId. Ein Re-Export (der nur
  STEP-Ids neu nummeriert) ergibt einen *leeren* Diff. Pro geänderter Entity
  gibt es Feld-Detail (welches Attribut/Pset-Feld, alt → neu).
- **Markdown-Dateien** — Modelle mit `kind: "md"` (z. B. `README.md`) werden
  wie IFC-Modelle versioniert (Commits + Nachricht, Branches, Download);
  statt Objekt-Diff dient der Inhalts-Hash der Identisch-Erkennung. Eine
  `README.md` wird in der Web-UI wie bei GitHub unter der Dateiliste des
  jeweiligen Ordners gerendert (marked + DOMPurify).
- **3D-Vorschau** — die Web-UI rendert jeden IFC-Stand mit dem
  ThatOpen-Viewer (`@thatopen/components` + Fragments). Die IFC wird beim
  ersten Abruf **serverseitig** zu Fragments konvertiert
  (`src/domain/fragmentsService.ts`, web-ifc-WASM in Node) und das Ergebnis
  im Object Store neben der IFC gecacht (`….frag`) — Commits sind
  unveränderlich, der Cache veraltet nie; gleichzeitige Erst-Abrufe teilen
  sich einen Konvertierungslauf. Der Fragments-Worker der Web-UI wird
  versionsgleich aus dem Paket synchronisiert
  (`web/scripts/sync-fragments-worker.mjs`).
- **Issues** — wie bei GitHub: pro Projekt nummerierte Issues mit
  Markdown-Beschreibung und Kommentar-Thread, offen/geschlossen, zuordenbar
  an Benutzer, 0..n Modelle und farbige Labels (Tab „Issues“ in der Web-UI;
  Detailseite im GitHub-Layout mit Meta-Sidebar rechts). Zusätzlich können
  Issues **IFC-GlobalIds** tragen (`guids`) und werden damit im 3D-Viewer
  verortet. Jedes Issue hat eine **Art** (`kind`): **`virtual`** (Standard —
  lebt nur im Server, wie GitHub-Issues) oder **`bcf`** (echtes IFC-Issue im
  buildingSMART-**BCF-2.1**-Standard). BCF-Issues sind als `.bcfzip`
  exportierbar — einzeln (`GET …/issues/:number/bcf`) oder alle des Projekts
  (`GET …/issues/bcf`): die Issue-UUID ist die Topic-Guid, Titel/Beschreibung/
  Status/Kommentare wandern ins `markup.bcf`, die verorteten GlobalIds werden
  als Viewpoint-Selektion (`Component IfcGuid=…`) mitgegeben, sodass andere
  BIM-Werkzeuge direkt auf die betroffenen Objekte springen. Die Art ist
  jederzeit umschaltbar (Formular-Auswahl bzw. Sidebar der Detailseite);
  „Issue aus Run erstellen“ legt BCF als Art vor. Umgekehrt lassen sich
  BCF-Dateien **importieren** (`POST …/issues/bcf`, Body = Zip mit
  `Content-Type: application/zip`; Button „BCF-Import“ im Issues-Tab):
  jedes Topic wird ein BCF-Issue mit Beschreibung, Status, Kommentaren
  (Original-Autor/-Datum im Text) und den Viewpoint-GUIDs; Header-Dateinamen
  werden auf gleichnamige Modelle gematcht, bereits importierte Topics
  (gleiche Topic-Guid) übersprungen.
- **Issues aus Prüfungen + 3D-Verortung** — fehlgeschlagene Runs sammeln die
  **GlobalIds der Verstöße** (`failedGuids`; IDS automatisch aus den
  Verstoßobjekten, Python-Skripte per stdout-Konvention `GUID: <GlobalId>`
  je Zeile). Der Button **„Issue aus Run erstellen“** (am Run auf der
  Commit-Seite und im Actions-Tab) befüllt das Issue-Formular mit
  Prüfbericht, Commit-Link, Modell-Verknüpfung und den GUIDs. Auf der
  Issue-Detailseite zeigt die Karte **„3D-Verortung“** die verknüpften
  Modelle im ThatOpen-Viewer: alle betroffenen Objekte rot markiert, je
  GUID ein klickbarer Chip, der das Objekt anfährt
  (`FragmentsModel.getLocalIdsByGuids` + Highlight + `fitToItems`).
- **Actions (Prüf-Workflows)** — wie GitHub Actions, aber für Modellprüfung:
  pro Projekt hinterlegte Prüfungen, die gegen einen konkreten Commit laufen
  (Tab „Actions“ in der Web-UI). Zwei Arten:
  - **`ids`** — IDS-Validierung (buildingSMART Information Delivery
    Specification): die hochgeladene `.ids`-XML wird mit dem geteilten
    Editor-Validator (`editor/src/ifc/ids.ts`) komplett serverseitig in
    TypeScript geprüft (XML-DOM via linkedom) — 6 Facetten, Cardinality,
    Restrictions; deutscher Bericht mit den konkreten Verstößen je Objekt.
  - **`python`** — beliebiges Python-Prüfskript: läuft als Kindprozess
    (`PYTHON_BIN`, Default `python`/`python3`; Zeitlimit 5 min), bekommt den
    IFC-Pfad als Argument 1 und als `IFC_PATH`-Umgebungsvariable.
    **Exit-Code 0 = bestanden**, stdout/stderr landen im Run-Protokoll.
  Jede Ausführung ist ein **Run** mit Status
  (`queued/running/success/failed/error`), Kurzfazit und Protokoll; Runs
  laufen sequenziell in einer In-Process-Queue. Auslösen per Knopfdruck auf
  der Commit-Seite („Jetzt prüfen“) oder automatisch bei jedem neuen Commit
  (Flag „Bei Commit ausführen“ je Action).
- **Zentrale Skript-/IDS-Bibliothek** — Prüfdateien lassen sich
  **projektübergreifend** ablegen (Seite „Bibliothek“ in der Topbar,
  `/api/library`). Eine Action kann statt eines eigenen Uploads einen
  Bibliothekseintrag referenzieren (`libraryFileId`); wird die Datei in der
  Bibliothek aktualisiert, gilt der neue Stand sofort in allen
  referenzierenden Actions aller Projekte. Hochladen darf jeder angemeldete
  Benutzer; ändern/löschen der Eigentümer oder ein Admin; Löschen ist
  blockiert (409), solange Actions die Datei verwenden.
  > ⚠️ Python-Actions führen hochgeladenen Code auf dem Server aus — wie bei
  > selbst gehosteten CI-Runnern. Anlegen/Ausführen verlangt deshalb
  > Schreibrecht im Projekt; den Hub nur mit vertrauenswürdigen Mitgliedern
  > betreiben oder `PYTHON_BIN` auf einen sandboxed Interpreter zeigen lassen.
- **Globale Admins** — das fest verdrahtete Admin-Konto (`ADMIN_EMAIL`,
  Default `admin@ifc-hub.local`; `ADMIN_PASSWORD`, Default `ifc-hub-admin` —
  in Produktion setzen!) wird beim Start angelegt bzw. markiert. Admins haben
  Owner-Rechte auf allen Projekten (auch privaten) und eine kleine
  Benutzerverwaltung unter „Verwaltung“ (anlegen, Admin-Status, Passwort
  setzen, löschen — sofern der Benutzer keine Inhalte verfasst hat).
- **Sichtbarkeit** — Projekte sind per Default **öffentlich**: jeder
  angemeldete Benutzer sieht sie lesend (implizite viewer-Rolle), schreiben
  können nur Mitglieder; pro Projekt umschaltbar auf privat (nur Mitglieder).
  Einzelne Modelle mit `visibility: public` sind zusätzlich ganz ohne
  Anmeldung les- und diffbar (Portal-Zugriff ohne Client).

## Zwei Speicher-Modi

| Modus | Objekt-Store (IFC-Blobs) | Metadaten (Projekte, Commits, Manifeste) |
| --- | --- | --- |
| **lokal** (Standard) | Dateisystem `DATA_DIR` (`./.ifc-vcs-data`) | SQLite `DATA_DIR/catalog.sqlite` (node:sqlite, WAL), oder Postgres wenn `DATABASE_URL` gesetzt |
| **azure** (`STORAGE=azure`) | Azure Blob Storage | Postgres (`DATABASE_URL`) |

Die Metadaten-Schicht dedupliziert Entity-Payloads über Commits hinweg
(`entity_objects`), Diffs werden gecacht (`diffs_cache`; Commits sind
unveränderlich, der Cache veraltet also nie). Schema in
`src/repository/sql/schema.ts`, in Tests via PGlite ausgeführt.

## Starten

```bash
cd server
npm install
npm run dev            # http://localhost:8787 — Web-UI + API, lokaler Modus
```

Produktion mit Azure Blob + Postgres:

```bash
STORAGE=azure \
AZURE_STORAGE_CONNECTION_STRING="..." \
AZURE_STORAGE_CONTAINER="ifc-versions" \
DATABASE_URL="postgres://user:pass@host:5432/ifcvcs" \
JWT_SECRET="..." NODE_ENV=production npm start
```

Konfiguration (`src/config.ts`): `PORT` (8787), `HOST`, `JWT_SECRET`,
`STORAGE` (`filesystem`|`azure`), `DATA_DIR`,
`AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`,
`DATABASE_URL` (Postgres; ohne = SQLite unter `DATA_DIR`), `ADMIN_EMAIL`,
`ADMIN_PASSWORD` (fest verdrahtetes Admin-Konto), `PYTHON_BIN` (Interpreter
für Python-Actions, Default `python` unter Windows, sonst `python3`).

> **Hinweis:** Der lokale Modus ist ohne weitere Konfiguration persistent
> (SQLite-Katalog + Blobs unter `DATA_DIR`; kein natives Modul nötig,
> node:sqlite ist eingebaut). Beide Modi laufen über dieselbe SqlRepository
> mit identischem Schema.

## Web-UI (`web/`, Nuxt)

Single-Page-App: Login/Registrierung, Projekte (+ Mitgliederverwaltung),
Modelle, Commit-Historie je Branch, IFC-Upload mit Commit-Nachricht,
Commit-Detail mit semantischem Diff (wählbare Vergleichsbasis, Feld-Detail
pro Entity), .ifc-Download.

Markdown wird überall (md-Dateien, Issue-Beschreibungen, Kommentare) mit
einem **WYSIWYG-Editor** bearbeitet (`components/MarkdownEditor.vue`,
TipTap + tiptap-markdown): Toolbar für Überschriften, Fett/Kursiv, Listen,
Aufgabenlisten, Tabellen, Links, Code — gespeichert wird reiner Markdown;
über den Umschalter rechts in der Toolbar lässt sich jederzeit der
Markdown-Quelltext direkt bearbeiten.

- Der Fastify-Server liefert die gebaute SPA aus `public/` mit aus — **ein
  Prozess für UI + API**. Der Build ist eingecheckt; `npm run dev` reicht.
- UI neu bauen nach Änderungen in `web/`:

```bash
npm run build:web      # = npm --prefix web run generate + Sync nach public/
```

- UI-Entwicklung mit Hot-Reload: `cd web && npm install && npm run dev`
  (Port 3000, proxied `/api` auf 8787).

## REST-API (`/api`, JSON)

Auth: `Authorization: Bearer <JWT>` aus `/api/auth/login`. Fehler kommen als
`{ "error": "…" }`.

| Methode | Pfad | Bemerkung |
| --- | --- | --- |
| GET | `/api/health` | `{status, version, storage}` |
| POST | `/api/auth/register`, `/api/auth/login` | → `{ token, user }` |
| GET | `/api/me` | aktueller Benutzer (inkl. `isAdmin`) |
| GET/POST | `/api/admin/users` | Benutzer auflisten / anlegen `{email, password, name?, isAdmin?}` (nur Admin) |
| PATCH/DELETE | `/api/admin/users/:id` | Name/Admin-Status/Passwort ändern bzw. löschen (nur Admin; Selbst-Aussperrung und Löschen mit Inhalten blockiert) |
| GET/POST | `/api/projects` | eigene + öffentliche Projekte (mit Rolle) / anlegen `{name, slug?, visibility?}` (Default: public) |
| GET/PATCH | `/api/projects/:slug` | Projekt + Mitglieder + `folders` (private nur für Mitglieder) / Einstellungen `{name?, visibility?}` (admin) |
| POST | `/api/projects/:slug/folders` | Ordner anlegen `{path}` (write) |
| DELETE | `/api/projects/:slug/folders?path=` | leeren Ordner löschen (409 wenn Modelle darin) |
| DELETE | `/api/projects/:slug` | Projekt löschen (nur Owner; inkl. Blobs) |
| PUT/GET | `/api/projects/:slug/image` | Projektbild (PNG, z. B. Szenen-Screenshot aus dem 3D-Tab) setzen (write) / abrufen (Mitglied) |
| GET/POST | `/api/projects/:slug/labels` | Labels auflisten / anlegen `{name, color}` (write) |
| GET/POST | `/api/projects/:slug/issues` | Issues (`?state=open\|closed`, mit Zählern) / eröffnen `{title, body?, kind?: "virtual"\|"bcf", assigneeIds?, modelIds?, labelIds?, guids?}` (jedes Mitglied) |
| GET | `/api/projects/:slug/issues/bcf` | alle BCF-Issues als `.bcfzip` (BCF 2.1) |
| POST | `/api/projects/:slug/issues/bcf` | `.bcfzip` importieren (Body = Zip, `application/zip`) → `{imported, skipped}` (write) |
| GET | `/api/projects/:slug/issues/:number/bcf` | einzelnes BCF-Issue als `.bcfzip` (400 bei virtuellen Issues) |
| GET/PATCH | `/api/projects/:slug/issues/:number` | Issue-Detail (inkl. `comments`) / ändern (Titel, Body, State, Zuordnungen — Autor oder write-Rolle) |
| POST/DELETE | `/api/projects/:slug/issues/:number/comments(/:id)` | kommentieren (jedes Mitglied) / löschen (Autor oder write-Rolle) |
| POST | `/api/projects/:slug/members` | Mitglied hinzufügen/Rolle ändern `{email, role}` (admin) |
| DELETE | `/api/projects/:slug/members/:userId` | Mitglied entfernen (admin; Owner geschützt) |
| GET/POST | `/api/projects/:slug/models` | Modelle (mit Head-Commit) / anlegen `{name, visibility?, folder?, kind?}` (`ifc`\|`md`) |
| GET | `/api/projects/:slug/models/:model` | Modell + Branches (mit Heads) |
| PATCH | `/api/projects/:slug/models/:model` | Einstellungen `{name?, visibility?, defaultBranch?, folder?}` (admin) |
| DELETE | `/api/projects/:slug/models/:model` | Modell löschen (admin; inkl. Blobs) |
| POST | `/api/projects/:slug/models/:model/branches` | Branch anlegen `{name, from?}` — startet am Head von `from` |
| POST | `…/commits?branch=&message=` | Datei-Inhalt hochladen (raw Body **oder** Multipart `file` + Felder `message`/`branch`) → `{commit, diff}`; IFC-Modelle verlangen STEP, `md` beliebigen Text (max 2 MB) |
| GET | `…/commits?branch=` | Historie (Commits mit Autor) |
| GET | `…/commits/:id` | Commit-Metadaten |
| GET | `…/commits/:id/file` | Roh-IFC herunterladen (byte-identisch) |
| GET | `…/commits/:id/fragments` | ThatOpen-Fragments für die 3D-Vorschau (erster Abruf konvertiert + cached; immutable-Cache-Header) |
| GET | `…/diff?from=&to=` | semantischer Diff zweier Commits |
| GET | `…/diff/entity?from=&to=&globalId=` | Feld-Detail einer geänderten Entity |
| GET/POST | `/api/projects/:slug/actions` | Actions auflisten (inkl. `libraryName`) / anlegen `{name, kind, content, fileName?, runOnCommit?}` **oder** `{name, libraryFileId, runOnCommit?}` (write) |
| PATCH/DELETE | `/api/projects/:slug/actions/:id` | Name/`runOnCommit`/Dateiinhalt ändern bzw. löschen (write) |
| GET | `/api/projects/:slug/actions/:id/file` | hinterlegte IDS/Skript-Datei herunterladen |
| POST | `…/commits/:id/validate` | Commit prüfen `{actionIds?}` (Default: alle Actions) → `{runs}` (write) |
| GET | `/api/projects/:slug/runs?commit=&action=&model=` | Runs (ohne Log) mit Action/Modell/Auslöser |
| GET | `/api/projects/:slug/runs/:runId` | Run-Detail inklusive Protokoll |
| GET/POST | `/api/library` | zentrale Bibliothek auflisten (mit `usageCount`, `owner`) / Datei ablegen `{name, kind, content, fileName?}` (jeder Angemeldete) |
| PATCH/DELETE | `/api/library/:id` | Name/Inhalt aktualisieren bzw. löschen (Eigentümer/Admin; DELETE 409 solange referenziert) |
| GET | `/api/library/:id/file` | Bibliotheksdatei herunterladen |

CORS ist offen (Bearer-Auth, keine Cookies) — Editor (Vite/Tauri) und
Nuxt-Dev-Server können direkt zugreifen.

## Editor-Integration

Im Editor (`editor/`) gibt es das Mosaic-Panel **„IFC Hub“** (über das
Fenster-Menü): anmelden, Projekt/Modell/Branch wählen, Versionsstände als
neuen Tab öffnen, aktuellen Stand mit Commit-Nachricht committen (inkl.
Diff-Zusammenfassung als Antwort). Client-Code in `editor/src/vcs/`
(`client.ts`, `types.ts`); unter Tauri läuft HTTP über das Tauri-Plugin
(Host-Freigabe in `src-tauri/capabilities/default.json`).

## Tests

```bash
npm test               # Service-, HTTP- (fastify.inject) und SQL-Ebene (PGlite)
npm run typecheck      # tsc --noEmit
```

## Noch offen (bewusst später)

- Drei-Wege-Merge mit Konflikt-Erkennung auf Entity-Ebene; Merge-UI.
- Umbenennen von Projekten; Branches löschen.
- Tags/Releases; geschützte Branches.
- OpenAPI/Swagger-Doku; Pagination für sehr lange Historien.
- 3D-Vorschau für beliebige (nicht nur Head-)Commits; visueller 3D-Diff.
