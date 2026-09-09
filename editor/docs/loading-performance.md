# Initial IFC loading

Measured on Windows with the locally supplied KBB model (137,107,719 bytes,
48,375 STEP entities, 1,749 geometric products). These are local development
measurements, not a guarantee for other models, devices or cold disk caches.

| Stage | Before | After |
| --- | ---: | ---: |
| Native parse, Node median of three runs | 2,438 ms | 546 ms |
| Fragments conversion, browser worker comparison | 14,142 ms | 8,816 ms |
| Uncompressed viewer data | 82.09 MB | 73.38 MB |

The STEP scanner now splits arguments while reading the entity. Comment and
reference searches jump over numeric payloads. Strings, nested aggregates,
comments, entity offsets and malformed input retain their lexical checks.
All native entities, arguments, indexes and diagnostics were compared with the
previous implementation on the full KBB model and were identical.

Fragments 3.4's `addAllAttributes()` omits `IfcTriangulatedFaceSet` from its
geometry exclusion list. The viewer importer now excludes this category from
attribute processing, while retaining its actual geometry and the complete
native STEP document. Worker conversion and its main-thread fallback use the
same configuration. KBB mesh bytes and all remaining attribute records had
identical SHA-256 hashes before and after; the GUID entry count remained 8,304.
The bridge-fixture regression additionally checks geometry, coordinates,
identity, spatial structure, properties and material relations.

These stage timings exclude viewer startup, worker handoff, mesh loading and
the first rendered frame. Geometry conversion remains the largest stage; no
persistent cache or change in geometric quality was introduced.

Reproduce native timings from `editor/`:

```powershell
node --expose-gc --import tsx scripts/benchmark-loading.ts 'C:\path\model.ifc'
```
