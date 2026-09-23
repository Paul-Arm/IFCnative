//! Model comparison (GlobalId based) against another IFC file.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::diff::{ChangeKind, ObjectChange};

#[derive(Default)]
pub struct DiffState {
    pub other: Option<String>,
    pub changes: Vec<ObjectChange>,
    pub filter: String,
    pub show_added: bool,
    pub show_removed: bool,
    pub show_modified: bool,
    pub init: bool,
    pub millis: f64,
}

pub fn run_compare(s: &Session, path: &std::path::Path, app: &mut AppCtx) {
    let t = std::time::Instant::now();
    match ifc_doc::Document::open(path, &|_, _| {}) {
        Ok(other) => {
            let st = &mut app.panel_state.diff;
            st.changes = ifc_doc::diff::compare(&other, &s.doc);
            st.other = Some(path.display().to_string());
            st.millis = t.elapsed().as_secs_f64() * 1000.0;
        }
        Err(e) => app.error(format!("Vergleich fehlgeschlagen: {e}")),
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    if !app.panel_state.diff.init {
        let st = &mut app.panel_state.diff;
        st.init = true;
        st.show_added = true;
        st.show_removed = true;
        st.show_modified = true;
    }
    ui.horizontal(|ui| {
        if ui.button(format!("{} Mit älterer Version vergleichen …", ic::DIFF)).clicked() {
            if let Some(p) = rfd::FileDialog::new().add_filter("IFC", &["ifc", "ifczip"]).pick_file() {
                run_compare(s, &p, app);
            }
        }
    });
    let st = &mut app.panel_state.diff;
    let Some(other) = &st.other else {
        ui.weak("Vergleicht das aktuelle Modell (neu) mit einer anderen IFC-Datei (alt) anhand der GlobalIds: hinzugefügt, entfernt, geändert (Attribute, Psets, Typ, Material, Platzierung, Geometrie).");
        return;
    };
    let (a, r, m) = st.changes.iter().fold((0, 0, 0), |acc, c| match c.kind {
        ChangeKind::Added => (acc.0 + 1, acc.1, acc.2),
        ChangeKind::Removed => (acc.0, acc.1 + 1, acc.2),
        ChangeKind::Modified => (acc.0, acc.1, acc.2 + 1),
    });
    ui.label(format!("Alt: {other} · {:.0} ms", st.millis));
    ui.horizontal(|ui| {
        ui.checkbox(&mut st.show_added, RichText::new(format!("+ {a} neu")).color(Color32::from_rgb(90, 200, 110)));
        ui.checkbox(&mut st.show_removed, RichText::new(format!("− {r} entfernt")).color(Color32::from_rgb(240, 90, 80)));
        ui.checkbox(&mut st.show_modified, RichText::new(format!("~ {m} geändert")).color(Color32::from_rgb(255, 170, 40)));
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Filter").desired_width(140.0));
    });
    let mut select: Option<Vec<u32>> = None;
    ui.horizontal(|ui| {
        if ui.small_button("Neue + geänderte auswählen").clicked() {
            select = Some(st.changes.iter().filter_map(|c| c.new_id).collect());
        }
        if ui.small_button("Als Farben anzeigen").clicked() {
            for c in &st.changes {
                if let Some(id) = c.new_id {
                    if let Some(&oi) = s.scene.index_of.get(&id) {
                        let col = if c.kind == ChangeKind::Added { [90, 200, 110, 255] } else { [255, 170, 40, 255] };
                        s.scene.set_override(oi, Some(col));
                    }
                }
            }
            s.legend = vec![("neu".into(), [90, 200, 110, 255], a), ("geändert".into(), [255, 170, 40, 255], m)];
            s.view_dirty = true;
        }
    });
    let f = st.filter.to_lowercase();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for (k, c) in st.changes.iter().enumerate() {
            let show = match c.kind {
                ChangeKind::Added => st.show_added,
                ChangeKind::Removed => st.show_removed,
                ChangeKind::Modified => st.show_modified,
            };
            if !show || (!f.is_empty() && !c.name.to_lowercase().contains(&f) && !c.class.to_lowercase().contains(&f) && !c.guid.to_lowercase().contains(&f)) {
                continue;
            }
            let (sym, col) = match c.kind {
                ChangeKind::Added => ("+", Color32::from_rgb(90, 200, 110)),
                ChangeKind::Removed => ("−", Color32::from_rgb(240, 90, 80)),
                ChangeKind::Modified => ("~", Color32::from_rgb(255, 170, 40)),
            };
            let title = RichText::new(format!("{sym} {} „{}“  {}", c.class, c.name, c.guid)).color(col);
            if c.fields.is_empty() {
                if ui.selectable_label(false, title).clicked() {
                    if let Some(id) = c.new_id {
                        select = Some(vec![id]);
                    }
                }
            } else {
                egui::CollapsingHeader::new(title).id_salt(("chg", k)).show(ui, |ui| {
                    if let Some(id) = c.new_id {
                        if ui.small_button("auswählen").clicked() {
                            select = Some(vec![id]);
                        }
                    }
                    egui::Grid::new(("chgf", k)).striped(true).num_columns(3).show(ui, |ui| {
                        for (n, o, nv) in &c.fields {
                            ui.label(n);
                            ui.colored_label(Color32::from_rgb(240, 90, 80), if o.is_empty() { "—" } else { o });
                            ui.colored_label(Color32::from_rgb(90, 200, 110), if nv.is_empty() { "—" } else { nv });
                            ui.end_row();
                        }
                    });
                });
            }
        }
    });
    if let Some(sel) = select {
        s.select(sel, false);
        s.fit_selection();
    }
}
