//! Batch property editing across many objects (+ table import).

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use ifc_doc::{model, ops, tflags, Value};
use rayon::prelude::*;
use std::collections::BTreeMap;

#[derive(Default)]
pub struct BatchState {
    pub pset: String,
    pub prop: String,
    pub value: String,
    pub vtype: String,
    pub summary: BTreeMap<(String, String), BTreeMap<String, usize>>,
    pub summary_key: Option<(u64, u64, usize)>,
    pub filter: String,
    pub import_report: Option<String>,
}

fn targets(s: &Session) -> Vec<u32> {
    let mut v: Vec<u32> = s.selection.iter().flat_map(|&id| s.tree.subtree(id)).filter(|&id| s.doc.has_flag(id, tflags::PRODUCT) && !s.doc.has_flag(id, tflags::OPENING)).collect();
    v.sort_unstable();
    v.dedup();
    v
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let t = targets(s);
    let st = &mut app.panel_state.batch;
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(format!("{} Zielobjekte", t.len())).strong());
        ui.weak("(aktuelle Auswahl inkl. untergeordneter Elemente)");
    });
    if t.is_empty() {
        ui.weak("Elemente auswählen (3D-Ansicht, Struktur, Klassen oder Filter), um ihre Eigenschaften gemeinsam zu bearbeiten.");
    }
    ui.separator();
    // setter
    let mut apply = false;
    let mut delete = false;
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::TextEdit::singleline(&mut st.pset).hint_text("Pset").desired_width(150.0));
        ui.add(egui::TextEdit::singleline(&mut st.prop).hint_text("Eigenschaft").desired_width(130.0));
        ui.add(egui::TextEdit::singleline(&mut st.value).hint_text("Wert").desired_width(120.0));
        let types = ["Automatisch", "IfcLabel", "IfcText", "IfcIdentifier", "IfcBoolean", "IfcLogical", "IfcInteger", "IfcReal", "IfcLengthMeasure", "IfcAreaMeasure", "IfcVolumeMeasure", "IfcPositiveLengthMeasure", "IfcRatioMeasure", "IfcThermalTransmittanceMeasure", "IfcDate"];
        if st.vtype.is_empty() {
            st.vtype = "Automatisch".into();
        }
        egui::ComboBox::from_id_salt("vtype").selected_text(&st.vtype).width(150.0).show_ui(ui, |ui| {
            for ty in types {
                ui.selectable_value(&mut st.vtype, ty.to_string(), ty);
            }
        });
        if ui.add_enabled(!t.is_empty() && !st.pset.trim().is_empty() && !st.prop.trim().is_empty(), egui::Button::new(format!("{} Auf alle setzen", ic::EDIT))).clicked() {
            apply = true;
        }
        if ui.add_enabled(!t.is_empty() && !st.prop.trim().is_empty(), egui::Button::new(format!("{} Bei allen entfernen", ic::DELETE))).clicked() {
            delete = true;
        }
    });
    if apply {
        let (pset, prop) = (st.pset.trim().to_string(), st.prop.trim().to_string());
        let value = if st.vtype == "Automatisch" { ops::typed_value_from_text(&st.value, None) } else { ops::typed_value(&st.vtype.to_ascii_uppercase(), &st.value, &s.doc) };
        let n = t.len();
        let split = app.settings.split_shared_psets;
        if s.edit(&format!("{prop} bei {n} Objekten setzen"), |doc| {
            // objects sharing one pset get it updated once, unless splitting is requested
            for &id in &t {
                ops::set_property(doc, id, &pset, &prop, value.clone(), split && false)?;
            }
            Ok(())
        })
        .is_some()
        {
            app.toast(format!("{prop} bei {n} Objekten gesetzt"));
            app.panel_state.batch.summary_key = None;
        }
    }
    if delete {
        let st = &app.panel_state.batch;
        let (pset, prop) = (st.pset.trim().to_string(), st.prop.trim().to_string());
        let mut removed = 0usize;
        s.edit(&format!("{prop} entfernen"), |doc| {
            for &id in &t {
                for ps in model::psets_of(doc, id) {
                    if ps.from_type.is_some() || (!pset.is_empty() && ps.name != pset) {
                        continue;
                    }
                    for p in ps.props.iter().filter(|p| p.name == prop) {
                        if doc.exists(p.id) {
                            ops::remove_property(doc, ps.id, p.id)?;
                            removed += 1;
                        }
                    }
                }
            }
            Ok(())
        });
        app.toast(format!("{removed} Eigenschaften entfernt"));
        app.panel_state.batch.summary_key = None;
    }
    let st = &mut app.panel_state.batch;
    // summary of existing values
    let key = (s.uid, s.doc.revision(), t.len());
    if st.summary_key != Some(key) && t.len() <= 200_000 {
        let doc = &s.doc;
        let parts: Vec<Vec<((String, String), String)>> = t.par_iter().map(|&id| model::psets_of(doc, id).into_iter().flat_map(|ps| ps.props.into_iter().map(move |p| ((ps.name.clone(), p.name.clone()), p.value.display()))).collect()).collect();
        let mut summary: BTreeMap<(String, String), BTreeMap<String, usize>> = BTreeMap::new();
        for v in parts {
            for (k, val) in v {
                *summary.entry(k).or_default().entry(val).or_default() += 1;
            }
        }
        st.summary = summary;
        st.summary_key = Some(key);
    }
    ui.separator();
    ui.horizontal(|ui| {
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Eigenschaften filtern").desired_width(200.0));
        if ui.button(format!("{} Tabelle importieren (CSV) …", ic::TABLE)).on_hover_text("Erste Spalte GlobalId, Tag oder Name; weitere Spalten als Pset.Eigenschaft").clicked() {
            if let Some(p) = rfd::FileDialog::new().add_filter("CSV", &["csv", "txt"]).pick_file() {
                st.import_report = Some(import_csv(s, &p));
                st.summary_key = None;
            }
        }
    });
    if let Some(r) = &st.import_report {
        ui.colored_label(egui::Color32::from_rgb(110, 170, 255), r);
    }
    let filter = st.filter.to_lowercase();
    let mut pick: Option<(String, String, String)> = None;
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        egui::Grid::new("batch-sum").num_columns(3).striped(true).show(ui, |ui| {
            ui.strong("Pset");
            ui.strong("Eigenschaft");
            ui.strong(format!("Werte (bei {} Objekten)", t.len()));
            ui.end_row();
            for ((ps, p), vals) in &st.summary {
                if !filter.is_empty() && !ps.to_lowercase().contains(&filter) && !p.to_lowercase().contains(&filter) {
                    continue;
                }
                ui.label(ps);
                ui.label(p);
                ui.horizontal_wrapped(|ui| {
                    let total: usize = vals.values().sum();
                    for (v, n) in vals.iter().take(8) {
                        if ui.small_button(format!("{} ({n})", if v.is_empty() { "—" } else { v })).on_hover_text("In Editor übernehmen").clicked() {
                            pick = Some((ps.clone(), p.clone(), v.clone()));
                        }
                    }
                    if vals.len() > 8 {
                        ui.weak(format!("+{} weitere", vals.len() - 8));
                    }
                    if total < t.len() {
                        ui.weak(format!("fehlt bei {}", t.len() - total));
                    }
                });
                ui.end_row();
            }
        });
    });
    if let Some((a, b, c)) = pick {
        st.pset = a;
        st.prop = b;
        st.value = c;
    }
}

/// CSV import: key column (GlobalId/Tag/Name/#id) + "Pset.Property" columns.
pub fn import_csv(s: &mut Session, path: &std::path::Path) -> String {
    let Ok(text) = std::fs::read_to_string(path) else { return "Datei nicht lesbar".into() };
    let delim = if text.lines().next().map(|l| l.matches(';').count() > l.matches(',').count()).unwrap_or(false) { ';' } else { ',' };
    let mut lines = text.lines();
    let Some(header) = lines.next() else { return "Leere Datei".into() };
    let cols: Vec<String> = split_csv(header, delim);
    if cols.len() < 2 {
        return "Mindestens zwei Spalten erforderlich".into();
    }
    let doc = &s.doc;
    let guids = model::guid_index(doc);
    let mut by_name: std::collections::HashMap<String, Vec<u32>> = Default::default();
    for id in doc.ids_with_flag(tflags::PRODUCT) {
        if let Some(n) = doc.name_of(id) {
            by_name.entry(n).or_default().push(id);
        }
        if let Some(tag) = doc.attr_str(id, "Tag") {
            by_name.entry(tag).or_default().push(id);
        }
    }
    let mut assignments: Vec<(u32, String, String, String)> = Vec::new();
    let mut missing = 0;
    for line in lines {
        let vals = split_csv(line, delim);
        let Some(key) = vals.first() else { continue };
        let ids: Vec<u32> = if let Some(&id) = guids.get(key.trim()) {
            vec![id]
        } else if let Some(id) = key.trim().strip_prefix('#').and_then(|x| x.parse::<u32>().ok()) {
            vec![id]
        } else {
            by_name.get(key.trim()).cloned().unwrap_or_default()
        };
        if ids.is_empty() {
            missing += 1;
            continue;
        }
        for (ci, c) in cols.iter().enumerate().skip(1) {
            let Some(v) = vals.get(ci) else { continue };
            if v.trim().is_empty() {
                continue;
            }
            let (ps, p) = c.split_once('.').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or(("Pset_Import".to_string(), c.clone()));
            for &id in &ids {
                assignments.push((id, ps.clone(), p.clone(), v.clone()));
            }
        }
    }
    let n = assignments.len();
    let res = s.edit("Tabelle importieren", |doc| {
        for (id, ps, p, v) in &assignments {
            ops::set_property(doc, *id, ps, p, ops::typed_value_from_text(v, None), false)?;
        }
        Ok(())
    });
    match res {
        Some(()) => format!("{n} Werte gesetzt, {missing} Zeilen ohne passendes Objekt"),
        None => format!("Import fehlgeschlagen: {}", s.last_error.clone().unwrap_or_default()),
    }
}

pub fn split_csv(line: &str, delim: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == delim && !quoted => out.push(std::mem::take(&mut cur)),
            c => cur.push(c),
        }
    }
    out.push(cur);
    out
}

#[allow(dead_code)]
fn _unused(_: Value) {}
