//! Clash detection panel.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::model;
use ifc_geom::clash::{self, Clash, ClashOptions};
use rustc_hash::FxHashSet;

pub struct ClashState {
    pub a_class: String,
    pub b_class: String,
    pub a_sel: Vec<u32>,
    pub b_sel: Vec<u32>,
    pub tol_mm: f32,
    pub clearance_mm: f32,
    pub results: Vec<Clash>,
    pub millis: f64,
    pub ran: bool,
    pub ignore_related: bool,
}

impl Default for ClashState {
    fn default() -> Self {
        ClashState { a_class: String::new(), b_class: String::new(), a_sel: vec![], b_sel: vec![], tol_mm: 2.0, clearance_mm: 0.0, results: vec![], millis: 0.0, ran: false, ignore_related: true }
    }
}

fn set_ids(s: &Session, class: &str, sel: &[u32]) -> Vec<u32> {
    if !sel.is_empty() {
        return sel.iter().flat_map(|&id| s.tree.subtree(id)).filter(|id| s.scene.has(*id)).collect();
    }
    let c = class.trim().to_ascii_uppercase();
    let c = if c.is_empty() || c.starts_with("IFC") { c } else { format!("IFC{c}") };
    s.scene.objects.iter().filter(|o| o.geom.is_some()).map(|o| o.id).filter(|&id| {
        let t = s.doc.type_name(id).unwrap_or("");
        if t == "IFCSPACE" || t == "IFCOPENINGELEMENT" || t.contains("ZONE") {
            return false;
        }
        c.is_empty() || s.doc.schema().is_subtype_of(t, &c)
    })
    .collect()
}

fn related_pairs(s: &Session) -> FxHashSet<(u32, u32)> {
    let doc = &s.doc;
    let mut out = FxHashSet::default();
    let add = |out: &mut FxHashSet<(u32, u32)>, a: u32, b: u32| {
        out.insert((a.min(b), a.max(b)));
    };
    for rel in doc.ids_of_type("IFCRELFILLSELEMENT") {
        let (Some(o), Some(e)) = (doc.arg(rel, 4).and_then(|v| v.as_ref_id()), doc.arg(rel, 5).and_then(|v| v.as_ref_id())) else { continue };
        for vr in doc.referencing_with_type(o, "IFCRELVOIDSELEMENT") {
            if let Some(h) = doc.arg(vr, 4).and_then(|v| v.as_ref_id()) {
                add(&mut out, h, e);
            }
        }
    }
    for (c, (p, _)) in s.tree.parent.iter() {
        add(&mut out, *c, *p);
    }
    out
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.clash;
    egui::Grid::new("clash-sets").num_columns(3).show(ui, |ui| {
        ui.label("Gruppe A");
        ui.add(egui::TextEdit::singleline(&mut st.a_class).hint_text("Klasse, z. B. IfcBeam (leer = alle)").desired_width(200.0));
        ui.horizontal(|ui| {
            if ui.button("= Auswahl").clicked() {
                st.a_sel = s.selection.clone();
            }
            if !st.a_sel.is_empty() {
                ui.weak(format!("{} gewählt", st.a_sel.len()));
                if ui.small_button(ic::CLOSE).clicked() {
                    st.a_sel.clear();
                }
            }
        });
        ui.end_row();
        ui.label("Gruppe B");
        ui.add(egui::TextEdit::singleline(&mut st.b_class).hint_text("Klasse, z. B. IfcDuctSegment (leer = alle)").desired_width(200.0));
        ui.horizontal(|ui| {
            if ui.button("= Auswahl").clicked() {
                st.b_sel = s.selection.clone();
            }
            if !st.b_sel.is_empty() {
                ui.weak(format!("{} gewählt", st.b_sel.len()));
                if ui.small_button(ic::CLOSE).clicked() {
                    st.b_sel.clear();
                }
            }
        });
        ui.end_row();
        ui.label("Toleranz");
        ui.add(egui::DragValue::new(&mut st.tol_mm).range(0.0..=100.0).suffix(" mm"));
        ui.checkbox(&mut st.ignore_related, "verbundene Bauteile ignorieren (Öffnungen, Aggregation)");
        ui.end_row();
        ui.label("Mindestabstand");
        ui.add(egui::DragValue::new(&mut st.clearance_mm).range(0.0..=2000.0).suffix(" mm")).on_hover_text("0 = nur harte Durchdringungen");
        ui.end_row();
    });
    if ui.button(format!("{} Kollisionen prüfen", ic::CLASH)).clicked() {
        let t = std::time::Instant::now();
        let ids_a = set_ids(s, &st.a_class, &st.a_sel);
        let ids_b = set_ids(s, &st.b_class, &st.b_sel);
        let ga: Vec<_> = ids_a.iter().filter_map(|id| s.scene.obj(*id).and_then(|o| o.geom.clone())).collect();
        let gb: Vec<_> = ids_b.iter().filter_map(|id| s.scene.obj(*id).and_then(|o| o.geom.clone())).collect();
        let ra: Vec<&ifc_geom::ProductGeom> = ga.iter().map(|g| g.as_ref()).collect();
        let rb: Vec<&ifc_geom::ProductGeom> = gb.iter().map(|g| g.as_ref()).collect();
        let ignore = if st.ignore_related { related_pairs(s) } else { FxHashSet::default() };
        let same = ids_a == ids_b;
        let opts = ClashOptions { tolerance: st.tol_mm / 1000.0, clearance: st.clearance_mm / 1000.0 };
        let mut res = if same { clash::detect(&ra, &ra, opts, &ignore) } else { clash::detect(&ra, &rb, opts, &ignore) };
        // dedup symmetric pairs
        let mut seen = FxHashSet::default();
        res.retain(|c| seen.insert((c.a.min(c.b), c.a.max(c.b))));
        st.results = res;
        st.millis = t.elapsed().as_secs_f64() * 1000.0;
        st.ran = true;
    }
    if !st.ran {
        ui.weak("Findet Durchdringungen zwischen Bauteilen (exakter Dreieckstest mit Toleranz) und optional Unterschreitungen eines Mindestabstands.");
        return;
    }
    ui.separator();
    let hard = st.results.iter().filter(|c| c.hard).count();
    ui.horizontal(|ui| {
        ui.label(RichText::new(format!("{} Kollisionen ({hard} hart) · {:.0} ms", st.results.len(), st.millis)).strong());
        if !st.results.is_empty() && ui.button("Alle einfärben").clicked() {
            let mut a_ids = FxHashSet::default();
            let mut b_ids = FxHashSet::default();
            for c in &st.results {
                a_ids.insert(c.a);
                b_ids.insert(c.b);
            }
            for (i, o) in s.scene.objects.clone().iter().enumerate() {
                let col = if a_ids.contains(&o.id) { Some([230, 60, 60, 255]) } else if b_ids.contains(&o.id) { Some([250, 200, 50, 255]) } else { Some([200, 200, 200, 90]) };
                s.scene.set_override(i as u32, col);
            }
            s.legend = vec![("Gruppe A".into(), [230, 60, 60, 255], a_ids.len()), ("Gruppe B".into(), [250, 200, 50, 255], b_ids.len())];
            s.view_dirty = true;
        }
        if ui.button("Farben zurücksetzen").clicked() {
            s.color_mode = crate::session::ColorMode::Ifc;
            s.recolor();
        }
    });
    let mut pick: Option<(u32, u32, glam::Vec3)> = None;
    let results = st.results.clone();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show_rows(ui, 20.0, results.len(), |ui, range| {
        for i in range {
            let c = &results[i];
            ui.horizontal(|ui| {
                ui.colored_label(if c.hard { Color32::from_rgb(240, 90, 80) } else { Color32::from_rgb(255, 170, 40) }, if c.hard { "●" } else { "○" });
                let txt = format!("{} ↔ {}", model::label(&s.doc, c.a), model::label(&s.doc, c.b));
                if ui.selectable_label(s.selection.contains(&c.a) && s.selection.contains(&c.b), txt).clicked() {
                    pick = Some((c.a, c.b, c.point));
                }
            });
        }
    });
    if let Some((a, b, p)) = pick {
        s.select(vec![a, b], false);
        if let Some((lo, hi)) = s.scene.bbox_of([a, b]) {
            let r = ((hi - lo).length() * 0.25).max(0.5);
            s.camera.fit(p - glam::Vec3::splat(r), p + glam::Vec3::splat(r));
            s.view_dirty = true;
        }
        s.measure.results.clear();
    }
}
