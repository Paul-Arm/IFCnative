//! Model statistics: classes, geometry volumes/areas, file composition.

use crate::app::AppCtx;
use crate::session::{fmt_count, Session};
use egui::{Color32, Pos2, Rect, Vec2};
use glam::Vec3;
use rustc_hash::FxHashMap;

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let doc = &s.doc;
    ui.heading("Statistik");
    egui::Grid::new("st-top").num_columns(2).striped(true).show(ui, |ui| {
        ui.label("Entities");
        ui.label(fmt_count(doc.len()));
        ui.end_row();
        ui.label("Objekte mit Geometrie");
        ui.label(fmt_count(s.scene.objects.iter().filter(|o| o.geom.is_some()).count()));
        ui.end_row();
        ui.label("Dreiecke");
        ui.label(fmt_count(s.scene.total_tris));
        ui.end_row();
        ui.label("GPU-Blöcke");
        ui.label(s.scene.chunks.len().to_string());
        ui.end_row();
        if let Some((lo, hi)) = s.scene.bbox {
            let d = hi - lo;
            ui.label("Ausdehnung");
            ui.label(format!("{:.2} × {:.2} × {:.2} m", d.x, d.y, d.z));
            ui.end_row();
        }
        ui.label("Ursprung (Verschiebung)");
        ui.label(format!("{:.1}, {:.1}, {:.1}", s.scene.origin.x, s.scene.origin.y, s.scene.origin.z));
        ui.end_row();
        if let Some(st) = &doc.load_stats {
            ui.label("Dateigröße");
            ui.label(format!("{:.1} MB", st.bytes as f64 / 1e6));
            ui.end_row();
            ui.label("Parsen + Indizieren");
            ui.label(format!("{:.0} ms (Scan {:.0}, Index {:.0})", st.total_ms, st.scan_ms, st.index_ms));
            ui.end_row();
        }
    });
    ui.separator();
    // per class: count, triangles, volume, area (cached per scene revision)
    let key = (s.uid, s.scene.revision);
    if app.panel_state.stats_cache.as_ref().map(|c| c.0 != key).unwrap_or(true) {
        use rayon::prelude::*;
        let per_obj: Vec<(String, usize, f64, f64)> = s.scene.objects.par_iter().filter_map(|o| {
            let g = o.geom.as_ref()?;
            let (v, a) = volume_area(g);
            Some((doc.type_camel(o.id).unwrap_or("?").to_string(), g.tri_count(), v, a))
        })
        .collect();
        let mut per: FxHashMap<String, (usize, usize, f64, f64)> = FxHashMap::default();
        for (c, t, v, a) in per_obj {
            let e = per.entry(c).or_default();
            e.0 += 1;
            e.1 += t;
            e.2 += v;
            e.3 += a;
        }
        let mut rows: Vec<(String, (usize, usize, f64, f64))> = per.into_iter().collect();
        rows.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
        app.panel_state.stats_cache = Some((key, rows));
    }
    let rows = app.panel_state.stats_cache.as_ref().map(|c| c.1.clone()).unwrap_or_default();
    let max = rows.first().map(|r| r.1 .0).unwrap_or(1).max(1);
    ui.strong("Klassen (Geometrie aus der Triangulierung)");
    egui::Grid::new("st-classes").num_columns(6).striped(true).show(ui, |ui| {
        ui.strong("Klasse");
        ui.strong("Anzahl");
        ui.label("");
        ui.strong("Dreiecke");
        ui.strong("Volumen m³");
        ui.strong("Oberfläche m²");
        ui.end_row();
        for (c, (n, t, v, a)) in &rows {
            ui.label(c);
            ui.label(n.to_string());
            let (rect, _) = ui.allocate_exact_size(Vec2::new(120.0, 12.0), egui::Sense::hover());
            let w = rect.width() * (*n as f32 / max as f32);
            ui.painter().rect_filled(Rect::from_min_size(rect.min, Vec2::new(w, rect.height())), 2.0, Color32::from_rgb(90, 140, 230));
            let _ = Pos2::ZERO;
            ui.label(fmt_count(*t));
            ui.label(format!("{v:.2}"));
            ui.label(format!("{a:.1}"));
            ui.end_row();
        }
    });
}

/// Mesh volume (absolute signed volume) and surface area.
pub fn volume_area(g: &ifc_geom::ProductGeom) -> (f64, f64) {
    let mut v = 0.0f64;
    let mut a = 0.0f64;
    for t in g.indices.chunks_exact(3) {
        let p0 = Vec3::from(g.positions[t[0] as usize]).as_dvec3();
        let p1 = Vec3::from(g.positions[t[1] as usize]).as_dvec3();
        let p2 = Vec3::from(g.positions[t[2] as usize]).as_dvec3();
        v += p0.dot(p1.cross(p2));
        a += (p1 - p0).cross(p2 - p0).length() * 0.5;
    }
    ((v / 6.0).abs(), a)
}
