//! IDS checking panel (+ ID check box).

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::ids::{self, Ids, SpecResult, SpecStatus};

#[derive(Default)]
pub struct IdsState {
    pub ids: Option<(String, Ids)>,
    pub results: Vec<SpecResult>,
    pub error: Option<String>,
    pub millis: f64,
    pub checked_rev: Option<(u64, u64)>,
    pub filter: String,
    pub auto: bool,
    pub id_text: String,
    pub id_results: Vec<(String, String, Vec<u32>)>,
}

fn load(st: &mut IdsState, path: &std::path::Path) {
    match std::fs::read_to_string(path).map_err(anyhow::Error::from).and_then(|t| ids::parse(&t)) {
        Ok(i) => {
            st.ids = Some((path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), i));
            st.results.clear();
            st.error = None;
            st.checked_rev = None;
            st.auto = true;
        }
        Err(e) => st.error = Some(format!("IDS konnte nicht gelesen werden: {e}")),
    }
}

fn run(st: &mut IdsState, s: &Session) {
    if let Some((_, i)) = &st.ids {
        let t = std::time::Instant::now();
        st.results = ids::check(&s.doc, i);
        st.millis = t.elapsed().as_secs_f64() * 1000.0;
        st.checked_rev = Some((s.uid, s.doc.revision()));
    }
}

/// Resolve pasted identifiers (#STEP-Id, GlobalId, Tag, Name).
fn check_ids(s: &Session, text: &str) -> Vec<(String, String, Vec<u32>)> {
    let doc = &s.doc;
    let guids = ifc_doc::model::guid_index(doc);
    let mut lower: std::collections::HashMap<String, Vec<u32>> = Default::default();
    for (g, id) in &guids {
        lower.entry(g.to_lowercase()).or_default().push(*id);
    }
    let mut by_tag: std::collections::HashMap<String, Vec<u32>> = Default::default();
    for id in doc.ids_with_flag(ifc_doc::tflags::PRODUCT) {
        if let Some(t) = doc.attr_str(id, "Tag") {
            by_tag.entry(t).or_default().push(id);
        }
    }
    let mut seen: std::collections::HashMap<String, usize> = Default::default();
    let tokens: Vec<String> = text.split(|c: char| c.is_whitespace() || c == ',' || c == ';').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    for t in &tokens {
        *seen.entry(t.clone()).or_default() += 1;
    }
    tokens
        .into_iter()
        .map(|t| {
            if seen.get(&t).copied().unwrap_or(0) > 1 {
                return (t.clone(), "doppelt in der Liste".into(), vec![]);
            }
            if let Some(n) = t.strip_prefix('#').and_then(|x| x.parse::<u32>().ok()) {
                return if doc.exists(n) { (t, format!("OK – {}", ifc_doc::model::label(doc, n)), vec![n]) } else { (t, "fehlt".into(), vec![]) };
            }
            if let Some(&id) = guids.get(&t) {
                return (t, format!("OK – {}", ifc_doc::model::label(doc, id)), vec![id]);
            }
            if let Some(ids) = lower.get(&t.to_lowercase()) {
                return (t, "Groß-/Kleinschreibung weicht ab".into(), ids.clone());
            }
            if let Some(ids) = by_tag.get(&t) {
                return (t, if ids.len() > 1 { format!("Tag mehrdeutig ({}×)", ids.len()) } else { "OK (Tag)".into() }, ids.clone());
            }
            (t, "fehlt".into(), vec![])
        })
        .collect()
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    if let Some(p) = app.panel_state.ids_path.take() {
        load(&mut app.panel_state.ids, &p);
        run(&mut app.panel_state.ids, s);
    }
    let st = &mut app.panel_state.ids;
    // automatic re-check after model changes
    if st.auto && st.ids.is_some() && st.checked_rev.map(|r| r.1 != s.doc.revision() || r.0 != s.uid).unwrap_or(false) && s.loading.is_none() {
        run(st, s);
    }
    ui.horizontal(|ui| {
        if ui.button(format!("{} IDS laden …", ic::OPEN)).clicked() {
            if let Some(p) = rfd::FileDialog::new().add_filter("IDS", &["ids", "xml"]).pick_file() {
                load(st, &p);
                run(st, s);
            }
        }
        if ui.add_enabled(st.ids.is_some(), egui::Button::new(format!("{} Prüfen", ic::CHECK))).clicked() {
            run(st, s);
        }
        ui.checkbox(&mut st.auto, "bei Änderungen neu prüfen");
        if !st.results.is_empty() && ui.button(format!("{} Einfärben", ic::PALETTE)).on_hover_text("Ergebnis im 3D: grün = erfüllt, rot = Verstoß, grau = nicht geprüft").clicked() {
            // an object failing any specification is red, applicable and never failing is green
            let mut map: rustc_hash::FxHashMap<u32, String> = rustc_hash::FxHashMap::default();
            for r in &st.results {
                for &id in &r.applicable {
                    map.entry(id).or_insert_with(|| "erfüllt".to_string());
                }
            }
            for r in &st.results {
                for f in &r.failures {
                    map.insert(f.id, "nicht erfüllt".to_string());
                }
            }
            s.color_mode = crate::session::ColorMode::Custom {
                title: "IDS-Ergebnis".into(),
                map: std::sync::Arc::new(map),
                colors: vec![("erfüllt".into(), [70, 185, 100, 255]), ("nicht erfüllt".into(), [225, 70, 60, 255])],
                other: Some(("nicht geprüft".into(), [175, 178, 185, 255])),
            };
            s.recolor();
        }
        if !st.results.is_empty() && ui.button(format!("{} BCF …", ic::EXPORT)).on_hover_text("Nicht erfüllte Spezifikationen als BCF-Themen").clicked() {
            let topics: Vec<crate::bcf::Topic> = st
                .results
                .iter()
                .filter(|r| r.status == SpecStatus::Fail)
                .map(|r| crate::bcf::Topic {
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
    let mut select: Option<Vec<u32>> = None;
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        if let Some((name, i)) = &st.ids {
            egui::CollapsingHeader::new(RichText::new(format!("{name} – {} ({} Spezifikationen)", i.title, i.specs.len())).strong()).default_open(false).show(ui, |ui| {
                egui::Grid::new("ids-info").num_columns(2).show(ui, |ui| {
                    for (k, v) in &i.info {
                        ui.weak(k);
                        ui.label(v);
                        ui.end_row();
                    }
                });
                for w in &i.warnings {
                    ui.colored_label(Color32::from_rgb(255, 170, 40), format!("{} {w}", ic::WARN));
                }
            });
            if !st.results.is_empty() {
                let (p, f, n) = st.results.iter().fold((0, 0, 0), |a, r| match r.status {
                    SpecStatus::Pass => (a.0 + 1, a.1, a.2),
                    SpecStatus::Fail => (a.0, a.1 + 1, a.2),
                    SpecStatus::NotApplicable => (a.0, a.1, a.2 + 1),
                });
                let violations: usize = st.results.iter().map(|r| r.failures.len()).sum();
                ui.horizontal(|ui| {
                    ui.colored_label(Color32::from_rgb(90, 200, 110), format!("✔ {p} erfüllt"));
                    ui.colored_label(Color32::from_rgb(240, 90, 80), format!("✖ {f} nicht erfüllt"));
                    ui.weak(format!("○ {n} nicht anwendbar · {violations} Verstöße · {:.0} ms", st.millis));
                    ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Spezifikationen filtern").desired_width(140.0));
                });
            }
            let flt = st.filter.to_lowercase();
            for (k, spec) in i.specs.iter().enumerate() {
                if !flt.is_empty() && !spec.name.to_lowercase().contains(&flt) {
                    continue;
                }
                let r = st.results.get(k);
                let (sym, col) = match r.map(|r| r.status) {
                    Some(SpecStatus::Pass) => ("✔", Color32::from_rgb(90, 200, 110)),
                    Some(SpecStatus::Fail) => ("✖", Color32::from_rgb(240, 90, 80)),
                    Some(SpecStatus::NotApplicable) => ("○", Color32::GRAY),
                    None => ("·", Color32::GRAY),
                };
                let counts = r.map(|r| format!("  –  {}/{} bestanden", r.passed, r.applicable.len())).unwrap_or_default();
                let title = RichText::new(format!("{sym} {}{counts}", spec.name)).color(col);
                egui::CollapsingHeader::new(title).id_salt(("idsres", k)).show(ui, |ui| {
                    ui.horizontal_wrapped(|ui| {
                        if !spec.identifier.is_empty() {
                            ui.label(RichText::new(&spec.identifier).monospace().background_color(ui.visuals().faint_bg_color));
                        }
                        if !spec.ifc_version.is_empty() {
                            ui.label(RichText::new(&spec.ifc_version).small().background_color(ui.visuals().faint_bg_color));
                        }
                    });
                    if !spec.description.is_empty() {
                        ui.weak(&spec.description);
                    }
                    if !spec.instructions.is_empty() {
                        ui.label(RichText::new(format!("Hinweis: {}", spec.instructions)).italics());
                    }
                    ui.label(RichText::new("Anwendbar auf:").strong());
                    for f in &spec.applicability {
                        ui.label(format!("• {}", ids::describe(f)));
                    }
                    ui.label(RichText::new("Anforderungen:").strong());
                    for q in &spec.requirements {
                        ui.horizontal_wrapped(|ui| {
                            ui.label(format!("• {}", ids::describe(&q.facet)));
                            ui.label(RichText::new(ids::cardinality_label(q.card)).small().background_color(ui.visuals().faint_bg_color));
                            if let Some(ins) = &q.instructions {
                                ui.weak(ins);
                            }
                        });
                    }
                    if let Some(r) = r {
                        if !r.note.is_empty() {
                            ui.colored_label(col, &r.note);
                        }
                        ui.horizontal(|ui| {
                            if !r.applicable.is_empty() && ui.small_button("Anwendbare auswählen").clicked() {
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
                                for part in f.reason.split("; ") {
                                    ui.weak(format!("– {part}"));
                                }
                            });
                        }
                        if r.failures.len() > 500 {
                            ui.weak(format!("… {} weitere", r.failures.len() - 500));
                        }
                    }
                });
            }
        } else {
            ui.weak("IDS-Datei (Information Delivery Specification 1.0) laden oder per Drag & Drop ablegen.");
        }
        ui.separator();
        egui::CollapsingHeader::new(RichText::new(format!("{} ID-Prüfung", ic::SEARCH)).strong()).default_open(false).show(ui, |ui| {
            ui.weak("IDs einfügen (#STEP-Id, GlobalId oder Tag) – je Zeile, Komma oder Leerzeichen getrennt:");
            ui.add(egui::TextEdit::multiline(&mut st.id_text).desired_rows(3).desired_width(f32::INFINITY));
            if ui.button("Prüfen").clicked() {
                st.id_results = check_ids(s, &st.id_text);
            }
            for (t, status, ids) in &st.id_results {
                ui.horizontal(|ui| {
                    let col = if status.starts_with("OK") { Color32::from_rgb(90, 200, 110) } else if status == "fehlt" { Color32::from_rgb(240, 90, 80) } else { Color32::from_rgb(255, 170, 40) };
                    if ui.link(RichText::new(t).monospace()).clicked() && !ids.is_empty() {
                        select = Some(ids.clone());
                    }
                    ui.colored_label(col, status);
                });
            }
        });
    });
    if let Some(sel) = select {
        s.select(sel, false);
        s.fit_selection();
    }
}
