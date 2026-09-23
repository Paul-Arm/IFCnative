//! Semantic model queries on top of [`Document`]: spatial structure,
//! property sets, quantities, types, materials, classifications, units.

use crate::document::{tflags, Document};
use crate::step::Value;
use rayon::prelude::*;
use rustc_hash::FxHashMap;

/// Kind of a tree edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    Aggregates,
    Contains,
    Nests,
    Voids,
    Fills,
}

#[derive(Debug, Default, Clone)]
pub struct SpatialTree {
    pub roots: Vec<u32>,
    pub children: FxHashMap<u32, Vec<(u32, Link)>>,
    pub parent: FxHashMap<u32, (u32, Link)>,
    /// Relationship entity that created the edge (child -> rel id).
    pub via: FxHashMap<u32, u32>,
    pub revision: u64,
}

impl SpatialTree {
    pub fn build(doc: &Document) -> SpatialTree {
        let mut t = SpatialTree { revision: doc.revision(), ..Default::default() };
        let s = doc.schema();
        let specs: [(&str, &str, &str, Link); 5] = [
            ("IFCRELAGGREGATES", "RelatingObject", "RelatedObjects", Link::Aggregates),
            ("IFCRELCONTAINEDINSPATIALSTRUCTURE", "RelatingStructure", "RelatedElements", Link::Contains),
            ("IFCRELNESTS", "RelatingObject", "RelatedObjects", Link::Nests),
            ("IFCRELVOIDSELEMENT", "RelatingBuildingElement", "RelatedOpeningElement", Link::Voids),
            ("IFCRELFILLSELEMENT", "RelatingOpeningElement", "RelatedBuildingElement", Link::Fills),
        ];
        for (ty, a_parent, a_child, link) in specs {
            let (Some(ip), Some(ic)) = (s.attr_index(ty, a_parent), s.attr_index(ty, a_child)) else { continue };
            let rels = doc.ids_of_type(ty);
            let edges: Vec<(u32, u32, Vec<u32>)> = rels
                .par_iter()
                .filter_map(|&rel| {
                    let args = doc.args(rel)?;
                    let p = args.get(ip)?.as_ref_id()?;
                    let c = args.get(ic)?.ref_list();
                    Some((rel, p, c))
                })
                .collect();
            for (rel, p, cs) in edges {
                for c in cs {
                    if c == p || t.parent.contains_key(&c) {
                        continue;
                    }
                    t.children.entry(p).or_default().push((c, link));
                    t.parent.insert(c, (p, link));
                    t.via.insert(c, rel);
                }
            }
        }
        // roots: projects first, then any spatial element / product without parent
        let mut roots: Vec<u32> = doc.ids_with_flag(tflags::PROJECT).into_iter().filter(|id| !t.parent.contains_key(id)).collect();
        for id in doc.ids_with_flag(tflags::SPATIAL) {
            if !t.parent.contains_key(&id) && !roots.contains(&id) {
                roots.push(id);
            }
        }
        t.roots = roots;
        // stable child order: spatial first, then by type name, then by id
        let keys: Vec<u32> = t.children.keys().copied().collect();
        for k in keys {
            if let Some(v) = t.children.get_mut(&k) {
                v.sort_by(|a, b| {
                    let sa = doc.has_flag(a.0, tflags::SPATIAL);
                    let sb = doc.has_flag(b.0, tflags::SPATIAL);
                    sb.cmp(&sa).then_with(|| elevation_key(doc, a.0).partial_cmp(&elevation_key(doc, b.0)).unwrap_or(std::cmp::Ordering::Equal)).then_with(|| doc.type_name(a.0).cmp(&doc.type_name(b.0))).then(a.0.cmp(&b.0))
                });
            }
        }
        t
    }

    pub fn children_of(&self, id: u32) -> &[(u32, Link)] {
        self.children.get(&id).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Path from a root to `id` (inclusive).
    pub fn path_to(&self, id: u32) -> Vec<u32> {
        let mut out = vec![id];
        let mut cur = id;
        let mut guard = 0;
        while let Some(&(p, _)) = self.parent.get(&cur) {
            out.push(p);
            cur = p;
            guard += 1;
            if guard > 10_000 {
                break;
            }
        }
        out.reverse();
        out
    }

    /// All descendants (including `id`).
    pub fn subtree(&self, id: u32) -> Vec<u32> {
        let mut out = Vec::new();
        let mut stack = vec![id];
        while let Some(c) = stack.pop() {
            out.push(c);
            for (ch, _) in self.children_of(c) {
                stack.push(*ch);
            }
        }
        out
    }

    /// Nearest spatial container (storey/space/building...) of an element.
    pub fn container_of(&self, doc: &Document, id: u32) -> Option<u32> {
        let mut cur = id;
        let mut guard = 0;
        while let Some(&(p, _)) = self.parent.get(&cur) {
            if doc.has_flag(p, tflags::SPATIAL) {
                return Some(p);
            }
            cur = p;
            guard += 1;
            if guard > 10_000 {
                break;
            }
        }
        None
    }

    pub fn storey_of(&self, doc: &Document, id: u32) -> Option<u32> {
        self.path_to(id).into_iter().rev().find(|&p| doc.is_a(p, "IFCBUILDINGSTOREY"))
    }
}

fn elevation_key(doc: &Document, id: u32) -> f64 {
    if doc.type_name(id) == Some("IFCBUILDINGSTOREY") {
        doc.attr(id, "Elevation").and_then(|v| v.as_f64()).unwrap_or(0.0)
    } else {
        0.0
    }
}

#[derive(Debug, Clone)]
pub struct PropView {
    pub id: u32,
    pub name: String,
    pub value: Value,
    pub kind: PropKind,
    pub unit: Option<u32>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropKind {
    Single,
    Enumerated,
    Bounded,
    List,
    Table,
    Reference,
    Complex,
    Quantity,
    Other,
}

#[derive(Debug, Clone)]
pub struct PsetView {
    pub id: u32,
    pub name: String,
    pub is_quantity: bool,
    /// Defined on the element type rather than the occurrence.
    pub from_type: Option<u32>,
    /// Relationship entity (IfcRelDefinesByProperties) linking it, if any.
    pub rel: Option<u32>,
    pub props: Vec<PropView>,
    pub shared_count: usize,
}

pub fn read_property(doc: &Document, pid: u32) -> Option<PropView> {
    let ty = doc.type_name(pid)?.to_string();
    let args = doc.args(pid)?;
    let name = args.first().and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let description = args.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());
    let s = doc.schema();
    let (value, kind, unit) = match ty.as_str() {
        "IFCPROPERTYSINGLEVALUE" => (args.get(2).cloned().unwrap_or(Value::Null), PropKind::Single, args.get(3).and_then(|v| v.as_ref_id())),
        "IFCPROPERTYENUMERATEDVALUE" => (args.get(2).cloned().unwrap_or(Value::Null), PropKind::Enumerated, None),
        "IFCPROPERTYBOUNDEDVALUE" => {
            let up = args.get(2).cloned().unwrap_or(Value::Null);
            let lo = args.get(3).cloned().unwrap_or(Value::Null);
            (Value::List(vec![lo, up]), PropKind::Bounded, args.get(4).and_then(|v| v.as_ref_id()))
        }
        "IFCPROPERTYLISTVALUE" => (args.get(2).cloned().unwrap_or(Value::Null), PropKind::List, args.get(3).and_then(|v| v.as_ref_id())),
        "IFCPROPERTYTABLEVALUE" => (Value::List(vec![args.get(2).cloned().unwrap_or(Value::Null), args.get(3).cloned().unwrap_or(Value::Null)]), PropKind::Table, None),
        "IFCPROPERTYREFERENCEVALUE" => (args.last().cloned().unwrap_or(Value::Null), PropKind::Reference, None),
        "IFCCOMPLEXPROPERTY" => (args.get(3).cloned().unwrap_or(Value::Null), PropKind::Complex, None),
        t if doc.has_flag(pid, tflags::QUANTITY) => {
            let vname = match t {
                "IFCQUANTITYLENGTH" => "LengthValue",
                "IFCQUANTITYAREA" => "AreaValue",
                "IFCQUANTITYVOLUME" => "VolumeValue",
                "IFCQUANTITYCOUNT" => "CountValue",
                "IFCQUANTITYWEIGHT" => "WeightValue",
                "IFCQUANTITYTIME" => "TimeValue",
                "IFCQUANTITYNUMBER" => "NumberValue",
                _ => "",
            };
            let vi = s.attr_index(t, vname).unwrap_or(3);
            let unit = s.attr_index(t, "Unit").and_then(|i| args.get(i)).and_then(|v| v.as_ref_id());
            (args.get(vi).cloned().unwrap_or(Value::Null), PropKind::Quantity, unit)
        }
        _ => (Value::Null, PropKind::Other, None),
    };
    Some(PropView { id: pid, name, value, kind, unit, description })
}

pub fn read_pset(doc: &Document, psid: u32) -> Option<PsetView> {
    let ty = doc.type_name(psid)?;
    let args = doc.args(psid)?;
    let name = args.get(2).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let is_quantity = ty == "IFCELEMENTQUANTITY";
    let list_idx = if is_quantity { 5 } else { 4 };
    let props = args.get(list_idx).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter_map(|p| read_property(doc, p)).collect();
    Some(PsetView { id: psid, name, is_quantity, from_type: None, rel: None, props, shared_count: 0 })
}

/// All property/quantity sets of an object (occurrence first, then type sets).
pub fn psets_of(doc: &Document, id: u32) -> Vec<PsetView> {
    let mut out = Vec::new();
    for rel in doc.referencing_with_type(id, "IFCRELDEFINESBYPROPERTIES") {
        let Some(args) = doc.args(rel) else { continue };
        if !args.get(4).map(|v| v.ref_list().contains(&id)).unwrap_or(false) {
            continue;
        }
        let shared = args.get(4).map(|v| v.ref_list().len()).unwrap_or(0);
        for psid in args.get(5).map(|v| v.ref_list()).unwrap_or_default() {
            if let Some(mut p) = read_pset(doc, psid) {
                p.rel = Some(rel);
                p.shared_count = shared;
                out.push(p);
            }
        }
    }
    // properties directly on type objects (HasPropertySets)
    if doc.has_flag(id, tflags::TYPE_OBJECT) {
        if let Some(Value::List(l)) = doc.attr(id, "HasPropertySets") {
            for v in l {
                if let Some(ps) = v.as_ref_id().and_then(|p| read_pset(doc, p)) {
                    out.push(ps);
                }
            }
        }
    } else if let Some(t) = type_of(doc, id) {
        if let Some(Value::List(l)) = doc.attr(t, "HasPropertySets") {
            for v in l {
                if let Some(mut ps) = v.as_ref_id().and_then(|p| read_pset(doc, p)) {
                    ps.from_type = Some(t);
                    out.push(ps);
                }
            }
        }
    }
    out
}

/// Type object assigned to an occurrence.
pub fn type_of(doc: &Document, id: u32) -> Option<u32> {
    for rel in doc.referencing_with_type(id, "IFCRELDEFINESBYTYPE") {
        let args = doc.args(rel)?;
        if args.get(4).map(|v| v.ref_list().contains(&id)).unwrap_or(false) {
            return args.get(5).and_then(|v| v.as_ref_id());
        }
    }
    // IFC2x3 IfcRelDefinesByType is also found via IsDefinedBy; nothing else to check
    None
}

/// Occurrences typed by a type object.
pub fn occurrences_of_type(doc: &Document, type_id: u32) -> Vec<u32> {
    let mut out = Vec::new();
    for rel in doc.referencing_with_type(type_id, "IFCRELDEFINESBYTYPE") {
        if let Some(args) = doc.args(rel) {
            out.extend(args.get(4).map(|v| v.ref_list()).unwrap_or_default());
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct MaterialView {
    pub rel: u32,
    pub root: u32,
    pub kind: String,
    pub layers: Vec<MaterialLayerView>,
}

#[derive(Debug, Clone)]
pub struct MaterialLayerView {
    pub id: u32,
    pub material: Option<u32>,
    pub material_name: String,
    pub thickness: Option<f64>,
    pub name: Option<String>,
    pub category: Option<String>,
}

pub fn material_name(doc: &Document, mid: u32) -> String {
    doc.arg(mid, 0).and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| format!("#{mid}"))
}

/// Materials associated to an object (or its type).
pub fn materials_of(doc: &Document, id: u32) -> Vec<MaterialView> {
    let mut out = Vec::new();
    let mut targets = vec![id];
    if let Some(t) = type_of(doc, id) {
        targets.push(t);
    }
    for target in targets {
        for rel in doc.referencing_with_type(target, "IFCRELASSOCIATESMATERIAL") {
            let Some(args) = doc.args(rel) else { continue };
            if !args.get(4).map(|v| v.ref_list().contains(&target)).unwrap_or(false) {
                continue;
            }
            let Some(root) = args.get(5).and_then(|v| v.as_ref_id()) else { continue };
            out.push(describe_material(doc, rel, root));
        }
    }
    out
}

pub fn describe_material(doc: &Document, rel: u32, root: u32) -> MaterialView {
    let kind = doc.type_camel(root).unwrap_or("?").to_string();
    let mut layers = Vec::new();
    let resolve_layer_set = |set: u32, layers: &mut Vec<MaterialLayerView>| {
        if let Some(Value::List(l)) = doc.arg(set, 0) {
            for v in l {
                if let Some(lid) = v.as_ref_id() {
                    let a = doc.args(lid).unwrap_or_default();
                    let m = a.first().and_then(|v| v.as_ref_id());
                    layers.push(MaterialLayerView {
                        id: lid,
                        material: m,
                        material_name: m.map(|m| material_name(doc, m)).unwrap_or_default(),
                        thickness: a.get(1).and_then(|v| v.as_f64()),
                        name: a.get(3).and_then(|v| v.as_str()).map(|s| s.to_string()),
                        category: a.get(5).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                }
            }
        }
    };
    match doc.type_name(root).unwrap_or("") {
        "IFCMATERIAL" => layers.push(MaterialLayerView { id: root, material: Some(root), material_name: material_name(doc, root), thickness: None, name: None, category: doc.attr_str(root, "Category") }),
        "IFCMATERIALLAYERSETUSAGE" => {
            if let Some(set) = doc.arg(root, 0).and_then(|v| v.as_ref_id()) {
                resolve_layer_set(set, &mut layers);
            }
        }
        "IFCMATERIALLAYERSET" => resolve_layer_set(root, &mut layers),
        "IFCMATERIALLIST" => {
            for m in doc.arg(root, 0).map(|v| v.ref_list()).unwrap_or_default() {
                layers.push(MaterialLayerView { id: m, material: Some(m), material_name: material_name(doc, m), thickness: None, name: None, category: None });
            }
        }
        "IFCMATERIALCONSTITUENTSET" => {
            for c in doc.arg(root, 2).map(|v| v.ref_list()).unwrap_or_default() {
                let a = doc.args(c).unwrap_or_default();
                let m = a.get(2).and_then(|v| v.as_ref_id());
                layers.push(MaterialLayerView {
                    id: c,
                    material: m,
                    material_name: m.map(|m| material_name(doc, m)).unwrap_or_default(),
                    thickness: a.get(3).and_then(|v| v.as_f64()),
                    name: a.first().and_then(|v| v.as_str()).map(|s| s.to_string()),
                    category: a.get(4).and_then(|v| v.as_str()).map(|s| s.to_string()),
                });
            }
        }
        "IFCMATERIALPROFILESETUSAGE" | "IFCMATERIALPROFILESET" => {
            let set = if doc.type_name(root) == Some("IFCMATERIALPROFILESETUSAGE") { doc.arg(root, 0).and_then(|v| v.as_ref_id()) } else { Some(root) };
            if let Some(set) = set {
                for p in doc.arg(set, 2).map(|v| v.ref_list()).unwrap_or_default() {
                    let a = doc.args(p).unwrap_or_default();
                    let m = a.get(2).and_then(|v| v.as_ref_id());
                    layers.push(MaterialLayerView {
                        id: p,
                        material: m,
                        material_name: m.map(|m| material_name(doc, m)).unwrap_or_default(),
                        thickness: None,
                        name: a.first().and_then(|v| v.as_str()).map(|s| s.to_string()),
                        category: a.get(5).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                }
            }
        }
        _ => {}
    }
    MaterialView { rel, root, kind, layers }
}

#[derive(Debug, Clone)]
pub struct ClassificationView {
    pub rel: u32,
    pub reference: u32,
    pub identification: String,
    pub name: String,
    pub source: String,
}

pub fn classifications_of(doc: &Document, id: u32) -> Vec<ClassificationView> {
    let mut out = Vec::new();
    for rel in doc.referencing_with_type(id, "IFCRELASSOCIATESCLASSIFICATION") {
        let Some(args) = doc.args(rel) else { continue };
        let Some(r) = args.get(5).and_then(|v| v.as_ref_id()) else { continue };
        let a = doc.args(r).unwrap_or_default();
        let t = doc.type_name(r).unwrap_or("");
        let (ident, name, src) = if t == "IFCCLASSIFICATIONREFERENCE" {
            let src = a.get(3).and_then(|v| v.as_ref_id()).and_then(|s| doc.name_of(s).or_else(|| doc.arg(s, 3).and_then(|v| v.as_str().map(|x| x.to_string())))).unwrap_or_default();
            (a.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string(), a.get(2).and_then(|v| v.as_str()).unwrap_or_default().to_string(), src)
        } else {
            (String::new(), doc.name_of(r).unwrap_or_default(), String::new())
        };
        out.push(ClassificationView { rel, reference: r, identification: ident, name, source: src });
    }
    out
}

/// Groups/systems/zones an object is assigned to.
pub fn groups_of(doc: &Document, id: u32) -> Vec<u32> {
    let mut out = Vec::new();
    for rel in doc.referencing_with_type(id, "IFCRELASSIGNSTOGROUP") {
        if let Some(g) = doc.arg(rel, 6).and_then(|v| v.as_ref_id()) {
            out.push(g);
        }
    }
    out
}

pub fn group_members(doc: &Document, gid: u32) -> Vec<u32> {
    let mut out = Vec::new();
    for rel in doc.referencing_with_type(gid, "IFCRELASSIGNSTOGROUP") {
        if let Some(args) = doc.args(rel) {
            if args.get(6).and_then(|v| v.as_ref_id()) == Some(gid) {
                out.extend(args.get(4).map(|v| v.ref_list()).unwrap_or_default());
            }
        }
    }
    out
}

/// Project length unit scale to metres and the unit label.
pub fn length_unit(doc: &Document) -> (f64, String) {
    unit_of_type(doc, "LENGTHUNIT").unwrap_or((1.0, "m".into()))
}

pub fn unit_of_type(doc: &Document, unit_type: &str) -> Option<(f64, String)> {
    let proj = doc.ids_of_kind("IFCPROJECT").into_iter().next()?;
    let ua = doc.attr(proj, "UnitsInContext")?.as_ref_id()?;
    let units = doc.arg(ua, 0)?.ref_list();
    for u in units {
        let t = doc.type_name(u)?.to_string();
        let a = doc.args(u)?;
        match t.as_str() {
            "IFCSIUNIT" => {
                if a.get(1).and_then(|v| v.as_enum()) == Some(unit_type) {
                    let prefix = a.get(2).and_then(|v| v.as_enum()).unwrap_or("");
                    let name = a.get(3).and_then(|v| v.as_enum()).unwrap_or("");
                    let f = si_prefix(prefix);
                    let label = format!("{}{}", si_prefix_symbol(prefix), si_symbol(name));
                    let f = if name == "SQUARE_METRE" { f * f } else if name == "CUBIC_METRE" { f * f * f } else { f };
                    return Some((f, label));
                }
            }
            "IFCCONVERSIONBASEDUNIT" => {
                if a.get(1).and_then(|v| v.as_enum()) == Some(unit_type) {
                    let name = a.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let mut f = 1.0;
                    if let Some(mu) = a.get(3).and_then(|v| v.as_ref_id()) {
                        let ma = doc.args(mu).unwrap_or_default();
                        let v = ma.first().and_then(|v| v.as_f64()).unwrap_or(1.0);
                        let base = ma.get(1).and_then(|v| v.as_ref_id()).and_then(|b| doc.args(b)).map(|ba| si_prefix(ba.get(2).and_then(|v| v.as_enum()).unwrap_or(""))).unwrap_or(1.0);
                        f = v * base;
                    }
                    return Some((f, name.to_lowercase()));
                }
            }
            _ => {}
        }
    }
    None
}

pub fn si_prefix(p: &str) -> f64 {
    match p {
        "EXA" => 1e18,
        "PETA" => 1e15,
        "TERA" => 1e12,
        "GIGA" => 1e9,
        "MEGA" => 1e6,
        "KILO" => 1e3,
        "HECTO" => 1e2,
        "DECA" => 1e1,
        "DECI" => 1e-1,
        "CENTI" => 1e-2,
        "MILLI" => 1e-3,
        "MICRO" => 1e-6,
        "NANO" => 1e-9,
        "PICO" => 1e-12,
        _ => 1.0,
    }
}

fn si_prefix_symbol(p: &str) -> &'static str {
    match p {
        "KILO" => "k",
        "CENTI" => "c",
        "MILLI" => "m",
        "DECI" => "d",
        "MICRO" => "µ",
        _ => "",
    }
}

fn si_symbol(n: &str) -> &'static str {
    match n {
        "METRE" => "m",
        "SQUARE_METRE" => "m²",
        "CUBIC_METRE" => "m³",
        "GRAM" => "g",
        "SECOND" => "s",
        "RADIAN" => "rad",
        "DEGREE_CELSIUS" => "°C",
        "KELVIN" => "K",
        "NEWTON" => "N",
        "PASCAL" => "Pa",
        "WATT" => "W",
        "JOULE" => "J",
        _ => "",
    }
}

/// Short label for tree/list display: `Name` or type + id.
pub fn label(doc: &Document, id: u32) -> String {
    match doc.name_of(id) {
        Some(n) if !n.trim().is_empty() => n,
        _ => {
            if doc.type_name(id) == Some("IFCBUILDINGSTOREY") {
                format!("{} #{}", doc.type_camel(id).unwrap_or("?"), id)
            } else {
                format!("{} #{}", doc.type_camel(id).unwrap_or("?"), id)
            }
        }
    }
}

/// Find the IfcProject id.
pub fn project(doc: &Document) -> Option<u32> {
    doc.ids_of_kind("IFCPROJECT").into_iter().next()
}

/// Owner history used for new entities (first one in the file).
pub fn owner_history(doc: &Document) -> Option<u32> {
    doc.ids_of_type("IFCOWNERHISTORY").into_iter().next()
}

/// GlobalId -> entity id index.
pub fn guid_index(doc: &Document) -> FxHashMap<String, u32> {
    let roots = doc.ids_with_flag(tflags::ROOT);
    roots.par_iter().filter_map(|&id| doc.guid_of(id).map(|g| (g, id))).collect::<Vec<_>>().into_iter().collect()
}

/// Flat searchable summary of an object.
pub fn summary_fields(doc: &Document, id: u32) -> Vec<(String, String)> {
    let mut v = Vec::new();
    v.push(("Klasse".into(), doc.type_camel(id).unwrap_or("?").to_string()));
    v.push(("STEP-Id".into(), format!("#{id}")));
    if let Some(g) = doc.guid_of(id) {
        v.push(("GlobalId".into(), g));
    }
    let names = doc.attr_names(id);
    if let Some(args) = doc.args(id) {
        for (i, a) in args.iter().enumerate() {
            let n = names.get(i).cloned().unwrap_or_else(|| format!("#{i}"));
            if matches!(n.as_str(), "GlobalId" | "OwnerHistory") {
                continue;
            }
            if matches!(a, Value::Str(_) | Value::Enum(_) | Value::Real(_) | Value::Int(_) | Value::Typed(..)) {
                v.push((n, a.display()));
            }
        }
    }
    v
}
