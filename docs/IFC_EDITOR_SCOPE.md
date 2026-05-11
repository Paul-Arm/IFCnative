# IFCnative full IFC editor scope

Goal: evolve IFCnative from an IFC viewer/builder into a staged, inspectable full IFC editor. Every write should create a draft first, show an entity-aware diff/review, and only update/export after explicit Apply.

## Core editing model

- Parse, index, validate, diff, apply, discard, export IFC/STEP text.
- Preserve header/schema and stable STEP ids where possible.
- Maintain live indexes after every draft: entities, references, graph, properties, resources, units, geometry.
- Support batch operations and undo/redo on top of the current draft/apply workflow.
- Surface validation warnings before export: missing placements, invalid references, orphan resources, schema mismatches.

## Important IFC concepts to cover

- Spatial hierarchy: `IfcProject`, `IfcSite`, `IfcBuilding`, `IfcBuildingStorey`, `IfcSpace`, `IfcFacility`.
- Products/elements: built elements, walls, slabs, beams, columns, doors, windows, coverings, members, plates, furniture, distribution elements, proxies.
- Geometry: local/object placement, representation contexts, product definition shapes, shape representations, swept solids, profiles, mapped items, bounding boxes, tessellations.
- Relationships: aggregation, containment, nesting, property definitions, type definitions, materials, classifications, documents, groups, systems, processes, controls, element connections, void/fill, sequence.
- Resources: materials, material layers/profiles/constituents, classifications, document references, library references, constraints, approvals, actors/organizations.
- Properties and quantities: property sets, single/enumerated/list/table values, quantities, units, SI/conversion/derived units, templates.
- Types and reuse: product types, representation maps, common type assignment workflows.

## Editing operations

- Entity CRUD: create, rename, retarget type, edit raw args, delete with reference review.
- Relationship workflows: connect/disconnect nodes, move between spatial containers, assign/unassign resource, replace target/source, bulk relationship edits.
- Geometry workflows: create simple bodies, move/rotate/scale placements, edit dimensions/profile, assign body to existing product, copy geometry between products.
- Property workflows: add/edit/remove psets and qtos, change value type, bulk apply psets, import/export property templates.
- Resource workflows: assign materials/classifications/documents/libraries/constraints/approvals and review all reverse references.
- Review workflows: entity-aware diffs grouped by STEP id, impacted-reference list, validation summary, export only after Apply.

## Near-term milestones

1. Add simple rectangular body creation presets with dimensions/placement and spatial containment.
2. Add viewer transform controls that stage placement moves instead of immediate writes.
3. Improve graph filtering/expansion with relationship-type filters and persisted pins/layouts.
4. Replace text-only diff hunking with entity-aware grouped diffs.
5. Add deletion and move workflows with reference impact checks.

