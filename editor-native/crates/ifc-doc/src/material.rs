//! Material editing: appearance (surface styles), material properties,
//! layer/constituent/profile sets, merging and object colours.

use crate::document::{tflags, Document};
use crate::model::{self, PropView};
use crate::ops;
use crate::{SchemaId, Value};

/// Colour (RGB 0‥1) and transparency (0 = opaque … 1 = invisible).
pub type Rgba = ([f64; 3], f64);

fn r(id: u32) -> Value {
    Value::Ref(id)
}
fn s(t: &str) -> Value {
    Value::Str(t.to_string())
}
fn refs(ids: &[u32]) -> Value {
    Value::List(ids.iter().map(|&i| Value::Ref(i)).collect())
}
fn name_arg(doc: &Document, id: u32, i: usize) -> String {
    doc.arg(id, i).and_then(|v| v.as_str().map(|x| x.to_string())).unwrap_or_default()
}

// ------------------------------------------------------------------ styles

fn rgb_of(doc: &Document, c: u32) -> Option<[f64; 3]> {
    if doc.type_name(c)? != "IFCCOLOURRGB" {
        return None;
    }
    let a = doc.args(c)?;
    Some([a.get(1)?.as_f64()?, a.get(2)?.as_f64()?, a.get(3)?.as_f64()?])
}

/// Colour of a presentation style (surface style or style assignment).
pub fn style_color(doc: &Document, st: u32) -> Option<Rgba> {
    style_color_d(doc, st, 0)
}

fn style_color_d(doc: &Document, st: u32, depth: u32) -> Option<Rgba> {
    if depth > 5 {
        return None;
    }
    match doc.type_name(st)? {
        "IFCPRESENTATIONSTYLEASSIGNMENT" => doc.arg(st, 0)?.ref_list().into_iter().find_map(|x| style_color_d(doc, x, depth + 1)),
        "IFCSURFACESTYLE" => {
            let mut best = None;
            for x in doc.arg(st, 2)?.ref_list() {
                let t = doc.type_name(x).unwrap_or("");
                if t == "IFCSURFACESTYLERENDERING" || t == "IFCSURFACESTYLESHADING" {
                    let a = doc.args(x)?;
                    if let Some(rgb) = a.first().and_then(|v| v.as_ref_id()).and_then(|c| rgb_of(doc, c)) {
                        best = Some((rgb, a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0)));
                        if t == "IFCSURFACESTYLERENDERING" {
                            break;
                        }
                    }
                }
            }
            best
        }
        _ => None,
    }
}

/// Styled items reachable from a material's definition representations.
fn material_styled_items(doc: &Document, mat: u32) -> Vec<(u32, u32, u32)> {
    let mut out = Vec::new();
    for mdr in doc.referencing_with_type(mat, "IFCMATERIALDEFINITIONREPRESENTATION") {
        if doc.arg(mdr, 3).and_then(|v| v.as_ref_id()) != Some(mat) {
            continue;
        }
        for rep in doc.arg(mdr, 2).map(|v| v.ref_list()).unwrap_or_default() {
            for it in doc.arg(rep, 3).map(|v| v.ref_list()).unwrap_or_default() {
                if doc.type_name(it) == Some("IFCSTYLEDITEM") {
                    out.push((mdr, rep, it));
                }
            }
        }
    }
    out
}

/// Display colour of a material (from its IfcMaterialDefinitionRepresentation).
pub fn material_color(doc: &Document, mat: u32) -> Option<Rgba> {
    for (_, _, it) in material_styled_items(doc, mat) {
        for st in doc.arg(it, 1).map(|v| v.ref_list()).unwrap_or_default() {
            if let Some(c) = style_color(doc, st) {
                return Some(c);
            }
        }
    }
    None
}

/// New surface style; returns the value to put into IfcStyledItem.Styles
/// (a style assignment in IFC2x3, the style itself in IFC4+).
pub fn create_surface_style(doc: &mut Document, name: &str, c: Rgba) -> Value {
    let colour = doc.create("IFCCOLOURRGB", &[Value::Null, Value::Real(c.0[0]), Value::Real(c.0[1]), Value::Real(c.0[2])]);
    let n = doc.schema().attr_names("IFCSURFACESTYLERENDERING").len().max(9);
    let mut a = vec![Value::Null; n];
    a[0] = r(colour);
    a[1] = Value::Real(c.1.clamp(0.0, 1.0));
    a[n - 1] = Value::Enum("NOTDEFINED".into());
    let rend = doc.create("IFCSURFACESTYLERENDERING", &a);
    let style = doc.create("IFCSURFACESTYLE", &[s(name), Value::Enum("BOTH".into()), refs(&[rend])]);
    if doc.schema_id == SchemaId::Ifc2x3 {
        r(doc.create("IFCPRESENTATIONSTYLEASSIGNMENT", &[refs(&[style])]))
    } else {
        r(style)
    }
}

/// Set (or with `None` remove) the display colour of a material.
pub fn set_material_color(doc: &mut Document, mat: u32, c: Option<Rgba>) -> anyhow::Result<()> {
    let old = material_styled_items(doc, mat);
    let mut mdrs: Vec<u32> = old.iter().map(|x| x.0).collect();
    mdrs.dedup();
    let mut dead: Vec<u32> = Vec::new();
    for (_, rep, it) in &old {
        dead.push(*it);
        dead.push(*rep);
    }
    dead.extend(mdrs.iter().copied());
    dead.sort_unstable();
    dead.dedup();
    if !dead.is_empty() {
        ops::delete_entities(doc, &dead, false)?;
    }
    if let Some(c) = c {
        let name = model::material_name(doc, mat);
        let style = create_surface_style(doc, &name, c);
        let si = doc.create("IFCSTYLEDITEM", &[Value::Null, Value::List(vec![style]), Value::Null]);
        let ctx = ops::body_context(doc);
        let rep = doc.create("IFCSTYLEDREPRESENTATION", &[r(ctx), s("Style"), s("Material"), refs(&[si])]);
        doc.create("IFCMATERIALDEFINITIONREPRESENTATION", &[Value::Null, Value::Null, refs(&[rep]), r(mat)]);
    }
    Ok(())
}

const NON_BODY: [&str; 10] = ["Axis", "FootPrint", "Box", "Annotation", "Profile", "Reference", "Clearance", "CoG", "Lighting", "Plan"];

/// Top level items of an object's body representation(s).
pub fn body_items(doc: &Document, product: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let Some(pds) = doc.attr(product, "Representation").and_then(|v| v.as_ref_id()) else { return out };
    for rep in doc.arg(pds, 2).map(|v| v.ref_list()).unwrap_or_default() {
        let ident = name_arg(doc, rep, 1);
        if NON_BODY.iter().any(|x| x.eq_ignore_ascii_case(&ident)) {
            continue;
        }
        out.extend(doc.arg(rep, 3).map(|v| v.ref_list()).unwrap_or_default());
    }
    out
}

/// Explicit colour of an object (style on its first body item).
pub fn object_color(doc: &Document, product: u32) -> Option<Rgba> {
    for it in body_items(doc, product) {
        for si in doc.referencing_with_type(it, "IFCSTYLEDITEM") {
            for st in doc.arg(si, 1).map(|v| v.ref_list()).unwrap_or_default() {
                if let Some(c) = style_color(doc, st) {
                    return Some(c);
                }
            }
        }
    }
    None
}

/// Colour objects (styles on their body items); `None` removes item styles.
/// Returns the number of styled items.
pub fn set_object_color(doc: &mut Document, objects: &[u32], c: Option<Rgba>) -> anyhow::Result<usize> {
    let mut items: Vec<u32> = objects.iter().flat_map(|&o| body_items(doc, o)).collect();
    items.sort_unstable();
    items.dedup();
    let old: Vec<u32> = items.iter().flat_map(|&it| doc.referencing_with_type(it, "IFCSTYLEDITEM")).filter(|&si| doc.arg(si, 0).and_then(|v| v.as_ref_id()).is_some()).collect();
    if !old.is_empty() {
        ops::delete_entities(doc, &old, false)?;
    }
    let Some(c) = c else { return Ok(0) };
    let name = format!("Farbe {:02X}{:02X}{:02X}", (c.0[0] * 255.0).round() as u8, (c.0[1] * 255.0).round() as u8, (c.0[2] * 255.0).round() as u8);
    let style = create_surface_style(doc, &name, c);
    for &it in &items {
        doc.create("IFCSTYLEDITEM", &[r(it), Value::List(vec![style.clone()]), Value::Null]);
    }
    Ok(items.len())
}

// ------------------------------------------------------------------ properties

/// Positions (name, properties, material) of material property sets.
fn prop_layout(doc: &Document, set: u32) -> Option<(usize, usize, usize)> {
    match doc.type_name(set)? {
        "IFCMATERIALPROPERTIES" if doc.schema_id != SchemaId::Ifc2x3 => Some((0, 2, 3)),
        "IFCEXTENDEDMATERIALPROPERTIES" => Some((3, 1, 0)),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct MatPropSet {
    pub id: u32,
    pub name: String,
    pub props: Vec<PropView>,
}

pub fn property_sets(doc: &Document, mat: u32) -> Vec<MatPropSet> {
    let mut out = Vec::new();
    for t in ["IFCMATERIALPROPERTIES", "IFCEXTENDEDMATERIALPROPERTIES"] {
        for set in doc.referencing_with_type(mat, t) {
            let Some((ni, li, mi)) = prop_layout(doc, set) else { continue };
            if doc.arg(set, mi).and_then(|v| v.as_ref_id()) != Some(mat) {
                continue;
            }
            let props = doc.arg(set, li).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter_map(|p| model::read_property(doc, p)).collect();
            out.push(MatPropSet { id: set, name: name_arg(doc, set, ni), props });
        }
    }
    out
}

/// Create/update a material property (single value).
pub fn set_property(doc: &mut Document, mat: u32, set_name: &str, prop: &str, value: Value) -> anyhow::Result<()> {
    let set = match property_sets(doc, mat).into_iter().find(|p| p.name == set_name) {
        Some(p) => p.id,
        None => create_property_set(doc, mat, set_name),
    };
    let (_, li, _) = prop_layout(doc, set).ok_or_else(|| anyhow::anyhow!("keine Materialeigenschaften"))?;
    let list = doc.arg(set, li).map(|v| v.ref_list()).unwrap_or_default();
    for p in &list {
        if name_arg(doc, *p, 0) == prop && doc.type_name(*p) == Some("IFCPROPERTYSINGLEVALUE") {
            return doc.set_arg(*p, 2, value);
        }
    }
    let np = doc.create("IFCPROPERTYSINGLEVALUE", &[s(prop), Value::Null, value, Value::Null]);
    let mut l = list;
    l.push(np);
    doc.set_arg(set, li, refs(&l))
}

pub fn create_property_set(doc: &mut Document, mat: u32, name: &str) -> u32 {
    if doc.schema_id == SchemaId::Ifc2x3 {
        doc.create("IFCEXTENDEDMATERIALPROPERTIES", &[r(mat), Value::List(vec![]), Value::Null, s(name)])
    } else {
        doc.create("IFCMATERIALPROPERTIES", &[s(name), Value::Null, Value::List(vec![]), r(mat)])
    }
}

pub fn remove_property(doc: &mut Document, set: u32, prop: u32) -> anyhow::Result<()> {
    let (_, li, _) = prop_layout(doc, set).ok_or_else(|| anyhow::anyhow!("keine Materialeigenschaften"))?;
    let l: Vec<u32> = doc.arg(set, li).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter(|&p| p != prop).collect();
    doc.set_arg(set, li, refs(&l))?;
    if doc.referencing(prop).is_empty() {
        doc.delete(prop);
    }
    Ok(())
}

/// Standard material property sets (IFC4 names) with value types.
pub const PRESETS: &[(&str, &[(&str, &str)])] = &[
    ("Pset_MaterialCommon", &[("MassDensity", "IFCMASSDENSITYMEASURE"), ("Porosity", "IFCNORMALISEDRATIOMEASURE"), ("MolecularWeight", "IFCMOLECULARWEIGHTMEASURE")]),
    ("Pset_MaterialThermal", &[("ThermalConductivity", "IFCTHERMALCONDUCTIVITYMEASURE"), ("SpecificHeatCapacity", "IFCSPECIFICHEATCAPACITYMEASURE"), ("BoilingPoint", "IFCTHERMODYNAMICTEMPERATUREMEASURE"), ("FreezingPoint", "IFCTHERMODYNAMICTEMPERATUREMEASURE")]),
    ("Pset_MaterialMechanical", &[("YoungModulus", "IFCMODULUSOFELASTICITYMEASURE"), ("ShearModulus", "IFCMODULUSOFELASTICITYMEASURE"), ("PoissonRatio", "IFCPOSITIVERATIOMEASURE"), ("ThermalExpansionCoefficient", "IFCTHERMALEXPANSIONCOEFFICIENTMEASURE"), ("DynamicViscosity", "IFCDYNAMICVISCOSITYMEASURE")]),
    ("Pset_MaterialConcrete", &[("CompressiveStrength", "IFCPRESSUREMEASURE"), ("MaxAggregateSize", "IFCPOSITIVELENGTHMEASURE"), ("AdmixturesDescription", "IFCTEXT"), ("Workability", "IFCTEXT"), ("WaterImpermeability", "IFCTEXT"), ("ProtectivePoreRatio", "IFCNORMALISEDRATIOMEASURE")]),
    ("Pset_MaterialSteel", &[("YieldStress", "IFCPRESSUREMEASURE"), ("UltimateStress", "IFCPRESSUREMEASURE"), ("UltimateStrain", "IFCPOSITIVERATIOMEASURE"), ("HardeningModule", "IFCMODULUSOFELASTICITYMEASURE"), ("ProportionalStress", "IFCPRESSUREMEASURE"), ("PlasticStrain", "IFCPOSITIVERATIOMEASURE"), ("StructuralGrade", "IFCLABEL")]),
    ("Pset_MaterialWood", &[("Species", "IFCLABEL"), ("StrengthGrade", "IFCLABEL"), ("AppearanceGrade", "IFCLABEL"), ("Layup", "IFCLABEL"), ("Layers", "IFCINTEGER"), ("Plies", "IFCINTEGER"), ("MoistureContent", "IFCPOSITIVERATIOMEASURE")]),
    ("Pset_MaterialEnergy", &[("ViscosityTemperatureDerivative", "IFCREAL"), ("MoistureCapacityThermalGradient", "IFCREAL"), ("ThermalConductivityTemperatureDerivative", "IFCREAL"), ("SpecificHeatTemperatureDerivative", "IFCREAL")]),
];

/// Value type of a preset property, if known.
pub fn preset_type(set: &str, prop: &str) -> Option<&'static str> {
    PRESETS.iter().find(|p| p.0 == set).and_then(|p| p.1.iter().find(|x| x.0 == prop)).map(|x| x.1)
}

/// Add a preset set with empty values (existing properties are kept).
pub fn add_preset(doc: &mut Document, mat: u32, set_name: &str) -> anyhow::Result<()> {
    let Some((_, props)) = PRESETS.iter().find(|p| p.0 == set_name) else { anyhow::bail!("unbekannte Vorlage {set_name}") };
    let existing: Vec<String> = property_sets(doc, mat).into_iter().filter(|p| p.name == set_name).flat_map(|p| p.props.into_iter().map(|x| x.name)).collect();
    for (p, _) in props.iter() {
        if !existing.iter().any(|e| e == p) {
            set_property(doc, mat, set_name, p, Value::Null)?;
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ merge/delete

fn replace_in(v: &Value, from: u32, to: u32, n: &mut usize) -> Value {
    match v {
        Value::Ref(x) if *x == from => {
            *n += 1;
            Value::Ref(to)
        }
        Value::List(l) => Value::List(l.iter().map(|x| replace_in(x, from, to, n)).collect()),
        other => other.clone(),
    }
}

/// Replace every reference to `from` by `to`; returns the number of replaced references.
pub fn replace_references(doc: &mut Document, from: u32, to: u32) -> anyhow::Result<usize> {
    let mut total = 0;
    for e in doc.referencing(from) {
        let Some(args) = doc.args(e) else { continue };
        let mut n = 0;
        let new: Vec<Value> = args.iter().map(|v| replace_in(v, from, to, &mut n)).collect();
        if n > 0 {
            // no duplicates in lists (e.g. a material list containing both)
            let new: Vec<Value> = new
                .into_iter()
                .map(|v| match v {
                    Value::List(l) if l.iter().all(|x| matches!(x, Value::Ref(_))) => {
                        let mut seen = rustc_hash::FxHashSet::default();
                        Value::List(l.into_iter().filter(|x| seen.insert(x.as_ref_id())).collect())
                    }
                    v => v,
                })
                .collect();
            doc.set_args(e, &new)?;
            total += n;
        }
    }
    Ok(total)
}

/// Delete a material with its appearance and property sets (references are cleaned up).
pub fn delete_material(doc: &mut Document, mat: u32) -> anyhow::Result<()> {
    set_material_color(doc, mat, None)?;
    let sets: Vec<u32> = property_sets(doc, mat).into_iter().map(|p| p.id).collect();
    for set in sets {
        let (_, li, _) = prop_layout(doc, set).unwrap_or((0, 2, 3));
        let props = doc.arg(set, li).map(|v| v.ref_list()).unwrap_or_default();
        ops::delete_entities(doc, &[set], false)?;
        for p in props {
            if doc.exists(p) && doc.referencing(p).is_empty() {
                doc.delete(p);
            }
        }
    }
    ops::delete_entities(doc, &[mat], false)?;
    Ok(())
}

/// Merge `from` into `to`: all uses of `from` point to `to`, then `from` is deleted.
pub fn merge_into(doc: &mut Document, from: u32, to: u32) -> anyhow::Result<usize> {
    if from == to {
        return Ok(0);
    }
    // appearance/properties of `from` are dropped, not moved
    set_material_color(doc, from, None)?;
    let keep_sets: Vec<u32> = property_sets(doc, from).into_iter().map(|p| p.id).collect();
    let mut n = 0;
    for e in doc.referencing(from) {
        if keep_sets.contains(&e) {
            continue;
        }
        let Some(args) = doc.args(e) else { continue };
        let mut k = 0;
        let new: Vec<Value> = args.iter().map(|v| replace_in(v, from, to, &mut k)).collect();
        if k > 0 {
            doc.set_args(e, &new)?;
            n += k;
        }
    }
    delete_material(doc, from)?;
    Ok(n)
}

/// Materials not used by any association, set or layer.
pub fn unused_materials(doc: &Document) -> Vec<u32> {
    doc.ids_of_type("IFCMATERIAL")
        .into_iter()
        .filter(|&m| {
            doc.referencing(m).into_iter().all(|x| {
                let t = doc.type_name(x).unwrap_or("");
                t == "IFCMATERIALDEFINITIONREPRESENTATION" || t == "IFCMATERIALPROPERTIES" || t == "IFCEXTENDEDMATERIALPROPERTIES"
            })
        })
        .collect()
}

// ------------------------------------------------------------------ sets

/// Material sets of the model: layer sets, constituent sets, profile sets, lists.
pub fn material_sets(doc: &Document) -> Vec<u32> {
    let mut out = Vec::new();
    for t in ["IFCMATERIALLAYERSET", "IFCMATERIALCONSTITUENTSET", "IFCMATERIALPROFILESET", "IFCMATERIALLIST"] {
        out.extend(doc.ids_of_type(t));
    }
    out
}

/// (list attribute index, name attribute index) of a set.
pub fn set_layout(doc: &Document, set: u32) -> Option<(usize, Option<usize>)> {
    match doc.type_name(set)? {
        "IFCMATERIALLAYERSET" => Some((0, Some(1))),
        "IFCMATERIALCONSTITUENTSET" => Some((2, Some(0))),
        "IFCMATERIALPROFILESET" => Some((2, Some(0))),
        "IFCMATERIALLIST" => Some((0, None)),
        _ => None,
    }
}

pub fn set_name(doc: &Document, set: u32) -> String {
    set_layout(doc, set).and_then(|(_, ni)| ni).map(|i| name_arg(doc, set, i)).unwrap_or_default()
}

pub fn set_items(doc: &Document, set: u32) -> Vec<u32> {
    set_layout(doc, set).map(|(li, _)| doc.arg(set, li).map(|v| v.ref_list()).unwrap_or_default()).unwrap_or_default()
}

/// Material referenced by a set item (layer, constituent, profile; a list item is the material).
pub fn item_material(doc: &Document, item: u32) -> Option<u32> {
    match doc.type_name(item)? {
        "IFCMATERIAL" => Some(item),
        "IFCMATERIALLAYER" => doc.arg(item, 0).and_then(|v| v.as_ref_id()),
        "IFCMATERIALCONSTITUENT" | "IFCMATERIALPROFILE" => doc.arg(item, 2).and_then(|v| v.as_ref_id()),
        _ => None,
    }
}

pub fn set_item_material(doc: &mut Document, set: u32, item: u32, mat: u32) -> anyhow::Result<()> {
    match doc.type_name(item).unwrap_or("") {
        "IFCMATERIALLAYER" => doc.set_arg(item, 0, r(mat)),
        "IFCMATERIALCONSTITUENT" | "IFCMATERIALPROFILE" => doc.set_arg(item, 2, r(mat)),
        "IFCMATERIAL" => {
            let (li, _) = set_layout(doc, set).ok_or_else(|| anyhow::anyhow!("kein Materialsatz"))?;
            let l: Vec<u32> = set_items(doc, set).into_iter().map(|x| if x == item { mat } else { x }).collect();
            doc.set_arg(set, li, refs(&l))
        }
        _ => Ok(()),
    }
}

/// Add an item: a layer (thickness in model units), a constituent, or a list entry.
pub fn add_item(doc: &mut Document, set: u32, mat: u32, thickness: f64) -> anyhow::Result<u32> {
    let (li, _) = set_layout(doc, set).ok_or_else(|| anyhow::anyhow!("kein Materialsatz"))?;
    let item = match doc.type_name(set).unwrap_or("") {
        "IFCMATERIALLAYERSET" => {
            let n = doc.schema().attr_names("IFCMATERIALLAYER").len().max(3);
            let mut a = vec![Value::Null; n];
            a[0] = r(mat);
            a[1] = Value::Real(thickness);
            doc.create("IFCMATERIALLAYER", &a)
        }
        "IFCMATERIALCONSTITUENTSET" => doc.create("IFCMATERIALCONSTITUENT", &[s(&model::material_name(doc, mat)), Value::Null, r(mat), Value::Null, Value::Null]),
        "IFCMATERIALLIST" => mat,
        t => anyhow::bail!("{t}: Hinzufügen nicht unterstützt"),
    };
    let mut l = set_items(doc, set);
    l.push(item);
    doc.set_arg(set, li, refs(&l))?;
    Ok(item)
}

pub fn remove_item(doc: &mut Document, set: u32, item: u32) -> anyhow::Result<()> {
    let (li, _) = set_layout(doc, set).ok_or_else(|| anyhow::anyhow!("kein Materialsatz"))?;
    let l: Vec<u32> = set_items(doc, set).into_iter().filter(|&x| x != item).collect();
    doc.set_arg(set, li, refs(&l))?;
    if doc.type_name(item) != Some("IFCMATERIAL") && doc.referencing(item).is_empty() {
        doc.delete(item);
    }
    Ok(())
}

pub fn move_item(doc: &mut Document, set: u32, item: u32, delta: i32) -> anyhow::Result<()> {
    let (li, _) = set_layout(doc, set).ok_or_else(|| anyhow::anyhow!("kein Materialsatz"))?;
    let mut l = set_items(doc, set);
    let Some(i) = l.iter().position(|&x| x == item) else { return Ok(()) };
    let j = (i as i64 + delta as i64).clamp(0, l.len() as i64 - 1) as usize;
    l.swap(i, j);
    doc.set_arg(set, li, refs(&l))
}

pub fn create_constituent_set(doc: &mut Document, name: &str) -> u32 {
    doc.create("IFCMATERIALCONSTITUENTSET", &[s(name), Value::Null, Value::List(vec![])])
}

/// Objects using a material definition (directly or through sets/usages).
pub fn users(doc: &Document, def: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let mut stack = vec![def];
    let mut seen = rustc_hash::FxHashSet::default();
    while let Some(x) = stack.pop() {
        if !seen.insert(x) || seen.len() > 20_000 {
            continue;
        }
        for rr in doc.referencing(x) {
            match doc.type_name(rr).unwrap_or("") {
                "IFCRELASSOCIATESMATERIAL" => out.extend(doc.arg(rr, 4).map(|v| v.ref_list()).unwrap_or_default()),
                "IFCMATERIALLAYER" | "IFCMATERIALLAYERSET" | "IFCMATERIALLAYERSETUSAGE" | "IFCMATERIALLIST" | "IFCMATERIALCONSTITUENT" | "IFCMATERIALCONSTITUENTSET" | "IFCMATERIALPROFILE" | "IFCMATERIALPROFILESET" | "IFCMATERIALPROFILESETUSAGE" => stack.push(rr),
                _ => {}
            }
        }
    }
    // occurrences of typed objects inherit the type's material
    let types: Vec<u32> = out.iter().copied().filter(|&o| doc.has_flag(o, tflags::TYPE_OBJECT)).collect();
    for t in types {
        out.extend(model::occurrences_of_type(doc, t));
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// Sets (and usages) directly containing a material.
pub fn containers_of(doc: &Document, mat: u32) -> Vec<u32> {
    let mut out = Vec::new();
    for x in doc.referencing(mat) {
        match doc.type_name(x).unwrap_or("") {
            "IFCMATERIALLAYER" | "IFCMATERIALCONSTITUENT" | "IFCMATERIALPROFILE" => {
                for p in doc.referencing(x) {
                    if set_layout(doc, p).is_some() {
                        out.push(p);
                    }
                }
            }
            "IFCMATERIALLIST" => out.push(x),
            _ => {}
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> Document {
        crate::ops::new_project(SchemaId::Ifc4, "T", &[("EG".into(), 0.0)])
    }

    #[test]
    fn colors_and_merge() {
        let mut d = doc();
        let a = ops::create_material(&mut d, "Beton", None);
        let b = ops::create_material(&mut d, "Beton C25", None);
        set_material_color(&mut d, a, Some(([0.5, 0.25, 1.0], 0.2))).unwrap();
        let c = material_color(&d, a).unwrap();
        assert!((c.0[1] - 0.25).abs() < 1e-9 && (c.1 - 0.2).abs() < 1e-9);
        set_material_color(&mut d, a, Some(([0.1, 0.1, 0.1], 0.0))).unwrap();
        assert_eq!(d.ids_of_type("IFCMATERIALDEFINITIONREPRESENTATION").len(), 1);
        let set = ops::create_layer_set(&mut d, "Wand", &[("Beton C25".into(), 0.2)]);
        add_item(&mut d, set, a, 0.1).unwrap();
        assert_eq!(set_items(&d, set).len(), 2);
        set_property(&mut d, b, "Pset_MaterialCommon", "MassDensity", Value::Typed("IFCMASSDENSITYMEASURE".into(), Box::new(Value::Real(2400.0)))).unwrap();
        assert_eq!(property_sets(&d, b)[0].props.len(), 1);
        merge_into(&mut d, b, a).unwrap();
        assert!(!d.exists(b));
        assert!(set_items(&d, set).iter().all(|&l| item_material(&d, l) == Some(a)));
        assert!(unused_materials(&d).is_empty());
        set_material_color(&mut d, a, None).unwrap();
        assert!(material_color(&d, a).is_none());
    }
}
