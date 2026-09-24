//! Schema conformance check of all entities against the EXPRESS tables:
//! known entity types, attribute count, required attributes, reference
//! targets (existence and type), enumeration values and list/single shape.

use crate::document::Document;
use crate::step::Value;
use rayon::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum IssueKind {
    UnknownType,
    ArgCount,
    MissingRequired,
    DanglingRef,
    WrongRefType,
    BadEnum,
    Shape,
}

impl IssueKind {
    pub fn title(self) -> &'static str {
        match self {
            IssueKind::UnknownType => "Unbekannte Entity-Klasse im Schema",
            IssueKind::ArgCount => "Falsche Anzahl Attribute",
            IssueKind::MissingRequired => "Pflichtattribut fehlt ($)",
            IssueKind::DanglingRef => "Verweis auf nicht vorhandene Entity",
            IssueKind::WrongRefType => "Verweis auf falsche Klasse",
            IssueKind::BadEnum => "Ungültiger Aufzählungswert",
            IssueKind::Shape => "Liste/Einzelwert vertauscht",
        }
    }
    pub fn is_error(self) -> bool {
        !matches!(self, IssueKind::MissingRequired)
    }
}

#[derive(Debug, Clone)]
pub struct Issue {
    pub id: u32,
    pub kind: IssueKind,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct IssueGroup {
    pub kind: IssueKind,
    pub total: usize,
    /// Sample issues (up to the limit).
    pub samples: Vec<Issue>,
}

fn refs_in<'a>(v: &'a Value, out: &mut Vec<u32>) {
    match v {
        Value::Ref(r) => out.push(*r),
        Value::List(l) => l.iter().for_each(|x| refs_in(x, out)),
        Value::Typed(_, inner) => refs_in(inner, out),
        _ => {}
    }
}

fn check_entity(doc: &Document, id: u32, out: &mut Vec<Issue>) {
    let Some(ti) = doc.type_idx_of(id) else { return };
    let info = &doc.types[ti as usize];
    let schema = doc.schema();
    let Some(ei) = info.schema_idx else {
        out.push(Issue { id, kind: IssueKind::UnknownType, message: format!("{} ist in {} nicht definiert", info.name, doc.schema_id.display()) });
        return;
    };
    let e = &schema.entities[ei];
    let Some(args) = doc.args(id) else { return };
    if args.len() != e.attrs.len() {
        out.push(Issue { id, kind: IssueKind::ArgCount, message: format!("{}: {} statt {} Attribute", e.name, args.len(), e.attrs.len()) });
    }
    for (i, (a, v)) in e.attrs.iter().zip(args.iter()).enumerate() {
        let _ = i;
        match v {
            Value::Null => {
                if !a.optional {
                    out.push(Issue { id, kind: IssueKind::MissingRequired, message: format!("{}.{}", e.name, a.name) });
                }
                continue;
            }
            Value::Derived => continue,
            _ => {}
        }
        // references anywhere in the value must exist
        let mut rs = Vec::new();
        refs_in(v, &mut rs);
        for r in &rs {
            if !doc.exists(*r) {
                out.push(Issue { id, kind: IssueKind::DanglingRef, message: format!("{}.{} → #{r}", e.name, a.name) });
            }
        }
        if a.is_list && !matches!(v, Value::List(_)) {
            out.push(Issue { id, kind: IssueKind::Shape, message: format!("{}.{}: Liste erwartet", e.name, a.name) });
            continue;
        }
        // the reference flag of the tables is only trusted for real entity types
        let ref_entity = a.is_ref && schema.entity(&a.ty.to_ascii_uppercase()).is_some();
        if !a.is_list && ref_entity && !matches!(v, Value::Ref(_)) {
            out.push(Issue { id, kind: IssueKind::Shape, message: format!("{}.{}: Verweis erwartet", e.name, a.name) });
            continue;
        }
        if ref_entity {
            let target = a.ty.to_ascii_uppercase();
            if schema.entity(&target).is_some() {
                for r in rs.iter().filter(|r| doc.exists(**r)) {
                    if !doc.is_a(*r, &target) {
                        out.push(Issue { id, kind: IssueKind::WrongRefType, message: format!("{}.{} → #{r} {} (erwartet {})", e.name, a.name, doc.type_camel(*r).unwrap_or("?"), a.ty) });
                    }
                }
            }
        } else if let Some(vals) = schema.enum_values(&a.ty) {
            let check = |x: &Value, out: &mut Vec<Issue>| {
                if let Value::Enum(en) = x {
                    if !vals.iter().any(|v| v.eq_ignore_ascii_case(en)) {
                        out.push(Issue { id, kind: IssueKind::BadEnum, message: format!("{}.{} = .{en}. (erlaubt: {})", e.name, a.name, vals.join(", ")) });
                    }
                }
            };
            match v {
                Value::List(l) => l.iter().for_each(|x| check(x, out)),
                x => check(x, out),
            }
        }
    }
}

/// Check every live entity; returns issue groups with up to `limit` samples each.
pub fn validate(doc: &Document, limit: usize) -> Vec<IssueGroup> {
    let ids: Vec<u32> = doc.recs().iter().filter(|r| !r.deleted()).map(|r| r.id).collect();
    let issues: Vec<Issue> = ids
        .par_chunks(4096)
        .flat_map_iter(|chunk| {
            let mut out = Vec::new();
            for &id in chunk {
                check_entity(doc, id, &mut out);
            }
            out
        })
        .collect();
    let mut groups: Vec<IssueGroup> = Vec::new();
    for is in issues {
        match groups.iter_mut().find(|g| g.kind == is.kind) {
            Some(g) => {
                g.total += 1;
                if g.samples.len() < limit {
                    g.samples.push(is);
                }
            }
            None => groups.push(IssueGroup { kind: is.kind, total: 1, samples: vec![is] }),
        }
    }
    groups.sort_by_key(|g| g.kind);
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_problems() {
        let src = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('','',(''),(''),'','','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCWALL($,$,'W1',$,$,#99,$,$,.NOSUCHVALUE.);\n#2=IFCCARTESIANPOINT((0.,0.,0.));\n#3=IFCLOCALPLACEMENT($,#2);\n#4=IFCFOO(1);\n#5=IFCWALL('0abcdefghijklmnopqrstu',$,'W2',$,$,#3,$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n";
        let doc = Document::from_bytes(src.as_bytes().to_vec(), &|_, _| {}).unwrap();
        let g = validate(&doc, 50);
        let has = |k: IssueKind| g.iter().any(|x| x.kind == k);
        assert!(has(IssueKind::MissingRequired), "{g:?}"); // GlobalId of #1
        assert!(has(IssueKind::DanglingRef));
        assert!(has(IssueKind::BadEnum));
        assert!(has(IssueKind::UnknownType));
        // RelativePlacement is a select → not type checked; #5 is clean
        assert!(g.iter().all(|x| x.samples.iter().all(|i| i.id != 5 && i.id != 3)), "{g:?}");
    }
}
