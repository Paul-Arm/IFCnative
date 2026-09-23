//! GlobalId based semantic comparison of two documents.

use crate::document::{tflags, Document};
use crate::model;
use rayon::prelude::*;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Removed,
    Modified,
}

#[derive(Debug, Clone)]
pub struct ObjectChange {
    pub guid: String,
    pub kind: ChangeKind,
    pub class: String,
    pub name: String,
    /// Entity id in the current (new) document, if present.
    pub new_id: Option<u32>,
    pub old_id: Option<u32>,
    /// (field, old, new)
    pub fields: Vec<(String, String, String)>,
}

/// Flattened comparable record of an object.
pub fn record(doc: &Document, id: u32, tree: &model::SpatialTree) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("Klasse".to_string(), doc.type_camel(id).unwrap_or("").to_string());
    let names = doc.attr_names(id);
    if let Some(args) = doc.args(id) {
        for (i, a) in args.iter().enumerate() {
            let n = names.get(i).cloned().unwrap_or_else(|| format!("#{i}"));
            if matches!(n.as_str(), "GlobalId" | "OwnerHistory" | "ObjectPlacement" | "Representation") {
                continue;
            }
            if matches!(a, crate::Value::Ref(_) | crate::Value::List(_)) {
                continue;
            }
            m.insert(format!("Attribut.{n}"), a.display());
        }
    }
    for ps in model::psets_of(doc, id) {
        for p in ps.props {
            m.insert(format!("{}.{}", ps.name, p.name), p.value.display());
        }
    }
    if let Some(c) = tree.container_of(doc, id) {
        m.insert("Raumstruktur".into(), doc.guid_of(c).unwrap_or_default());
    }
    if let Some(t) = model::type_of(doc, id) {
        m.insert("Typ".into(), model::label(doc, t));
    }
    let mats: Vec<String> = model::materials_of(doc, id).into_iter().flat_map(|mv| mv.layers.into_iter().map(|l| l.material_name)).collect();
    if !mats.is_empty() {
        m.insert("Material".into(), mats.join(", "));
    }
    // placement signature (numeric content of the placement chain)
    if let Some(pl) = doc.arg(id, 5).and_then(|v| v.as_ref_id()) {
        m.insert("Platzierung".into(), placement_signature(doc, pl, 0));
    }
    if let Some(r) = doc.arg(id, 6).and_then(|v| v.as_ref_id()) {
        m.insert("Geometrie".into(), format!("{:016x}", geometry_hash(doc, r)));
    }
    m
}

fn placement_signature(doc: &Document, pl: u32, depth: u32) -> String {
    if depth > 8 {
        return String::new();
    }
    let a = doc.args(pl).unwrap_or_default();
    let mut s = String::new();
    for v in &a {
        match v {
            crate::Value::Ref(r) => {
                let t = doc.type_name(*r).unwrap_or("");
                if t == "IFCLOCALPLACEMENT" {
                    continue; // parent handled by containment
                }
                s.push_str(&placement_signature(doc, *r, depth + 1));
            }
            other => s.push_str(&other.display()),
        }
        s.push('|');
    }
    s
}

/// Structural hash of a representation subtree (ids ignored, content hashed).
pub fn geometry_hash(doc: &Document, root: u32) -> u64 {
    let mut h: u64 = 1469598103934665603;
    let mut stack = vec![root];
    let mut seen = rustc_hash::FxHashSet::default();
    let mut n = 0;
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        n += 1;
        if n > 200_000 {
            break;
        }
        let raw = doc.raw_args(id).unwrap_or_default();
        for b in doc.type_name(id).unwrap_or("").bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
        let mut in_ref = false;
        for &b in raw {
            if b == b'#' {
                in_ref = true;
                continue;
            }
            if in_ref && b.is_ascii_digit() {
                continue;
            }
            in_ref = false;
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
        let mut refs = doc.references(id);
        refs.reverse();
        stack.extend(refs);
    }
    h
}

pub fn compare(old: &Document, new: &Document) -> Vec<ObjectChange> {
    let old_t = model::SpatialTree::build(old);
    let new_t = model::SpatialTree::build(new);
    let pick = |d: &Document| -> Vec<(String, u32)> { d.ids_with_flag(tflags::PRODUCT | tflags::SPATIAL | tflags::PROJECT | tflags::GROUP | tflags::TYPE_OBJECT).into_par_iter().filter_map(|id| d.guid_of(id).map(|g| (g, id))).collect() };
    let old_ids: BTreeMap<String, u32> = pick(old).into_iter().collect();
    let new_ids: BTreeMap<String, u32> = pick(new).into_iter().collect();
    let mut out: Vec<ObjectChange> = Vec::new();
    for (g, &oid) in &old_ids {
        if !new_ids.contains_key(g) {
            out.push(ObjectChange { guid: g.clone(), kind: ChangeKind::Removed, class: old.type_camel(oid).unwrap_or("").into(), name: old.name_of(oid).unwrap_or_default(), new_id: None, old_id: Some(oid), fields: vec![] });
        }
    }
    for (g, &nid) in &new_ids {
        if !old_ids.contains_key(g) {
            out.push(ObjectChange { guid: g.clone(), kind: ChangeKind::Added, class: new.type_camel(nid).unwrap_or("").into(), name: new.name_of(nid).unwrap_or_default(), new_id: Some(nid), old_id: None, fields: vec![] });
        }
    }
    let common: Vec<(String, u32, u32)> = new_ids.iter().filter_map(|(g, &n)| old_ids.get(g).map(|&o| (g.clone(), o, n))).collect();
    let modified: Vec<ObjectChange> = common
        .par_iter()
        .filter_map(|(g, o, n)| {
            let ra = record(old, *o, &old_t);
            let rb = record(new, *n, &new_t);
            if ra == rb {
                return None;
            }
            let mut fields = Vec::new();
            for (k, v) in &ra {
                match rb.get(k) {
                    Some(v2) if v2 == v => {}
                    Some(v2) => fields.push((k.clone(), v.clone(), v2.clone())),
                    None => fields.push((k.clone(), v.clone(), String::new())),
                }
            }
            for (k, v) in &rb {
                if !ra.contains_key(k) {
                    fields.push((k.clone(), String::new(), v.clone()));
                }
            }
            Some(ObjectChange { guid: g.clone(), kind: ChangeKind::Modified, class: new.type_camel(*n).unwrap_or("").into(), name: new.name_of(*n).unwrap_or_default(), new_id: Some(*n), old_id: Some(*o), fields })
        })
        .collect();
    out.extend(modified);
    out.sort_by(|a, b| a.class.cmp(&b.class).then(a.name.cmp(&b.name)));
    out
}
