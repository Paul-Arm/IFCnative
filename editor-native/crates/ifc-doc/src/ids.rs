//! IDS 1.0 (Information Delivery Specification) parsing and checking.

use crate::document::{tflags, Document};
use crate::model;
use crate::step::Value;
use rayon::prelude::*;

#[derive(Debug, Clone, Default)]
pub struct Elem {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Elem>,
    pub text: String,
}

impl Elem {
    pub fn attr(&self, n: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == n).map(|(_, v)| v.as_str())
    }
    pub fn child(&self, n: &str) -> Option<&Elem> {
        self.children.iter().find(|c| c.name == n)
    }
    pub fn all<'a>(&'a self, n: &'a str) -> impl Iterator<Item = &'a Elem> + 'a {
        self.children.iter().filter(move |c| c.name == n)
    }
}

pub fn parse_xml(text: &str) -> anyhow::Result<Elem> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<Elem> = vec![Elem { name: "#root".into(), ..Default::default() }];
    loop {
        match reader.read_event()? {
            Event::Start(e) => {
                let mut el = Elem { name: local(e.name().as_ref().as_bytes()), ..Default::default() };
                for a in e.attributes().flatten() {
                    el.attrs.push((local(a.key.as_ref().as_bytes()), a.normalized_value(quick_xml::XmlVersion::Implicit1_0).map(|v| v.into_owned()).unwrap_or_default()));
                }
                stack.push(el);
            }
            Event::Empty(e) => {
                let mut el = Elem { name: local(e.name().as_ref().as_bytes()), ..Default::default() };
                for a in e.attributes().flatten() {
                    el.attrs.push((local(a.key.as_ref().as_bytes()), a.normalized_value(quick_xml::XmlVersion::Implicit1_0).map(|v| v.into_owned()).unwrap_or_default()));
                }
                stack.last_mut().unwrap().children.push(el);
            }
            Event::Text(t) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&t.xml10_content());
                }
            }
            Event::CData(t) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&t);
                }
            }
            Event::GeneralRef(r) => {
                if let Some(top) = stack.last_mut() {
                    let name = r.to_string();
                    top.text.push_str(match name.as_str() {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => "",
                    });
                }
            }
            Event::End(_) => {
                let el = stack.pop().unwrap();
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(el);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let root = stack.pop().unwrap_or_default();
    root.children.into_iter().next().ok_or_else(|| anyhow::anyhow!("Leeres XML"))
}

fn local(n: &[u8]) -> String {
    let s = String::from_utf8_lossy(n);
    s.rsplit(':').next().unwrap_or("").to_string()
}

/// Value constraint.
#[derive(Debug, Clone)]
pub enum Constraint {
    Any,
    Simple(String),
    Enum(Vec<String>),
    Pattern(String),
    Bounds { min: Option<(f64, bool)>, max: Option<(f64, bool)> },
    Length { exact: Option<usize>, min: Option<usize>, max: Option<usize> },
}

impl Constraint {
    fn from(el: Option<&Elem>) -> Constraint {
        let Some(el) = el else { return Constraint::Any };
        if let Some(sv) = el.child("simpleValue") {
            return Constraint::Simple(sv.text.trim().to_string());
        }
        if let Some(r) = el.child("restriction") {
            let enums: Vec<String> = r.all("enumeration").filter_map(|e| e.attr("value").map(|v| v.to_string())).collect();
            if !enums.is_empty() {
                return Constraint::Enum(enums);
            }
            if let Some(p) = r.child("pattern").and_then(|p| p.attr("value")) {
                return Constraint::Pattern(p.to_string());
            }
            let num = |n: &str| r.child(n).and_then(|x| x.attr("value")).and_then(|v| v.parse::<f64>().ok());
            let (mi, me, ma, mx) = (num("minInclusive"), num("minExclusive"), num("maxInclusive"), num("maxExclusive"));
            if mi.is_some() || me.is_some() || ma.is_some() || mx.is_some() {
                return Constraint::Bounds { min: mi.map(|v| (v, true)).or(me.map(|v| (v, false))), max: ma.map(|v| (v, true)).or(mx.map(|v| (v, false))) };
            }
            let us = |n: &str| r.child(n).and_then(|x| x.attr("value")).and_then(|v| v.parse::<usize>().ok());
            if us("length").is_some() || us("minLength").is_some() || us("maxLength").is_some() {
                return Constraint::Length { exact: us("length"), min: us("minLength"), max: us("maxLength") };
            }
        }
        let t = el.text.trim();
        if !t.is_empty() {
            return Constraint::Simple(t.to_string());
        }
        Constraint::Any
    }

    pub fn matches(&self, v: &str) -> bool {
        match self {
            Constraint::Any => true,
            Constraint::Simple(s) => eq_value(s, v),
            Constraint::Enum(e) => e.iter().any(|s| eq_value(s, v)),
            Constraint::Pattern(p) => regex::Regex::new(&format!("^(?:{p})$")).map(|re| re.is_match(v)).unwrap_or(false),
            Constraint::Bounds { min, max } => {
                let Ok(x) = v.replace(',', ".").parse::<f64>() else { return false };
                let lo = min.map(|(m, inc)| if inc { x >= m } else { x > m }).unwrap_or(true);
                let hi = max.map(|(m, inc)| if inc { x <= m } else { x < m }).unwrap_or(true);
                lo && hi
            }
            Constraint::Length { exact, min, max } => {
                let n = v.chars().count();
                exact.map(|e| n == e).unwrap_or(true) && min.map(|m| n >= m).unwrap_or(true) && max.map(|m| n <= m).unwrap_or(true)
            }
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Constraint::Any => "beliebig".into(),
            Constraint::Simple(s) => format!("„{s}“"),
            Constraint::Enum(e) => format!("eins von [{}]", e.join(", ")),
            Constraint::Pattern(p) => format!("Muster /{p}/"),
            Constraint::Bounds { min, max } => format!("Bereich {}…{}", min.map(|m| m.0.to_string()).unwrap_or_default(), max.map(|m| m.0.to_string()).unwrap_or_default()),
            Constraint::Length { exact, min, max } => format!("Länge {:?}/{:?}/{:?}", exact, min, max),
        }
    }
}

fn eq_value(expected: &str, actual: &str) -> bool {
    if expected == actual {
        return true;
    }
    match (expected.parse::<f64>(), actual.replace(',', ".").parse::<f64>()) {
        (Ok(a), Ok(b)) => (a - b).abs() <= 1e-6 * a.abs().max(1.0),
        _ => {
            let norm = |s: &str| match s.to_ascii_lowercase().as_str() {
                "true" | "t" => "true".to_string(),
                "false" | "f" => "false".to_string(),
                o => o.to_string(),
            };
            let (e, a) = (norm(expected), norm(actual));
            (e == "true" || e == "false") && e == a
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cardinality {
    Required,
    Optional,
    Prohibited,
}

#[derive(Debug, Clone)]
pub enum Facet {
    Entity { name: Constraint, predefined: Constraint },
    Attribute { name: Constraint, value: Constraint },
    Property { pset: Constraint, name: Constraint, value: Constraint, data_type: Option<String> },
    Classification { system: Constraint, value: Constraint },
    Material { value: Constraint },
    PartOf { relation: Option<String>, entity: Box<Facet> },
}

#[derive(Debug, Clone)]
pub struct Requirement {
    pub facet: Facet,
    pub card: Cardinality,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Specification {
    pub name: String,
    pub description: String,
    pub ifc_version: String,
    pub applicability: Vec<Facet>,
    pub requirements: Vec<Requirement>,
    pub min_occurs: u32,
    pub max_occurs: Option<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct Ids {
    pub title: String,
    pub author: String,
    pub specs: Vec<Specification>,
}

fn parse_facet(el: &Elem) -> Option<Facet> {
    Some(match el.name.as_str() {
        "entity" => Facet::Entity { name: Constraint::from(el.child("name")), predefined: Constraint::from(el.child("predefinedType")) },
        "attribute" => Facet::Attribute { name: Constraint::from(el.child("name")), value: Constraint::from(el.child("value")) },
        "property" => Facet::Property { pset: Constraint::from(el.child("propertySet")), name: Constraint::from(el.child("baseName").or_else(|| el.child("name"))), value: Constraint::from(el.child("value")), data_type: el.attr("dataType").map(|s| s.to_ascii_uppercase()) },
        "classification" => Facet::Classification { system: Constraint::from(el.child("system")), value: Constraint::from(el.child("value")) },
        "material" => Facet::Material { value: Constraint::from(el.child("value")) },
        "partOf" => Facet::PartOf { relation: el.attr("relation").map(|s| s.to_ascii_uppercase()), entity: Box::new(el.child("entity").and_then(parse_facet).unwrap_or(Facet::Entity { name: Constraint::Any, predefined: Constraint::Any })) },
        _ => return None,
    })
}

pub fn parse(text: &str) -> anyhow::Result<Ids> {
    let root = parse_xml(text)?;
    if root.name != "ids" {
        anyhow::bail!("Keine IDS-Datei (Wurzel <{}>)", root.name);
    }
    let mut ids = Ids::default();
    if let Some(info) = root.child("info") {
        ids.title = info.child("title").map(|t| t.text.clone()).unwrap_or_default();
        ids.author = info.child("author").map(|t| t.text.clone()).unwrap_or_default();
    }
    for spec in root.child("specifications").map(|s| s.all("specification").collect::<Vec<_>>()).unwrap_or_default() {
        let app = spec.child("applicability");
        let applicability: Vec<Facet> = app.map(|a| a.children.iter().filter_map(parse_facet).collect()).unwrap_or_default();
        let min_occurs = app.and_then(|a| a.attr("minOccurs")).or(spec.attr("minOccurs")).and_then(|v| v.parse().ok()).unwrap_or(0);
        let max_occurs = match app.and_then(|a| a.attr("maxOccurs")).or(spec.attr("maxOccurs")) {
            Some("unbounded") | None => None,
            Some(v) => v.parse().ok(),
        };
        let requirements = spec
            .child("requirements")
            .map(|r| {
                r.children
                    .iter()
                    .filter_map(|c| {
                        let facet = parse_facet(c)?;
                        let card = match c.attr("cardinality").or(c.attr("use")) {
                            Some("optional") => Cardinality::Optional,
                            Some("prohibited") => Cardinality::Prohibited,
                            _ => {
                                if c.attr("minOccurs") == Some("0") {
                                    Cardinality::Optional
                                } else if c.attr("maxOccurs") == Some("0") {
                                    Cardinality::Prohibited
                                } else {
                                    Cardinality::Required
                                }
                            }
                        };
                        Some(Requirement { facet, card, instructions: c.attr("instructions").map(|s| s.to_string()) })
                    })
                    .collect()
            })
            .unwrap_or_default();
        ids.specs.push(Specification {
            name: spec.attr("name").unwrap_or("Spezifikation").to_string(),
            description: spec.attr("description").unwrap_or("").to_string(),
            ifc_version: spec.attr("ifcVersion").unwrap_or("").to_string(),
            applicability,
            requirements,
            min_occurs,
            max_occurs,
        });
    }
    Ok(ids)
}

// ------------------------------------------------------------------ checking

/// Values of a facet for an entity; `None` = facet target absent.
fn facet_values(doc: &Document, id: u32, f: &Facet) -> Option<Vec<String>> {
    match f {
        Facet::Entity { .. } => Some(vec![doc.type_name(id)?.to_string()]),
        Facet::Attribute { name, .. } => {
            let t = doc.type_name(id)?;
            let names = doc.schema().attr_names(t);
            let args = doc.args(id)?;
            let mut out = Vec::new();
            for (i, n) in names.iter().enumerate() {
                if name.matches(n) {
                    match args.get(i) {
                        Some(Value::Null) | None => {}
                        Some(Value::Str(s)) if s.is_empty() => {}
                        Some(v) => out.push(v.display()),
                    }
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Facet::Property { pset, name, data_type, .. } => {
            let mut out = Vec::new();
            for ps in model::psets_of(doc, id) {
                if !pset.matches(&ps.name) {
                    continue;
                }
                for p in ps.props {
                    if !name.matches(&p.name) {
                        continue;
                    }
                    if let Some(dt) = data_type {
                        if let Value::Typed(t, _) = &p.value {
                            if t != dt {
                                out.push(format!("\u{0}typ:{t}"));
                                continue;
                            }
                        }
                    }
                    match &p.value {
                        Value::Null => {}
                        v => out.push(v.display()),
                    }
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Facet::Classification { system, .. } => {
            let mut out = Vec::new();
            for c in model::classifications_of(doc, id) {
                if system.matches(&c.source) || matches!(system, Constraint::Any) {
                    out.push(c.identification.clone());
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Facet::Material { .. } => {
            let mut out = Vec::new();
            for m in model::materials_of(doc, id) {
                for l in m.layers {
                    out.push(l.material_name.clone());
                    if let Some(c) = l.category {
                        out.push(c);
                    }
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Facet::PartOf { .. } => None,
    }
}

fn facet_matches(doc: &Document, tree: &model::SpatialTree, id: u32, f: &Facet) -> bool {
    match f {
        Facet::Entity { name, predefined } => {
            let Some(t) = doc.type_name(id) else { return false };
            if !name.matches(t) {
                return false;
            }
            if matches!(predefined, Constraint::Any) {
                return true;
            }
            let mut pt = doc.attr(id, "PredefinedType").and_then(|v| v.as_enum().map(|s| s.to_string())).unwrap_or_default();
            if pt == "USERDEFINED" {
                pt = doc.attr_str(id, "ObjectType").or_else(|| doc.attr_str(id, "ElementType")).unwrap_or_default();
            }
            if pt.is_empty() || pt == "NOTDEFINED" {
                if let Some(ty) = model::type_of(doc, id) {
                    pt = doc.attr(ty, "PredefinedType").and_then(|v| v.as_enum().map(|s| s.to_string())).unwrap_or_default();
                }
            }
            predefined.matches(&pt)
        }
        Facet::PartOf { relation, entity } => {
            let mut cur = id;
            for _ in 0..64 {
                let Some(&(p, link)) = tree.parent.get(&cur) else { break };
                let rel_ok = match relation.as_deref() {
                    None => true,
                    Some("IFCRELAGGREGATES") => link == model::Link::Aggregates,
                    Some("IFCRELCONTAINEDINSPATIALSTRUCTURE") => link == model::Link::Contains,
                    Some("IFCRELNESTS") => link == model::Link::Nests,
                    Some("IFCRELVOIDSELEMENT") => link == model::Link::Voids,
                    Some("IFCRELFILLSELEMENT") => link == model::Link::Fills,
                    Some(_) => true,
                };
                if rel_ok && facet_matches(doc, tree, p, entity) {
                    return true;
                }
                if relation.is_some() {
                    // direct relation only
                    if relation.as_deref() != Some("IFCRELCONTAINEDINSPATIALSTRUCTURE") {
                        break;
                    }
                }
                cur = p;
            }
            if relation.as_deref() == Some("IFCRELASSIGNSTOGROUP") || relation.is_none() {
                return model::groups_of(doc, id).into_iter().any(|g| facet_matches(doc, tree, g, entity));
            }
            false
        }
        _ => {
            let value = match f {
                Facet::Attribute { value, .. } | Facet::Property { value, .. } | Facet::Classification { value, .. } | Facet::Material { value } => value,
                _ => &Constraint::Any,
            };
            match facet_values(doc, id, f) {
                None => false,
                Some(vals) => vals.iter().any(|v| !v.starts_with('\u{0}') && value.matches(v)),
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct Failure {
    pub id: u32,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct SpecResult {
    pub name: String,
    pub description: String,
    pub applicable: Vec<u32>,
    pub passed: usize,
    pub failures: Vec<Failure>,
    pub spec_ok: bool,
    pub note: String,
}

fn describe_facet(f: &Facet) -> String {
    match f {
        Facet::Entity { name, predefined } => format!("Klasse {}{}", name.describe(), if matches!(predefined, Constraint::Any) { String::new() } else { format!(" / Typ {}", predefined.describe()) }),
        Facet::Attribute { name, value } => format!("Attribut {} = {}", name.describe(), value.describe()),
        Facet::Property { pset, name, value, data_type } => format!("{}.{} = {}{}", pset.describe(), name.describe(), value.describe(), data_type.as_ref().map(|d| format!(" [{d}]")).unwrap_or_default()),
        Facet::Classification { system, value } => format!("Klassifikation {} {}", system.describe(), value.describe()),
        Facet::Material { value } => format!("Material {}", value.describe()),
        Facet::PartOf { relation, entity } => format!("Teil von {} ({})", describe_facet(entity), relation.clone().unwrap_or_default()),
    }
}

pub fn check(doc: &Document, ids: &Ids) -> Vec<SpecResult> {
    let tree = model::SpatialTree::build(doc);
    let rooted: Vec<u32> = doc.ids_with_flag(tflags::ROOT);
    ids.specs
        .iter()
        .map(|spec| {
            // candidates: entity facet narrows by class
            let candidates: Vec<u32> = match spec.applicability.iter().find(|f| matches!(f, Facet::Entity { .. })) {
                Some(Facet::Entity { name: Constraint::Simple(n), .. }) => doc.ids_of_type(&n.to_ascii_uppercase()),
                Some(Facet::Entity { name: Constraint::Enum(ns), .. }) => ns.iter().flat_map(|n| doc.ids_of_type(&n.to_ascii_uppercase())).collect(),
                _ => rooted.clone(),
            };
            let applicable: Vec<u32> = candidates.into_par_iter().filter(|&id| spec.applicability.iter().all(|f| facet_matches(doc, &tree, id, f))).collect();
            let failures: Vec<Failure> = applicable
                .par_iter()
                .filter_map(|&id| {
                    let mut reasons = Vec::new();
                    for r in &spec.requirements {
                        let present = match &r.facet {
                            Facet::Entity { .. } | Facet::PartOf { .. } => true,
                            f => facet_values(doc, id, f).is_some(),
                        };
                        let ok = facet_matches(doc, &tree, id, &r.facet);
                        let pass = match r.card {
                            Cardinality::Required => ok,
                            Cardinality::Prohibited => !ok,
                            Cardinality::Optional => !present || ok,
                        };
                        if !pass {
                            let what = describe_facet(&r.facet);
                            let found = match &r.facet {
                                Facet::Entity { .. } | Facet::PartOf { .. } => String::new(),
                                f => match facet_values(doc, id, f) {
                                    Some(v) => format!(" (gefunden: {})", v.iter().map(|x| x.trim_start_matches('\u{0}').to_string()).collect::<Vec<_>>().join(", ")),
                                    None => " (fehlt)".into(),
                                },
                            };
                            reasons.push(match r.card {
                                Cardinality::Prohibited => format!("verboten: {what}{found}"),
                                _ => format!("{what}{found}"),
                            });
                        }
                    }
                    if reasons.is_empty() {
                        None
                    } else {
                        Some(Failure { id, reason: reasons.join("; ") })
                    }
                })
                .collect();
            let n = applicable.len();
            let mut spec_ok = failures.is_empty();
            let mut note = String::new();
            if spec.min_occurs > 0 && n == 0 {
                spec_ok = false;
                note = "keine anwendbaren Objekte gefunden (erforderlich)".into();
            }
            if spec.max_occurs == Some(0) && n > 0 {
                spec_ok = false;
                note = format!("{n} Objekte vorhanden, obwohl verboten");
            }
            SpecResult { name: spec.name.clone(), description: spec.description.clone(), passed: n - failures.len(), applicable, failures, spec_ok, note }
        })
        .collect()
}

/// CSV report of all failures.
pub fn report_csv(doc: &Document, results: &[SpecResult]) -> String {
    let mut out = String::from("Spezifikation;Status;STEP-Id;GlobalId;Klasse;Name;Befund\n");
    for r in results {
        if r.failures.is_empty() {
            out.push_str(&format!("{};{};;;;;{}\n", r.name, if r.spec_ok { "OK" } else { "FEHLER" }, r.note));
        }
        for f in &r.failures {
            out.push_str(&format!("{};FEHLER;#{};{};{};{};{}\n", r.name, f.id, doc.guid_of(f.id).unwrap_or_default(), doc.type_camel(f.id).unwrap_or(""), doc.name_of(f.id).unwrap_or_default().replace(';', ","), f.reason.replace(';', ",")));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_roundtrip() {
        let mut doc = crate::ops::new_project(crate::SchemaId::Ifc4, "T", &[("EG".into(), 0.0)]);
        let st = doc.ids_of_type("IFCBUILDINGSTOREY")[0];
        doc.begin("x");
        let w = crate::ops::create_element(&mut doc, &crate::ops::NewElement { class_upper: "IFCWALL".into(), name: "W".into(), container: Some(st), location: [0.0; 3], rotation_deg: 0.0, shape: None, predefined_type: None }).unwrap();
        crate::ops::set_property(&mut doc, w, "Pset_WallCommon", "IsExternal", crate::ops::typed_value_from_text("true", None), false).unwrap();
        doc.commit();
        let xml = r#"<?xml version="1.0"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
<info><title>Test</title></info>
<specifications>
 <specification name="Wände extern" ifcVersion="IFC4">
  <applicability minOccurs="1" maxOccurs="unbounded"><entity><name><simpleValue>IFCWALL</simpleValue></name></entity></applicability>
  <requirements>
   <property dataType="IFCBOOLEAN" cardinality="required"><propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet><baseName><simpleValue>IsExternal</simpleValue></baseName><value><simpleValue>TRUE</simpleValue></value></property>
   <attribute cardinality="required"><name><simpleValue>Name</simpleValue></name><value><xs:restriction base="xs:string"><xs:pattern value="W.*"/></xs:restriction></value></attribute>
   <property cardinality="required"><propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet><baseName><simpleValue>FireRating</simpleValue></baseName></property>
  </requirements>
 </specification>
</specifications></ids>"#;
        let ids = parse(xml).unwrap();
        assert_eq!(ids.specs.len(), 1);
        let r = check(&doc, &ids);
        assert_eq!(r[0].applicable.len(), 1);
        assert_eq!(r[0].failures.len(), 1, "{:?}", r[0].failures);
        assert!(r[0].failures[0].reason.contains("FireRating"));
    }
}
