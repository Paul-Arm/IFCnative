# IFCnative v2 — Full IFC Editor Scope

Goal: grow IFCnative from viewer/builder into a practical IFC editor with draft-first changes, visual review, entity-aware diffs, and safe IFC export.

## Core editor principles

- Never write/export destructive IFC changes blindly: stage draft → summarize → diff/review → apply → export.
- Preserve STEP ids and original ordering where practical.
- Keep all edits valid enough for `web-ifc` open/save roundtrips.
- Prefer entity-aware operations over raw STEP editing, but keep raw STEP escape hatches.
- Every visual operation should map to an IFC concept: placement, representation, relationship, property, resource, or assignment.

## IFC project/spatial structure

Important classes:

- `IFCPROJECT`
- `IFCSITE`
- `IFCBUILDING`
- `IFCBUILDINGSTOREY`
- `IFCSPACE`
- `IFCFACILITY`, `IFCFACILITYPART`
- `IFCZONE`
- `IFCGROUP`, `IFCSYSTEM`

Important relationships:

- `IFCRELAGGREGATES` — decomposition tree, e.g. project → site → building → storey.
- `IFCRELNESTS` — ordered/nested decomposition.
- `IFCRELCONTAINEDINSPATIALSTRUCTURE` — products contained in storeys/spaces.
- `IFCRELREFERENCEDINSPATIALSTRUCTURE` — product referenced by additional spatial structures.
- `IFCRELASSIGNSTOGROUP` — grouping, zones, systems.

Editor features:

- Spatial tree create/edit/move/reparent.
- Drag/drop graph reparenting with relationship-type selection.
- Validate single primary containment for physical products.
- Show full path for selected entity.

## Physical/product classes

Common element/product classes:

- `IFCBUILTELEMENT`, `IFCBUILDINGELEMENTPROXY`
- `IFCWALL`, `IFCWALLSTANDARDCASE`
- `IFCSLAB`, `IFCROOF`, `IFCBEAM`, `IFCCOLUMN`, `IFCMEMBER`, `IFCPLATE`
- `IFCDOOR`, `IFCWINDOW`, `IFCCURTAINWALL`, `IFCSTAIR`, `IFCRAMP`, `IFCRAILING`
- `IFCFURNISHINGELEMENT`, `IFCFLOWTERMINAL`, `IFCDISTRIBUTIONELEMENT`
- `IFCOPENINGELEMENT`, `IFCVOIDINGFEATURE`, `IFCPROJECTIONELEMENT`
- `IFCELEMENTASSEMBLY`, `IFCTRANSPORTELEMENT`
- `IFCANNOTATION`, `IFCPROXY`

Relationships:

- `IFCRELVOIDSELEMENT`
- `IFCRELFILLSELEMENT`
- `IFCRELCONNECTSELEMENTS`
- `IFCRELCONNECTSPORTS`
- `IFCRELCONNECTSPORTTOELEMENT`
- `IFCRELINTERFERESELEMENTS`
- `IFCRELPROJECTSELEMENT`

Editor features:

- Create simple elements by type.
- Reclass selected entities.
- Move/reparent elements between storeys/spaces/groups.
- Connect/disconnect elements.
- Openings and fills workflow: select host → create opening → assign door/window fill.

## Geometry and representation

Placement classes:

- `IFCLOCALPLACEMENT`
- `IFCAXIS2PLACEMENT3D`, `IFCAXIS2PLACEMENT2D`
- `IFCCARTESIANPOINT`
- `IFCDIRECTION`
- `IFCGEOMETRICREPRESENTATIONCONTEXT`, `IFCGEOMETRICREPRESENTATIONSUBCONTEXT`

Shape classes:

- `IFCPRODUCTDEFINITIONSHAPE`
- `IFCSHAPEREPRESENTATION`
- `IFCMAPPEDITEM`, `IFCREPRESENTATIONMAP`
- `IFCSTYLEDITEM`

Simple solid/body classes:

- `IFCEXTRUDEDAREASOLID`
- `IFCRECTANGLEPROFILEDEF`
- `IFCCIRCLEPROFILEDEF`
- `IFCARBITRARYCLOSEDPROFILEDEF`
- `IFCPOLYLINE`, `IFCINDEXEDPOLYCURVE`
- `IFCPOLYGONALFACESET`, `IFCINDEXEDPOLYGONALFACE`
- `IFCBOUNDINGBOX`

Editor features:

- 3D transform/move selected product by editing `IFCLOCALPLACEMENT`.
- Create simple rectangular/cylindrical/prism bodies with dimensions.
- Assign generated body representation to selected/new product.
- Geometry presets: block, slab, column, beam, wall, opening proxy.
- Show placement origin/axes and allow numeric XYZ edit.
- Draft all geometry edits and preview before apply.

## Types, materials, classification, documents

Type classes:

- `IFCTYPEOBJECT`, `IFCELEMENTTYPE`
- `IFCWALLTYPE`, `IFCSLABTYPE`, `IFCDOORTYPE`, `IFCWINDOWTYPE`, `IFCBEAMTYPE`, `IFCCOLUMNTYPE`

Material/resource classes:

- `IFCMATERIAL`
- `IFCMATERIALLAYER`, `IFCMATERIALLAYERSET`, `IFCMATERIALLAYERSETUSAGE`
- `IFCMATERIALPROFILE`, `IFCMATERIALPROFILESET`, `IFCMATERIALPROFILESETUSAGE`
- `IFCMATERIALCONSTITUENT`, `IFCMATERIALCONSTITUENTSET`

Classification/document/library classes:

- `IFCCLASSIFICATION`
- `IFCCLASSIFICATIONREFERENCE`
- `IFCDOCUMENTINFORMATION`
- `IFCDOCUMENTREFERENCE`
- `IFCLIBRARYINFORMATION`, `IFCLIBRARYREFERENCE`

Relationships:

- `IFCRELDEFINESBYTYPE`
- `IFCRELASSOCIATESMATERIAL`
- `IFCRELASSOCIATESCLASSIFICATION`
- `IFCRELASSOCIATESDOCUMENT`
- `IFCRELASSOCIATESLIBRARY`

Editor features:

- Create/edit types and assign occurrences.
- Material assignment editor with simple material first, layer/profile later.
- Classification/document reference assignment.
- Resource graph neighborhood in graph view.

## Properties and quantities

Classes:

- `IFCPROPERTYSET`
- `IFCPROPERTYSINGLEVALUE`
- `IFCPROPERTYENUMERATEDVALUE`
- `IFCPROPERTYLISTVALUE`
- `IFCPROPERTYBOUNDEDVALUE`
- `IFCPROPERTYTABLEVALUE`
- `IFCELEMENTQUANTITY`
- `IFCQUANTITYLENGTH`, `IFCQUANTITYAREA`, `IFCQUANTITYVOLUME`, `IFCQUANTITYCOUNT`, `IFCQUANTITYWEIGHT`, `IFCQUANTITYTIME`

Relationships:

- `IFCRELDEFINESBYPROPERTIES`

Editor features:

- Add/edit/delete psets and quantities.
- Typed property editor for labels/text/real/integer/boolean/date.
- Quantity calculator for simple generated solids.
- Pset templates/presets for common IFC workflows.

## Units, measures, contexts

Classes:

- `IFCUNITASSIGNMENT`
- `IFCSIUNIT`, `IFCCONVERSIONBASEDUNIT`, `IFCDERIVEDUNIT`
- `IFCMEASUREWITHUNIT`
- `IFCAPPLICATION`, `IFCOWNERHISTORY`, `IFCPERSON`, `IFCORGANIZATION`

Editor features:

- Unit list editor.
- Detect missing or duplicate unit assignments.
- Preserve/repair owner history where possible.

## Graph view expansion

Required graph capabilities:

- Relationship-type filters.
- Depth control and cap handling.
- Pinned/manual positions.
- Expand/collapse per node.
- Create node from drag edge.
- Connect existing nodes with relationship-type picker.
- Entity search and focus.
- Neighborhood presets: spatial, properties, resources, geometry, all.
- Edge editing/delete in inspector.
- Entity-aware graph warnings for invalid relationships.

## Diff / review / git-like workflow

Required features:

- All edits stage a draft first.
- Show human summary: operation, affected STEP ids, entity types.
- Entity-aware diff grouped by `#id`.
- Added/removed/changed relationship summary.
- Geometry/placement changes displayed numerically.
- Apply/discard controls.
- Export disabled with pending draft.
- Optional future: history stack, undo/redo, named change sets, compare current IFC vs opened file.

## Validation and diagnostics

Important checks:

- STEP syntax parseable.
- `web-ifc` can open model.
- Required references exist.
- Relationship endpoints are compatible.
- Products have expected placement/representation where edited.
- Spatial containment sanity.
- Duplicate GlobalIds warning.
- Missing units/schema/header warnings.

## Implementation order recommendation

1. Entity-aware diff/review and draft system.
2. Relationship graph filters + relationship editing/delete.
3. Placement parser/editor and 3D move draft.
4. Simple body generation presets.
5. Type/material/classification/document managers.
6. Validation panel and repair suggestions.
7. Undo/redo and change sets.

## Native Windows status, 2026-05-24

- Draft-first editing, apply/discard, export gating, named undo/redo checkpoints, entity-aware STEP diff summaries, relationship graph filters, numeric placement edits, simple rectangle/cylinder body presets, opening/fill workflows, and resource assignment workflows are implemented in `NativeWindows/`.
- New package-backed native service groundwork is in place for xBIM Essentials/Geometry, xBIM IDS Validator, HelixToolkit WPF SharpDX, and Xceed AvalonDock.
- IFCnative `.ifcxml` roundtrip load/export, Diagnostics-tab IDS entity-requirement validation, advanced IFC search, and AvalonDock layout XML persistence are covered by `NativeWindows.Tests`.
- Windows-native graph now uses MSAGL auto-layout, WPF-customizable IFC nodes, and draft-safe graph copy/paste link creation.
- Still pending for full parity: real xBIM tessellated mesh viewport, visible AvalonDock shell migration, richer typed editors/pickers, full buildingSMART ifcXML mapping, full IDS/MVD result mapping, and true large-model streaming/chunked geometry.
