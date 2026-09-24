//! BCF topics: load a .bcf/.bcfzip, list topics with snapshot, apply viewpoints,
//! add topics from the current view, save all topics as BCF.

use crate::app::AppCtx;
use crate::bcf::{self, ImportedTopic};
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};

#[derive(Default)]
pub struct BcfState {
    pub topics: Vec<ImportedTopic>,
    pub source: String,
    pub selected: Option<usize>,
    pub filter: String,
    pub new_title: String,
    pub new_desc: String,
    thumbs: std::collections::HashMap<usize, egui::TextureHandle>,
    pub error: Option<String>,
}

impl BcfState {
    pub fn load(&mut self, path: &std::path::Path) {
        match bcf::read_bcf(path) {
            Ok(t) => {
                self.topics = t;
                self.source = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                self.selected = None;
                self.thumbs.clear();
                self.error = None;
            }
            Err(e) => self.error = Some(e.to_string()),
        }
    }
}

fn status_color(s: &str) -> Color32 {
    match s.to_lowercase().as_str() {
        "closed" | "resolved" | "done" | "geschlossen" | "erledigt" => Color32::from_rgb(110, 200, 120),
        "open" | "offen" | "new" | "neu" => Color32::from_rgb(240, 130, 90),
        _ => Color32::from_rgb(230, 180, 80),
    }
}

fn thumb(ui: &egui::Ui, st: &mut BcfState, i: usize) -> Option<egui::TextureHandle> {
    if let Some(t) = st.thumbs.get(&i) {
        return Some(t.clone());
    }
    let bytes = st.topics.get(i)?.snapshot.as_ref()?;
    let img = image::load_from_memory(bytes).ok()?.thumbnail(480, 320).to_rgba8();
    let (w, h) = img.dimensions();
    let ci = egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &img.into_raw());
    let tex = ui.ctx().load_texture(format!("bcf-thumb-{i}"), ci, egui::TextureOptions::LINEAR);
    st.thumbs.insert(i, tex.clone());
    Some(tex)
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.bcf;
    let mut apply: Option<usize> = None;
    let mut save = false;
    let mut add = false;
    ui.horizontal_wrapped(|ui| {
        if ui.button(format!("{} BCF laden …", ic::OPEN)).clicked() {
            if let Some(p) = rfd::FileDialog::new().add_filter("BCF", &["bcf", "bcfzip"]).pick_file() {
                st.load(&p);
            }
        }
        if ui.add_enabled(!st.topics.is_empty(), egui::Button::new(format!("{} Speichern unter …", ic::SAVE))).clicked() {
            save = true;
        }
        if !st.source.is_empty() {
            ui.weak(format!("{} · {} Themen", st.source, st.topics.len()));
        }
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Titel, Status, Zuständig").desired_width(140.0));
    });
    if let Some(e) = &st.error {
        ui.colored_label(Color32::from_rgb(240, 110, 90), e);
    }
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::TextEdit::singleline(&mut st.new_title).hint_text("Neues Thema: Titel").desired_width(200.0));
        ui.add(egui::TextEdit::singleline(&mut st.new_desc).hint_text("Beschreibung").desired_width(220.0));
        if ui.add_enabled(!st.new_title.trim().is_empty(), egui::Button::new(format!("{} Aus aktueller Ansicht", ic::CAMERA))).on_hover_text("Kamera, Auswahl und Bildschirmfoto übernehmen").clicked() {
            add = true;
        }
    });
    ui.separator();
    let filter = st.filter.to_lowercase();
    let visible: Vec<usize> = (0..st.topics.len())
        .filter(|&i| {
            let t = &st.topics[i];
            filter.is_empty() || t.title.to_lowercase().contains(&filter) || t.status.to_lowercase().contains(&filter) || t.assigned.to_lowercase().contains(&filter) || t.topic_type.to_lowercase().contains(&filter)
        })
        .collect();
    if st.topics.is_empty() {
        ui.weak("BCF-Datei laden (Themen mit Kamera, Auswahl, Kommentaren und Bildschirmfoto) oder ein Thema aus der aktuellen Ansicht anlegen.");
    }
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for i in visible {
            let is_sel = st.selected == Some(i);
            let t = st.topics[i].clone();
            let frame = egui::Frame::group(ui.style()).fill(if is_sel { ui.visuals().selection.bg_fill.gamma_multiply(0.35) } else { ui.visuals().faint_bg_color });
            let r = frame
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(if t.status.is_empty() { "–".to_string() } else { t.status.clone() }).color(status_color(&t.status)).strong());
                        ui.label(RichText::new(&t.title).strong());
                        if !t.topic_type.is_empty() {
                            ui.weak(format!("· {}", t.topic_type));
                        }
                        if !t.priority.is_empty() {
                            ui.weak(format!("· Priorität {}", t.priority));
                        }
                    });
                    ui.horizontal_wrapped(|ui| {
                        ui.weak(format!("{} · {}", t.author, t.date.get(..10).unwrap_or(&t.date)));
                        if !t.assigned.is_empty() {
                            ui.weak(format!("· zuständig: {}", t.assigned));
                        }
                        if !t.due.is_empty() {
                            ui.weak(format!("· fällig: {}", t.due.get(..10).unwrap_or(&t.due)));
                        }
                        if let Some(vp) = &t.viewpoint {
                            ui.weak(format!("· {} Objekte", vp.selection.len()));
                        }
                        if !t.comments.is_empty() {
                            ui.weak(format!("· {} Kommentare", t.comments.len()));
                        }
                    });
                    if is_sel {
                        if let Some(tex) = thumb(ui, st, i) {
                            let w = ui.available_width().min(420.0);
                            let size = tex.size_vec2();
                            ui.add(egui::Image::new(&tex).fit_to_exact_size(egui::vec2(w, w * size.y / size.x.max(1.0))).corner_radius(4.0));
                        }
                        if !t.description.is_empty() {
                            ui.label(&t.description);
                        }
                        for c in &t.comments {
                            ui.horizontal_wrapped(|ui| {
                                ui.label(RichText::new(format!("{} ({})", c.author, c.date.get(..16).unwrap_or(&c.date))).weak().small());
                                ui.label(&c.text);
                            });
                        }
                    }
                })
                .response;
            if r.interact(egui::Sense::click()).clicked() {
                st.selected = Some(i);
                apply = Some(i);
            }
            ui.add_space(2.0);
        }
    });
    // ---------------------------------------------------------------- actions
    if let Some(i) = apply {
        if let Some(vp) = app.panel_state.bcf.topics.get(i).and_then(|t| t.viewpoint.clone()) {
            let (found, total) = bcf::apply_viewpoint(s, &vp);
            if total > 0 && found < total {
                app.toast(format!("{found} von {total} Objekten des Themas im Modell gefunden"));
            }
        }
    }
    if add {
        let st = &mut app.panel_state.bcf;
        let snap = app.renderer.as_ref().and_then(|r| r.read_color()).and_then(|(w, h, d)| bcf::png_bytes(w, h, &d));
        let sel: Vec<String> = s.selection.iter().filter_map(|&i| s.doc.guid_of(i)).collect();
        let c = &s.camera;
        let eye = c.eye().as_dvec3() + s.scene.origin;
        let dir = (-c.dir()).as_dvec3();
        st.topics.push(ImportedTopic {
            guid: String::new(),
            title: st.new_title.trim().to_string(),
            description: st.new_desc.trim().to_string(),
            status: "Open".into(),
            topic_type: "Issue".into(),
            author: if app.settings.author.is_empty() { "IFCnative".into() } else { app.settings.author.clone() },
            date: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            viewpoint: Some(bcf::Viewpoint { eye: Some(eye), dir: Some(dir), ortho: c.ortho, view_scale: None, selection: sel, default_visible: true, exceptions: vec![] }),
            snapshot: snap,
            ..Default::default()
        });
        st.new_title.clear();
        st.new_desc.clear();
        st.selected = Some(st.topics.len() - 1);
    }
    if save {
        let st = &app.panel_state.bcf;
        let topics: Vec<bcf::Topic> = st.topics.iter().map(|t| bcf::to_export(t, s)).collect();
        if let Some(p) = rfd::FileDialog::new().add_filter("BCF", &["bcf", "bcfzip"]).set_file_name(if st.source.is_empty() { "Themen.bcf".to_string() } else { st.source.clone() }).save_file() {
            match bcf::write_bcf(&p, &s.title(), &topics) {
                Ok(()) => app.toast(format!("{} Themen als BCF gespeichert", topics.len())),
                Err(e) => app.error(e.to_string()),
            }
        }
    }
}
