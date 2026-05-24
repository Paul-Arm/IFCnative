# IFCnative Windows Native Rewrite

Branch: `windows-native-rewrite-20260524-1218`

Goal: add/rewrite IFCnative as a Windows-native application for efficiently opening, inspecting, editing, validating, diffing, and exporting large IFC files.

Important constraint from Paul: the native app is a separate/additional folder/project. Do **not** delete or replace the existing Web/React app; keep it available while building the Windows-native implementation.

## Technical direction

- **Project layout:** keep the existing Web/React app intact; build the Windows-native app as a separate project folder (`NativeWindows/` for now, unless later moved/renamed).
- **UI shell:** C#/.NET WPF (`net9.0-windows`) for a fast native desktop shell, docking-style panels, file dialogs, keyboard workflows, and incremental UI virtualization.
- **IFC document core:** C# services first, designed around streaming/indexed STEP parsing so large files do not require expensive full UI materialization.
- **Geometry pipeline:** isolate behind service interfaces. Initial native shell keeps geometry as a replaceable viewport service; later implementation can bridge `web-ifc`, IfcOpenShell, or a C++/Rust mesh worker without rewriting editor panels.
- **Editing model:** draft-first changes with diff/review before export; never blindly overwrite opened IFC.
- **Performance principle:** parse once, index references/types/spatial structure, virtualize all large lists/trees, and keep document mutations targeted.

## Current app inventory

### Existing React/Vite web app

- Vite React 19 app using TypeScript.
- IFC loading with `web-ifc` and ThatOpen/Fragments-related dependencies.
- Mosaic/pane-based IFC workspace.
- Relationship graph UI using React Flow.
- Three/ThatOpen viewer components.
- IFC builder utilities for minimal IFC4X3 projects.
- STEP preflight checks: ISO marker, header/data sections, schema extraction.
- Entity summaries and type counts via `web-ifc`.
- Spatial graph indexing.
- Property/material/classification/document/type indexing.
- Geometry streaming/indexing from `web-ifc`.
- Native TypeScript IFC document model that can parse/serialize STEP text and perform draft mutations.
- Entity-aware diff/review helpers grouped around STEP entities and relationship/placement/geometry changes.
- Tests cover preflight, `web-ifc` roundtrip, graph/property/geometry indexes, native document edits, relationship validation, diff summaries, placement/body generation, unit/schema diagnostics.

### Existing native Windows project

- `NativeWindows/IFCnative.NativeWindows.csproj` targets `net9.0-windows` with WPF enabled.
- Current C# shell code already includes:
  - Open IFC file dialog.
  - Export IFC file dialog.
  - Sample IFC loader.
  - STEP preflight diagnostics.
  - Header/schema extraction.
  - Entity parser and typed entity index.
  - Incoming reference index.
  - Relationship index for common IFC relationship classes.
  - Property/quantity, type assignment, resource, unit, product placement, and product representation indexes.
  - Spatial containment tree.
  - Entity search.
  - Entity inspector for id/type/GlobalId/name/description/raw arguments.
  - Basic entity edit/export by reparsing serialized STEP text.
  - Type count list.
  - Placeholder native viewport status/actions.
- Gap found: `App.xaml` references `MainWindow.xaml`, but `MainWindow.xaml` is missing in the branch, so the native WPF project is incomplete until the XAML view is added.

## Current function/capability checklist

Status legend: `[x] current`, `[~] partial`, `[ ] planned/native rewrite target`.

### File/session

- [x] Open IFC/STEP text files.
- [x] Load bundled sample IFC.
- [x] Export IFC text.
- [x] Extract schema/header.
- [~] Preserve original STEP ids and order during export. Current native export sorts by id.
- [~] Large-file memory strategy: async sequential file loading with progress/cancellation; streaming parser and lazy indexes still pending.
- [~] Recent files/session restore. Native shell now persists recent IFC paths and can reopen/clean missing entries; automatic full workspace restore is still pending.
- [ ] ifcZIP/ifcXML support.

### Parsing/indexing

- [x] STEP entity parser with nested argument splitting.
- [x] Entity lookup by STEP id.
- [x] Entity buckets by IFC type.
- [x] Incoming reference index.
- [x] Spatial roots/tree from containment/decomposition relationships.
- [~] Relationship-specific endpoint model exists in TypeScript; C# now has first-pass parity for common relationship classes.
- [ ] Incremental parse/update after edits instead of full reparse.
- [ ] Robust syntax recovery for malformed huge files.

### Inspection/search

- [x] Entity search by id/type/name/GlobalId.
- [x] Entity inspector.
- [x] Incoming references panel.
- [x] Type counts.
- [~] Global search by id/type/name/GlobalId/spatial path; advanced filters still pending.
- [x] Pinned selections/bookmarks for quick navigation.
- [x] Full spatial path display for selected entity.

### Editing

- [x] Basic name/description/raw argument editing.
- [~] TypeScript draft mutation helpers for elements, relationships, properties, quantities, resources, types, units, placement, and body representations.
- [ ] Native draft transaction model.
- [ ] Apply/discard review UI.
- [ ] Undo/redo or named changesets.
- [ ] Safe targeted serializer preserving formatting/order where practical.

### Spatial/products/relationships

- [~] Spatial tree display.
- [~] TypeScript helpers can add elements and relationships.
- [ ] Native create/edit/move/reparent spatial nodes.
- [ ] Native relationship graph with filters/depth/pinning.
- [ ] Relationship create/edit/delete with endpoint validation.
- [ ] Opening/fill and connect/disconnect workflows.

### Properties/resources

- [~] TypeScript indexes psets, quantities, materials, classifications, documents, types.
- [~] TypeScript mutation helpers can add/update these resources.
- [~] Native property/quantity index and inspector view.
- [~] Native type assignment index and inspector view.
- [~] Native material/classification/document/library resource index and inspector view.
- [ ] Templates/presets for common psets and quantities.

### Geometry/viewport

- [x] Web app has `web-ifc` geometry streaming/indexing.
- [~] TypeScript native document supports simple rectangle/cylinder body generation and placement updates.
- [~] C# native project has viewport placeholders and product representation indexing.
- [ ] Native 3D viewport implementation.
- [ ] Efficient large-model mesh streaming/chunking.
- [ ] Selection sync between tree/graph/viewport.
- [~] Product placement index and numeric placement editor; transform controls still pending.
- [ ] Body presets: block, slab, wall, column, beam, opening proxy.

### Diff/review/export

- [x] TypeScript entity-aware diff helpers.
- [x] Web app disables export with pending draft according to prior plan.
- [~] Native diff/review panel for staged entity and placement edits.
- [~] Native human summary with added/removed/changed STEP ids and argument-level change preview.
- [~] Native export guarded by pending draft state.
- [ ] Validate exported IFC with parser/geometry backend before final save where possible.

### Validation/diagnostics

- [x] Basic STEP frame diagnostics.
- [~] TypeScript diagnostics for schema/units/references/product shape issues.
- [ ] Native validation panel with grouped severity.
- [~] Duplicate GlobalId, missing refs, physical product placement/representation, and multiple primary containment diagnostics.
- [ ] Repair suggestions.
- [ ] IDS/MVD validation.

## Rewrite work queue

1. [x] Clone/fetch repo and create rewrite branch.
2. [x] Create this inventory/tracking document.
3. [~] Make native WPF project structurally complete and buildable by adding missing XAML and project defaults. XAML is present; Windows/dotnet build verification still pending.
4. [ ] Split native shell into UI + services + view models so large lists can be virtualized and tested.
5. [~] Port TypeScript native document capabilities to C# services: first-pass relationship model/indexing, property/resource/type/unit/placement/representation read indexes, and numeric placement edit helper done; broader edit helpers and body helpers remain.
6. [~] Implement draft transaction model and native diff summary. Entity and placement edits now stage drafts with apply/discard; broader edit operations still need integration.
7. [~] Add large-file parser/index strategy with progress and cancellation. Async sequential file loading with cancel/progress is done; parser/index streaming still pending.
8. [ ] Implement native relationship/spatial/property editor panels.
9. [ ] Implement geometry backend abstraction and first viewport.
10. [ ] Add native test project for parser/index/edit/diff services.
11. [ ] Run Windows build/tests on a Windows-capable environment; current host is macOS and lacks `dotnet`.

## Verification log

- 2026-05-24 12:18 Europe/Berlin: repo fetched, branch created.
- 2026-05-24 12:20 Europe/Berlin: native build attempted on current host; blocked because `dotnet` command is not installed on this macOS host.
- 2026-05-24 12:28 Europe/Berlin: added native relationship model/index, relationship inspector tab, duplicate GlobalId diagnostics, missing relationship reference diagnostics, and multiple primary spatial containment diagnostics. Existing web tests/build still pass on macOS.
- 2026-05-24 12:38 Europe/Berlin: added native property/quantity set index, resource index, unit index, and inspector tabs for Psets/Qto, resources, and units. Existing web tests/build still pass on macOS.
- 2026-05-24 12:48 Europe/Berlin: added native IFC type assignment index and inspector tab so occurrences can show their assigned IFC type objects. Existing web tests/build still pass on macOS.
- 2026-05-24 12:58 Europe/Berlin: added native product placement index for IFCLOCALPLACEMENT/IFCAXIS2PLACEMENT3D/IFCCARTESIANPOINT and a Placement inspector tab. Existing web tests/build still pass on macOS.
- 2026-05-24 13:08 Europe/Berlin: added native numeric placement editing for indexed product placements, reparsing/exporting through the C# document service. Existing web tests/build still pass on macOS.
- 2026-05-24 13:18 Europe/Berlin: added native product representation index for IFCPRODUCTDEFINITIONSHAPE/IFCSHAPEREPRESENTATION geometry references and physical product diagnostics for missing/invalid placements and representations. Existing web tests/build still pass on macOS.
- 2026-05-24 13:28 Europe/Berlin: added native draft/diff workflow for entity and placement edits with apply/discard controls and export disabled while a draft is pending. Existing web tests/build still pass on macOS.
- 2026-05-24 13:38 Europe/Berlin: added native async sequential IFC file loader with progress updates and cancellation wiring in the Windows shell. Existing web tests/build still pass on macOS.
- 2026-05-24 13:48 Europe/Berlin: added native spatial path indexing, full path display in the entity inspector, and path-aware entity search. Existing web tests/build still pass on macOS.
- 2026-05-24 13:58 Europe/Berlin: added native pinned entity bookmarks with a Pinned navigation tab and inspector pin/unpin action. Existing web tests/build still pass on macOS.
- 2026-05-24 14:08 Europe/Berlin: added persisted native recent-file storage with a Recent navigation tab, one-click reopen, and missing-file cleanup. Existing web tests/build still pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
