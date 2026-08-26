# ifc2glb — IFC → glTF binary (GLB) converter

Memory-efficient replacement for `IfcConvert`-based pipelines, built on
xBIM (`Xbim.Essentials` for parsing, optionally `Xbim.Geometry` for
tessellation). Runs on **Windows and Linux x64**.

```
IfcToGlb.Core/   conversion library (reusable; future Python bindings target)
IfcToGlb.Cli/    thin CLI wrapper, builds the `ifc2glb` binary
samples/box.ifc  minimal smoke-test model (extruded solid → OpenCascade path)
```

## Two conversion paths

|           | Direct tessellation (fast path)                                                                                                          | xBIM/OpenCascade                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input     | IFC4+ models whose body geometry is exclusively `IfcTriangulatedFaceSet` / simple `IfcPolygonalFaceSet` (typical reference-view exports) | Everything else: BReps, swept solids, booleans, mapped items, openings (`IfcRelVoidsElement`) — typical IFC2x3 design exports                                                             |
| Engine    | pure C# (Xbim.Essentials only)                                                                                                           | native OpenCascade via `Xbim.Geometry`                                                                                                                                                    |
| Platforms | **Windows + Linux**                                                                                                                      | **Windows only** — the official `Xbim.Geometry`/`Xbim.Geometry.Occt` NuGet packages contain no Linux native engines (the `-netcore` suffix refers to the TFM, not cross-platform support) |

The path is chosen automatically per file. On Linux, a model that needs
OpenCascade fails with a clear `NotSupportedException` naming the blocking
entity type (exit code 1).

Reference numbers, 130 MB IFC4 bridge model (1,749 products, 2.5M triangles):

|             | OpenCascade path | Fast path                                            |
| ----------- | ---------------- | ---------------------------------------------------- |
| Wall clock  | 395 s            | **8 s**                                              |
| Peak memory | 1.74 GB          | **0.9 GB** (dominated by xBIM's in-memory IFC model) |
| GLB size    | 87 MB            | **37 MB**                                            |

## Usage

```
ifc2glb <input.ifc> [output.glb] [options]

  --deflection-mm <value>     OpenCascade chord tolerance in mm (default: 4)
  --deflection-angle <value>  OpenCascade angular deflection in radians (default: 1)
  --threads <n>               tessellation threads (default: CPU count)
  --include-spaces            export IfcSpace volumes (skipped by default)
  --no-metadata               omit IFC type/name/expressId node extras
  --quiet                     suppress progress output (stderr)
  --verbose                   show xBIM toolkit logs / full stack traces
```

The absolute output path is printed to **stdout** on success (progress goes to
stderr), so scripts can capture it directly. Exit codes: `0` success,
`1` conversion failure, `2` invalid arguments.

## Output structure

- glTF 2.0 binary, Y-up, metres (converted from the IFC model units at the
  root node).
- One named node per `IfcProduct` — **node name = IFC GlobalId**; extras carry
  `ifcType`, `name` and `expressId` for viewer-side filtering.
- Authored `IfcSurfaceStyle` colors (incl. transparency) become glTF
  materials; unstyled elements get a stable per-IFC-type fallback color.
- Geometry is deduplicated: each distinct face set / shape geometry is written
  once and instanced via node transforms.
- Faceted geometry is written **without** a NORMAL attribute — glTF clients
  must then derive flat face normals, which is correct for hard-edged BIM
  geometry and halves the vertex payload. The OpenCascade path keeps its
  authored smooth normals.
- Geo-referenced models are re-centred (single root placement is dropped on
  the fast path; most populated region centre on the OpenCascade path); the
  removed offset is recorded in `asset.extras.originOffsetMetres`.

## Memory behaviour

- Vertex/index data streams into a delete-on-close temp file as it is
  produced; managed memory holds only the JSON-side descriptors. Peak usage is
  dominated by xBIM's in-memory IFC model, not by the GLB writer.
- The CLI is a short-lived process per file (workstation GC,
  `System.GC.ConserveMemory=5`), so leaks cannot accumulate across
  conversions — run one process per file in batch pipelines.
- 64-bit only; ~100MB+ IFC files exhaust a 32-bit address space.
- The GLB container format is limited to 4 GB; conversion fails cleanly if
  exceeded.

Do **not** enable `InvariantGlobalization`: Xbim's STEP parser instantiates
`CultureInfo("en-US")` internally and would silently parse all REAL values
as `0` in invariant mode.

## Building / publishing

```powershell
# local build
dotnet build src/IfcToGlb.Cli/IfcToGlb.Cli.csproj -c Release

# self-contained binaries (no .NET runtime required on target)
dotnet publish src/IfcToGlb.Cli/IfcToGlb.Cli.csproj -c Release -r linux-x64 --self-contained
dotnet publish src/IfcToGlb.Cli/IfcToGlb.Cli.csproj -c Release -r win-x64 --self-contained
```

Output lands in `src/IfcToGlb.Cli/bin/Release/net10.0/<rid>/publish/`. Notes:

- Do not enable trimming (`PublishTrimmed`); xBIM relies on reflection.
- Do not use `PublishSingleFile` (any RID): Xbim's geometry-engine loader
  resolves DLL paths from assembly locations, which are empty inside a
  single-file bundle — the OpenCascade path then fails on Windows too. The
  plain publish folder works (verified on Windows and under WSL/Ubuntu).
- The linux-x64 publish output still contains `win-x64`/`win-x86` engine
  folders (package content); they are dead weight on Linux but harmless on
  the fast path. They can be deleted for deployment.

## Python usage

Today (subprocess):

```python
import subprocess

def ifc_to_glb(ifc_path: str, glb_path: str | None = None) -> str:
    args = ["./ifc2glb", ifc_path] + ([glb_path] if glb_path else []) + ["--quiet"]
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return result.stdout.strip()  # absolute path of the written GLB
```

Planned: direct bindings against `IfcToGlb.Core` (e.g. via `pythonnet`), which
is why the conversion logic lives in the library, not the CLI.

## Known limitations

- On Linux, models requiring OpenCascade (IFC2x3 swept solids, BReps,
  booleans, openings) are rejected. Options if this becomes a requirement:
  re-export source models as IFC4 reference view (tessellated), or extend the
  managed path (extrusions and faceted BReps are feasible; boolean opening
  subtraction is the hard part).
- `IfcPolygonalFaceSet` faces are fan-triangulated (fine for convex faces);
  faces with voids (`IfcIndexedPolygonalFaceWithVoids`) route the model to the
  OpenCascade path.
- No Draco/meshopt compression; GLB stays viewer-compatible without
  extensions.
