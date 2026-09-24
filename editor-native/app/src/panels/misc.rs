//! Notes and recent-files panels.

use crate::app::{Action, AppCtx};
use crate::icons as ic;
use crate::session::Session;

pub fn notes(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let key = s.path.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| format!("unsaved-{}", s.uid));
    let mut text = app.settings.notes.get(&key).cloned().unwrap_or_default();
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(format!("{} Notizen zu {}", ic::EDIT, s.title())).strong());
        ui.weak("(lokal gespeichert, nicht in der IFC-Datei)");
    });
    let r = ui.add_sized(ui.available_size(), egui::TextEdit::multiline(&mut text).hint_text("Freie Notizen, Aufgaben, Fragen zum Modell …"));
    if r.changed() {
        app.settings.notes.insert(key, text);
    }
    if r.lost_focus() {
        app.settings.save();
    }
}

fn rel_time(secs: i64) -> String {
    let d = chrono::Utc::now().timestamp() - secs;
    match d {
        d if d < 60 => "gerade eben".into(),
        d if d < 3600 => format!("vor {} Minuten", d / 60),
        d if d < 86_400 => format!("vor {} Stunden", d / 3600),
        d => format!("vor {} Tagen", d / 86_400),
    }
}

pub fn recent(ui: &mut egui::Ui, open_paths: &[std::path::PathBuf], app: &mut AppCtx) {
    let list = app.settings.recent.clone();
    if list.is_empty() {
        ui.weak("Noch keine Dateien geöffnet.");
        return;
    }
    egui::Grid::new("recent-grid").striped(true).num_columns(6).show(ui, |ui| {
        ui.strong("Datei");
        ui.strong("Schema");
        ui.strong("Entities");
        ui.strong("Größe");
        ui.strong("Geöffnet");
        ui.label("");
        ui.end_row();
        for p in list {
            let key = p.display().to_string();
            let meta = app.settings.recent_meta.get(&key).cloned();
            let exists = p.exists();
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let is_open = open_paths.contains(&p);
            let r = ui.add_enabled(exists, egui::Link::new(if is_open { format!("● {name}") } else { name }));
            if r.clicked() {
                app.actions.push(Action::Open(p.clone()));
            }
            r.on_hover_text(p.display().to_string());
            ui.label(meta.as_ref().map(|m| m.0.clone()).unwrap_or_default());
            ui.label(meta.as_ref().map(|m| crate::session::fmt_count(m.1)).unwrap_or_default());
            ui.label(std::fs::metadata(&p).map(|m| format!("{:.1} MB", m.len() as f64 / 1e6)).unwrap_or_else(|_| "fehlt".into()));
            ui.label(meta.as_ref().map(|m| rel_time(m.2)).unwrap_or_default());
            if ui.small_button(ic::CLOSE).on_hover_text("Aus Liste entfernen").clicked() {
                app.settings.recent.retain(|x| x != &p);
                app.settings.save();
            }
            ui.end_row();
        }
    });
}
