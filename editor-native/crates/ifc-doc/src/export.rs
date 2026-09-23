//! Tabular exports of object data (CSV, XLSX).

use crate::document::Document;
use crate::model;
use rayon::prelude::*;
use std::collections::BTreeSet;

/// Rows: one per object with base columns + all property columns found.
pub fn table(doc: &Document, ids: &[u32]) -> (Vec<String>, Vec<Vec<String>>) {
    let tree = model::SpatialTree::build(doc);
    let recs: Vec<(u32, Vec<(String, String)>)> = ids
        .par_iter()
        .map(|&id| {
            let mut v = Vec::new();
            for ps in model::psets_of(doc, id) {
                for p in ps.props {
                    v.push((format!("{}.{}", ps.name, p.name), p.value.display()));
                }
            }
            (id, v)
        })
        .collect();
    let mut cols: BTreeSet<String> = BTreeSet::new();
    for (_, v) in &recs {
        for (k, _) in v {
            cols.insert(k.clone());
        }
    }
    let mut header = vec!["STEP-Id".to_string(), "GlobalId".into(), "Klasse".into(), "Name".into(), "Typ".into(), "Geschoss".into(), "Material".into()];
    let prop_cols: Vec<String> = cols.into_iter().collect();
    header.extend(prop_cols.iter().cloned());
    let rows = recs
        .into_iter()
        .map(|(id, props)| {
            let mut row = vec![
                format!("#{id}"),
                doc.guid_of(id).unwrap_or_default(),
                doc.type_camel(id).unwrap_or("").to_string(),
                doc.name_of(id).unwrap_or_default(),
                model::type_of(doc, id).map(|t| model::label(doc, t)).unwrap_or_default(),
                tree.storey_of(doc, id).map(|s| model::label(doc, s)).unwrap_or_default(),
                model::materials_of(doc, id).first().and_then(|m| m.layers.first().map(|l| l.material_name.clone())).unwrap_or_default(),
            ];
            let map: std::collections::HashMap<String, String> = props.into_iter().collect();
            for c in &prop_cols {
                row.push(map.get(c).cloned().unwrap_or_default());
            }
            row
        })
        .collect();
    (header, rows)
}

fn csv_escape(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn write_csv(doc: &Document, ids: &[u32], path: &std::path::Path) -> anyhow::Result<usize> {
    let (h, rows) = table(doc, ids);
    let mut out = String::from("\u{feff}");
    out.push_str(&h.iter().map(|x| csv_escape(x)).collect::<Vec<_>>().join(";"));
    out.push('\n');
    for r in &rows {
        out.push_str(&r.iter().map(|x| csv_escape(x)).collect::<Vec<_>>().join(";"));
        out.push('\n');
    }
    std::fs::write(path, out)?;
    Ok(rows.len())
}

pub fn write_xlsx(doc: &Document, ids: &[u32], path: &std::path::Path) -> anyhow::Result<usize> {
    let (h, rows) = table(doc, ids);
    let mut wb = rust_xlsxwriter::Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name("Objekte")?;
    let bold = rust_xlsxwriter::Format::new().set_bold();
    for (c, name) in h.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, name, &bold)?;
    }
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            if let Ok(f) = v.parse::<f64>() {
                ws.write_number((r + 1) as u32, c as u16, f)?;
            } else {
                ws.write_string((r + 1) as u32, c as u16, v)?;
            }
        }
    }
    ws.autofilter(0, 0, rows.len() as u32, (h.len().max(1) - 1) as u16)?;
    ws.set_freeze_panes(1, 0)?;
    wb.save(path)?;
    Ok(rows.len())
}
