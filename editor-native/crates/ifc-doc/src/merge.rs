//! Copy objects from one document into another (or merge whole models).
//!
//! Shared context entities (project, owner history, representation contexts)
//! are mapped onto the target's own; spatial elements are matched by class and
//! name (storeys also by elevation), unmatched ones are copied. Everything
//! reachable from the copied objects (placements, geometry, styles, property
//! sets, types, materials, relationships) is copied with new ids.

use crate::document::{tflags, Document};
use crate::guid::new_guid;
use crate::{model, ops, Value};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Default, Clone)]
pub struct MergeReport {
    pub entities: usize,
    pub products: usize,
    pub spatial_matched: usize,
    pub spatial_created: usize,
    pub new_guids: usize,
    pub skipped_rels: usize,
    /// Objects already present in the target (same GlobalId), not copied.
    pub same_guid: usize,
}

impl MergeReport {
    pub fn summary(&self) -> String {
        format!(
            "{} Objekte übernommen ({} Entities), {} Raumstruktur-Elemente zugeordnet, {} neu angelegt{}",
            self.products,
            self.entities,
            self.spatial_matched,
            self.spatial_created,
            if self.new_guids > 0 { format!(", {} GlobalIds neu vergeben", self.new_guids) } else { String::new() },
        ) + &if self.same_guid > 0 { format!(", {} bereits vorhandene Objekte (gleiche GlobalId) übersprungen", self.same_guid) } else { String::new() }
    }
}

fn name(doc: &Document, id: u32) -> String {
    doc.name_of(id).unwrap_or_default().trim().to_lowercase()
}

/// Elevation attribute of a storey (file units), if set.
fn elevation(doc: &Document, id: u32) -> Option<f64> {
    doc.attr(id, "Elevation").and_then(|v| v.as_f64())
}

fn remap(v: &Value, map: &FxHashMap<u32, u32>, keep: &dyn Fn(u32) -> bool) -> Value {
    match v {
        Value::Ref(r) => match map.get(r) {
            Some(n) => Value::Ref(*n),
            None => Value::Null,
        },
        Value::List(l) => Value::List(
            l.iter()
                .filter(|x| match x {
                    Value::Ref(r) => map.contains_key(r) && keep(*r),
                    _ => true,
                })
                .map(|x| remap(x, map, keep))
                .collect(),
        ),
        Value::Typed(t, inner) => Value::Typed(t.clone(), Box::new(remap(inner, map, keep))),
        other => other.clone(),
    }
}

/// Copy `products` (None = the whole model) from `src` into `dst`.
pub fn merge_from(dst: &mut Document, src: &Document, products: Option<&[u32]>) -> anyhow::Result<MergeReport> {
    let (us, ud) = (model::length_unit(src).0, model::length_unit(dst).0);
    if ((us - ud) / ud).abs() > 1e-9 {
        anyhow::bail!("Unterschiedliche Längeneinheiten ({} vs. {}) – Übernahme nicht möglich", model::length_unit(src).1, model::length_unit(dst).1);
    }
    let mut report = MergeReport::default();
    // ------------------------------------------------------------ fixed mappings
    let mut map: FxHashMap<u32, u32> = FxHashMap::default();
    let mut existing: FxHashSet<u32> = FxHashSet::default();
    let dst_project = model::project(dst).ok_or_else(|| anyhow::anyhow!("Zielmodell ohne IfcProject"))?;
    for p in src.ids_of_kind("IFCPROJECT") {
        map.insert(p, dst_project);
        existing.insert(p);
    }
    let oh = ops::owner_history(dst).as_ref_id();
    for h in src.ids_of_type("IFCOWNERHISTORY") {
        if let Some(oh) = oh {
            map.insert(h, oh);
            existing.insert(h);
        }
    }
    let dst_ctx = dst.ids_of_type("IFCGEOMETRICREPRESENTATIONCONTEXT");
    let dst_sub = dst.ids_of_type("IFCGEOMETRICREPRESENTATIONSUBCONTEXT");
    let body = ops::body_context(dst);
    for c in src.ids_of_type("IFCGEOMETRICREPRESENTATIONCONTEXT") {
        let ty = src.arg(c, 1).and_then(|v| v.as_str().map(|s| s.to_lowercase()));
        let t = dst_ctx.iter().copied().find(|&d| dst.arg(d, 1).and_then(|v| v.as_str().map(|s| s.to_lowercase())) == ty).or(dst_ctx.first().copied()).unwrap_or(body);
        map.insert(c, t);
        existing.insert(c);
    }
    for c in src.ids_of_type("IFCGEOMETRICREPRESENTATIONSUBCONTEXT") {
        let ident = src.arg(c, 0).and_then(|v| v.as_str().map(|s| s.to_lowercase()));
        let t = dst_sub.iter().copied().find(|&d| dst.arg(d, 0).and_then(|v| v.as_str().map(|s| s.to_lowercase())) == ident).unwrap_or(body);
        map.insert(c, t);
        existing.insert(c);
    }
    // spatial elements: class + name, storeys also by elevation
    let dst_spatial: Vec<u32> = dst.ids_with_flag(tflags::SPATIAL);
    let src_tree = model::SpatialTree::build(src);
    for s in src.ids_with_flag(tflags::SPATIAL) {
        if src.has_flag(s, tflags::PROJECT) {
            continue;
        }
        let ty = src.type_name(s).unwrap_or("");
        let n = name(src, s);
        let mut hit = dst_spatial.iter().copied().find(|&d| dst.type_name(d) == Some(ty) && name(dst, d) == n && !n.is_empty());
        if hit.is_none() && ty == "IFCBUILDINGSTOREY" {
            if let Some(e) = elevation(src, s) {
                hit = dst_spatial.iter().copied().find(|&d| dst.type_name(d) == Some(ty) && elevation(dst, d).map(|x| (x - e).abs() < 0.01 / ud.max(1e-9)).unwrap_or(false));
            }
        }
        if hit.is_none() && matches!(ty, "IFCSITE" | "IFCBUILDING") {
            // single site/building on both sides → same
            let a: Vec<u32> = src.ids_of_type(ty);
            let b: Vec<u32> = dst_spatial.iter().copied().filter(|&d| dst.type_name(d) == Some(ty)).collect();
            if a.len() == 1 && b.len() == 1 {
                hit = Some(b[0]);
            }
        }
        if let Some(d) = hit {
            map.insert(s, d);
            existing.insert(s);
            report.spatial_matched += 1;
        }
    }
    // whole model: objects with a GlobalId already present in the target are the same objects
    let dst_guids = model::guid_index(dst);
    if products.is_none() {
        for id in src.ids_with_flag(tflags::ROOT) {
            if existing.contains(&id) {
                continue;
            }
            if let Some(&d) = src.guid_of(id).and_then(|g| dst_guids.get(&g)) {
                if dst.type_name(d) == src.type_name(id) {
                    map.insert(id, d);
                    existing.insert(id);
                    report.same_guid += 1;
                }
            }
        }
    }
    // ------------------------------------------------------------ roots
    let selected: FxHashSet<u32> = match products {
        Some(p) => {
            let mut set = FxHashSet::default();
            for &id in p {
                for x in src_tree.subtree(id) {
                    set.insert(x);
                }
                // unmatched spatial parents are copied as well
                for a in src_tree.path_to(id) {
                    if src.has_flag(a, tflags::SPATIAL) && !existing.contains(&a) && !src.has_flag(a, tflags::PROJECT) {
                        set.insert(a);
                    }
                }
            }
            set
        }
        None => src.ids_with_flag(tflags::PRODUCT).into_iter().chain(src.ids_with_flag(tflags::GROUP)).filter(|x| !existing.contains(x)).collect(),
    };
    // openings/fillings of selected elements
    let mut selected = selected;
    for id in selected.clone() {
        for rel in src.referencing_with_type(id, "IFCRELVOIDSELEMENT") {
            if let Some(o) = src.arg(rel, 5).and_then(|v| v.as_ref_id()) {
                selected.insert(o);
                for f in src.referencing_with_type(o, "IFCRELFILLSELEMENT") {
                    if let Some(e) = src.arg(f, 5).and_then(|v| v.as_ref_id()) {
                        selected.insert(e);
                    }
                }
            }
        }
    }
    let mut roots: Vec<u32> = selected.iter().copied().collect();
    for &id in &selected {
        for rel in src.referencing(id) {
            if src.has_flag(rel, tflags::REL) {
                roots.push(rel);
            }
        }
    }
    if products.is_none() {
        // whole model: all remaining rooted definitions (types, psets on types, groups, …)
        for id in src.ids_with_flag(tflags::ROOT) {
            if !existing.contains(&id) && !src.has_flag(id, tflags::PRODUCT) {
                roots.push(id);
            }
        }
    }
    // ------------------------------------------------------------ closure (stops at mapped entities and foreign products)
    let foreign = |id: u32| src.has_flag(id, tflags::PRODUCT) && !selected.contains(&id);
    let mut take: FxHashSet<u32> = FxHashSet::default();
    let mut stack: Vec<u32> = roots;
    while let Some(id) = stack.pop() {
        if existing.contains(&id) || !take.insert(id) {
            continue;
        }
        for r in src.references(id) {
            if !existing.contains(&r) && !take.contains(&r) && src.exists(r) && !foreign(r) {
                stack.push(r);
            }
        }
    }
    // presentation of copied geometry/materials
    let mut extra: Vec<u32> = Vec::new();
    for si in src.ids_of_type("IFCSTYLEDITEM") {
        if src.arg(si, 0).and_then(|v| v.as_ref_id()).map(|i| take.contains(&i)).unwrap_or(false) {
            extra.push(si);
        }
    }
    for t in ["IFCMATERIALDEFINITIONREPRESENTATION", "IFCMATERIALPROPERTIES", "IFCEXTENDEDMATERIALPROPERTIES"] {
        for e in src.ids_of_type(t) {
            if src.references(e).iter().any(|r| take.contains(r) && src.has_flag(*r, tflags::MATERIAL)) {
                extra.push(e);
            }
        }
    }
    let mut stack = extra;
    while let Some(id) = stack.pop() {
        if existing.contains(&id) || !take.insert(id) {
            continue;
        }
        for r in src.references(id) {
            if !existing.contains(&r) && !take.contains(&r) && src.exists(r) && !foreign(r) {
                stack.push(r);
            }
        }
    }
    // ------------------------------------------------------------ relationships: drop redundant ones
    let mut ids: Vec<u32> = take.iter().copied().collect();
    ids.sort_unstable();
    let mut skip: FxHashSet<u32> = FxHashSet::default();
    for &id in &ids {
        if !src.has_flag(id, tflags::REL) {
            continue;
        }
        let refs = src.references(id);
        let objs: Vec<u32> = refs.iter().copied().filter(|r| src.has_flag(*r, tflags::ROOT) && !src.has_flag(*r, tflags::REL)).collect();
        let any_new = objs.iter().any(|r| take.contains(r));
        // lists of a relationship only keep copied objects (matched ones already have
        // their own relationships in the target); a list without copied entries kills the rel
        let empty_list = src.args(id).unwrap_or_default().iter().any(|v| match v {
            Value::List(l) => {
                let r: Vec<u32> = l.iter().filter_map(|x| x.as_ref_id()).collect();
                !r.is_empty() && !r.iter().any(|x| take.contains(x))
            }
            _ => false,
        });
        if !any_new || empty_list {
            skip.insert(id);
        }
    }
    report.skipped_rels = skip.len();
    ids.retain(|id| !skip.contains(id));
    // ------------------------------------------------------------ new ids
    let mut next = dst.next_id();
    for &id in &ids {
        map.insert(id, next);
        next += 1;
    }
    let guids = dst_guids;
    let is_new = |r: u32| take.contains(&r) && !skip.contains(&r);
    let keep = |r: u32| existing.contains(&r) || is_new(r);
    for &id in &ids {
        let ty = src.type_name(id).unwrap_or("").to_string();
        let is_rel = src.has_flag(id, tflags::REL);
        let mut args: Vec<Value> = src.args(id).unwrap_or_default().iter().map(|v| if is_rel { remap(v, &map, &is_new) } else { remap(v, &map, &keep) }).collect();
        if src.has_flag(id, tflags::ROOT) {
            if let Some(Value::Str(g)) = args.first() {
                if guids.contains_key(g) {
                    args[0] = Value::Str(new_guid());
                    report.new_guids += 1;
                }
            }
        }
        let text = crate::step::args_to_step(&args);
        let got = dst.create_raw(&ty, &text)?;
        debug_assert_eq!(got, map[&id]);
        if src.has_flag(id, tflags::PRODUCT) && !src.has_flag(id, tflags::SPATIAL) {
            report.products += 1;
        }
        if src.has_flag(id, tflags::SPATIAL) {
            report.spatial_created += 1;
        }
    }
    report.entities = ids.len();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SchemaId;

    fn with_wall(doc: &mut Document, storey_name: &str, wall: &str) -> u32 {
        let st = doc.ids_of_type("IFCBUILDINGSTOREY").into_iter().find(|&s| doc.name_of(s).as_deref() == Some(storey_name)).unwrap();
        let spec = ops::NewElement { class_upper: "IFCWALL".into(), name: wall.into(), container: Some(st), location: [0.0, 0.0, 0.0], rotation_deg: 0.0, shape: Some(ops::BodyShape::Box { x: 5.0, y: 0.2, z: 3.0, centered: false }), predefined_type: None };
        let id = ops::create_element(doc, &spec).unwrap();
        ops::set_property(doc, id, "Pset_WallCommon", "IsExternal", Value::Typed("IFCBOOLEAN".into(), Box::new(Value::Enum("T".into()))), false).unwrap();
        id
    }

    #[test]
    fn merge_models() {
        let mut a = ops::new_project(SchemaId::Ifc4, "A", &[("EG".into(), 0.0), ("OG".into(), 3.0)]);
        let mut b = ops::new_project(SchemaId::Ifc4, "B", &[("EG".into(), 0.0), ("DG".into(), 6.0)]);
        with_wall(&mut a, "EG", "Wand A");
        let wb = with_wall(&mut b, "EG", "Wand B");
        with_wall(&mut b, "DG", "Wand Dach");
        let before = a.ids_of_type("IFCBUILDINGSTOREY").len();
        let r = merge_from(&mut a, &b, None).unwrap();
        assert_eq!(r.products, 2, "{r:?}");
        // EG matched, DG created
        assert_eq!(a.ids_of_type("IFCBUILDINGSTOREY").len(), before + 1);
        assert_eq!(a.ids_of_kind("IFCPROJECT").len(), 1);
        let tree = model::SpatialTree::build(&a);
        let walls = a.ids_of_type("IFCWALL");
        assert_eq!(walls.len(), 3);
        let eg = a.ids_of_type("IFCBUILDINGSTOREY").into_iter().find(|&s| a.name_of(s).as_deref() == Some("EG")).unwrap();
        let in_eg: Vec<u32> = tree.subtree(eg).into_iter().filter(|x| a.type_name(*x) == Some("IFCWALL")).collect();
        assert_eq!(in_eg.len(), 2);
        for w in walls {
            assert_eq!(model::psets_of(&a, w).len(), 1);
        }
        // the matched storey keeps exactly one parent
        let parents = a.referencing_with_type(eg, "IFCRELAGGREGATES").into_iter().filter(|&r| a.arg(r, 5).map(|v| v.ref_list().contains(&eg)).unwrap_or(false)).count();
        assert_eq!(parents, 1);
        // partial copy: only the selected wall, again (GUIDs clash → new ones)
        let r2 = merge_from(&mut a, &b, Some(&[wb])).unwrap();
        assert_eq!(r2.products, 1);
        assert_eq!(r2.new_guids >= 1, true);
        assert_eq!(a.ids_of_type("IFCWALL").len(), 4);
        // text roundtrip stays parseable
        let bytes = a.to_bytes();
        let re = Document::from_bytes(bytes, &|_, _| {}).unwrap();
        assert_eq!(re.ids_of_type("IFCWALL").len(), 4);
    }
}
