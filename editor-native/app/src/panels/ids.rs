//! IDS checking panel.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::ids::{self, Ids, SpecResult};

#[derive(Default)]
pub struct IdsState {
    pub ids: Option<(String, Ids)>,
    pub results: Vec<SpecResult>,
    pub error: Option<String>,
    pub millis: f64,
    pub checked_rev: Option<(u64, u64)>,
}

fn load(st: &mut IdsState, path: &std::path::Path) {
    match std::fs::read_to_string(path).map_err(anyhow::Error::from).and_then(|t| ids::parse(&t)) {
        Ok(i) => {
            st.ids = Some((path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), i));
            st.results.clear();
            st.error = None;
            st.checked_rev = None;
        }
        Err(e) => st.error = Some(format!("IDS konnte nicht gelesen werden: {e}")),
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    if let Some(p) = app.panel_state.ids_path.take() {
        load(&mut app.panel_state.ids, &p);
    }
    let st = &mut app.panel_state.ids;
    ui.horizontal(|ui| {
        if ui.button(format!("{} IDS laden …", ic::OPEN)).clicked() {
            if let Some(p) = rfd::FileDialog::new().add_filter("IDS", &["ids", "xml"]).pick_file() {
                load(st, &p);
            }
        }
        let can = st.ids.is_some();
        if ui.add_enabled(can, egui::Button::new(format!("{} Prüfen", ic::CHECK))).clicked() {
            let t = std::time::Instant::now();
            st.results = ids::check(&s.doc, &st.ids.as_ref().unwrap().1);
            st.millis = t.elapsed().as_secs_f64() * 1000.0;
            st.checked_rev = Some((s.uid, s.doc.revision()));
        }
        if !st.results.is_empty() && ui.button(format!("{} BCF …", ic::EXPORT)).on_hover_text("Nicht erfüllte Spezifikationen als BCF-Themen").clicked() {
            let topics: Vec<crate::bcf::Topic> = st.results.iter().filter(|r| !r.spec_ok).map(|r| crate::bcf::Topic {
                title: format!("IDS: {}", r.name),
                description: format!("{} von {} Objekten erfüllen die Anforderungen nicht. {}", r.failures.len(), r.applicable.len(), r.note),
                components: r.failures.iter().take(2000).filter_map(|f| s.doc.guid_of(f.id)).collect(),
                camera: Some(s.camera.clone()),
                origin: s.scene.origin,
                snapshot_png: None,
                status: "Open".into(),
                topic_type: "Error".into(),
            })
            .collect();
            if let Some(p) = rfd::FileDialog::new().add_filter("BCF", &["bcf", "bcfzip"]).set_file_name("IDS-Befunde.bcf").save_file() {
                let _ = crate::bcf::write_bcf(&p, &s.title(), &topics);
            }
        }
        if !st.results.is_empty() && ui.button(format!("{} Bericht (CSV) …", ic::EXPORT)).clicked() {
            if let Some(p) = rfd::FileDialog::new().add_filter("CSV", &["csv"]).set_file_name("IDS-Bericht.csv").save_file() {
                let _ = std::fs::write(p, ids::report_csv(&s.doc, &st.results));
            }
        }
    });
    if let Some(e) = &st.error {
        ui.colored_label(Color32::from_rgb(240, 90, 80), e);
    }
    let Some((name, i)) = &st.ids else {
        ui.weak("IDS-Datei (Information Delivery Specification 1.0) laden oder per Drag & Drop ablegen.");
        return;
    };
    ui.label(RichText::new(format!("{name} – {} ({} Spezifikationen)", i.title, i.specs.len())).strong());
    if st.checked_rev.is_some() && st.checked_rev != Some((s.uid, s.doc.revision())) {
        ui.colored_label(Color32::from_rgb(255, 170, 40), "Modell wurde seit der Prüfung geändert – erneut prüfen.");
    }
    if st.results.is_empty() {
        for sp in &i.specs {
            ui.label(format!("• {} – {} Anforderungen", sp.name, sp.requirements.len()));
        }
        return;
    }
    let ok = st.results.iter().filter(|r| r.spec_ok).count();
    ui.label(format!("{ok}/{} Spezifikationen erfüllt · {:.0} ms", st.results.len(), st.millis));
    let mut select: Option<Vec<u32>> = None;
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for (k, r) in st.results.iter().enumerate() {
            let col = if r.spec_ok { Color32::from_rgb(90, 200, 110) } else { Color32::from_rgb(240, 90, 80) };
            let title = RichText::new(format!("{} {}  –  {}/{} bestanden", if r.spec_ok { "✔" } else { "✖" }, r.name, r.passed, r.applicable.len())).color(col);
            egui::CollapsingHeader::new(title).id_salt(("idsres", k)).show(ui, |ui| {
                if !r.description.is_empty() {
                    ui.weak(&r.description);
                }
                if !r.note.is_empty() {
                    ui.colored_label(col, &r.note);
                }
                ui.horizontal(|ui| {
                    if ui.small_button("Anwendbare auswählen").clicked() {
                        select = Some(r.applicable.clone());
                    }
                    if !r.failures.is_empty() && ui.small_button("Fehlerhafte auswählen").clicked() {
                        select = Some(r.failures.iter().map(|f| f.id).collect());
                    }
                });
                for f in r.failures.iter().take(500) {
                    ui.horizontal_wrapped(|ui| {
                        if ui.link(format!("#{} {}", f.id, ifc_doc::model::label(&s.doc, f.id))).clicked() {
                            select = Some(vec![f.id]);
                        }
                        ui.weak(&f.reason);
                    });
                }
                if r.failures.len() > 500 {
                    ui.weak(format!("… {} weitere", r.failures.len() - 500));
                }
            });
        }
    });
    if let Some(sel) = select {
        s.select(sel, false);
        s.fit_selection();
    }
}
