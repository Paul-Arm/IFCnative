//! Rename by pattern: `{Geschoss}-{Klasse}-{Nr:03}` with numbering in reading
//! order (storey elevation, then top→bottom, left→right).

use crate::session::Session;
use ifc_doc::{model, ops, Value};

pub const TARGETS: [&str; 6] = ["Name", "Tag", "Description", "ObjectType", "LongName", "Eigenschaft …"];

pub const TOKENS: [(&str, &str); 10] = [
    ("{Name}", "bisheriger Name"),
    ("{Klasse}", "IFC-Klasse ohne „Ifc“"),
    ("{Typ}", "Name des Typobjekts"),
    ("{Geschoss}", "Name des Geschosses"),
    ("{GNr}", "Nummer des Geschosses (0 = unterstes)"),
    ("{Nr}", "laufende Nummer, {Nr:03} mit führenden Nullen"),
    ("{Tag}", "Kennung"),
    ("{GUID}", "GlobalId"),
    ("{Material}", "erstes Material"),
    ("{P:Pset.Eigenschaft}", "Eigenschaftswert"),
];

/// Objects in reading order with (storey index, running number).
pub fn ordered(s: &Session, ids: &[u32], restart_per_storey: bool, start: u32) -> Vec<(u32, u32, u32)> {
    let doc = &s.doc;
    let mut storeys: Vec<(f32, u32)> = doc.ids_of_type("IFCBUILDINGSTOREY").into_iter().map(|st| (s.storey_elevation(st).unwrap_or(0.0), st)).collect();
    storeys.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let storey_idx = |id: u32| s.tree.storey_of(doc, id).and_then(|st| storeys.iter().position(|x| x.1 == st)).map(|i| i as u32).unwrap_or(u32::MAX);
    let mut keyed: Vec<(u32, f32, f32, u32)> = ids
        .iter()
        .map(|&id| {
            let c = s.scene.obj(id).map(|o| (o.min + o.max) * 0.5).unwrap_or_default();
            (storey_idx(id), -c.y, c.x, id)
        })
        .collect();
    // rows of ~1 m: top → bottom, then left → right
    keyed.sort_by(|a, b| a.0.cmp(&b.0).then(((a.1).round() as i64).cmp(&((b.1).round() as i64))).then(a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal)));
    let mut out = Vec::with_capacity(keyed.len());
    let mut nr = start;
    let mut last = None;
    for (st, _, _, id) in keyed {
        if restart_per_storey && last != Some(st) {
            nr = start;
        }
        last = Some(st);
        out.push((id, st, nr));
        nr += 1;
    }
    out
}

/// Expand a pattern for one object.
pub fn expand(s: &Session, id: u32, pattern: &str, storey_idx: u32, nr: u32) -> String {
    let doc = &s.doc;
    let mut out = String::new();
    let mut rest = pattern;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find('}') else {
            out.push_str(&rest[i..]);
            return out;
        };
        let tok = &rest[i + 1..i + j];
        let val = match tok {
            "Name" => doc.name_of(id).unwrap_or_default(),
            "Klasse" => doc.type_camel(id).unwrap_or("").trim_start_matches("Ifc").to_string(),
            "Typ" => model::type_of(doc, id).and_then(|t| doc.name_of(t)).unwrap_or_default(),
            "Geschoss" => s.tree.storey_of(doc, id).and_then(|st| doc.name_of(st)).unwrap_or_default(),
            "GNr" => if storey_idx == u32::MAX { String::new() } else { storey_idx.to_string() },
            "Tag" => doc.attr_str(id, "Tag").unwrap_or_default(),
            "GUID" => doc.guid_of(id).unwrap_or_default(),
            "Material" => model::materials_of(doc, id).first().and_then(|m| m.layers.first().map(|l| l.material_name.clone())).unwrap_or_default(),
            t if t == "Nr" || t.starts_with("Nr:") => {
                let width: usize = t.strip_prefix("Nr:").and_then(|w| w.parse().ok()).unwrap_or(0);
                format!("{nr:0width$}")
            }
            t if t.starts_with("P:") => {
                let spec = &t[2..];
                let (ps, p) = spec.split_once('.').unwrap_or(("", spec));
                model::psets_of(doc, id).into_iter().filter(|x| ps.is_empty() || x.name == ps).flat_map(|x| x.props).find(|x| x.name == p).map(|x| x.value.display()).unwrap_or_default()
            }
            other => format!("{{{other}}}"),
        };
        out.push_str(&val);
        rest = &rest[i + j + 1..];
    }
    out.push_str(rest);
    out
}

/// Write the new values (one undo step). `target` indexes TARGETS; 5 = property `prop` ("Pset.Name").
pub fn apply(s: &mut Session, items: &[(u32, String)], target: usize, prop: &str, split: bool) -> Option<usize> {
    let attr = TARGETS.get(target).copied().unwrap_or("Name").to_string();
    let prop = prop.to_string();
    s.edit("Umbenennen nach Muster", |doc| {
        let mut n = 0;
        for (id, v) in items {
            if target == 5 {
                let (ps, p) = prop.split_once('.').ok_or_else(|| anyhow::anyhow!("Eigenschaft als Pset.Name angeben"))?;
                ops::set_property(doc, *id, ps, p, ops::typed_value_from_text(v, None), split)?;
            } else {
                let ty = doc.type_name(*id).unwrap_or("").to_string();
                if doc.schema().attr_index(&ty, &attr).is_none() {
                    continue;
                }
                doc.set_attr(*id, &attr, if v.is_empty() { Value::Null } else { Value::Str(v.clone()) })?;
            }
            n += 1;
        }
        Ok(n)
    })
}
