//! Undo history.

use crate::app::{Action, AppCtx};
use crate::icons as ic;
use crate::session::Session;

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    ui.horizontal(|ui| {
        if ui.add_enabled(s.doc.can_undo(), egui::Button::new(format!("{} Rückgängig", ic::UNDO))).clicked() {
            app.actions.push(Action::Undo);
        }
        if ui.add_enabled(s.doc.can_redo(), egui::Button::new(format!("{} Wiederholen", ic::REDO))).clicked() {
            app.actions.push(Action::Redo);
        }
    });
    ui.separator();
    let hist: Vec<(String, usize, std::time::SystemTime)> = s.doc.history().iter().map(|t| (t.label.clone(), t.changes.len(), t.time)).collect();
    let redo: Vec<(String, usize)> = s.doc.redo_stack().iter().rev().map(|t| (t.label.clone(), t.changes.len())).collect();
    if hist.is_empty() && redo.is_empty() {
        ui.weak("Noch keine Änderungen.");
        return;
    }
    let mut undo_to: Option<usize> = None;
    let mut redo_n: Option<usize> = None;
    for (i, (label, n, time)) in hist.iter().enumerate().rev() {
        let ago = time.elapsed().map(|d| d.as_secs()).unwrap_or(0);
        let when = if ago < 60 { format!("vor {ago} s") } else { format!("vor {} min", ago / 60) };
        if ui.selectable_label(i + 1 == hist.len(), format!("{label}  · {n} Änderungen · {when}")).on_hover_text("Klicken: bis hierher zurücksetzen").clicked() {
            undo_to = Some(hist.len() - 1 - i);
        }
    }
    if !redo.is_empty() {
        ui.separator();
        ui.weak("Wiederholbar:");
        for (i, (label, n)) in redo.iter().enumerate() {
            if ui.selectable_label(false, egui::RichText::new(format!("{label}  · {n}")).italics().weak()).clicked() {
                redo_n = Some(redo.len() - i);
            }
        }
    }
    if let Some(k) = undo_to {
        for _ in 0..k {
            app.actions.push(Action::Undo);
        }
    }
    if let Some(k) = redo_n {
        for _ in 0..k {
            app.actions.push(Action::Redo);
        }
    }
}
