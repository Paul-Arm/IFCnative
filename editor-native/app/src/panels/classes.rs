//! IFC class list with counts, visibility toggles and selection.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use rustc_hash::FxHashMap;

pub fn show(ui: &mut egui::Ui, s: &mut Session, _app: &mut AppCtx) {
    // count products with geometry per class
    let mut counts: FxHashMap<String, (usize, String)> = FxHashMap::default();
    for o in &s.scene.objects {
        if o.geom.is_none() {
            continue;
        }
        let t = s.doc.type_name(o.id).unwrap_or("?").to_string();
        let camel = s.doc.type_camel(o.id).unwrap_or("?").to_string();
        counts.entry(t).or_insert((0, camel)).0 += 1;
    }
    let mut list: Vec<(String, usize, String)> = counts.into_iter().map(|(k, (n, c))| (k, n, c)).collect();
    list.sort_by(|a, b| a.2.cmp(&b.2));
    ui.horizontal(|ui| {
        if ui.small_button(format!("{} Alle", ic::SHOW)).clicked() {
            s.class_hidden.clear();
            s.apply_visibility();
        }
        if ui.small_button(format!("{} Keine", ic::HIDE)).clicked() {
            for (t, _, _) in &list {
                s.class_hidden.insert(t.clone());
            }
            s.apply_visibility();
        }
    });
    ui.separator();
    let mut changed = false;
    let mut select: Option<String> = None;
    for (t, n, camel) in &list {
        ui.horizontal(|ui| {
            let mut vis = !s.class_hidden.contains(t);
            if ui.checkbox(&mut vis, "").changed() {
                if vis {
                    s.class_hidden.remove(t);
                } else {
                    s.class_hidden.insert(t.clone());
                }
                changed = true;
            }
            ui.label(ic::for_class(t));
            if ui.selectable_label(false, format!("{camel}")).on_hover_text("Klicken: alle auswählen").clicked() {
                select = Some(t.clone());
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.weak(n.to_string());
            });
        });
    }
    if changed {
        s.apply_visibility();
    }
    if let Some(t) = select {
        let ids: Vec<u32> = s.scene.objects.iter().map(|o| o.id).filter(|&i| s.doc.type_name(i) == Some(t.as_str())).collect();
        s.select(ids, false);
    }
    ui.separator();
    ui.collapsing("Alle Entity-Typen der Datei", |ui| {
        let mut all: Vec<(String, usize)> = s.doc.type_counts().into_iter().map(|(t, c)| (s.doc.types[t as usize].camel.clone(), c)).collect();
        all.sort_by(|a, b| b.1.cmp(&a.1));
        egui::Grid::new("alltypes").striped(true).show(ui, |ui| {
            for (t, c) in all {
                ui.label(t);
                ui.weak(c.to_string());
                ui.end_row();
            }
        });
    });
}
