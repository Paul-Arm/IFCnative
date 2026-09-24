//! DIN 276 cost groups: automatic assignment by class/properties, manual
//! assignment, quantities per cost group, Excel export.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::RichText;
use ifc_doc::{din276, tflags};
use rayon::prelude::*;
use std::collections::BTreeMap;

#[derive(Clone, Default)]
struct Group {
    ids: Vec<u32>,
    volume: f64,
    footprint: f64,
    surface: f64,
}

#[derive(Default)]
pub struct CostsState {
    key: Option<(u64, u64, bool, usize)>,
    groups: BTreeMap<String, Group>,
    unassigned: Vec<u32>,
    /// (element, suggested code) for elements without (or, with overwrite, any) code
    suggestions: Vec<(u32, String)>,
    only_selection: bool,
    overwrite: bool,
    code: String,
    filter: String,
}

fn elements(s: &Session, only_selection: bool) -> Vec<u32> {
    let base: Vec<u32> = if only_selection { s.selection.iter().flat_map(|&id| s.tree.subtree(id)).collect() } else { s.doc.ids_with_flag(tflags::ELEMENT) };
    let mut v: Vec<u32> = base.into_iter().filter(|&id| s.doc.has_flag(id, tflags::ELEMENT) && !s.doc.has_flag(id, tflags::OPENING) && !s.doc.has_flag(id, tflags::FEATURE)).collect();
    v.sort_unstable();
    v.dedup();
    v
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.costs;
    let key = (s.uid, s.doc.revision(), st.only_selection, if st.only_selection { s.selection.len() } else { 0 });
    let overwrite_key = st.overwrite;
    if st.key != Some(key) {
        let els = elements(s, st.only_selection);
        let doc = &s.doc;
        let rows: Vec<(u32, Option<String>, Option<&'static str>)> = els.par_iter().map(|&id| (id, din276::current(doc, id), din276::suggest(doc, id))).collect();
        let mut groups: BTreeMap<String, Group> = BTreeMap::new();
        let mut unassigned = Vec::new();
        let mut suggestions = Vec::new();
        for (id, cur, sug) in &rows {
            match cur {
                Some(c) => {
                    let g = groups.entry(c.clone()).or_default();
                    g.ids.push(*id);
                    if let Some(m) = crate::panels::quantities::measure(s, *id) {
                        g.volume += m.volume;
                        g.footprint += m.footprint;
                        g.surface += m.area;
                    }
                }
                None => unassigned.push(*id),
            }
            if let Some(sg) = sug {
                if cur.is_none() || (overwrite_key && cur.as_deref() != Some(*sg)) {
                    suggestions.push((*id, sg.to_string()));
                }
            }
        }
        st.groups = groups;
        st.unassigned = unassigned;
        st.suggestions = suggestions;
        st.key = Some(key);
    }
    let mut assign: Option<Vec<(u32, String)>> = None;
    let mut select: Option<Vec<u32>> = None;
    let mut export = false;
    ui.horizontal_wrapped(|ui| {
        if ui.checkbox(&mut st.only_selection, "Nur Auswahl").changed() {
            st.key = None;
        }
        if ui.checkbox(&mut st.overwrite, "Vorhandene Zuordnungen überschreiben").changed() {
            st.key = None;
        }
        let n = st.suggestions.len();
        if ui.add_enabled(n > 0, egui::Button::new(RichText::new(format!("{} {n} Vorschläge übernehmen", ic::CHECK)).strong())).on_hover_text("Regeln nach IFC-Klasse, PredefinedType, IsExternal und LoadBearing").clicked() {
            assign = Some(st.suggestions.clone());
        }
        ui.separator();
        ui.label("Auswahl →");
        let label = if st.code.is_empty() { "Kostengruppe wählen".to_string() } else { format!("{} {}", st.code, din276::name_of(&st.code).unwrap_or("")) };
        egui::ComboBox::from_id_salt("kg-pick").selected_text(label).width(260.0).height(380.0).show_ui(ui, |ui| {
            ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("suchen"));
            let f = st.filter.to_lowercase();
            for (c, n) in din276::CODES {
                if !f.is_empty() && !c.contains(&f) && !n.to_lowercase().contains(&f) {
                    continue;
                }
                let indent = if c.ends_with("00") { "" } else if c.ends_with('0') { "  " } else { "    " };
                ui.selectable_value(&mut st.code, c.to_string(), format!("{indent}{c} {n}"));
            }
        });
        let sel = s.paint_targets();
        if ui.add_enabled(!st.code.is_empty() && !sel.is_empty(), egui::Button::new(format!("zuordnen ({})", sel.len()))).clicked() {
            assign = Some(sel.into_iter().map(|id| (id, st.code.clone())).collect());
        }
        ui.separator();
        if ui.add_enabled(!st.groups.is_empty(), egui::Button::new(format!("{} Excel …", ic::EXPORT))).clicked() {
            export = true;
        }
    });
    let total: usize = st.groups.values().map(|g| g.ids.len()).sum::<usize>() + st.unassigned.len();
    ui.horizontal(|ui| {
        ui.label(RichText::new(format!("{} von {total} Elementen zugeordnet", total - st.unassigned.len())).strong());
        if !st.unassigned.is_empty() && ui.link(format!("{} ohne Kostengruppe", st.unassigned.len())).clicked() {
            select = Some(st.unassigned.clone());
        }
    });
    ui.separator();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        egui::Grid::new("kg-grid").striped(true).num_columns(6).spacing([14.0, 4.0]).show(ui, |ui| {
            ui.strong("KG");
            ui.strong("Bezeichnung");
            ui.strong("Anzahl");
            ui.strong("Volumen m³");
            ui.strong("Grundfläche m²");
            ui.strong("Oberfläche m²");
            ui.end_row();
            // 100er/10er sums
            let mut last_major = String::new();
            for (code, g) in &st.groups {
                let major = format!("{}00", &code[..1.min(code.len())]);
                if major != last_major {
                    let (n, v, f): (usize, f64, f64) = st.groups.iter().filter(|(c, _)| c.starts_with(&code[..1])).fold((0, 0.0, 0.0), |a, (_, g)| (a.0 + g.ids.len(), a.1 + g.volume, a.2 + g.footprint));
                    ui.label(RichText::new(&major).strong());
                    ui.label(RichText::new(din276::name_of(&major).unwrap_or("")).strong());
                    ui.label(RichText::new(n.to_string()).strong());
                    ui.label(RichText::new(format!("{v:.2}")).strong());
                    ui.label(RichText::new(format!("{f:.2}")).strong());
                    ui.label("");
                    ui.end_row();
                    last_major = major;
                }
                if ui.link(format!("  {code}")).on_hover_text("Elemente auswählen").clicked() {
                    select = Some(g.ids.clone());
                }
                ui.label(din276::name_of(code).unwrap_or("(unbekannt)"));
                ui.label(g.ids.len().to_string());
                ui.label(format!("{:.2}", g.volume));
                ui.label(format!("{:.2}", g.footprint));
                ui.label(format!("{:.2}", g.surface));
                ui.end_row();
            }
        });
        if st.groups.is_empty() {
            ui.weak("Noch keine Kostengruppen zugeordnet – „Vorschläge übernehmen“ ordnet Wände, Decken, Stützen, Öffnungen, Dächer, Gründung, TGA-Bauteile usw. automatisch zu.");
        }
    });
    if export {
        let headers: Vec<String> = ["KG", "Bezeichnung", "Anzahl", "Volumen m³", "Grundfläche m²", "Oberfläche m²"].iter().map(|x| x.to_string()).collect();
        let rows: Vec<Vec<String>> = st.groups.iter().map(|(c, g)| vec![c.clone(), din276::name_of(c).unwrap_or("").to_string(), g.ids.len().to_string(), format!("{:.3}", g.volume), format!("{:.3}", g.footprint), format!("{:.3}", g.surface)]).collect();
        if let Some(p) = rfd::FileDialog::new().add_filter("xlsx", &["xlsx"]).set_file_name("Kostengruppen DIN 276.xlsx").save_file() {
            match ifc_doc::import::write_xlsx_rows("DIN 276", &headers, &rows, &p) {
                Ok(()) => app.toast(format!("{} Kostengruppen exportiert", rows.len())),
                Err(e) => app.error(e.to_string()),
            }
        }
    }
    if let Some(items) = assign {
        let n = items.len();
        if s.edit("DIN 276 zuordnen", |doc| din276::assign(doc, &items)).is_some() {
            app.toast(format!("{n} Elemente einer Kostengruppe zugeordnet"));
        }
    }
    if let Some(ids) = select {
        s.select(ids, false);
    }
}
