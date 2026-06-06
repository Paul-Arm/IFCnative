# IFCnative Native Windows — Visible Functions Plan

## Context

Paul's feedback: the rewrite has too much backend/plumbing work and not enough visible, usable editor functionality. Stop defaulting to small parser-hardening iterations. Prioritize user-facing native Windows features, and prefer mature native libraries over custom placeholders.

Important constraints:

- Keep the existing Web/React app intact.
- The Windows-native app remains a separate project under `NativeWindows/`.
- Prefer native Windows rendering/geometry alternatives over WASM when a good native option exists.
- WASM/web-ifc should be treated as compatibility/fallback, not the target renderer for the Windows-native app.

## Current branch / push status

- Branch: `codex/native-ifc-memory-model`
- Worktree: `O:\Code\native\IFCnative`
- Last pushed clean status seen: not pushed from this worktree yet.
- Web verification has been passing:
  - `npm run test:ifc`
  - `npm run lint`
  - `npm run build`
- Native `.NET/Avalonia` build/test execution is now verified on Windows/.NET 9:
  - `dotnet build NativeWindows\IFCnative.NativeWindows.csproj`
  - `dotnet run --project NativeWindows.Tests\IFCnative.NativeWindows.Tests.csproj` (47 tests as of 2026-06-06 Europe/Berlin)

## Functions that currently exist in the native app

### File/session

- Open IFC/STEP files.
- Open `.ifczip` / `.zip` archives and extract the first IFC/STEP entry.
- Export IFC text.
- Export validated IFC text into `.ifczip` archives.
- Recent IFC paths.
- Reopen/clean missing recent entries.
- Persist window/pane layout state.
- Restore pane visibility, pane widths, and window size.
- Auto-reopen last available IFC workspace on startup.
- Avalonia/ReactiveUI native shell.
- Dock.Avalonia workspace with model, viewport, inspector, graph, diagnostics, draft, builder, recent-file, notes, and console panels.
- Workspace presets for inspect, edit, graph, validation, and builder workflows.
- Multiple loaded IFC document sessions in the native shell.

### Inspection/navigation

- Entity search by STEP id, IFC type, name, GlobalId, and spatial path.
- Entity inspector.
- Incoming references panel.
- Relationship panel.
- Type counts.
- Full spatial path display for selected entity.
- Pinned/bookmarked entities for quick navigation.
- Diagnostics tab with severity-ranked rows.
- Diagnostics filtering by severity/message/repair-suggestion text.
- Diagnostic rows with STEP ids navigate to the referenced entity.

### Draft/review/edit safety

- Draft staging for edits.
- Apply / discard controls.
- Export disabled/guarded while drafts are pending.
- Diff summary with added/removed/changed STEP ids and argument-level preview.
- Undo/redo checkpoints.
- Named changesets.
- Export validation reparses serialized STEP before writing.
- Export blocks parser errors/entity-count mismatches.
- Geometry backend validates indexed representation chains before final save.
- Property, Pset/Qto template creation, simple material/classification/document/library assignment, placement, matching existing extruded body-dimension, existing-product body representation assignment, product/opening/filling preset creation, diagnostic repairs, raw entity editing, relationship create/edit/delete, element connect/disconnect, and spatial reparent/detach edits now mutate `IfcMemoryModel` first; STEP rows are patched only for draft/export.

### Spatial/products/relationships

- Spatial tree display.
- First-pass spatial reparent draft editor.
- Cycle/spatial-parent guards.
- Detach/delete spatial-link workflow for containment/aggregation relationships.
- Spatial reparent/detach now edits memory-model relations instead of live STEP state.
- Create new contained product presets with memory-model placement/body geometry.
- Relationship creation for common IFC relationship classes.
- Relationship endpoint selection/staging from the inspector.
- Element connect/disconnect workflow.
- Relationship create/edit/delete and element connect/disconnect now edit memory-model relations instead of live STEP state.
- Opening fill workflow via `IFCRELFILLSELEMENT`.
- Relationship neighborhood graph preview with filtering, depth controls, relationship hub nodes, edge labels, and graph-to-editor selection.

### Properties/resources

- Property/quantity indexes.
- Native in-memory IFC model stores typed property values independent of raw STEP argument strings.
- Property value edits use the memory model instead of STEP clone/reparse as live state.
- Property/quantity inspector view.
- Raw value edits for single values/quantities.
- Type assignment index/view.
- Material/classification/document/library resource index/view.
- First-pass simple material assignment.
- First-pass classification assignment.
- First-pass document assignment.
- First-pass library assignment.
- Simple resource assignments use native memory-model resources and relations instead of STEP clone/reparse as live state.
- First-pass `Pset_NativeCommon` preset button.
- First-pass `Qto_NativeBaseQuantities` preset button.
- Pset/Qto template creation uses memory-model property set objects with typed values instead of STEP clone/reparse as live state.

### Geometry/viewport

- Product placement index.
- Numeric placement editor.
- Product representation index for `IFCPRODUCTDEFINITIONSHAPE` / `IFCSHAPEREPRESENTATION` references.
- Native in-memory IFC model stores product geometry as first-pass primitives with placement and profile dimensions.
- Native memory geometry transform service resolves relative product placement chains, axis/ref-direction rotations, and local solid/profile offsets before preview mesh tessellation.
- Matching existing extruded body dimensions and assigned rectangle/cylinder body representations can be edited in the memory model before export patching.
- Geometry backend abstraction (`IIfcGeometryBackend`).
- Native memory-model geometry backend.
- STEP-reference viewport preview backend remains available as fallback/debug code.
- First Avalonia viewport preview now renders a native mesh-projection view from memory-model rectangle/bounding-box and cylinder extrusion tessellation.
- Preview camera is fitted from mesh bounds.
- Viewport projection controls and mesh statistics are available in the Avalonia viewport panel.
- Tree/graph/inspector selections keep the viewport mesh list in sync.
- Sample IFC expanded with visible placement/body representation geometry.

### Validation/repair

- STEP preflight.
- Header/schema extraction.
- Duplicate STEP id recovery/warnings.
- Missing/trailing/malformed parser recovery for several common cases.
- Duplicate GlobalId diagnostics.
- Missing references diagnostics.
- Physical product placement/representation diagnostics.
- Multiple primary containment diagnostics.
- Missing GlobalId repair.
- Missing/invalid placement/representation repair helpers.
- Missing relationship reference repair.
- Spatial containment repair.

## What is still not good enough / missing

These are the important gaps Paul is reacting to:

1. **3D viewer is not a real IFC mesh viewer yet**
   - Current viewport now has first-pass native mesh tessellation for simple memory-model primitives, but not full IFC geometry extraction.
   - Placement transforms now include relative placements, local solid/profile offsets, and axis/ref-direction rotations for supported primitive previews.
   - The previous WPF `Viewport3D` preview has been replaced by a first Avalonia mesh-projection preview while the app moves to Avalonia/ReactiveUI.
   - Hover/highlight, multi-select, isolation, camera controls, and full mesh picking are still pending in the Avalonia viewport.
   - Need real IFC mesh extraction/tessellation and richer native rendering.
   - Prefer native renderer/backend over WASM.

2. **Graph is still not a mature visual graph editor**
   - Current graph is improving but remains a preview, not a polished graph editor.
   - Relationship hubs, edge labels, and click-to-edit relationship selection now exist.
   - Still needs a real layout algorithm, edge routing, expansion UX, maybe minimap/zoom controls.

3. **Window management/docking needs polish**
   - Dock.Avalonia is now integrated with a code-first workspace layout.
   - Persisted/restorable Dock.Avalonia layout, richer panel menus, and refined dock chrome/theme states are still pending.

4. **Editor panels are still too raw**
   - Property editor still has raw-ish value editing.
   - Relationship editor is first-pass.
   - Resource managers are first-pass.
   - Need user-friendly forms, pickers, validation, and previews.

5. **Large IFC performance is not truly solved**
   - Async loading exists.
   - Some parser recovery exists.
   - But true streaming parser/lazy indexes/mesh chunking/cancellation across indexing and tessellation are still pending.

6. **Native build verification is no longer pending**
   - Windows/.NET 9 Avalonia build and `NativeWindows.Tests` now pass.
   - Keep this gate in the loop while replacing STEP-entity editor state with the in-memory model.

## New priority order

Stop defaulting to small parser-hardening work. Focus on visible/user-facing native app capability.

### Priority 0 - Finish native in-memory editor state

Goal: stop using STEP/IFC entities as the live editor state for large files.

Deliverables:

- Move common edit workflows from STEP clone/reparse to `IfcMemoryModel` mutations. Property, Pset/Qto template creation, simple resource assignment, placement, matching existing extruded body-dimension, existing-product body representation assignment, product/opening/filling preset creation, diagnostic repairs, raw entity editing, relationship create/edit/delete, element connect/disconnect, and spatial reparent/detach edits are now on this path; `IfcDocumentEditor` has no `document.ToStepText()` live-state reparse path left. Keep auditing future editor features against this boundary.
- Keep STEP serialization as explicit export only.
- Keep STEP parsing as explicit import only.
- Maintain source-id mapping so diffs/export can still target stable IFC rows.
- Add tests proving property and geometry edits update the memory model without reparsing STEP.

### Priority 1 — Real native 3D viewer/backend

Goal: turn the viewport into a useful native IFC viewer.

Preferred direction:

- Rendering: HelixToolkit/SharpDX/DirectX or another mature native Windows 3D option.
- Geometry extraction/tessellation: IfcOpenShell or native C++/Rust worker if feasible.
- Avoid making WASM/web-ifc the primary renderer for the Windows-native app.
- Use `IIfcGeometryBackend` / `IfcPreviewMesh` as the integration seam.
- Keep native memory-model preview and STEP-reference preview as fallback/debug views.

Deliverables:

- Load/display actual product meshes from sample IFC.
- Orbit/pan/zoom camera. First-pass tested camera state exists for preview meshes; carry it forward into the mature Avalonia/native renderer.
- Selection sync with inspector/spatial tree.
- First-pass viewport click selection to inspector exists for preview meshes; carry this into the mature renderer with highlighting and robust picking.
- Fit selection / reset camera actually affects viewport. First-pass fit state exists in the native camera service; richer Avalonia viewport camera commands remain pending for the mature renderer.
- Type/category visibility toggles if practical.
- Clear error state when geometry backend cannot tessellate.

### Priority 2 — Polish Dock.Avalonia window management

Goal: make NativeWindows feel like a serious desktop editor.

Recommended libraries/options:

- Continue with Dock.Avalonia as the selected docking library.

Deliverables:

- Dockable panels for Model, Viewport, Inspector, Graph, Diagnostics. First Dock.Avalonia layout exists.
- Close/open panels via menu.
- Persist/restore Dock.Avalonia layout.
- Reset layout.
- Avoid unreadable theme states in dock chrome.

### Priority 3 — Real visual graph editor

Goal: replace graph preview with a usable IFC relationship graph.

Recommended libraries/options:

- GraphX / GraphShape / QuickGraph-style stack if compatible.
- Otherwise a stronger Avalonia Canvas graph with layout, edge routing, pan/zoom, and interaction.

Deliverables:

- Nodes and edges visually distinct.
- Layout algorithm.
- Relationship type filters.
- Depth control.
- Click node to select entity.
- Click edge to inspect/edit relationship.
- Expand/collapse neighborhood.
- Use graph to create/edit/delete relationships where safe.

### Priority 4 — Comfortable editor panels

Goal: stop exposing raw IFC details for common workflows.

Deliverables:

- Property set editor with typed fields.
- Quantity editor with typed numeric inputs.
- Relationship editor with source/target pickers, not just raw ids.
- Spatial reparent via picker/drag-drop.
- Material/classification/document/library managers with forms.
- Preview change summary before staging.

### Priority 5 — Large IFC performance pass

Goal: make large files practical.

Deliverables:

- Streaming/lazy parser/index strategy.
- Progress/cancellation across parsing and indexing, not just file read.
- Virtualized trees/lists everywhere.
- Chunked geometry extraction/rendering.
- Background indexing/geometry loading.

## Recommended next task prompt

Use this for the next separate session/subagent:

```text
In O:\Code\native\IFCnative on branch codex/native-ifc-memory-model, continue the native rewrite. Do not delete or replace the Web/React app.

Read NATIVE_WINDOWS_VISIBLE_FUNCTIONS_PLAN.md and WINDOWS_NATIVE_REWRITE.md first. The native app now uses Avalonia/ReactiveUI with a Dock.Avalonia workspace and has IfcMemoryModel, IfcMemoryModelEditor, and IfcMemoryModelExporter. Property value edits, Pset/Qto template creation, simple material/classification/document/library assignments, placement edits, matching existing extruded body-dimension edits, existing-product body representation assignment, product/opening/filling preset creation, diagnostic repairs, raw entity editing, relationship create/edit/delete, element connect/disconnect, and spatial reparent/detach mutate memory first and patch STEP only at the draft/export boundary; `IfcDocumentEditor` no longer reparses serialized IFC as live editor state. The memory geometry backend exposes `IfcPreviewMesh` and tessellates simple rectangle/bounding-box/cylinder extrusions with relative placement chains, axis/ref-direction rotations, and local solid/profile offsets; the Avalonia viewport currently renders a first mesh-projection preview, but full IFC mesh extraction/rendering, mature camera controls, and robust picking are still missing. Prioritize a real native 3D viewer/backend using native libraries if feasible, then continue Dock.Avalonia polish, graph, and performance work.

Run dotnet build NativeWindows\IFCnative.NativeWindows.csproj, dotnet run --project NativeWindows.Tests\IFCnative.NativeWindows.Tests.csproj, git diff --check, npm run test:ifc, npm run lint, and npm run build. Update WINDOWS_NATIVE_REWRITE.md and this plan with results.
```
