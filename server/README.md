# IFC Version Control Server

A GitHub-style collaboration backend for IFC building models with **semantic,
GlobalId-keyed diffs** (not git line diffs). Built on the existing TypeScript IFC
layer in `../src/ifc` — it reuses `parseNativeIfcText` and the GlobalId diff in
`../src/ifc/versioning`.

## What it does

- **Projects / models / branches / commits** — teams version IFC models together.
- **Semantic commits** — each uploaded IFC is decomposed into entities, every
  rooted entity (real 22-char IFC GUID) is content-hashed in a version-stable way
  (express ids excluded, references rewritten to GUIDs, GUID-less support
  geometry/placements/property values folded into their owning entity). A commit
  is a manifest `{globalId -> hash}`; its `manifestHash` is the content-address.
- **Semantic diff** — comparing two commits is a set diff over manifests:
  `added / removed / modified` by GlobalId. Re-exporting a file (which renumbers
  STEP ids) produces an *empty* diff.
- **Client-less access** — models marked `public` are browsable and diffable
  without authentication, for the web portal and third-party tools.

## Storage

- **Object store** (raw IFC + manifests): Azure Blob Storage in production
  (`STORAGE=azure`), filesystem for local dev/tests. See `src/storage/`.
- **Metadata** (projects, commits, members): `MemoryRepository` for dev/tests.
  Swap in a Postgres / Azure SQL implementation of `Repository` for production.

## Run

```bash
cd server
npm install
# local dev (filesystem store):
npm run dev
# production with Azure Blob:
STORAGE=azure \
AZURE_STORAGE_CONNECTION_STRING="..." \
AZURE_STORAGE_CONTAINER="ifc-versions" \
JWT_SECRET="..." NODE_ENV=production npm start
```

Config (`src/config.ts`): `PORT` (8787), `HOST`, `JWT_SECRET`, `STORAGE`
(`filesystem`|`azure`), `DATA_DIR`, `AZURE_STORAGE_CONNECTION_STRING`,
`AZURE_STORAGE_CONTAINER`.

## API (MVP)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login` | returns `{ token, user }` |
| GET | `/me` | current user |
| GET/POST | `/projects` | list mine / create |
| GET | `/projects/:slug` | project + members |
| POST | `/projects/:slug/members` | add member `{ email, role }` |
| GET/POST | `/projects/:slug/models` | list / create `{ name, visibility }` |
| GET | `/projects/:slug/models/:model` | model + branches |
| POST | `/projects/:slug/models/:model/commits?branch=&message=` | upload IFC (raw body or multipart `file`) → `{ commit, diff }` |
| GET | `/projects/:slug/models/:model/commits?branch=` | history |
| GET | `/projects/:slug/models/:model/commits/:id` | commit metadata |
| GET | `/projects/:slug/models/:model/commits/:id/file` | download raw IFC |
| GET | `/projects/:slug/models/:model/diff?from=&to=` | semantic diff |

## Tests

```bash
npm test   # service + HTTP (fastify.inject), no DB or Azure needed
```

## Not yet (later phases)

Branches UI / three-way merge with per-entity conflict detection, entity payload
dedup + diff cache, Postgres repository, public REST docs (Swagger), client SDK.
