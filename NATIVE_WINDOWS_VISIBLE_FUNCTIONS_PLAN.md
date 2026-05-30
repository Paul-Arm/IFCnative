# IFCnative Native Windows — Visible Functions Plan

## Context

Paul's feedback: the rewrite has too much backend/plumbing work and not enough visible, usable editor functionality. Stop defaulting to small parser-hardening iterations. Prioritize user-facing native Windows features, and prefer mature native libraries over custom placeholders.

Important constraints:

- Keep the existing Web/React app intact.
- The Windows-native app remains a separate project under `NativeWindows/`.
- Prefer native Windows rendering/geometry alternatives over WASM when a good native option exists.
- WASM/web-ifc should be treated as compatibility/fallback, not the target renderer for the Windows-native app.

## Current branch / push status

- Branch: `windows-native-rewrite-20260524-1218`
- Last pushed clean status seen: `26cf301 Harden native parser trailing text recovery`
- Web verification has been passing:
  - `npm run test:ifc`
  - `npm run lint`
  - `npm run build`
- Native `.NET/WPF` build/test execution is now verified on Windows/.NET 9:
  - `dotnet run --project NativeWindows.Tests\IFCnative.NativeWindows.Tests.csproj`
  - `dotnet build NativeWindows\IFCnative.NativeWindows.csproj`

## Functions that currently exist in the native app

### File/session

- Open IFC/STEP files.
- Open `.ifczip` / `.zip` archives and extract the first IFC/STEP entry.
- Open IFCnative `.ifcxml` exports through a safe `stepText` payload.
- Export IFC text.
- Export validated IFC text into `.ifczip` archives.
- Export validated IFC text into IFCnative `.ifcxml` `stepText` payloads.
- Recent IFC paths.
- Reopen/clean missing recent entries.
- Persist window/pane layout state.
- Restore pane visibility, pane widths, and window size.
- Auto-reopen last available IFC workspace on startup.
- Runtime package bridge status for xBIM Essentials, xBIM Geometry, xBIM IDS Validator, HelixToolkit WPF SharpDX, and Xceed AvalonDock.

### Inspection/navigation

- Entity search by STEP id, IFC type, name, GlobalId, and spatial path.
- Advanced search service for text, type, relationship kind, diagnostic severity, property presence, and resource presence filters.
- Entity inspector.
- Incoming references panel.
- Relationship panel.
- Type counts.
- Full spatial path display for selected entity.
- Pinned/bookmarked entities for quick navigation.
- Diagnostics tab with severity-ranked rows.
- Diagnostics filtering by severity/message/repair-suggestion text.
- Diagnostic rows with STEP ids navigate to the referenced entity.
- Diagnostics-tab IDS file picker plus basic entity-requirement validation with diagnostics append support.

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

### Spatial/products/relationships

- Spatial tree display.
- First-pass spatial reparent draft editor.
- Cycle/spatial-parent guards.
- Detach/delete spatial-link workflow for containment/aggregation relationships.
- Create new contained product presets with placement/body geometry.
- Relationship creation for common IFC relationship classes.
- Relationship endpoint selection/staging from the inspector.
- Element connect/disconnect workflow.
- Opening fill workflow via `IFCRELFILLSELEMENT`.
- Relationship neighborhood graph preview with filtering, depth controls, MSAGL auto-layout, relationship hub nodes, edge labels, graph-to-editor selection, and draft-safe graph copy/paste link creation.

### Properties/resources

- Property/quantity indexes.
- Property/quantity inspector view.
- Raw value edits for single values/quantities.
- Type assignment index/view.
- Material/classification/document/library resource index/view.
- First-pass simple material assignment.
- First-pass classification assignment.
- First-pass document assignment.
- First-pass library assignment.
- First-pass `Pset_NativeCommon` preset button.
- First-pass `Qto_NativeBaseQuantities` preset button.

### Geometry/viewport

- Product placement index.
- Numeric placement editor.
- Product representation index for `IFCPRODUCTDEFINITIONSHAPE` / `IFCSHAPEREPRESENTATION` references.
- Geometry backend abstraction (`IIfcGeometryBackend`).
- STEP-reference viewport preview backend with shape/dimension projection for simple swept solids and bounding boxes.
- WPF `Viewport3D` preview renders STEP-derived rectangle/cylinder bodies at indexed placements with fit/zoom.
- Preview body picking selects the corresponding IFC product in the inspector.
- Sample IFC expanded with visible placement/body representation geometry.
- HelixToolkit WPF SharpDX and xBIM Geometry packages are pinned for the next full mesh backend slice.

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
- Safe IDS entity-requirement pass/fail diagnostics.

## What is still not good enough / missing

These are the important gaps Paul is reacting to:

1. **3D viewer is not a real IFC mesh viewer yet**
   - Current viewport can render simple STEP-derived body previews, but it is not full IFC tessellation.
   - Need real mesh extraction/tessellation and richer interactive rendering.
   - Prefer native renderer/backend over WASM.

2. **Graph is still not a mature visual graph editor**
   - Native WPF graph now uses MSAGL for automatic layout and keeps WPF-rendered nodes for IFC-aware styling/interactions.
   - Relationship hubs, edge labels, click-to-edit relationship selection, and copy/paste-to-draft now exist.
   - Still needs richer node templates, minimap-style overview, persisted manual pins, and more graph-native relationship editing.

3. **Window management/docking is still incomplete**
   - Menu and pane toggles exist, but this is not full docking/window management.
   - Xceed AvalonDock is now pinned and layout XML persistence is prepared, but the visible shell has not been migrated to dockable panes yet.

4. **Editor panels are still too raw**
   - Property editor still has raw-ish value editing.
   - Relationship editor is first-pass.
   - Resource managers are first-pass.
   - Need user-friendly forms, pickers, validation, and previews.

5. **Large IFC performance is not truly solved**
   - Async loading exists.
   - Some parser recovery exists.
   - But true streaming parser/lazy indexes/mesh chunking/cancellation across indexing and tessellation are still pending.

6. **Native package-backed verification is now available**
   - `dotnet run --project NativeWindows.Tests\IFCnative.NativeWindows.Tests.csproj` passes with 45 tests on Windows/.NET 9.
   - `dotnet build NativeWindows\IFCnative.NativeWindows.csproj` passes on Windows/.NET 9.

## New priority order

Stop defaulting to small parser-hardening work. Focus on visible/user-facing native app capability.

### Priority 1 — Real native 3D viewer/backend

Goal: turn the viewport into a useful native IFC viewer.

Preferred direction:

- Rendering: HelixToolkit/SharpDX/DirectX or another mature native Windows 3D option.
- Geometry extraction/tessellation: IfcOpenShell or native C++/Rust worker if feasible.
- Avoid making WASM/web-ifc the primary renderer for the Windows-native app.
- Use `IIfcGeometryBackend` as the integration seam.
- Keep STEP-reference preview as fallback/debug view.

Deliverables:

- Load/display actual product meshes from sample IFC.
- Orbit/pan/zoom camera.
- Selection sync with inspector/spatial tree.
- Fit selection / reset camera actually affects viewport.
- Type/category visibility toggles if practical.
- Clear error state when geometry backend cannot tessellate.

### Priority 2 — Real docking/window management

Goal: make NativeWindows feel like a serious desktop editor.

Recommended libraries/options:

- AvalonDock / Xceed AvalonDock, or another maintained WPF docking solution.

Deliverables:

- Dockable panels for Model, Viewport, Inspector, Graph, Diagnostics.
- Close/open panels via menu.
- Persist/restore layout.
- Reset layout.
- Avoid unreadable theme states in dock chrome.

Current status:

- Xceed AvalonDock is referenced and runtime-probed.
- `NativeWindowLayoutStore` can persist/sanitize AvalonDock layout XML.
- Visible dock chrome migration remains the next UI slice.

### Priority 3 — Real visual graph editor

Goal: replace graph preview with a usable IFC relationship graph.

Recommended libraries/options:

- GraphX / GraphShape / QuickGraph-style stack if compatible.
- Otherwise a stronger WPF Canvas graph with layout, edge routing, pan/zoom, and interaction.
- Current native implementation uses MSAGL for layout and a WPF Canvas renderer for customizable IFC nodes.

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
In /Users/paul/.openclaw/workspace/repos/IFCnative on branch windows-native-rewrite-20260524-1218, focus only on visible NativeWindows functionality. Do not delete or replace the Web/React app.

Read NATIVE_WINDOWS_VISIBLE_FUNCTIONS_PLAN.md first. Stop doing parser-hardening as the default. Implement the highest-value visible feature from the plan, prioritizing a real native 3D viewer/backend using native libraries if feasible (HelixToolkit/SharpDX/DirectX + IfcOpenShell/native worker preferred; WASM/web-ifc only fallback). If native package restore/build is blocked on this Mac, prepare the integration cleanly and document exact Windows/dotnet verification steps.

Run npm run test:ifc, npm run lint, npm run build when practical. Update WINDOWS_NATIVE_REWRITE.md and this plan with results. Commit and push the branch if verification passes or only native dotnet remains blocked.
```
