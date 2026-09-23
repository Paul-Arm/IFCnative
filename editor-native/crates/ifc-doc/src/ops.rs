//! Editing operations. All functions write through [`Document`] so they are
//! recorded in the current transaction (call `doc.begin(..)`/`doc.commit()`
//! around them to group them into one undo step).

use crate::document::{tflags, Document};
use crate::guid::new_guid;
use crate::model;
use crate::step::Value;
use rustc_hash::FxHashSet;

fn s(v: &str) -> Value {
    Value::Str(v.to_string())
}
fn r(id: u32) -> Value {
    Value::Ref(id)
}
fn refs(ids: &[u32]) -> Value {
    Value::List(ids.iter().map(|&i| Value::Ref(i)).collect())
}

/// Owner history for new rooted entities (created for IFC2X3 where it is mandatory).
pub fn owner_history(doc: &mut Document) -> Value {
    if let Some(oh) = model::owner_history(doc) {
        return r(oh);
    }
    if doc.schema_id != crate::SchemaId::Ifc2x3 {
        return Value::Null;
    }
    let person = doc.create("IFCPERSON", &[Value::Null, s("IFCnative"), Value::Null, Value::Null, Value::Null, Value::Null, Value::Null, Value::Null]);
    let org = doc.create("IFCORGANIZATION", &[Value::Null, s("IFCnative"), Value::Null, Value::Null, Value::Null]);
    let po = doc.create("IFCPERSONANDORGANIZATION", &[r(person), r(org), Value::Null]);
    let app = doc.create("IFCAPPLICATION", &[r(org), s(env!("CARGO_PKG_VERSION")), s("IFCnative"), s("IFCnative")]);
    let now = chrono::Utc::now().timestamp();
    r(doc.create("IFCOWNERHISTORY", &[r(po), r(app), Value::Null, Value::Enum("ADDED".into()), Value::Null, Value::Null, Value::Null, Value::Int(now)]))
}

// ------------------------------------------------------------------ properties

/// Guess a typed IFC value for a user entered text.
pub fn typed_value_from_text(text: &str, hint: Option<&Value>) -> Value {
    let t = text.trim();
    if let Some(Value::Typed(ty, inner)) = hint {
        let v = match inner.as_ref() {
            Value::Real(_) => t.replace(',', ".").parse::<f64>().map(Value::Real).unwrap_or_else(|_| Value::Str(t.to_string())),
            Value::Int(_) => t.parse::<i64>().map(Value::Int).unwrap_or_else(|_| Value::Str(t.to_string())),
            Value::Enum(_) => Value::Enum(bool_enum(t).unwrap_or_else(|| t.to_ascii_uppercase())),
            _ => Value::Str(t.to_string()),
        };
        return Value::Typed(ty.clone(), Box::new(v));
    }
    if let Some(b) = bool_enum(t) {
        return Value::Typed("IFCBOOLEAN".into(), Box::new(Value::Enum(b)));
    }
    if let Ok(i) = t.parse::<i64>() {
        return Value::Typed("IFCINTEGER".into(), Box::new(Value::Int(i)));
    }
    if let Ok(f) = t.replace(',', ".").parse::<f64>() {
        if !t.is_empty() {
            return Value::Typed("IFCREAL".into(), Box::new(Value::Real(f)));
        }
    }
    Value::Typed("IFCLABEL".into(), Box::new(Value::Str(t.to_string())))
}

/// Build a typed value for an explicit IFC measure/defined type.
pub fn typed_value(type_upper: &str, text: &str, doc: &Document) -> Value {
    let prim = doc.schema().primitive_of(type_upper).unwrap_or("string").to_string();
    let t = text.trim();
    let inner = match prim.as_str() {
        "number" => {
            if type_upper.contains("INTEGER") || type_upper == "IFCCOUNTMEASURE" && !t.contains(['.', ',']) {
                t.parse::<i64>().map(Value::Int).unwrap_or(Value::Int(0))
            } else {
                Value::Real(t.replace(',', ".").parse::<f64>().unwrap_or(0.0))
            }
        }
        "boolean" | "logical" => Value::Enum(bool_enum(t).unwrap_or_else(|| "U".into())),
        _ => Value::Str(t.to_string()),
    };
    Value::Typed(type_upper.to_string(), Box::new(inner))
}

fn bool_enum(t: &str) -> Option<String> {
    match t.to_ascii_lowercase().as_str() {
        "true" | "wahr" | "ja" | "yes" | ".t." | "t" => Some("T".into()),
        "false" | "falsch" | "nein" | "no" | ".f." | "f" => Some("F".into()),
        "unknown" | "unbekannt" | ".u." => Some("U".into()),
        _ => None,
    }
}

/// Find an occurrence pset by name: (pset id, rel id, number of related objects).
pub fn find_pset(doc: &Document, element: u32, name: &str) -> Option<(u32, u32, usize)> {
    for rel in doc.referencing_with_type(element, "IFCRELDEFINESBYPROPERTIES") {
        let a = doc.args(rel)?;
        let related = a.get(4).map(|v| v.ref_list()).unwrap_or_default();
        if !related.contains(&element) {
            continue;
        }
        for ps in a.get(5).map(|v| v.ref_list()).unwrap_or_default() {
            if doc.arg(ps, 2).and_then(|v| v.as_str().map(|x| x.to_string())).as_deref() == Some(name) {
                return Some((ps, rel, related.len()));
            }
        }
    }
    None
}

/// Create a property set (or quantity set) attached to the given objects.
pub fn create_pset(doc: &mut Document, objects: &[u32], name: &str, quantity: bool) -> u32 {
    let oh = owner_history(doc);
    let ps = if quantity {
        doc.create("IFCELEMENTQUANTITY", &[s(&new_guid()), oh.clone(), s(name), Value::Null, Value::Null, Value::List(vec![])])
    } else {
        doc.create("IFCPROPERTYSET", &[s(&new_guid()), oh.clone(), s(name), Value::Null, Value::List(vec![])])
    };
    doc.create("IFCRELDEFINESBYPROPERTIES", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(objects), r(ps)]);
    ps
}

/// Detach `element` from a shared pset by giving it its own copy. Returns the new pset id.
pub fn unshare_pset(doc: &mut Document, element: u32, pset: u32, rel: u32) -> anyhow::Result<u32> {
    let mut ra = doc.args(rel).ok_or_else(|| anyhow::anyhow!("Beziehung fehlt"))?;
    let related: Vec<u32> = ra[4].ref_list().into_iter().filter(|&x| x != element).collect();
    ra[4] = refs(&related);
    doc.set_args(rel, &ra)?;
    let copy = deep_copy_pset(doc, pset)?;
    let oh = owner_history(doc);
    doc.create("IFCRELDEFINESBYPROPERTIES", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(&[element]), r(copy)]);
    Ok(copy)
}

pub fn deep_copy_pset(doc: &mut Document, pset: u32) -> anyhow::Result<u32> {
    let ty = doc.type_name(pset).ok_or_else(|| anyhow::anyhow!("Pset fehlt"))?.to_string();
    let mut a = doc.args(pset).unwrap_or_default();
    let li = if ty == "IFCELEMENTQUANTITY" { 5 } else { 4 };
    let mut new_props = Vec::new();
    for p in a.get(li).map(|v| v.ref_list()).unwrap_or_default() {
        let pt = doc.type_name(p).unwrap_or("").to_string();
        let pa = doc.args(p).unwrap_or_default();
        new_props.push(Value::Ref(doc.create(&pt, &pa)));
    }
    a[0] = s(&new_guid());
    if li < a.len() {
        a[li] = Value::List(new_props);
    }
    Ok(doc.create(&ty, &a))
}

/// Set (create or update) a single value property on an element.
/// If the pset is shared with other elements and `split_shared` is true, the element gets its own copy.
pub fn set_property(doc: &mut Document, element: u32, pset_name: &str, prop: &str, value: Value, split_shared: bool) -> anyhow::Result<()> {
    let pset = match find_pset(doc, element, pset_name) {
        Some((ps, rel, n)) if n > 1 && split_shared => unshare_pset(doc, element, ps, rel)?,
        Some((ps, _, _)) => ps,
        None => create_pset(doc, &[element], pset_name, false),
    };
    set_property_in_pset(doc, pset, prop, value)
}

/// Set a property inside a known pset.
pub fn set_property_in_pset(doc: &mut Document, pset: u32, prop: &str, value: Value) -> anyhow::Result<()> {
    let mut a = doc.args(pset).ok_or_else(|| anyhow::anyhow!("Pset #{pset} fehlt"))?;
    let props = a.get(4).map(|v| v.ref_list()).unwrap_or_default();
    for p in &props {
        if doc.arg(*p, 0).and_then(|v| v.as_str().map(|x| x.to_string())).as_deref() == Some(prop) {
            match doc.type_name(*p) {
                Some("IFCPROPERTYSINGLEVALUE") => return doc.set_arg(*p, 2, value),
                Some("IFCPROPERTYENUMERATEDVALUE") => return doc.set_arg(*p, 2, Value::List(vec![value])),
                _ => {
                    // replace other property kinds by a single value
                    let unit = Value::Null;
                    doc.set_raw(*p, Some("IFCPROPERTYSINGLEVALUE"), &crate::step::args_to_step(&[s(prop), Value::Null, value, unit]))?;
                    return Ok(());
                }
            }
        }
    }
    let np = doc.create("IFCPROPERTYSINGLEVALUE", &[s(prop), Value::Null, value, Value::Null]);
    let mut list: Vec<Value> = props.into_iter().map(Value::Ref).collect();
    list.push(Value::Ref(np));
    while a.len() < 5 {
        a.push(Value::Null);
    }
    a[4] = Value::List(list);
    doc.set_args(pset, &a)
}

pub fn rename_property(doc: &mut Document, prop: u32, new_name: &str) -> anyhow::Result<()> {
    doc.set_arg(prop, 0, s(new_name))
}

/// Remove a property/quantity from a set; deletes it if nothing else references it.
pub fn remove_property(doc: &mut Document, pset: u32, prop: u32) -> anyhow::Result<()> {
    let ty = doc.type_name(pset).unwrap_or("").to_string();
    let li = if ty == "IFCELEMENTQUANTITY" { 5 } else { 4 };
    let mut a = doc.args(pset).ok_or_else(|| anyhow::anyhow!("Pset fehlt"))?;
    let list: Vec<Value> = a.get(li).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter(|&p| p != prop).map(Value::Ref).collect();
    a[li] = Value::List(list);
    doc.set_args(pset, &a)?;
    if doc.referencing(prop).is_empty() {
        doc.delete(prop);
    }
    Ok(())
}

pub fn rename_pset(doc: &mut Document, pset: u32, name: &str) -> anyhow::Result<()> {
    doc.set_arg(pset, 2, s(name))
}

/// Delete a pset with its properties and relationships.
pub fn delete_pset(doc: &mut Document, pset: u32) -> anyhow::Result<()> {
    let ty = doc.type_name(pset).unwrap_or("").to_string();
    let li = if ty == "IFCELEMENTQUANTITY" { 5 } else { 4 };
    let props = doc.arg(pset, li).map(|v| v.ref_list()).unwrap_or_default();
    delete_entities(doc, &[pset], true)?;
    for p in props {
        if doc.exists(p) && doc.referencing(p).is_empty() {
            doc.delete(p);
        }
    }
    Ok(())
}

/// Set a quantity value (creates IfcElementQuantity / quantity as needed).
pub fn set_quantity(doc: &mut Document, element: u32, qto_name: &str, qname: &str, kind: &str, value: f64) -> anyhow::Result<()> {
    let qset = match find_pset(doc, element, qto_name) {
        Some((q, _, _)) if doc.type_name(q) == Some("IFCELEMENTQUANTITY") => q,
        _ => create_pset(doc, &[element], qto_name, true),
    };
    let mut a = doc.args(qset).unwrap_or_default();
    let list = a.get(5).map(|v| v.ref_list()).unwrap_or_default();
    let qtype = format!("IFCQUANTITY{}", kind.to_ascii_uppercase());
    let vname = match kind.to_ascii_uppercase().as_str() {
        "LENGTH" => "LengthValue",
        "AREA" => "AreaValue",
        "VOLUME" => "VolumeValue",
        "COUNT" => "CountValue",
        "WEIGHT" => "WeightValue",
        "TIME" => "TimeValue",
        _ => "LengthValue",
    };
    for q in &list {
        if doc.arg(*q, 0).and_then(|v| v.as_str().map(|x| x.to_string())).as_deref() == Some(qname) {
            let qt = doc.type_name(*q).unwrap_or("").to_string();
            let vi = doc.schema().attr_index(&qt, vname).or_else(|| doc.schema().attr_index(&qt, "LengthValue")).unwrap_or(3);
            return doc.set_arg(*q, vi, Value::Real(value));
        }
    }
    let n = doc.schema().attr_names(&qtype).len().max(4);
    let mut qa = vec![Value::Null; n];
    qa[0] = s(qname);
    qa[3] = if kind.eq_ignore_ascii_case("COUNT") { Value::Real(value.round()) } else { Value::Real(value) };
    let q = doc.create(&qtype, &qa);
    let mut l: Vec<Value> = list.into_iter().map(Value::Ref).collect();
    l.push(Value::Ref(q));
    while a.len() < 6 {
        a.push(Value::Null);
    }
    a[5] = Value::List(l);
    doc.set_args(qset, &a)
}

// ------------------------------------------------------------------ deletion

/// Delete entities and clean up all references to them:
/// list members are removed, optional single references set to `$`,
/// relationships that lose a mandatory end are deleted as well.
/// With `purge`, dependents that become unreferenced are removed too.
pub fn delete_entities(doc: &mut Document, ids: &[u32], purge: bool) -> anyhow::Result<usize> {
    let mut to_delete: Vec<u32> = ids.iter().copied().filter(|&i| doc.exists(i)).collect();
    let mut deleted: FxHashSet<u32> = FxHashSet::default();
    let mut dependents: Vec<u32> = Vec::new();
    let schema = doc.schema();
    while let Some(id) = to_delete.pop() {
        if !deleted.insert(id) || !doc.exists(id) {
            continue;
        }
        if purge {
            dependents.extend(doc.references(id));
        }
        // openings of deleted elements go as well
        if doc.has_flag(id, tflags::ELEMENT) {
            for rel in doc.referencing_with_type(id, "IFCRELVOIDSELEMENT") {
                if doc.arg(rel, 4).and_then(|v| v.as_ref_id()) == Some(id) {
                    if let Some(o) = doc.arg(rel, 5).and_then(|v| v.as_ref_id()) {
                        to_delete.push(o);
                    }
                }
            }
        }
        let referencing = doc.referencing(id);
        doc.delete(id);
        for src in referencing {
            if deleted.contains(&src) || !doc.exists(src) {
                continue;
            }
            let Some(mut a) = doc.args(src) else { continue };
            let t = doc.type_name(src).unwrap_or("").to_string();
            let defs = schema.entity(&t).map(|e| e.attrs.clone()).unwrap_or_default();
            let mut kill = false;
            for (i, v) in a.iter_mut().enumerate() {
                let optional = defs.get(i).map(|d| d.optional).unwrap_or(true);
                match v {
                    Value::Ref(x) if *x == id => {
                        if optional {
                            *v = Value::Null;
                        } else {
                            kill = true;
                        }
                    }
                    Value::List(l) => {
                        let before = l.len();
                        l.retain(|x| x.as_ref_id() != Some(id));
                        remove_nested(l, id);
                        if l.is_empty() && before > 0 && !optional {
                            kill = true;
                        }
                    }
                    _ => {}
                }
            }
            if kill && (doc.has_flag(src, tflags::REL) || !doc.has_flag(src, tflags::ROOT)) {
                to_delete.push(src);
            } else {
                doc.set_args(src, &a)?;
            }
        }
    }
    if purge {
        let mut stack = dependents;
        let mut seen = FxHashSet::default();
        while let Some(d) = stack.pop() {
            if !seen.insert(d) || !doc.exists(d) {
                continue;
            }
            if doc.has_flag(d, tflags::ROOT) && !doc.has_flag(d, tflags::PSET) && !doc.has_flag(d, tflags::QSET) {
                continue;
            }
            if is_anchor(doc, d) {
                continue;
            }
            if doc.referencing(d).is_empty() {
                stack.extend(doc.references(d));
                doc.delete(d);
                deleted.insert(d);
            }
        }
    }
    Ok(deleted.len())
}

fn remove_nested(l: &mut [Value], id: u32) {
    for v in l.iter_mut() {
        if let Value::List(inner) = v {
            inner.retain(|x| x.as_ref_id() != Some(id));
            remove_nested(inner, id);
        }
    }
}

fn is_anchor(doc: &Document, id: u32) -> bool {
    matches!(
        doc.type_name(id).unwrap_or(""),
        "IFCOWNERHISTORY" | "IFCUNITASSIGNMENT" | "IFCGEOMETRICREPRESENTATIONCONTEXT" | "IFCGEOMETRICREPRESENTATIONSUBCONTEXT" | "IFCAPPLICATION" | "IFCPERSONANDORGANIZATION" | "IFCORGANIZATION" | "IFCPERSON"
    )
}

/// Remove resource entities that are not referenced by anything (iteratively).
pub fn purge_unused(doc: &mut Document) -> usize {
    let mut removed = 0;
    loop {
        let mut round = Vec::new();
        for id in doc.all_ids().collect::<Vec<_>>() {
            if doc.has_flag(id, tflags::ROOT) || is_anchor(doc, id) {
                continue;
            }
            let t = doc.type_name(id).unwrap_or("");
            if matches!(t, "IFCSTYLEDITEM" | "IFCPRESENTATIONLAYERASSIGNMENT" | "IFCPRESENTATIONLAYERWITHSTYLE" | "IFCMATERIALDEFINITIONREPRESENTATION" | "IFCEXTERNALREFERENCERELATIONSHIP" | "IFCMATERIALPROPERTIES" | "IFCRELASSOCIATESMATERIAL") {
                // anchors: keep while their targets exist
                continue;
            }
            if doc.referencing(id).is_empty() {
                round.push(id);
            }
        }
        if round.is_empty() {
            break;
        }
        for id in &round {
            doc.delete(*id);
        }
        removed += round.len();
        if removed > 50_000_000 {
            break;
        }
    }
    // styled items / layer assignments whose item vanished
    for t in ["IFCSTYLEDITEM"] {
        for id in doc.ids_of_type(t) {
            if doc.arg(id, 0).and_then(|v| v.as_ref_id()).map(|i| !doc.exists(i)).unwrap_or(false) {
                doc.delete(id);
                removed += 1;
            }
        }
    }
    removed
}

// ------------------------------------------------------------------ structure

/// Move elements into a spatial container (IfcRelContainedInSpatialStructure).
pub fn move_to_container(doc: &mut Document, elements: &[u32], container: u32) -> anyhow::Result<()> {
    for &e in elements {
        for rel in doc.referencing_with_type(e, "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
            let mut a = doc.args(rel).unwrap_or_default();
            let list: Vec<u32> = a.get(4).map(|v| v.ref_list()).unwrap_or_default();
            if !list.contains(&e) {
                continue;
            }
            let new: Vec<u32> = list.into_iter().filter(|&x| x != e).collect();
            if new.is_empty() {
                doc.delete(rel);
            } else {
                a[4] = refs(&new);
                doc.set_args(rel, &a)?;
            }
        }
    }
    // existing containment rel of target
    let existing = doc.referencing_with_type(container, "IFCRELCONTAINEDINSPATIALSTRUCTURE").into_iter().find(|&rel| doc.arg(rel, 5).and_then(|v| v.as_ref_id()) == Some(container));
    match existing {
        Some(rel) => {
            let mut a = doc.args(rel).unwrap_or_default();
            let mut list = a[4].ref_list();
            for &e in elements {
                if !list.contains(&e) {
                    list.push(e);
                }
            }
            a[4] = refs(&list);
            doc.set_args(rel, &a)?;
        }
        None => {
            let oh = owner_history(doc);
            doc.create("IFCRELCONTAINEDINSPATIALSTRUCTURE", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(elements), r(container)]);
        }
    }
    Ok(())
}

/// Aggregate `children` under `parent` (IfcRelAggregates), detaching previous aggregation.
pub fn aggregate(doc: &mut Document, parent: u32, children: &[u32]) -> anyhow::Result<()> {
    for &c in children {
        for rel in doc.referencing_with_type(c, "IFCRELAGGREGATES") {
            let mut a = doc.args(rel).unwrap_or_default();
            let list = a.get(5).map(|v| v.ref_list()).unwrap_or_default();
            if !list.contains(&c) {
                continue;
            }
            let new: Vec<u32> = list.into_iter().filter(|&x| x != c).collect();
            if new.is_empty() {
                doc.delete(rel);
            } else {
                a[5] = refs(&new);
                doc.set_args(rel, &a)?;
            }
        }
    }
    let existing = doc.referencing_with_type(parent, "IFCRELAGGREGATES").into_iter().find(|&rel| doc.arg(rel, 4).and_then(|v| v.as_ref_id()) == Some(parent));
    match existing {
        Some(rel) => {
            let mut a = doc.args(rel).unwrap_or_default();
            let mut list = a[5].ref_list();
            list.extend(children.iter().copied().filter(|c| !list.contains(c)).collect::<Vec<_>>());
            a[5] = refs(&list);
            doc.set_args(rel, &a)?;
        }
        None => {
            let oh = owner_history(doc);
            doc.create("IFCRELAGGREGATES", &[s(&new_guid()), oh, Value::Null, Value::Null, r(parent), refs(children)]);
        }
    }
    Ok(())
}

/// Create a spatial element (site/building/storey/space) aggregated under `parent`.
pub fn create_spatial(doc: &mut Document, class_upper: &str, name: &str, parent: u32, elevation: Option<f64>) -> anyhow::Result<u32> {
    let oh = owner_history(doc);
    let parent_pl = doc.arg(parent, 5).and_then(|v| v.as_ref_id());
    let pl = create_local_placement(doc, parent_pl, [0.0, 0.0, elevation.unwrap_or(0.0)], 0.0);
    let n = doc.schema().attr_names(class_upper).len();
    let mut a = vec![Value::Null; n.max(9)];
    a[0] = s(&new_guid());
    a[1] = oh;
    a[2] = s(name);
    a[5] = r(pl);
    let ci = doc.schema().attr_index(class_upper, "CompositionType");
    if let Some(ci) = ci {
        a[ci] = Value::Enum("ELEMENT".into());
    }
    if let (Some(ei), Some(e)) = (doc.schema().attr_index(class_upper, "Elevation"), elevation) {
        a[ei] = Value::Real(e);
    }
    a.truncate(n.max(1));
    let id = doc.create(class_upper, &a);
    aggregate(doc, parent, &[id])?;
    Ok(id)
}

pub fn create_local_placement(doc: &mut Document, rel_to: Option<u32>, loc: [f64; 3], rot_z_deg: f64) -> u32 {
    let p = doc.create("IFCCARTESIANPOINT", &[Value::List(loc.iter().map(|v| Value::Real(*v)).collect())]);
    let axis = if rot_z_deg.abs() > 1e-9 {
        let a = rot_z_deg.to_radians();
        let z = doc.create("IFCDIRECTION", &[Value::List(vec![Value::Real(0.0), Value::Real(0.0), Value::Real(1.0)])]);
        let x = doc.create("IFCDIRECTION", &[Value::List(vec![Value::Real(round(a.cos())), Value::Real(round(a.sin())), Value::Real(0.0)])]);
        doc.create("IFCAXIS2PLACEMENT3D", &[r(p), r(z), r(x)])
    } else {
        doc.create("IFCAXIS2PLACEMENT3D", &[r(p), Value::Null, Value::Null])
    };
    doc.create("IFCLOCALPLACEMENT", &[rel_to.map(r).unwrap_or(Value::Null), r(axis)])
}

fn round(v: f64) -> f64 {
    (v * 1e12).round() / 1e12
}

/// Body representation context (sub context "Body" or the 3D model context).
pub fn body_context(doc: &mut Document) -> u32 {
    for sc in doc.ids_of_type("IFCGEOMETRICREPRESENTATIONSUBCONTEXT") {
        if doc.arg(sc, 0).and_then(|v| v.as_str().map(|x| x.to_string())).map(|x| x.eq_ignore_ascii_case("Body")).unwrap_or(false) {
            return sc;
        }
    }
    for c in doc.ids_of_type("IFCGEOMETRICREPRESENTATIONCONTEXT") {
        if doc.arg(c, 1).and_then(|v| v.as_str().map(|x| x.to_string())).map(|x| x.eq_ignore_ascii_case("Model")).unwrap_or(true) {
            return c;
        }
    }
    let origin = doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(0.0), Value::Real(0.0), Value::Real(0.0)])]);
    let wcs = doc.create("IFCAXIS2PLACEMENT3D", &[r(origin), Value::Null, Value::Null]);
    let ctx = doc.create("IFCGEOMETRICREPRESENTATIONCONTEXT", &[Value::Null, s("Model"), Value::Int(3), Value::Real(1e-5), r(wcs), Value::Null]);
    if let Some(p) = model::project(doc) {
        let mut a = doc.args(p).unwrap_or_default();
        if let Some(i) = doc.schema().attr_index(doc.type_name(p).unwrap_or("IFCPROJECT"), "RepresentationContexts") {
            let mut l = a.get(i).map(|v| v.ref_list()).unwrap_or_default();
            l.push(ctx);
            a[i] = refs(&l);
            let _ = doc.set_args(p, &a);
        }
    }
    ctx
}

#[derive(Clone, Debug)]
pub enum BodyShape {
    /// Box: x length, y width, z height (file units), placed from the element origin.
    Box { x: f64, y: f64, z: f64, centered: bool },
    /// Cylinder: radius, height.
    Cylinder { r: f64, h: f64 },
    /// Arbitrary polygon extrusion (points in element XY, height).
    Polygon { pts: Vec<[f64; 2]>, h: f64 },
}

#[derive(Clone, Debug)]
pub struct NewElement {
    pub class_upper: String,
    pub name: String,
    pub container: Option<u32>,
    pub location: [f64; 3],
    pub rotation_deg: f64,
    pub shape: Option<BodyShape>,
    pub predefined_type: Option<String>,
}

/// Create a product with optional extruded body geometry and spatial containment.
pub fn create_element(doc: &mut Document, spec: &NewElement) -> anyhow::Result<u32> {
    let oh = owner_history(doc);
    let container_pl = spec.container.and_then(|c| doc.arg(c, 5)).and_then(|v| v.as_ref_id());
    let pl = create_local_placement(doc, container_pl, spec.location, spec.rotation_deg);
    let rep = match &spec.shape {
        Some(shape) => {
            let ctx = body_context(doc);
            let (profile, depth) = match shape {
                BodyShape::Box { x, y, z, centered } => {
                    let c = if *centered { [0.0, 0.0] } else { [x / 2.0, y / 2.0] };
                    let pp = doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(c[0]), Value::Real(c[1])])]);
                    let pos = doc.create("IFCAXIS2PLACEMENT2D", &[r(pp), Value::Null]);
                    (doc.create("IFCRECTANGLEPROFILEDEF", &[Value::Enum("AREA".into()), Value::Null, r(pos), Value::Real(*x), Value::Real(*y)]), *z)
                }
                BodyShape::Cylinder { r: rad, h } => {
                    let pp = doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(0.0), Value::Real(0.0)])]);
                    let pos = doc.create("IFCAXIS2PLACEMENT2D", &[r(pp), Value::Null]);
                    (doc.create("IFCCIRCLEPROFILEDEF", &[Value::Enum("AREA".into()), Value::Null, r(pos), Value::Real(*rad)]), *h)
                }
                BodyShape::Polygon { pts, h } => {
                    let mut ids: Vec<Value> = pts.iter().map(|p| Value::Ref(doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(p[0]), Value::Real(p[1])])]))).collect();
                    if let Some(first) = ids.first().cloned() {
                        ids.push(first);
                    }
                    let pl = doc.create("IFCPOLYLINE", &[Value::List(ids)]);
                    (doc.create("IFCARBITRARYCLOSEDPROFILEDEF", &[Value::Enum("AREA".into()), Value::Null, r(pl)]), *h)
                }
            };
            let o = doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(0.0), Value::Real(0.0), Value::Real(0.0)])]);
            let ax = doc.create("IFCAXIS2PLACEMENT3D", &[r(o), Value::Null, Value::Null]);
            let dir = doc.create("IFCDIRECTION", &[Value::List(vec![Value::Real(0.0), Value::Real(0.0), Value::Real(1.0)])]);
            let solid = doc.create("IFCEXTRUDEDAREASOLID", &[r(profile), r(ax), r(dir), Value::Real(depth)]);
            let sr = doc.create("IFCSHAPEREPRESENTATION", &[r(ctx), s("Body"), s("SweptSolid"), refs(&[solid])]);
            Value::Ref(doc.create("IFCPRODUCTDEFINITIONSHAPE", &[Value::Null, Value::Null, refs(&[sr])]))
        }
        None => Value::Null,
    };
    let names = doc.schema().attr_names(&spec.class_upper);
    let n = names.len().max(7);
    let mut a = vec![Value::Null; n];
    a[0] = s(&new_guid());
    a[1] = oh;
    a[2] = s(&spec.name);
    a[5] = r(pl);
    a[6] = rep;
    if let (Some(pt), Some(i)) = (&spec.predefined_type, doc.schema().attr_index(&spec.class_upper, "PredefinedType")) {
        a[i] = Value::Enum(pt.clone());
    }
    let id = doc.create(&spec.class_upper, &a);
    if let Some(c) = spec.container {
        move_to_container(doc, &[id], c)?;
    }
    Ok(id)
}

/// Duplicate products: new placement (offset), copied representation shell, copied psets, same container.
pub fn duplicate(doc: &mut Document, ids: &[u32], offset: [f64; 3]) -> anyhow::Result<Vec<u32>> {
    let mut out = Vec::new();
    let tree = model::SpatialTree::build(doc);
    for &id in ids {
        let Some(mut a) = doc.args(id) else { continue };
        let ty = doc.type_name(id).unwrap_or("").to_string();
        a[0] = s(&new_guid());
        // placement: copy with offset in the parent frame
        if let Some(pl) = a.get(5).and_then(|v| v.as_ref_id()) {
            let pa = doc.args(pl).unwrap_or_default();
            let rel_to = pa.first().and_then(|v| v.as_ref_id());
            let ax = pa.get(1).and_then(|v| v.as_ref_id());
            let (loc, axis, refd) = match ax.and_then(|x| doc.args(x)) {
                Some(xa) => (xa.first().and_then(|v| v.as_ref_id()), xa.get(1).cloned().unwrap_or(Value::Null), xa.get(2).cloned().unwrap_or(Value::Null)),
                None => (None, Value::Null, Value::Null),
            };
            let old = loc.and_then(|l| doc.arg(l, 0)).and_then(|v| v.as_list().map(|l| l.iter().filter_map(|x| x.as_f64()).collect::<Vec<_>>())).unwrap_or_else(|| vec![0.0, 0.0, 0.0]);
            let nl = [old.first().copied().unwrap_or(0.0) + offset[0], old.get(1).copied().unwrap_or(0.0) + offset[1], old.get(2).copied().unwrap_or(0.0) + offset[2]];
            let p = doc.create("IFCCARTESIANPOINT", &[Value::List(nl.iter().map(|v| Value::Real(*v)).collect())]);
            let nax = doc.create("IFCAXIS2PLACEMENT3D", &[r(p), axis, refd]);
            let npl = doc.create("IFCLOCALPLACEMENT", &[rel_to.map(r).unwrap_or(Value::Null), r(nax)]);
            a[5] = r(npl);
        }
        if let Some(pds) = a.get(6).and_then(|v| v.as_ref_id()) {
            let mut pa = doc.args(pds).unwrap_or_default();
            let reps: Vec<Value> = pa.get(2).map(|v| v.ref_list()).unwrap_or_default().into_iter().map(|rep| {
                let ra = doc.args(rep).unwrap_or_default();
                let rt = doc.type_name(rep).unwrap_or("IFCSHAPEREPRESENTATION").to_string();
                Value::Ref(doc.create(&rt, &ra))
            })
            .collect();
            if pa.len() > 2 {
                pa[2] = Value::List(reps);
            }
            a[6] = Value::Ref(doc.create("IFCPRODUCTDEFINITIONSHAPE", &pa));
        }
        let nid = doc.create(&ty, &a);
        // psets
        for ps in model::psets_of(doc, id) {
            if ps.from_type.is_some() {
                continue;
            }
            let copy = deep_copy_pset(doc, ps.id)?;
            let oh = owner_history(doc);
            doc.create("IFCRELDEFINESBYPROPERTIES", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(&[nid]), r(copy)]);
        }
        // type
        if let Some(t) = model::type_of(doc, id) {
            assign_type(doc, &[nid], t)?;
        }
        // materials
        for mv in model::materials_of(doc, id) {
            if doc.arg(mv.rel, 4).map(|v| v.ref_list().contains(&id)).unwrap_or(false) {
                let mut ra = doc.args(mv.rel).unwrap_or_default();
                let mut l = ra[4].ref_list();
                l.push(nid);
                ra[4] = refs(&l);
                doc.set_args(mv.rel, &ra)?;
            }
        }
        if let Some(c) = tree.container_of(doc, id) {
            move_to_container(doc, &[nid], c)?;
        }
        out.push(nid);
    }
    Ok(out)
}

// ------------------------------------------------------------------ associations

pub fn assign_type(doc: &mut Document, objects: &[u32], type_obj: u32) -> anyhow::Result<()> {
    // detach from previous types
    for &o in objects {
        for rel in doc.referencing_with_type(o, "IFCRELDEFINESBYTYPE") {
            let mut a = doc.args(rel).unwrap_or_default();
            let list = a[4].ref_list();
            if !list.contains(&o) {
                continue;
            }
            let new: Vec<u32> = list.into_iter().filter(|&x| x != o).collect();
            if new.is_empty() {
                doc.delete(rel);
            } else {
                a[4] = refs(&new);
                doc.set_args(rel, &a)?;
            }
        }
    }
    let existing = doc.referencing_with_type(type_obj, "IFCRELDEFINESBYTYPE").into_iter().find(|&rel| doc.arg(rel, 5).and_then(|v| v.as_ref_id()) == Some(type_obj));
    match existing {
        Some(rel) => {
            let mut a = doc.args(rel).unwrap_or_default();
            let mut l = a[4].ref_list();
            l.extend(objects.iter().copied().filter(|o| !l.contains(o)).collect::<Vec<_>>());
            a[4] = refs(&l);
            doc.set_args(rel, &a)?;
        }
        None => {
            let oh = owner_history(doc);
            doc.create("IFCRELDEFINESBYTYPE", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(objects), r(type_obj)]);
        }
    }
    Ok(())
}

pub fn create_material(doc: &mut Document, name: &str, category: Option<&str>) -> u32 {
    let n = doc.schema().attr_names("IFCMATERIAL").len();
    let mut a = vec![Value::Null; n.max(1)];
    a[0] = s(name);
    if let (Some(c), Some(i)) = (category, doc.schema().attr_index("IFCMATERIAL", "Category")) {
        a[i] = s(c);
    }
    doc.create("IFCMATERIAL", &a)
}

/// Associate a material definition with objects (replacing previous material associations).
pub fn assign_material(doc: &mut Document, objects: &[u32], material: u32) -> anyhow::Result<()> {
    for &o in objects {
        for rel in doc.referencing_with_type(o, "IFCRELASSOCIATESMATERIAL") {
            let mut a = doc.args(rel).unwrap_or_default();
            let list = a[4].ref_list();
            if !list.contains(&o) {
                continue;
            }
            let new: Vec<u32> = list.into_iter().filter(|&x| x != o).collect();
            if new.is_empty() {
                doc.delete(rel);
            } else {
                a[4] = refs(&new);
                doc.set_args(rel, &a)?;
            }
        }
    }
    let existing = doc.referencing_with_type(material, "IFCRELASSOCIATESMATERIAL").into_iter().find(|&rel| doc.arg(rel, 5).and_then(|v| v.as_ref_id()) == Some(material));
    match existing {
        Some(rel) => {
            let mut a = doc.args(rel).unwrap_or_default();
            let mut l = a[4].ref_list();
            l.extend(objects.iter().copied().filter(|o| !l.contains(o)).collect::<Vec<_>>());
            a[4] = refs(&l);
            doc.set_args(rel, &a)?;
        }
        None => {
            let oh = owner_history(doc);
            doc.create("IFCRELASSOCIATESMATERIAL", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(objects), r(material)]);
        }
    }
    Ok(())
}

/// Create a material layer set from (material name, thickness) pairs.
pub fn create_layer_set(doc: &mut Document, name: &str, layers: &[(String, f64)]) -> u32 {
    let mut ids = Vec::new();
    for (mname, t) in layers {
        let m = find_or_create_material(doc, mname);
        let n = doc.schema().attr_names("IFCMATERIALLAYER").len().max(3);
        let mut a = vec![Value::Null; n];
        a[0] = r(m);
        a[1] = Value::Real(*t);
        ids.push(doc.create("IFCMATERIALLAYER", &a));
    }
    let n = doc.schema().attr_names("IFCMATERIALLAYERSET").len().max(2);
    let mut a = vec![Value::Null; n];
    a[0] = refs(&ids);
    a[1] = s(name);
    doc.create("IFCMATERIALLAYERSET", &a)
}

pub fn find_or_create_material(doc: &mut Document, name: &str) -> u32 {
    for m in doc.ids_of_type("IFCMATERIAL") {
        if doc.arg(m, 0).and_then(|v| v.as_str().map(|x| x.to_string())).as_deref() == Some(name) {
            return m;
        }
    }
    create_material(doc, name, None)
}

/// Attach a classification reference (creates IfcClassification + reference as needed).
pub fn assign_classification(doc: &mut Document, objects: &[u32], system: &str, identification: &str, name: &str) -> anyhow::Result<u32> {
    let cls = doc
        .ids_of_type("IFCCLASSIFICATION")
        .into_iter()
        .find(|&c| {
            let i = doc.schema().attr_index("IFCCLASSIFICATION", "Name").unwrap_or(3);
            doc.arg(c, i).and_then(|v| v.as_str().map(|x| x.to_string())).as_deref() == Some(system)
        })
        .unwrap_or_else(|| {
            let n = doc.schema().attr_names("IFCCLASSIFICATION").len().max(4);
            let mut a = vec![Value::Null; n];
            let i = doc.schema().attr_index("IFCCLASSIFICATION", "Name").unwrap_or(3);
            a[i] = s(system);
            if doc.schema_id == crate::SchemaId::Ifc2x3 {
                a[0] = s("");
                a[1] = s("");
            }
            doc.create("IFCCLASSIFICATION", &a)
        });
    let n = doc.schema().attr_names("IFCCLASSIFICATIONREFERENCE").len().max(3);
    let mut a = vec![Value::Null; n];
    a[1] = s(identification);
    a[2] = s(name);
    if n > 3 {
        a[3] = r(cls);
    }
    let cref = doc.create("IFCCLASSIFICATIONREFERENCE", &a);
    let oh = owner_history(doc);
    doc.create("IFCRELASSOCIATESCLASSIFICATION", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(objects), r(cref)]);
    Ok(cref)
}

// ------------------------------------------------------------------ groups

pub fn create_group(doc: &mut Document, class_upper: &str, name: &str, members: &[u32]) -> anyhow::Result<u32> {
    let oh = owner_history(doc);
    let n = doc.schema().attr_names(class_upper).len().max(5);
    let mut a = vec![Value::Null; n];
    a[0] = s(&new_guid());
    a[1] = oh.clone();
    a[2] = s(name);
    if let Some(i) = doc.schema().attr_index(class_upper, "PredefinedType") {
        a[i] = Value::Enum("NOTDEFINED".into());
    }
    let g = doc.create(class_upper, &a);
    if !members.is_empty() {
        doc.create("IFCRELASSIGNSTOGROUP", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(members), Value::Null, r(g)]);
    }
    Ok(g)
}

pub fn add_to_group(doc: &mut Document, group: u32, members: &[u32]) -> anyhow::Result<()> {
    let existing = doc.referencing_with_type(group, "IFCRELASSIGNSTOGROUP").into_iter().find(|&rel| doc.arg(rel, 6).and_then(|v| v.as_ref_id()) == Some(group));
    match existing {
        Some(rel) => {
            let mut a = doc.args(rel).unwrap_or_default();
            let mut l = a[4].ref_list();
            l.extend(members.iter().copied().filter(|m| !l.contains(m)).collect::<Vec<_>>());
            a[4] = refs(&l);
            doc.set_args(rel, &a)
        }
        None => {
            let oh = owner_history(doc);
            doc.create("IFCRELASSIGNSTOGROUP", &[s(&new_guid()), oh, Value::Null, Value::Null, refs(members), Value::Null, r(group)]);
            Ok(())
        }
    }
}

pub fn remove_from_group(doc: &mut Document, group: u32, members: &[u32]) -> anyhow::Result<()> {
    for rel in doc.referencing_with_type(group, "IFCRELASSIGNSTOGROUP") {
        if doc.arg(rel, 6).and_then(|v| v.as_ref_id()) != Some(group) {
            continue;
        }
        let mut a = doc.args(rel).unwrap_or_default();
        let l: Vec<u32> = a[4].ref_list().into_iter().filter(|m| !members.contains(m)).collect();
        if l.is_empty() {
            doc.delete(rel);
        } else {
            a[4] = refs(&l);
            doc.set_args(rel, &a)?;
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ misc

/// Change the class of an entity, keeping as many positional attributes as fit.
pub fn change_class(doc: &mut Document, id: u32, new_class_upper: &str) -> anyhow::Result<()> {
    let mut a = doc.args(id).ok_or_else(|| anyhow::anyhow!("Entity fehlt"))?;
    let old = doc.type_name(id).unwrap_or("").to_string();
    let n = doc.schema().attr_names(new_class_upper).len();
    if n == 0 {
        anyhow::bail!("Unbekannte Klasse {new_class_upper}");
    }
    // PredefinedType values are class specific: reset
    if let Some(i) = doc.schema().attr_index(&old, "PredefinedType") {
        if i < a.len() {
            a[i] = Value::Null;
        }
    }
    a.resize(n, Value::Null);
    if let Some(i) = doc.schema().attr_index(new_class_upper, "PredefinedType") {
        if doc.schema().entity(new_class_upper).map(|e| !e.attrs[i].optional).unwrap_or(false) {
            a[i] = Value::Enum("NOTDEFINED".into());
        }
    }
    doc.set_raw(id, Some(new_class_upper), &crate::step::args_to_step(&a))
}

/// Regenerate GlobalIds that are invalid or duplicated. Returns the number of fixes.
pub fn fix_guids(doc: &mut Document) -> anyhow::Result<usize> {
    let mut seen = FxHashSet::default();
    let mut n = 0;
    for id in doc.ids_with_flag(tflags::ROOT) {
        let g = doc.guid_of(id).unwrap_or_default();
        if !crate::guid::is_valid(&g) || !seen.insert(g) {
            doc.set_arg(id, 0, s(&new_guid()))?;
            n += 1;
        }
    }
    Ok(n)
}

/// Collect the forward reference closure (all entities needed by `roots`).
pub fn closure(doc: &Document, roots: &[u32]) -> Vec<u32> {
    let mut seen = FxHashSet::default();
    let mut stack: Vec<u32> = roots.to_vec();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        for r in doc.references(id) {
            if !seen.contains(&r) && doc.exists(r) {
                stack.push(r);
            }
        }
    }
    let mut v: Vec<u32> = seen.into_iter().collect();
    v.sort_unstable();
    v
}

/// Export a subset of products (with their spatial parents, psets, types, materials) as a new IFC text.
pub fn export_subset(doc: &Document, products: &[u32]) -> Vec<u8> {
    let tree = model::SpatialTree::build(doc);
    let mut roots: Vec<u32> = Vec::new();
    let keep: FxHashSet<u32> = products.iter().copied().collect();
    let mut spatial_keep: FxHashSet<u32> = FxHashSet::default();
    for &p in products {
        roots.push(p);
        for a in tree.path_to(p) {
            spatial_keep.insert(a);
        }
    }
    roots.extend(spatial_keep.iter().copied());
    // relationships connecting kept objects
    let all_keep: FxHashSet<u32> = keep.union(&spatial_keep).copied().collect();
    for &o in all_keep.iter() {
        for rel in doc.referencing(o) {
            if !doc.has_flag(rel, tflags::REL) {
                continue;
            }
            roots.push(rel);
        }
    }
    // styled items for kept geometry
    let mut ids = closure(doc, &roots);
    let idset: FxHashSet<u32> = ids.iter().copied().collect();
    for si in doc.ids_of_type("IFCSTYLEDITEM") {
        if doc.arg(si, 0).and_then(|v| v.as_ref_id()).map(|i| idset.contains(&i)).unwrap_or(false) {
            ids.extend(closure(doc, &[si]));
        }
    }
    ids.sort_unstable();
    ids.dedup();
    // write: filter relationship lists to kept objects
    let idset: FxHashSet<u32> = ids.iter().copied().collect();
    let mut out = String::new();
    out.push_str(&doc.header_text());
    out.push_str("DATA;\n");
    for id in ids {
        let t = doc.type_name(id).unwrap_or("").to_string();
        let mut a = doc.args(id).unwrap_or_default();
        if doc.has_flag(id, tflags::REL) {
            for v in a.iter_mut() {
                if let Value::List(l) = v {
                    l.retain(|x| x.as_ref_id().map(|r| idset.contains(&r) && (all_keep.contains(&r) || !doc.has_flag(r, tflags::PRODUCT))).unwrap_or(true));
                }
            }
        }
        out.push_str(&format!("#{}={}({});\n", id, t, crate::step::args_to_step(&a)));
    }
    out.push_str("ENDSEC;\nEND-ISO-10303-21;\n");
    out.into_bytes()
}

/// Minimal new project with site, building and one storey.
pub fn new_project(schema: crate::SchemaId, project_name: &str, storeys: &[(String, f64)]) -> Document {
    let mut doc = Document::new_empty(schema);
    doc.begin("Neues Projekt");
    let oh = owner_history(&mut doc);
    let dims = doc.create("IFCDIMENSIONALEXPONENTS", &[Value::Int(0), Value::Int(0), Value::Int(0), Value::Int(0), Value::Int(0), Value::Int(0), Value::Int(0)]);
    let _ = dims;
    let len = doc.create("IFCSIUNIT", &[Value::Derived, Value::Enum("LENGTHUNIT".into()), Value::Null, Value::Enum("METRE".into())]);
    let area = doc.create("IFCSIUNIT", &[Value::Derived, Value::Enum("AREAUNIT".into()), Value::Null, Value::Enum("SQUARE_METRE".into())]);
    let vol = doc.create("IFCSIUNIT", &[Value::Derived, Value::Enum("VOLUMEUNIT".into()), Value::Null, Value::Enum("CUBIC_METRE".into())]);
    let ang = doc.create("IFCSIUNIT", &[Value::Derived, Value::Enum("PLANEANGLEUNIT".into()), Value::Null, Value::Enum("RADIAN".into())]);
    let ua = doc.create("IFCUNITASSIGNMENT", &[refs(&[len, area, vol, ang])]);
    let origin = doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(0.0), Value::Real(0.0), Value::Real(0.0)])]);
    let wcs = doc.create("IFCAXIS2PLACEMENT3D", &[r(origin), Value::Null, Value::Null]);
    let ctx = doc.create("IFCGEOMETRICREPRESENTATIONCONTEXT", &[Value::Null, s("Model"), Value::Int(3), Value::Real(1e-5), r(wcs), Value::Null]);
    let _body = doc.create("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", &[s("Body"), s("Model"), Value::Derived, Value::Derived, Value::Derived, Value::Derived, r(ctx), Value::Null, Value::Enum("MODEL_VIEW".into()), Value::Null]);
    let n = doc.schema().attr_names("IFCPROJECT").len();
    let mut pa = vec![Value::Null; n];
    pa[0] = s(&new_guid());
    pa[1] = oh;
    pa[2] = s(project_name);
    if let Some(i) = doc.schema().attr_index("IFCPROJECT", "RepresentationContexts") {
        pa[i] = refs(&[ctx]);
    }
    if let Some(i) = doc.schema().attr_index("IFCPROJECT", "UnitsInContext") {
        pa[i] = r(ua);
    }
    let project = doc.create("IFCPROJECT", &pa);
    let site = create_spatial(&mut doc, "IFCSITE", "Grundstück", project, None).expect("site");
    let building = create_spatial(&mut doc, "IFCBUILDING", "Gebäude", site, None).expect("building");
    for (name, elev) in storeys {
        let _ = create_spatial(&mut doc, "IFCBUILDINGSTOREY", name, building, Some(*elev));
    }
    doc.commit();
    doc.mark_saved();
    doc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_and_edits() {
        let mut doc = new_project(crate::SchemaId::Ifc4, "Test", &[("EG".into(), 0.0), ("OG".into(), 3.0)]);
        let storeys = doc.ids_of_type("IFCBUILDINGSTOREY");
        assert_eq!(storeys.len(), 2);
        doc.begin("Wand");
        let w = create_element(&mut doc, &NewElement { class_upper: "IFCWALL".into(), name: "W1".into(), container: Some(storeys[0]), location: [0.0, 0.0, 0.0], rotation_deg: 0.0, shape: Some(BodyShape::Box { x: 5.0, y: 0.3, z: 3.0, centered: false }), predefined_type: None }).unwrap();
        doc.commit();
        let t = model::SpatialTree::build(&doc);
        assert_eq!(t.container_of(&doc, w), Some(storeys[0]));
        doc.begin("Prop");
        set_property(&mut doc, w, "Pset_WallCommon", "IsExternal", typed_value_from_text("true", None), true).unwrap();
        doc.commit();
        let ps = model::psets_of(&doc, w);
        assert_eq!(ps.len(), 1);
        assert_eq!(ps[0].props[0].value.display(), "TRUE");
        doc.begin("Move");
        move_to_container(&mut doc, &[w], storeys[1]).unwrap();
        doc.commit();
        let t = model::SpatialTree::build(&doc);
        assert_eq!(t.container_of(&doc, w), Some(storeys[1]));
        doc.undo();
        let t = model::SpatialTree::build(&doc);
        assert_eq!(t.container_of(&doc, w), Some(storeys[0]));
        doc.begin("Dup");
        let d = duplicate(&mut doc, &[w], [0.0, 2.0, 0.0]).unwrap();
        doc.commit();
        assert_eq!(model::psets_of(&doc, d[0]).len(), 1);
        doc.begin("Del");
        delete_entities(&mut doc, &[w], true).unwrap();
        doc.commit();
        assert!(!doc.exists(w));
        let bytes = doc.to_bytes();
        let d2 = Document::from_bytes(bytes, &|_, _| {}).unwrap();
        assert!(d2.diagnostics.is_empty(), "{:?}", d2.diagnostics);
        assert_eq!(d2.ids_of_type("IFCWALL").len(), 1);
    }
}
