# IFCnative Windows Native Rewrite

Branch: `windows-native-rewrite-20260524-1218`

Goal: add/rewrite IFCnative as a Windows-native application for efficiently opening, inspecting, editing, validating, diffing, and exporting large IFC files.

Important constraint from Paul: the native app is a separate/additional folder/project. Do **not** delete or replace the existing Web/React app; keep it available while building the Windows-native implementation.

## Technical direction

- **Project layout:** keep the existing Web/React app intact; build the Windows-native app as a separate project folder (`NativeWindows/` for now, unless later moved/renamed).
- **UI shell:** C#/.NET WPF (`net9.0-windows`) for a fast native desktop shell, docking-style panels, file dialogs, keyboard workflows, and incremental UI virtualization.
- **IFC document core:** C# services first, designed around streaming/indexed STEP parsing so large files do not require expensive full UI materialization.
- **Geometry pipeline:** isolate behind service interfaces. Prefer a genuinely native Windows renderer/backend when a solid option exists (for example HelixToolkit/SharpDX/DirectX plus IfcOpenShell or a native C++/Rust mesh worker). Treat the existing WASM/web-ifc renderer path as a compatibility/fallback option for the Web app, not the target for the Windows-native app.
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
- `NativeWindows.Tests/` contains a lightweight native service test runner for parser/index/edit/diff/draft behavior; execution still needs a Windows/dotnet environment.
- Current C# shell code already includes:
  - Open IFC/STEP/ifcZIP file dialog.
  - Export IFC/ifcZIP file dialog.
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
- [x] Preserve original STEP ids and order during export. Native serialization now keeps parsed DATA entity order and appends newly created entities after existing rows.
- [~] Large-file memory strategy: async sequential file loading with progress/cancellation; streaming parser and lazy indexes still pending.
- [~] Recent files/session restore. Native shell now persists recent IFC paths, can reopen/clean missing entries, restores window/pane visibility plus pane widths, and automatically reopens the last IFC workspace on startup when the file is still available.
- [~] ifcZIP/ifcXML support. Native file loader can open `.ifczip`/`.zip` archives and extract the first IFC/STEP entry; export can write validated IFC text into `.ifczip` archives; ifcXML remains pending.

### Parsing/indexing

- [x] STEP entity parser with nested argument splitting.
- [x] Entity lookup by STEP id.
- [x] Entity buckets by IFC type.
- [x] Incoming reference index.
- [x] Spatial roots/tree from containment/decomposition relationships.
- [~] Relationship-specific endpoint model exists in TypeScript; C# now has first-pass parity for common relationship classes.
- [ ] Incremental parse/update after edits instead of full reparse.
- [~] Robust syntax recovery for malformed huge files. Native parser now skips unterminated entity argument rows and duplicate STEP ids with warnings, preserving the first duplicate id and resuming parsing following valid STEP entities; broader malformed-input recovery remains pending.

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
- [~] Undo/redo or named changesets. Applied native drafts now create named undo/redo checkpoints in `IfcDraftSession`; the WPF Draft tab can label a changeset, shows next undo/redo names, and lists recent checkpoint summaries.
- [~] Safe targeted serializer preserving formatting/order where practical. Native STEP export now keeps parsed DATA entity order and preserves untouched entity source text/formatting, edited/new entities serialize canonically, and STEP writer/id allocation helpers are centralized in `IfcStepWriter`.

### Spatial/products/relationships

- [~] Spatial tree display.
- [~] TypeScript helpers can add elements and relationships.
- [~] Native create/edit/move/reparent spatial nodes. First-pass reparent draft editor now updates existing containment/aggregation parents with cycle/spatial-parent guards; spatial parents can now stage new contained product presets with placement/body geometry; first-pass detach/delete spatial-link workflow removes selected entities from containment/aggregation relationships.
- [~] Native relationship graph/editor with filters/depth/pinning. Relationship endpoints can now be selected and staged from the inspector, and the relationship neighborhood graph now has text/type/id/name filtering plus depth-1/depth-2 expansion controls; richer visual graph layout remains pending.
- [~] Relationship create/edit/delete with endpoint validation. Existing common relationship endpoints can now be draft-edited by source/target STEP ids, selected relationships can be staged for deletion, common indexed relationship types can now be created from source/target STEP ids with diff review/export gating, and first-pass product connect/disconnect buttons use `IFCRELCONNECTSELEMENTS`; richer relationship-specific creation forms remain pending.
- [~] Opening/fill and connect/disconnect workflows. First-pass native opening/void workflow can stage a new `IFCOPENINGELEMENT` with placement/body preset plus `IFCRELVOIDSELEMENT`; selected openings can now stage a filling element with body preset plus `IFCRELFILLSELEMENT`; selected products can now stage first-pass `IFCRELCONNECTSELEMENTS` connect/disconnect drafts with corrected endpoint indexing.

### Properties/resources

- [~] TypeScript indexes psets, quantities, materials, classifications, documents, types.
- [~] TypeScript mutation helpers can add/update these resources.
- [~] Native property/quantity index, inspector view, and draft raw value edits for single values/quantities.
- [~] Native type assignment index and inspector view.
- [~] Native material/classification/document/library resource index and inspector view; first-pass simple material, classification, document, and library assignment draft workflows are now wired.
- [~] Templates/presets for common psets and quantities. First-pass native buttons can stage `Pset_NativeCommon` and `Qto_NativeBaseQuantities` assignments for selected products with draft review/export gating.

### Geometry/viewport

- [x] Web app has `web-ifc` geometry streaming/indexing.
- [~] TypeScript native document supports simple rectangle/cylinder body generation and placement updates; C# services now cover assigning rectangle/cylinder swept-solid representations to existing products.
- [~] C# native project has viewport placeholders and product representation indexing.
- [~] Native 3D viewport implementation. A geometry backend abstraction now feeds a first-pass STEP-reference viewport preview; actual mesh rendering is still pending.
- [ ] Efficient large-model mesh streaming/chunking.
- [~] Selection sync between tree/graph/viewport. Tree/graph selections now update the geometry preview list; rendered mesh picking remains pending.
- [~] Product placement index and numeric placement editor; transform controls still pending.
- [~] Body presets: native service and WPF UI can stage rectangle/cylinder swept-solid body representations for existing selected products, create new contained product presets under spatial parents, and create first-pass opening voids with body geometry under selected host products with draft review/export gating.

### Diff/review/export

- [x] TypeScript entity-aware diff helpers.
- [x] Web app disables export with pending draft according to prior plan.
- [~] Native diff/review panel for staged entity and placement edits.
- [~] Native human summary with added/removed/changed STEP ids and argument-level change preview.
- [~] Native export guarded by pending draft state.
- [~] Validate exported IFC with parser/geometry backend before final save where possible. Native export now reparses serialized STEP text before writing and blocks saves on parser errors/entity-count mismatches, and the active geometry backend now validates indexed representation chains before final save; richer mesh-backend validation remains pending.

### Validation/diagnostics

- [x] Basic STEP frame diagnostics.
- [~] TypeScript diagnostics for schema/units/references/product shape issues.
- [~] Native validation panel with grouped severity. Diagnostics are now projected into severity-ranked rows with first-pass repair suggestions, can be filtered by severity/message/suggestion text, and diagnostic rows with STEP ids navigate to the referenced entity; richer issue-specific repair actions still pending.
- [~] Missing/duplicate GlobalId, missing refs, physical product placement/representation, and multiple primary containment diagnostics.
- [~] Repair suggestions/actions. First-pass suggestions exist for STEP envelope, missing refs, missing/duplicate GlobalIds, containment, placement, and representation diagnostics; missing GlobalId diagnostics can stage generated ids, duplicate GlobalId diagnostics now expose a staged repair action that regenerates duplicate ids after the first occurrence, multiple-primary-containment diagnostics can stage a repair that keeps the first containment relationship while removing duplicate product links through the diff/export gate, missing relationship reference diagnostics can stage removal of dangling endpoints or delete now-empty relationships, and missing/invalid placement or representation diagnostics can stage default local placement/body repairs.
- [ ] IDS/MVD validation.

## Rewrite work queue

1. [x] Clone/fetch repo and create rewrite branch.
2. [x] Create this inventory/tracking document.
3. [~] Make native WPF project structurally complete and buildable by adding missing XAML and project defaults. XAML is present; Windows/dotnet build verification still pending.
4. [~] Split native shell into UI + services + view models so large lists can be virtualized and tested. Selection/inspector projection, navigation/type/search/bookmark projection, placement editor projection, entity-edit draft creation, draft-session state, and persisted native window-layout state have moved out of `MainWindow` into service/view-model classes; command wiring still needs further extraction.
5. [~] Port TypeScript native document capabilities to C# services: first-pass relationship model/indexing, property/resource/type/unit/placement/representation read indexes, numeric placement edit helper, existing-product body assignment helper, centralized STEP writer/id allocation helpers, and first malformed/duplicate-entity parser recovery done; broader create/delete edit helpers remain.
6. [~] Implement draft transaction model and native diff summary. Entity/placement and broader editor operations now stage drafts with apply/discard; applied drafts now support named undo/redo checkpoints, while richer persisted changeset metadata remains pending.
7. [~] Add large-file parser/index strategy with progress and cancellation. Async sequential file loading with cancel/progress is done; parser/index streaming still pending.
8. [~] Implement native relationship/spatial/property editor panels. Editable Psets/Qto raw values, common Pset/base Qto template creation, simple material/classification/document/library assignment, common relationship endpoint source/target draft edits, common relationship creation, selected relationship deletion, first-pass element connect/disconnect workflows, first-pass spatial reparent draft editing, spatial-parent product creation presets, spatial detach/delete-link workflows, and first-pass opening/void/fill creation are in place; richer typed forms/cascade workflows remain pending.
9. [~] Implement geometry backend abstraction and first viewport. `IIfcGeometryBackend` plus a STEP-reference preview backend now drives the native viewport panel; the WPF shell now renders a first native `Viewport3D` block preview with generated sample geometry, while a real native mesh/tessellation backend (prefer HelixToolkit/SharpDX/DirectX + IfcOpenShell/native worker over WASM if feasible) remains pending.
10. [~] Add native test project for parser/index/edit/diff services. A lightweight `NativeWindows.Tests` runner now covers sample parsing/indexes, entity/property/relationship/spatial/placement edits, diff summaries, and draft export gating; Windows/dotnet execution remains pending.
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
- 2026-05-24 14:22 Europe/Berlin: began native shell split by moving selected-entity inspector projection into `IfcSelectionProjector` and `IfcSelectionDetails`, trimming repeated list-building logic from `MainWindow`. Existing web tests/build still pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 14:28 Europe/Berlin: continued native shell split by adding `IfcNavigationProjector` and `IfcTypeCount` view model for type counts, path-aware entity search, pinned bookmark projection, and document/type viewport summaries. Existing web tests/build still pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 14:38 Europe/Berlin: continued native shell split by adding `IfcDraftSession` to own saved/pending draft state, export gating, apply/discard transitions, and diff-summary projection outside `MainWindow`. Existing web tests/build still pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 14:50 Europe/Berlin: continued native shell split by adding `IfcPlacementDetails` projection and moving entity-edit draft creation into `IfcDocumentEditor`, further reducing `MainWindow` command logic. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 14:58 Europe/Berlin: started native property editing by adding selectable Psets/Qto value view models, a raw value editor, and draft staging for `IFCPROPERTYSINGLEVALUE` plus common quantity value entities. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 15:11 Europe/Berlin: added native relationship endpoint editing for common relationship classes with selectable relationship details, source/target id editors, draft staging, and export gating through the existing draft session. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 15:18 Europe/Berlin: added native spatial reparent editing for existing `IFCRELCONTAINEDINSPATIALSTRUCTURE`/`IFCRELAGGREGATES` parent relationships, including parent STEP-id UI, draft staging/export gating, spatial-parent validation, and cycle prevention. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 15:28 Europe/Berlin: added a native relationship neighborhood graph panel for the selected entity, with directional relationship rows, clickable neighbor rows, and missing-reference surfacing. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 15:38 Europe/Berlin: added a native diagnostics projector and view model so validation output is severity-ranked and includes first-pass repair suggestions for STEP envelope, missing-reference, duplicate GlobalId, containment, placement, and representation problems. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 15:48 Europe/Berlin: added a native geometry backend abstraction (`IIfcGeometryBackend`) and first STEP-reference viewport preview with document/selection geometry summaries, represented-product rows, placement coordinates, and item descriptions for extruded solids, rectangle/circle profiles, bounding boxes, and fallback reference chains. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; native dotnet build remains blocked because `dotnet` is not installed on this host.
- 2026-05-24 15:58 Europe/Berlin: added `NativeWindows.Tests`, a lightweight Windows-targeted console test runner covering native parser/index projections, entity/property/relationship/spatial/placement edit helpers, diff summaries, and draft-session export gating. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 16:12 Europe/Berlin: added a native C# body-representation assignment helper that can draft rectangle/cylinder swept-solid geometry for an existing product, including fallback geometric representation context creation and coverage in `NativeWindows.Tests`. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 16:20 Europe/Berlin: wired the body-representation helper into the native WPF Representation tab with width/depth/height inputs and rectangle/cylinder staging buttons for selected product-like entities; staged body assignments flow through `IfcDraftSession`, keep export disabled until apply/discard, and have added native test coverage for staged body draft summaries. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 16:28 Europe/Berlin: added native create-new-product body presets: spatial parents can now stage a new contained product with local placement plus rectangle/cylinder swept-solid representation, with WPF controls in the Spatial edit tab and `NativeWindows.Tests` coverage for containment, placement, spatial path, and body indexing. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 16:38 Europe/Berlin: added a first-pass native spatial detach/delete-link workflow: selected contained/aggregated entities can now stage removal from their spatial parent relationship, empty containment relationships are removed, diff review/export gating is preserved, and `NativeWindows.Tests` covers the detach behavior. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 16:50 Europe/Berlin: added native selected-relationship deletion: relationship rows now expose a delete action, deletion stages through the draft session/diff review/export gate, `IfcDocumentEditor.RemoveRelationship` reparses indexes after removing the STEP relationship, and `NativeWindows.Tests` covers deleted property-assignment projection. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 16:58 Europe/Berlin: added first-pass native relationship creation: the Relationships tab now accepts type/name/source/target ids, `IfcDocumentEditor.AddRelationship` creates supported common relationship classes with generated GlobalIds and indexed endpoints, draft review/export gating is preserved, and `NativeWindows.Tests` covers created relationship projection/diffs. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 17:08 Europe/Berlin: added first-pass native opening/void creation: the Representation tab can stage a new `IFCOPENINGELEMENT` with local placement, rectangle body preset, and indexed `IFCRELVOIDSELEMENT` against the selected host product; `IfcDocumentEditor.AddOpeningVoidWithBodyRepresentation` and `NativeWindows.Tests` cover void relationship, placement/body indexing, and diff projection. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 17:18 Europe/Berlin: added first-pass native opening fill creation: selected `IFCOPENINGELEMENT` rows can now stage a filling product with local placement/body preset plus indexed `IFCRELFILLSELEMENT`; `IfcDocumentEditor.AddFillingElementWithBodyRepresentation`, WPF Representation-tab wiring, and `NativeWindows.Tests` cover fill relationship, placement/body indexing, and diff projection. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native test execution remains pending on Windows/dotnet.
- 2026-05-24 17:28 Europe/Berlin: added first-pass native element connect/disconnect workflow: corrected `IFCRELCONNECTSELEMENTS` endpoint indexing to skip the connection-geometry argument, added editor helpers plus Relationship-tab buttons to stage product connections/removals, and extended `NativeWindows.Tests` coverage for connection create/disconnect diffs. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 17:38 Europe/Berlin: added first-pass native Pset/Qto template workflows: selected products can now stage a generated `Pset_NativeCommon` with Reference/Status/IsExternal single values or `Qto_NativeBaseQuantities` with length/area/volume quantities, `IFCELEMENTQUANTITY` indexing now reads the quantities argument correctly, WPF Psets/Qto buttons use the existing draft review/export gate, and `NativeWindows.Tests` covers indexed template assignment/diffs. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 17:48 Europe/Berlin: added native export validation before final save: the WPF export path now reparses serialized STEP text via `IfcExportValidator`, blocks writes on parser errors or entity-count mismatches, reports validation warnings in the status bar, and `NativeWindows.Tests` covers valid/invalid export validation paths. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 17:58 Europe/Berlin: wired export validation through the active native geometry backend: `StepReferenceGeometryBackend` now validates product definition shape, shape representation, and geometry item references; `IfcExportValidator` merges backend errors/warnings; the WPF export path blocks geometry-invalid saves; and `NativeWindows.Tests` covers missing geometry item rejection. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 18:08 Europe/Berlin: changed native STEP serialization to preserve parsed DATA entity order instead of sorting by STEP id, so exports keep original row ordering while newly created entities append at the end; added `NativeWindows.Tests` coverage for unordered input and edited export order preservation. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 18:21 Europe/Berlin: extended native STEP serialization to retain each parsed entity's original source line/text when its arguments are unchanged, reducing export churn for multiline or custom-spaced DATA rows while still serializing edited/new entities canonically; added `NativeWindows.Tests` coverage for preserving untouched formatted entity text through targeted edits. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 18:31 Europe/Berlin: added native draft undo/redo history: `IfcDraftSession` now stores applied-document checkpoints, the Draft tab exposes Undo/Redo buttons, apply/discard/undo/redo refresh the projected document without resetting draft history, and `NativeWindows.Tests` covers undo/redo state transitions and redo invalidation after a new apply. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 18:38 Europe/Berlin: extended native draft history into named changesets: the Draft tab now accepts an optional changeset label before Apply, undo/redo buttons surface the next checkpoint names, `IfcDraftSession` keeps checkpoint summaries for the visible history list, and `NativeWindows.Tests` covers named undo/redo labels plus redo clearing after a new named apply. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 18:48 Europe/Berlin: added native diagnostics filtering: the Diagnostics tab now has a filter box for severity/message/repair-suggestion text, `IfcDiagnosticsProjector` supports filtered projections with empty-state feedback, and `NativeWindows.Tests` covers severity, text, and no-match filters. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 18:58 Europe/Berlin: added first-pass diagnostic navigation: projected diagnostics now parse the first referenced STEP id, the Diagnostics list can select/navigate to that entity in the inspector/viewport, missing targets are reported in the status bar, and `NativeWindows.Tests` covers parsed navigation targets. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 19:20 Europe/Berlin: addressed the latest native-app UI feedback without touching the Web/React app: added comprehensive dark WPF control styles for tabs/lists/trees/text inputs/buttons/menu items/disabled states, introduced a real File/View menu with open/sample/export/exit and pane visibility/reset layout controls, replaced the graph list with a native canvas graph preview with clickable nodes plus pan/zoom/reset, replaced the viewport placeholder with a first functional `Viewport3D` generated geometry preview, and expanded the sample IFC with visible placement/body representation geometry. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet. Recommended next step remains a real mesh/docking library pass (HelixToolkit + AvalonDock or similar) on Windows once package restore/build is available.
- 2026-05-24 19:30 Europe/Berlin: added native relationship graph filter/depth controls: the Graph tab now filters by relationship type, STEP id, entity type/name/GlobalId and can expand to depth 2; `IfcSelectionProjector` exposes the filtered/depth-aware graph projection and `NativeWindows.Tests` covers second-hop expansion plus filter pruning. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 19:42 Europe/Berlin: added persisted native window/pane layout state: the WPF shell now restores model/viewport/inspector pane visibility, splitter-adjusted side-pane widths, and window size via `NativeWindowLayoutStore`, keeps at least one pane visible, and has `NativeWindows.Tests` coverage for layout persistence/sanitization. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 19:32 Europe/Berlin: added automatic native workspace restore: the layout store now persists the last opened IFC path, normalizes it on load, the WPF shell reopens that file on startup when present, clears the restore target when the user loads the bundled sample, and `NativeWindows.Tests` covers last-path persistence. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 19:48 Europe/Berlin: centralized native STEP writer helpers: `IfcStepWriter` now owns document/entity serialization plus next-id allocation, `IfcDocument`/`IfcEntity` delegate serialization through it, editor workflows reuse the shared id allocator, the shell capability list reflects the completed writer-helper pass, and `NativeWindows.Tests` covers canonical writer helper behavior. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 19:58 Europe/Berlin: added a first-pass native material assignment workflow: the Resources tab can stage a new `IFCMATERIAL` plus `IFCRELASSOCIATESMATERIAL` for the selected product, the resource index immediately projects the assignment through draft review/export gating, the shell capability list now points to a native mesh backend as the next geometry step, and `NativeWindows.Tests` covers material resource indexing/diffs. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:08 Europe/Berlin: expanded the native Resources tab from material-only to first-pass classification/document/library reference assignments as well: `IfcDocumentEditor` now shares a simple resource-assignment helper across `IFCRELASSOCIATESMATERIAL`, `IFCRELASSOCIATESCLASSIFICATION`, `IFCRELASSOCIATESDOCUMENT`, and `IFCRELASSOCIATESLIBRARY`; resource labels now read the appropriate reference name fields; WPF staging buttons use the existing draft review/export gate; and `NativeWindows.Tests` covers all four indexed resource assignment types. `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:11 Europe/Berlin: added first-pass native diagnostic repair actions for duplicate GlobalIds: diagnostic projection now marks duplicate-id rows as repairable, the Diagnostics tab exposes a staged repair button, `IfcDocumentEditor.RegenerateDuplicateGlobalIds` preserves the first duplicate and regenerates later duplicate ids through the existing diff/export gate, and `NativeWindows.Tests` covers the repair projection/diff behavior. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:18 Europe/Berlin: expanded native diagnostic repair actions to multiple primary spatial containment warnings: diagnostic projection now marks these rows as repairable, the Diagnostics tab switches the repair button label/action by diagnostic type, `IfcDocumentEditor.KeepFirstPrimarySpatialContainment` preserves the first containment relationship while removing duplicate product links or empty duplicate relationships, and `NativeWindows.Tests` covers the staged repair projection/diff behavior. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:28 Europe/Berlin: expanded native diagnostic repair actions to missing relationship references: diagnostic projection now marks dangling relationship endpoint warnings as repairable, the Diagnostics tab stages a missing-reference repair through the existing draft/export gate, `IfcDocumentEditor.RemoveMissingRelationshipReferences` removes dangling endpoints or deletes relationships left without a valid side, and `NativeWindows.Tests` covers the projected repair/diff behavior. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:38 Europe/Berlin: expanded native diagnostic repair actions to physical-product placement/representation warnings: diagnostics now expose staged repairs for missing/invalid `ObjectPlacement` and `Representation`, the Diagnostics tab routes them through the existing draft/export gate, `IfcDocumentEditor` can create a default local placement or default 1x1x1 swept-solid body from the diagnostic target, and `NativeWindows.Tests` covers projection plus diff behavior. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:49 Europe/Berlin: added native missing-GlobalId diagnostics and repair flow for rooted IFC objects: the parser warns when rooted/project/spatial/product/relationship/property/type objects have an empty GlobalId, diagnostics project a staged repair action, the WPF Diagnostics tab routes it through the existing draft/export gate, `IfcDocumentEditor` generates a unique replacement id, and `NativeWindows.Tests` covers projection/diff behavior. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 20:58 Europe/Berlin: added first-pass native ifcZIP loading: `IfcFileLoader` now recognizes `.ifczip`/`.zip`, extracts the first `.ifc`/`.stp`/`.step` archive entry with progress text, the WPF open dialog includes ifcZIP archives and parses using the inner IFC filename, and `NativeWindows.Tests` covers zipped IFC extraction/parsing. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 21:11 Europe/Berlin: added native ifcZIP export: validated exports can now target `.ifczip`, `IfcFileLoader.WriteText` writes UTF-8 IFC text into a compressed archive entry derived from the document name, the WPF export dialog exposes ifcZIP archives, the shell capability list no longer marks ifcZIP unsupported, and `NativeWindows.Tests` covers generated archive contents. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 21:22 Europe/Berlin: added first-pass native parser recovery for malformed entity argument lists: unterminated STEP rows are skipped with a warning instead of swallowing following entities, and `NativeWindows.Tests` covers recovery after a broken row. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
- 2026-05-24 21:31 Europe/Berlin: expanded native parser recovery to duplicate STEP ids: parsing now keeps the first entity for a repeated id, warns and skips later duplicate rows, continues indexing following entities, and avoids exporting duplicate STEP rows; `NativeWindows.Tests` covers the duplicate-id recovery path. `git diff --check`, `npm run test:ifc`, `npm run lint`, and `npm run build` pass on macOS; `dotnet --info` still fails because `dotnet` is not installed on this host, so native build/test execution remains pending on Windows/dotnet.
