# IFC-Hub

Projekt-, Modell- und Versionsverwaltung für IFC-Dateien — **eine Codebasis, zwei
Betriebsarten** (siehe `../01-architektur.md` §5 und `../03-kernfeatures.md` §6):

- **a) Standalone/lokal** — als Tauri-Sidecar auf `127.0.0.1`, Ablage im
  Benutzerprofil. Null Konfiguration, jeder PC hat seine eigene Historie.
- **b) Zentral/Team** — dasselbe Artefakt im Docker-Container, mit Bearer-Token
  und einem Daten-Volume.

Der Hub ist eine **dünne Eigenschicht**: Parsen (`@ifc-lite/parser`) und
Vergleichen (`@ifc-lite/diff`) kommen aus ifc-lite; selbst gebaut ist nur, was
ifc-lite dokumentiert nicht hat — der Katalog aus Projekten → Modellen →
Versionsständen und die content-addressed Blob-Ablage.

## Schnellstart (lokal)

```bash
cd editor-2.0/hub
npm install
npm start          # http://127.0.0.1:8711
```

Prüfen:

```bash
curl http://127.0.0.1:8711/api/health
# {"ok":true,"version":"0.1.0"}
```

| Befehl | Wirkung |
| --- | --- |
| `npm start` | startet den Dienst über `tsx` (kein Build-Schritt nötig) |
| `npm run dev` | wie `start`, startet bei Dateiänderungen neu |
| `npm test` | Vitest (Service-, Diff- und HTTP-Ebene) |
| `npm run build` | `tsc --noEmit` — reine Typprüfung |

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `HUB_PORT` | `8711` | HTTP-Port |
| `HUB_HOST` | `127.0.0.1` | Bind-Adresse. Im Container `0.0.0.0` |
| `HUB_DATA_DIR` | `~/.ifcnative/hub` | Datenverzeichnis (Katalog + Blobs) |
| `HUB_TOKEN` | *(leer)* | Wenn gesetzt: alle `/api`-Routen außer `/api/health` verlangen `Authorization: Bearer <Token>` |

## Datenablage

```
<HUB_DATA_DIR>/
  catalog.json          Projekte → Modelle → Versionsstände (atomar geschrieben)
  blobs/<sha256-hex>    unveränderliche IFC-Blobs
```

- **Content-addressed:** die Adresse eines Blobs *ist* der sha256 seines Inhalts.
- **Dedup:** zwei Commits mit identischen Bytes teilen sich einen Blob; es
  entstehen trotzdem zwei eigenständige Versionsstände mit eigener Nachricht.
  Das ist auch die Grundlage für späteres Push/Pull — es wandern nur die Blobs,
  die die Gegenseite noch nicht hat.
- **Atomar:** `catalog.json` wird in eine Temporärdatei geschrieben und per
  `rename()` an Ort gebracht; ein Abbruch hinterlässt nie einen halben Katalog.
  Parallele Commits werden serialisiert (kein Lost Update).

## HTTP-API

JSON, UTF-8. **Listen sind nackte Arrays**, Einzelressourcen nackte Objekte.
Fehler kommen einheitlich als `{ "error": "…" }` mit passendem Statuscode
(400 unbrauchbare Eingabe · 401 Token fehlt/falsch · 404 unbekannte Id ·
422 kein lesbares IFC · 500 interner Fehler).

| Methode | Pfad | Rumpf / Query | Antwort |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ok, version}` |
| GET | `/api/projects` | — | `Project[]` |
| POST | `/api/projects` | JSON `{name}` | `Project` (201) |
| GET | `/api/projects/:pid/models` | — | `Model[]` |
| POST | `/api/projects/:pid/models` | JSON `{name}` | `Model` (201) |
| GET | `/api/projects/:pid/models/:mid/versions` | — | `Version[]`, **neueste zuerst** |
| POST | `/api/projects/:pid/models/:mid/versions` | `application/octet-stream` = IFC-Bytes; Query `message`, `author` | `Version` (201) |
| GET | `…/versions/:vid` | — | `Version` |
| GET | `…/versions/:vid/file` | — | IFC-Bytes, byte-identisch zum Commit |
| GET | `…/versions/:vid/diff/:otherVid` | — | `Diff` — `:vid` ist die **Basis**, `:otherVid` der **Kopfstand** |

### Formen

```jsonc
// Project
{ "id": "uuid", "name": "Bürogebäude Nord", "createdAt": "…Z", "modelCount": 1 }

// Model
{ "id": "uuid", "name": "Architektur", "createdAt": "…Z", "versionCount": 2 }

// Version — Schema und entityCount ermittelt der Hub beim Commit per @ifc-lite/parser
{
  "id": "uuid", "message": "Erster Stand", "author": "Paul",
  "createdAt": "2026-07-28T16:51:28.856Z", "schema": "IFC4",
  "entityCount": 69, "byteSize": 3679, "blobHash": "f67def…"
}

// Diff
{
  "added": [], "removed": [],
  "modified": [{
    "globalId": "0UvSRjd0HEwxHJszIzouyr",
    "expressId": 42,
    "label": "IfcWall · Wand A",
    "changedComponents": ["pset:Pset_WallCommon"]
  }],
  "summary": { "added": 0, "removed": 0, "modified": 1, "unchanged": 6 },
  "scope": "data", "fieldDetail": false,
  "base": "uuid-des-basisstands", "head": "uuid-des-kopfstands"
}
```

`globalId` ist der einzige verlässliche Anker in ein lokal geöffnetes Modell;
`expressId` gilt nur innerhalb des Standes, aus dem gerechnet wurde, und dient
allein der Anzeige.

### Beispiel

```bash
PID=$(curl -s -H 'Content-Type: application/json' \
      -d '{"name":"Bürogebäude Nord"}' localhost:8711/api/projects | jq -r .id)
MID=$(curl -s -H 'Content-Type: application/json' \
      -d '{"name":"Architektur"}' localhost:8711/api/projects/$PID/models | jq -r .id)
curl -s -H 'Content-Type: application/octet-stream' --data-binary @modell.ifc \
     "localhost:8711/api/projects/$PID/models/$MID/versions?message=Stand%201&author=Paul"
```

## Detailtiefe des Vergleichs

`@ifc-lite/diff` ist store-agnostisch: es vergleicht `EntityFingerprint`s und
kennt selbst keine IFC-Dateien. Den fehlenden Adapter stellt
`src/ifc/fingerprints.ts` — er zieht Identität (GlobalId) und Datensignale
(Attribute, Property-Sets, Quantity-Sets) aus dem kolumnaren Parser-Store.

Damit ergibt sich folgende Detailtiefe (Prüfpunkt Risiko **R2 / Befund B5** in
`../05-risiken-entscheidungen.md`):

- ✅ **Objekt-genau** — welches Objekt hinzugekommen, entfallen oder geändert
  ist, identifiziert über die GlobalId.
- ✅ **Komponenten-genau** — `changedComponents` benennt die betroffene
  Komponente: `attr:core`, `pset:<Name>`, `qset:<Name>`, `type-assignment`.
- ❌ **Nicht feld-genau** — *welche* Property innerhalb des Property-Sets sich
  geändert hat und mit welchem Alt-/Neuwert, liefert das Paket **nicht**. Das
  Antwortfeld `fieldDetail: false` macht diese Grenze für die App explizit.
  Wird Feld-Detail gebraucht, ist der geplante Fallback der Port von
  `entityFieldDiff` aus `src/ifc/versioning` des React-Projekts — er würde in
  `src/ifc/diff.ts` andocken und `changedComponents` pro Eintrag verfeinern.

**Vergleichsumfang** ist `data`. Ein Geometrie-Vergleich bräuchte die
Geometrie-Hashes aus dem WASM-Mesh-Pass; die fährt der Hub bewusst nicht (der
Dienst soll ohne GPU/WASM-Geometrie auskommen). `scope` steht deshalb fest auf
`"data"`.

**Identitätsanker GlobalId:** verglichen werden die Entities mit stabiler
GlobalId (IfcRoot-Abkömmlinge). Geometrie-, Placement- und Profil-Records haben
keine und fallen heraus. Ein mutationsfreier Re-Export ändert keine GlobalIds
(bestätigt in `app/tests/m0-durchstich.test.ts`), ein solcher Stand ergibt also
korrekt einen leeren Diff. Achtung Befund **B5**: aus dem Mutations-Overlay neu
erzeugte Records (`IfcPropertySet`, `IfcRelDefinesByProperties`) bekommen bei
jedem Export frische GlobalIds — für diese gilt die Identität nicht. Da sie
selbst nicht in der Vergleichsmenge liegen, wirkt sich das hier nur indirekt
aus: das *tragende* Objekt erscheint dann als `modified` mit dem betroffenen
`pset:`-Eintrag, was dem gewünschten Verhalten entspricht.

## Docker (Betriebsart b — zentral)

```bash
cd editor-2.0/hub
docker build -t ifc-hub .
docker run -d --name ifc-hub \
  -p 8711:8711 \
  -v ifc-hub-data:/data \
  -e HUB_TOKEN=ein-langes-zufaelliges-token \
  ifc-hub
```

Im Image sind `HUB_DATA_DIR=/data` und `HUB_HOST=0.0.0.0` vorbelegt; `/data`
ist ein Volume, damit Katalog und Blobs ein Image-Update überleben. Ein
`HEALTHCHECK` fragt `/api/health` ab. Das Image enthält **keine nativen
Build-Abhängigkeiten** — es gibt nichts zu kompilieren.

Setze `HUB_TOKEN` im Team-Betrieb immer; ohne Token ist der Hub offen.
Für den Betrieb über das offene Netz gehört ein TLS-Terminator (Reverse Proxy)
davor — der Hub selbst spricht nur HTTP.

## Einbettung als Tauri-Sidecar (Betriebsart a)

Doku-Hinweis — an der Tauri-App ist dafür bislang **nichts geändert**.

1. **Binary bauen:** den Hub mit einem Bundler (z. B. `node --experimental-sea-config`
   oder `pkg`/`bun build --compile`) zu einer einzelnen ausführbaren Datei
   packen und nach `app/src-tauri/binaries/ifc-hub-<target-triple>` legen. Der
   Namenssuffix mit dem Rust-Target-Triple ist Pflicht, sonst findet Tauri das
   Sidecar nicht.
2. **Registrieren** in `app/src-tauri/tauri.conf.json`:
   ```jsonc
   { "bundle": { "externalBin": ["binaries/ifc-hub"] } }
   ```
   und die Berechtigung `shell:allow-execute` für das Sidecar freigeben.
3. **Starten** beim App-Start über `tauri_plugin_shell`: Sidecar-Command mit
   `HUB_PORT` (freier Port, an das Frontend durchreichen), `HUB_HOST=127.0.0.1`
   und `HUB_DATA_DIR` = App-Datenverzeichnis (`app_data_dir()`) in der
   Umgebung. Kein `HUB_TOKEN` — lokal gibt es nichts abzuschirmen.
4. **Beenden:** den Kindprozess beim Schließen des Fensters mitnehmen; der Hub
   fährt auf `SIGTERM`/`SIGINT` sauber herunter.
5. Der Hub ist **abschaltbar** — die App bleibt ohne ihn voll funktionsfähig
   (Dateien direkt öffnen und speichern).

## Nächste Stufe (bewusst noch nicht gebaut)

- **Rollen und Collab-Räume:** `@ifc-lite/collab-server` programmatisch über
  `startCollabServer()` einbetten — Rollen je Projekt
  (Viewer/Commenter/Editor/Admin), JWT statt einfachem Bearer-Token,
  Echtzeit-Räume mit Live-Cursor. Das aktuelle Token in `src/http/auth.ts` ist
  bewusst nur die Vorbereitung: ein einziger Schalter, keine Identitäten.
- **Push/Pull** zwischen lokalem und zentralem Hub — die content-addressed
  Ablage liegt schon richtig, `hasBlob()` im Adapter ist der Ansatzpunkt.
- **Weitere Persistenz-Adapter:** Postgres + S3 hinter demselben
  `CatalogStore`-Interface (`src/storage/adapter.ts`); der Service ändert sich
  dafür nicht.
- **Feld-genauer Diff** über den Port von `entityFieldDiff` (siehe oben).
- **Branches und Drei-Wege-Merge** auf Entity-Ebene.

## Aufbau

```
src/
  main.ts                Einstiegspunkt (npm start)
  config.ts              Umgebungsvariablen + Hub-Version
  types.ts               Katalog-Datenmodell
  errors.ts              HubError mit HTTP-Status, deutsche Meldungen
  service.ts             Katalogschicht: Projekte/Modelle/Stände, Commit, Diff
  storage/
    adapter.ts           Persistenz-Interface (eine Implementierung)
    filesystem.ts        Dateisystem-Ablage: catalog.json + blobs/
  ifc/
    parse.ts             @ifc-lite/parser → Schema + Entity-Zahl
    fingerprints.ts      Store-Adapter für @ifc-lite/diff
    diff.ts              Vergleich + Abbildung auf den API-Vertrag
  http/
    server.ts            Fastify-Instanz, CORS, Fehlerformat
    routes.ts            Routen
    auth.ts              optionales Bearer-Token
tests/
  helpers.ts             Testmodell aus @ifc-lite/create, temporäres Datenverzeichnis
  service.test.ts        Katalog, Dedup, Roundtrip
  diff.test.ts           geänderte Property → genau ein modified
  http.test.ts           API-Formen und Token-Pflicht
```
