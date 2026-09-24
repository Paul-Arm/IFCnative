//! Application shell: documents, menus, docking layout, dialogs, shortcuts.

use crate::icons as ic;
use crate::panels;
use crate::session::{Session, Tool};
use crate::settings::Settings;
use crate::viewer::renderer::Renderer;
use crate::CliArgs;
use egui::{Align, Color32, Layout, RichText};
use egui_dock::{DockArea, DockState, NodeIndex, Style as DockStyle, TabViewer};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum Tab {
    Viewer,
    Structure,
    Classes,
    Search,
    Inspector,
    History,
    Diagnostics,
    Graph,
    Batch,
    Builder,
    Ids,
    Diff,
    Groups,
    Materials,
    Table,
    Stats,
    Clash,
}

impl Tab {
    pub fn title(self) -> String {
        let (i, t) = match self {
            Tab::Viewer => (ic::CUBE, "3D-Ansicht"),
            Tab::Structure => (ic::TREE, "Struktur"),
            Tab::Classes => (ic::LIST, "Klassen"),
            Tab::Search => (ic::FILTER, "Filter"),
            Tab::Inspector => (ic::INFO, "Eigenschaften"),
            Tab::History => (ic::HISTORY, "Verlauf"),
            Tab::Diagnostics => (ic::WARN, "Prüfung"),
            Tab::Graph => (ic::GRAPH, "Beziehungen"),
            Tab::Batch => (ic::TAG, "Pset-Stapel"),
            Tab::Builder => (ic::BUILD, "Erstellen"),
            Tab::Ids => (ic::CHECK, "IDS"),
            Tab::Diff => (ic::DIFF, "Vergleich"),
            Tab::Groups => (ic::GROUP, "Gruppen"),
            Tab::Materials => (ic::LAYERS, "Materialien"),
            Tab::Table => (ic::TABLE, "Tabelle"),
            Tab::Stats => (ic::CHART, "Statistik"),
            Tab::Clash => (ic::CLASH, "Kollisionen"),
        };
        format!("{i} {t}")
    }
    pub const ALL: [Tab; 17] = [Tab::Viewer, Tab::Structure, Tab::Classes, Tab::Search, Tab::Inspector, Tab::History, Tab::Diagnostics, Tab::Graph, Tab::Batch, Tab::Builder, Tab::Ids, Tab::Diff, Tab::Groups, Tab::Materials, Tab::Table, Tab::Stats, Tab::Clash];
}

/// State shared with panels.
pub struct AppCtx {
    pub renderer: Option<Renderer>,
    pub settings: Settings,
    pub box_start: Option<egui::Pos2>,
    pub orbit_pivot: Option<glam::Vec3>,
    pub context_menu_pos: Option<egui::Pos2>,
    pub context_menu_frames: u32,
    pub request_delete: bool,
    pub request_view_screenshot: bool,
    pub force_redraw: bool,
    pub last_view_size: (u32, u32),
    pub color_pset: String,
    pub color_prop: String,
    pub toasts: Vec<(String, std::time::Instant, bool)>,
    pub actions: Vec<Action>,
    pub panel_state: panels::PanelState,
}

impl AppCtx {
    pub fn toast(&mut self, msg: impl Into<String>) {
        self.toasts.push((msg.into(), std::time::Instant::now(), false));
    }
    pub fn error(&mut self, msg: impl Into<String>) {
        self.toasts.push((msg.into(), std::time::Instant::now(), true));
    }
}

#[derive(Clone, Debug)]
pub enum Action {
    Open(PathBuf),
    OpenDialog,
    New,
    Save,
    SaveAs,
    Close(usize),
    Undo,
    Redo,
    DeleteSelection,
    OpenTab(Tab),
    ExportSubset,
    ExportCsv,
    ExportXlsx,
    ExportObj,
    Compare(PathBuf),
}

pub struct IfcApp {
    pub ctx_state: AppCtx,
    pub sessions: Vec<Session>,
    pub active: usize,
    dock: DockState<Tab>,
    show_settings: bool,
    show_about: bool,
    show_shortcuts: bool,
    new_dialog: Option<NewProjectDialog>,
    confirm_delete: Option<Vec<u32>>,
    confirm_close: Option<usize>,
    args: CliArgs,
    frames: u64,
    screenshot_state: u8,
    applied_args: bool,
    last_autosave: std::time::Instant,
    exit_confirmed: bool,
    recovery: Vec<PathBuf>,
}

struct NewProjectDialog {
    name: String,
    schema: ifc_doc::SchemaId,
    storeys: Vec<(String, f64)>,
}

pub fn default_dock() -> DockState<Tab> {
    let mut dock = DockState::new(vec![Tab::Viewer]);
    let tree = dock.main_surface_mut();
    let [center, _left] = tree.split_left(NodeIndex::root(), 0.21, vec![Tab::Structure, Tab::Classes, Tab::Search, Tab::Groups]);
    let [center, _right] = tree.split_right(center, 0.72, vec![Tab::Inspector, Tab::History, Tab::Materials]);
    let [_c, _bottom] = tree.split_below(center, 0.72, vec![Tab::Diagnostics, Tab::Table, Tab::Batch, Tab::Builder, Tab::Graph, Tab::Ids, Tab::Clash, Tab::Diff, Tab::Stats]);
    dock
}

impl IfcApp {
    pub fn new(cc: &eframe::CreationContext<'_>, args: CliArgs) -> IfcApp {
        let mut fonts = egui::FontDefinitions::default();
        egui_phosphor::add_to_fonts(&mut fonts, egui_phosphor::Variant::Regular);
        cc.egui_ctx.set_fonts(fonts);
        egui_extras::install_image_loaders(&cc.egui_ctx);
        let settings = Settings::load();
        apply_style(&cc.egui_ctx, &settings);
        let renderer = cc.wgpu_render_state.as_ref().map(Renderer::new);
        let mut app = IfcApp {
            ctx_state: AppCtx {
                renderer,
                settings,
                box_start: None,
                orbit_pivot: None,
                context_menu_pos: None,
                context_menu_frames: 0,
                request_delete: false,
                request_view_screenshot: false,
                force_redraw: true,
                last_view_size: (0, 0),
                color_pset: String::new(),
                color_prop: String::new(),
                toasts: Vec::new(),
                actions: Vec::new(),
                panel_state: panels::PanelState::default(),
            },
            sessions: Vec::new(),
            active: 0,
            dock: default_dock(),
            show_settings: false,
            show_about: false,
            show_shortcuts: false,
            new_dialog: None,
            confirm_delete: None,
            confirm_close: None,
            args: args.clone(),
            frames: 0,
            screenshot_state: 0,
            applied_args: false,
            last_autosave: std::time::Instant::now(),
            exit_confirmed: false,
            recovery: Settings::recovery_dir().and_then(|d| std::fs::read_dir(d).ok()).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "ifc").unwrap_or(false)).collect()).unwrap_or_default(),
        };
        for f in &args.files {
            app.open_path(f.clone(), &cc.egui_ctx);
        }
        app
    }

    pub fn session(&mut self) -> Option<&mut Session> {
        self.sessions.get_mut(self.active)
    }

    pub fn open_path(&mut self, path: PathBuf, ctx: &egui::Context) {
        if let Some(i) = self.sessions.iter().position(|s| s.path.as_ref() == Some(&path)) {
            self.active = i;
            return;
        }
        let mut opts = self.ctx_state.settings.geom_options();
        opts.include_spaces = true;
        let mut s = Session::open(path.clone(), opts, ctx.clone());
        if !self.ctx_state.settings.hide_spaces {
            s.class_hidden.clear();
        }
        self.sessions.push(s);
        self.active = self.sessions.len() - 1;
        self.ctx_state.settings.push_recent(path);
        self.ctx_state.settings.save();
        if let Some(r) = self.ctx_state.renderer.as_mut() {
            r.clear();
        }
        self.ctx_state.force_redraw = true;
    }

    fn open_dialog(&mut self, ctx: &egui::Context) {
        let dir = self.ctx_state.settings.recent.first().and_then(|p| p.parent().map(|p| p.to_path_buf()));
        let mut d = rfd::FileDialog::new().add_filter("IFC-Modelle", &["ifc", "ifczip", "IFC"]).add_filter("Alle Dateien", &["*"]);
        if let Some(dir) = dir {
            d = d.set_directory(dir);
        }
        if let Some(files) = d.pick_files() {
            for f in files {
                self.open_path(f, ctx);
            }
        }
    }

    fn save(&mut self, save_as: bool) {
        let Some(s) = self.sessions.get_mut(self.active) else { return };
        let path = if save_as || s.path.is_none() {
            let mut d = rfd::FileDialog::new().add_filter("IFC", &["ifc"]).add_filter("IFC ZIP", &["ifczip"]);
            if let Some(p) = &s.path {
                if let Some(dir) = p.parent() {
                    d = d.set_directory(dir);
                }
                if let Some(n) = p.file_name() {
                    d = d.set_file_name(n.to_string_lossy());
                }
            } else {
                d = d.set_file_name("Modell.ifc");
            }
            match d.save_file() {
                Some(p) => p,
                None => return,
            }
        } else {
            s.path.clone().unwrap()
        };
        let Some(doc) = s.doc_mut() else {
            self.ctx_state.error("Speichern nicht möglich, solange die Geometrie noch geladen wird");
            return;
        };
        let t = std::time::Instant::now();
        match doc.save_as(&path) {
            Ok(()) => {
                s.path = Some(path.clone());
                s.status = format!("Gespeichert: {} ({:.0} ms)", path.display(), t.elapsed().as_secs_f64() * 1000.0);
                self.ctx_state.toast(format!("{} Gespeichert: {}", ic::SAVE, path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
                self.ctx_state.settings.push_recent(path);
                self.ctx_state.settings.save();
                if let Some(dir) = Settings::recovery_dir() {
                    let _ = std::fs::remove_file(dir.join(format!("session-{}.ifc", s.uid)));
                }
            }
            Err(e) => self.ctx_state.error(format!("Speichern fehlgeschlagen: {e}")),
        }
    }

    fn close_session(&mut self, i: usize) {
        if i < self.sessions.len() {
            self.sessions.remove(i);
            if self.active >= self.sessions.len() {
                self.active = self.sessions.len().saturating_sub(1);
            }
            if let Some(r) = self.ctx_state.renderer.as_mut() {
                r.clear();
            }
            if let Some(s) = self.sessions.get_mut(self.active) {
                for c in 0..s.scene.chunks.len() {
                    s.scene.dirty_chunks.insert(c as u32);
                }
                s.scene.state_dirty = true;
                s.view_dirty = true;
            }
        }
    }

    fn switch_to(&mut self, i: usize) {
        if i == self.active || i >= self.sessions.len() {
            return;
        }
        self.active = i;
        if let Some(r) = self.ctx_state.renderer.as_mut() {
            r.clear();
        }
        let s = &mut self.sessions[i];
        for c in 0..s.scene.chunks.len() {
            s.scene.dirty_chunks.insert(c as u32);
        }
        s.scene.state_dirty = true;
        s.view_dirty = true;
    }

    fn process_actions(&mut self, ctx: &egui::Context) {
        let actions = std::mem::take(&mut self.ctx_state.actions);
        for a in actions {
            match a {
                Action::Open(p) => self.open_path(p, ctx),
                Action::OpenDialog => self.open_dialog(ctx),
                Action::New => {
                    self.new_dialog = Some(NewProjectDialog { name: "Neues Projekt".into(), schema: ifc_doc::SchemaId::Ifc4, storeys: vec![("Erdgeschoss".into(), 0.0), ("1. Obergeschoss".into(), 3.0)] })
                }
                Action::Save => self.save(false),
                Action::SaveAs => self.save(true),
                Action::Close(i) => {
                    if self.sessions.get(i).map(|s| s.doc.is_dirty()).unwrap_or(false) {
                        self.confirm_close = Some(i);
                    } else {
                        self.close_session(i);
                    }
                }
                Action::Undo => {
                    if let Some(s) = self.session() {
                        if let Some(doc) = s.doc_mut() {
                            if let Some(label) = doc.undo_label().map(|x| x.to_string()) {
                                doc.undo();
                                s.status = format!("Rückgängig: {label}");
                            }
                            s.after_edit();
                        }
                    }
                }
                Action::Redo => {
                    if let Some(s) = self.session() {
                        if let Some(doc) = s.doc_mut() {
                            if let Some(label) = doc.redo_label().map(|x| x.to_string()) {
                                doc.redo();
                                s.status = format!("Wiederholt: {label}");
                            }
                            s.after_edit();
                        }
                    }
                }
                Action::DeleteSelection => {
                    if let Some(s) = self.sessions.get(self.active) {
                        if !s.selection.is_empty() {
                            self.confirm_delete = Some(s.selection.clone());
                        }
                    }
                }
                Action::OpenTab(t) => self.open_tab(t),
                Action::ExportSubset => {
                    if let Some(s) = self.sessions.get(self.active) {
                        let ids: Vec<u32> = s.selection.iter().flat_map(|&id| s.tree.subtree(id)).filter(|&id| s.doc.has_flag(id, ifc_doc::tflags::PRODUCT)).collect();
                        if ids.is_empty() {
                            self.ctx_state.error("Keine Elemente ausgewählt");
                        } else if let Some(p) = rfd::FileDialog::new().add_filter("IFC", &["ifc"]).set_file_name("Auswahl.ifc").save_file() {
                            let bytes = ifc_doc::ops::export_subset(&s.doc, &ids);
                            match std::fs::write(&p, bytes) {
                                Ok(()) => self.ctx_state.toast(format!("{} Elemente exportiert", ids.len())),
                                Err(e) => self.ctx_state.error(e.to_string()),
                            }
                        }
                    }
                }
                Action::ExportCsv | Action::ExportXlsx => {
                    let xlsx = matches!(a, Action::ExportXlsx);
                    if let Some(s) = self.sessions.get(self.active) {
                        let ids: Vec<u32> = if s.selection.is_empty() { s.scene.objects.iter().map(|o| o.id).collect() } else { s.selection.iter().flat_map(|&id| s.tree.subtree(id)).filter(|&id| s.doc.has_flag(id, ifc_doc::tflags::PRODUCT)).collect() };
                        let ext = if xlsx { "xlsx" } else { "csv" };
                        if let Some(p) = rfd::FileDialog::new().add_filter(ext, &[ext]).set_file_name(format!("Eigenschaften.{ext}")).save_file() {
                            let res = if xlsx { ifc_doc::export::write_xlsx(&s.doc, &ids, &p) } else { ifc_doc::export::write_csv(&s.doc, &ids, &p) };
                            match res {
                                Ok(n) => self.ctx_state.toast(format!("{n} Zeilen exportiert")),
                                Err(e) => self.ctx_state.error(e.to_string()),
                            }
                        }
                    }
                }
                Action::ExportObj => {
                    if let Some(s) = self.sessions.get(self.active) {
                        if let Some(p) = rfd::FileDialog::new().add_filter("OBJ", &["obj"]).add_filter("glTF binär", &["glb"]).set_file_name("Modell.glb").save_file() {
                            let is_glb = p.extension().map(|e| e.eq_ignore_ascii_case("glb")).unwrap_or(false);
                            let res = if is_glb { crate::viewer::export::write_glb(s, &p) } else { crate::viewer::export::write_obj(s, &p) };
                            match res {
                                Ok(()) => self.ctx_state.toast(format!("Exportiert: {}", p.display())),
                                Err(e) => self.ctx_state.error(e.to_string()),
                            }
                        }
                    }
                }
                Action::Compare(p) => {
                    if let Some(s) = self.sessions.get(self.active) {
                        panels::diff::run_compare(s, &p, &mut self.ctx_state);
                    }
                }
            }
        }
    }

    pub fn open_tab(&mut self, t: Tab) {
        if let Some(path) = self.dock.find_tab(&t) {
            let _ = self.dock.set_active_tab(path);
        } else {
            self.dock.push_to_focused_leaf(t);
        }
    }

    fn shortcuts(&mut self, ctx: &egui::Context) {
        use egui::{Key, KeyboardShortcut, Modifiers};
        let cmd = Modifiers::COMMAND;
        let sc = |ctx: &egui::Context, m: Modifiers, k: Key| ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(m, k)));
        if sc(ctx, cmd, Key::O) {
            self.ctx_state.actions.push(Action::OpenDialog);
        }
        if sc(ctx, cmd | Modifiers::SHIFT, Key::S) {
            self.ctx_state.actions.push(Action::SaveAs);
        }
        if sc(ctx, cmd, Key::S) {
            self.ctx_state.actions.push(Action::Save);
        }
        if sc(ctx, cmd, Key::N) {
            self.ctx_state.actions.push(Action::New);
        }
        if sc(ctx, cmd | Modifiers::SHIFT, Key::Z) || sc(ctx, cmd, Key::Y) {
            self.ctx_state.actions.push(Action::Redo);
        }
        if sc(ctx, cmd, Key::Z) {
            self.ctx_state.actions.push(Action::Undo);
        }
        if sc(ctx, cmd, Key::W) {
            self.ctx_state.actions.push(Action::Close(self.active));
        }
        if sc(ctx, cmd, Key::F) {
            self.open_tab(Tab::Search);
        }
        if ctx.egui_wants_keyboard_input() {
            return;
        }
        let Some(s) = self.sessions.get_mut(self.active) else { return };
        if sc(ctx, Modifiers::NONE, Key::Delete) {
            self.ctx_state.actions.push(Action::DeleteSelection);
        }
        if sc(ctx, cmd, Key::A) {
            let ids: Vec<u32> = s.scene.objects.iter().enumerate().filter(|(i, o)| o.geom.is_some() && !s.scene.is_hidden(*i as u32)).map(|(_, o)| o.id).collect();
            s.select(ids, false);
        }
        if sc(ctx, cmd, Key::D) {
            let sel = s.selection.clone();
            if let Some(ids) = s.edit("Duplizieren", |doc| ifc_doc::ops::duplicate(doc, &sel, [0.0, 0.0, 0.0])) {
                s.select(ids, false);
            }
        }
        if sc(ctx, Modifiers::NONE, Key::Escape) {
            if s.tool != Tool::Select {
                s.tool = Tool::Select;
                s.measure.points.clear();
            } else {
                s.select(vec![], false);
            }
        }
        if sc(ctx, Modifiers::SHIFT, Key::H) {
            s.show_all();
        } else if sc(ctx, Modifiers::NONE, Key::H) {
            let sel = s.selection.clone();
            s.hide(&sel);
        }
        if sc(ctx, Modifiers::NONE, Key::I) {
            let sel = s.selection.clone();
            s.isolate(&sel);
        }
        if sc(ctx, Modifiers::NONE, Key::F) {
            s.fit_all();
        }
        if sc(ctx, Modifiers::NONE, Key::Z) {
            s.fit_selection();
        }
        if sc(ctx, Modifiers::NONE, Key::X) {
            s.xray = !s.xray;
            s.apply_visibility();
        }
        if sc(ctx, Modifiers::NONE, Key::P) {
            s.camera.ortho = !s.camera.ortho;
            s.view_dirty = true;
        }
        if sc(ctx, Modifiers::NONE, Key::K) {
            self.ctx_state.settings.show_edges = !self.ctx_state.settings.show_edges;
            s.view_dirty = true;
        }
        if sc(ctx, Modifiers::NONE, Key::M) {
            s.tool = if s.tool == Tool::Measure { Tool::Select } else { Tool::Measure };
        }
        if sc(ctx, Modifiers::NONE, Key::B) {
            s.tool = if s.tool == Tool::BoxSelect { Tool::Select } else { Tool::BoxSelect };
        }
        use crate::viewer::camera::ViewPreset as V;
        for (k, p) in [(Key::Num1, V::Front), (Key::Num3, V::Right), (Key::Num7, V::Top), (Key::Num0, V::Iso), (Key::Num9, V::Bottom), (Key::Num4, V::Left), (Key::Num6, V::Back)] {
            if sc(ctx, Modifiers::NONE, k) {
                s.camera.set_preset(p);
                s.fit_all();
            }
        }
        if sc(ctx, Modifiers::ALT, Key::ArrowLeft) {
            if let Some(prev) = s.nav_back.pop() {
                if let Some(&cur) = s.selection.first() {
                    s.nav_fwd.push(cur);
                }
                s.selection = vec![prev];
                s.apply_visibility();
            }
        }
        if sc(ctx, Modifiers::ALT, Key::ArrowRight) {
            if let Some(next) = s.nav_fwd.pop() {
                if let Some(&cur) = s.selection.first() {
                    s.nav_back.push(cur);
                }
                s.selection = vec![next];
                s.apply_visibility();
            }
        }
    }

    fn menu_bar(&mut self, ui: &mut egui::Ui) {
        egui::MenuBar::new().ui(ui, |ui| {
            ui.menu_button("Datei", |ui| {
                ui.set_min_width(240.0);
                if ui.button(format!("{} Neues Projekt …\tStrg+N", ic::NEW)).clicked() {
                    self.ctx_state.actions.push(Action::New);
                }
                if ui.button(format!("{} Öffnen …\tStrg+O", ic::OPEN)).clicked() {
                    self.ctx_state.actions.push(Action::OpenDialog);
                }
                ui.menu_button(format!("{} Zuletzt geöffnet", ic::HISTORY), |ui| {
                    ui.set_min_width(360.0);
                    if self.ctx_state.settings.recent.is_empty() {
                        ui.weak("(keine)");
                    }
                    for p in self.ctx_state.settings.recent.clone() {
                        let exists = p.exists();
                        let txt = RichText::new(p.display().to_string());
                        if ui.add_enabled(exists, egui::Button::new(if exists { txt } else { txt.strikethrough() })).clicked() {
                            self.ctx_state.actions.push(Action::Open(p));
                            ui.close();
                        }
                    }
                    ui.separator();
                    if ui.button("Liste leeren").clicked() {
                        self.ctx_state.settings.recent.clear();
                        self.ctx_state.settings.save();
                    }
                });
                ui.separator();
                let has = !self.sessions.is_empty();
                if ui.add_enabled(has, egui::Button::new(format!("{} Speichern\tStrg+S", ic::SAVE))).clicked() {
                    self.ctx_state.actions.push(Action::Save);
                }
                if ui.add_enabled(has, egui::Button::new(format!("{} Speichern unter …\tStrg+Umschalt+S", ic::SAVE))).clicked() {
                    self.ctx_state.actions.push(Action::SaveAs);
                }
                ui.menu_button(format!("{} Exportieren", ic::EXPORT), |ui| {
                    if ui.button("Auswahl als IFC …").clicked() {
                        self.ctx_state.actions.push(Action::ExportSubset);
                        ui.close();
                    }
                    if ui.button("Eigenschaften als CSV …").clicked() {
                        self.ctx_state.actions.push(Action::ExportCsv);
                        ui.close();
                    }
                    if ui.button("Eigenschaften als Excel (XLSX) …").clicked() {
                        self.ctx_state.actions.push(Action::ExportXlsx);
                        ui.close();
                    }
                    if ui.button("Geometrie als GLB/OBJ …").clicked() {
                        self.ctx_state.actions.push(Action::ExportObj);
                        ui.close();
                    }
                });
                if ui.add_enabled(has, egui::Button::new(format!("{} Mit Datei vergleichen …", ic::DIFF))).clicked() {
                    if let Some(p) = rfd::FileDialog::new().add_filter("IFC", &["ifc", "ifczip"]).pick_file() {
                        self.ctx_state.actions.push(Action::Compare(p));
                        self.ctx_state.actions.push(Action::OpenTab(Tab::Diff));
                    }
                }
                ui.separator();
                if ui.add_enabled(has, egui::Button::new(format!("{} Schließen\tStrg+W", ic::CLOSE))).clicked() {
                    self.ctx_state.actions.push(Action::Close(self.active));
                }
                if ui.button("Beenden").clicked() {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
            ui.menu_button("Bearbeiten", |ui| {
                ui.set_min_width(260.0);
                let (undo, redo) = self.sessions.get(self.active).map(|s| (s.doc.undo_label().map(|x| x.to_string()), s.doc.redo_label().map(|x| x.to_string()))).unwrap_or((None, None));
                if ui.add_enabled(undo.is_some(), egui::Button::new(format!("{} Rückgängig: {}\tStrg+Z", ic::UNDO, undo.clone().unwrap_or_default()))).clicked() {
                    self.ctx_state.actions.push(Action::Undo);
                }
                if ui.add_enabled(redo.is_some(), egui::Button::new(format!("{} Wiederholen: {}\tStrg+Y", ic::REDO, redo.clone().unwrap_or_default()))).clicked() {
                    self.ctx_state.actions.push(Action::Redo);
                }
                ui.separator();
                if ui.button(format!("{} Auswahl löschen …\tEntf", ic::DELETE)).clicked() {
                    self.ctx_state.actions.push(Action::DeleteSelection);
                }
                if let Some(s) = self.sessions.get_mut(self.active) {
                    if ui.button(format!("{} Auswahl duplizieren\tStrg+D", ic::COPY)).clicked() {
                        let sel = s.selection.clone();
                        if let Some(ids) = s.edit("Duplizieren", |doc| ifc_doc::ops::duplicate(doc, &sel, [0.0, 0.0, 0.0])) {
                            s.select(ids, false);
                        }
                    }
                    ui.separator();
                    if ui.button("Ungenutzte Entities bereinigen").clicked() {
                        if let Some(n) = s.edit("Bereinigen", |doc| Ok(ifc_doc::ops::purge_unused(doc))) {
                            self.ctx_state.toast(format!("{n} ungenutzte Entities entfernt"));
                        }
                    }
                    if ui.button("Ungültige/doppelte GlobalIds reparieren").clicked() {
                        if let Some(n) = s.edit("GlobalIds reparieren", |doc| ifc_doc::ops::fix_guids(doc)) {
                            self.ctx_state.toast(format!("{n} GlobalIds neu vergeben"));
                        }
                    }
                }
            });
            ui.menu_button("Ansicht", |ui| {
                ui.set_min_width(240.0);
                ui.label(RichText::new("Fenster").weak());
                for t in Tab::ALL {
                    if ui.button(t.title()).clicked() {
                        self.open_tab(t);
                        ui.close();
                    }
                }
                ui.separator();
                if ui.button("Layout zurücksetzen").clicked() {
                    self.dock = default_dock();
                }
                let mut dark = self.ctx_state.settings.dark;
                if ui.checkbox(&mut dark, "Dunkles Design").changed() {
                    self.ctx_state.settings.dark = dark;
                    self.ctx_state.settings.save();
                    apply_style(ui.ctx(), &self.ctx_state.settings);
                    self.ctx_state.force_redraw = true;
                }
                if let Some(s) = self.sessions.get_mut(self.active) {
                    ui.separator();
                    if ui.checkbox(&mut s.xray, "Röntgenmodus\tX").changed() {
                        s.apply_visibility();
                    }
                    if ui.checkbox(&mut s.camera.ortho, "Orthografische Projektion\tP").changed() {
                        s.view_dirty = true;
                    }
                    let mut spaces = !s.class_hidden.contains("IFCSPACE");
                    if ui.checkbox(&mut spaces, "Räume (IfcSpace) anzeigen").changed() {
                        if spaces {
                            s.class_hidden.remove("IFCSPACE");
                        } else {
                            s.class_hidden.insert("IFCSPACE".into());
                        }
                        s.apply_visibility();
                    }
                }
            });
            ui.menu_button("Modell", |ui| {
                ui.set_min_width(240.0);
                if ui.button(format!("{} Element erstellen …", ic::BUILD)).clicked() {
                    self.open_tab(Tab::Builder);
                }
                if ui.button(format!("{} Psets im Stapel bearbeiten …", ic::TAG)).clicked() {
                    self.open_tab(Tab::Batch);
                }
                if ui.button(format!("{} Gruppen verwalten …", ic::GROUP)).clicked() {
                    self.open_tab(Tab::Groups);
                }
                if ui.button(format!("{} Materialien …", ic::LAYERS)).clicked() {
                    self.open_tab(Tab::Materials);
                }
                ui.separator();
                if ui.button(format!("{} Modell prüfen", ic::WARN)).clicked() {
                    self.open_tab(Tab::Diagnostics);
                }
                if ui.button(format!("{} IDS-Prüfung …", ic::CHECK)).clicked() {
                    self.open_tab(Tab::Ids);
                }
                if ui.button(format!("{} Kollisionsprüfung …", ic::CLASH)).clicked() {
                    self.open_tab(Tab::Clash);
                }
                if ui.button(format!("{} Statistik", ic::CHART)).clicked() {
                    self.open_tab(Tab::Stats);
                }
            });
            ui.menu_button("Extras", |ui| {
                if ui.button(format!("{} Einstellungen …", ic::SETTINGS)).clicked() {
                    self.show_settings = true;
                    ui.close();
                }
                if ui.button("Tastenkürzel …").clicked() {
                    self.show_shortcuts = true;
                    ui.close();
                }
                if ui.button("Über IFCnative …").clicked() {
                    self.show_about = true;
                    ui.close();
                }
            });
            // document tabs
            ui.separator();
            let mut switch = None;
            let mut close = None;
            for (i, s) in self.sessions.iter().enumerate() {
                let title = s.title();
                let resp = ui.selectable_label(i == self.active, &title);
                if resp.clicked() {
                    switch = Some(i);
                }
                if resp.middle_clicked() {
                    close = Some(i);
                }
                if ui.small_button(ic::CLOSE).on_hover_text("Schließen").clicked() {
                    close = Some(i);
                }
            }
            if let Some(i) = switch {
                self.switch_to(i);
            }
            if let Some(i) = close {
                self.ctx_state.actions.push(Action::Close(i));
            }
        });
    }

    fn status_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if let Some(s) = self.sessions.get(self.active) {
                if let Some(l) = &s.loading {
                    if !l.geometry_done {
                        ui.spinner();
                        ui.label(&l.message);
                        ui.add(egui::ProgressBar::new(l.progress).desired_width(160.0));
                    }
                }
                ui.label(&s.status);
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(format!("{} Entities · {} Objekte · {} Dreiecke · {}", crate::session::fmt_count(s.doc.len()), crate::session::fmt_count(s.scene.objects.len()), crate::session::fmt_count(s.scene.total_tris), s.doc.schema_id.display()));
                    ui.separator();
                    ui.label(format!("Auswahl: {}", s.selection.len()));
                    if s.doc.is_dirty() {
                        ui.separator();
                        ui.colored_label(Color32::from_rgb(255, 170, 40), "● ungespeichert");
                    }
                });
            } else {
                ui.label("Bereit");
            }
        });
    }

    fn dialogs(&mut self, ctx: &egui::Context) {
        if self.show_settings {
            let mut open = true;
            egui::Window::new(format!("{} Einstellungen", ic::SETTINGS)).open(&mut open).resizable(false).show(ctx, |ui| {
                let st = &mut self.ctx_state.settings;
                let mut changed = false;
                egui::Grid::new("settings").num_columns(2).spacing([16.0, 8.0]).show(ui, |ui| {
                    ui.label("Design");
                    changed |= ui.checkbox(&mut st.dark, "Dunkel").changed();
                    ui.end_row();
                    ui.label("UI-Skalierung");
                    changed |= ui.add(egui::Slider::new(&mut st.ui_scale, 0.75..=2.0)).changed();
                    ui.end_row();
                    ui.label("Auswahlfarbe");
                    let mut c = Color32::from_rgba_unmultiplied(st.selection_color[0], st.selection_color[1], st.selection_color[2], 255);
                    if ui.color_edit_button_srgba(&mut c).changed() {
                        st.selection_color = [c.r(), c.g(), c.b(), 255];
                        changed = true;
                    }
                    ui.end_row();
                    ui.label("Hintergrund (dunkel)");
                    changed |= ui.color_edit_button_rgb(&mut st.bg_dark).changed();
                    ui.end_row();
                    ui.label("Hintergrund (hell)");
                    changed |= ui.color_edit_button_rgb(&mut st.bg_light).changed();
                    ui.end_row();
                    ui.label("Navigation");
                    ui.vertical(|ui| {
                        changed |= ui.checkbox(&mut st.orbit_around_pick, "Um angeklickten Punkt drehen").changed();
                        changed |= ui.checkbox(&mut st.invert_zoom, "Zoomrichtung umkehren").changed();
                    });
                    ui.end_row();
                    ui.label("Fangradius Messen (px)");
                    changed |= ui.add(egui::Slider::new(&mut st.snap_px, 0.0..=40.0)).changed();
                    ui.end_row();
                    ui.label("Geometrie");
                    ui.vertical(|ui| {
                        changed |= ui.checkbox(&mut st.cut_openings, "Öffnungen ausschneiden (CSG)").changed();
                        changed |= ui.checkbox(&mut st.hide_spaces, "Räume beim Öffnen ausblenden").changed();
                        changed |= ui.add(egui::Slider::new(&mut st.max_circle_segments, 12..=128).text("Kreissegmente (max.)")).changed();
                    });
                    ui.end_row();
                    ui.label("Psets");
                    changed |= ui.checkbox(&mut st.split_shared_psets, "Geteilte Psets beim Bearbeiten eines Elements trennen").changed();
                    ui.end_row();
                    ui.label("Wiederherstellung");
                    changed |= ui.add(egui::Slider::new(&mut st.autosave_minutes, 0..=30).text("Min. Autosicherung (0 = aus)")).changed();
                    ui.end_row();
                });
                ui.separator();
                if let Some(s) = self.sessions.get_mut(self.active) {
                    if ui.button("Geometrie mit neuen Einstellungen neu erzeugen").clicked() {
                        s.geom_opts = st.geom_options();
                        s.geom_opts.include_spaces = true;
                        s.remesh_all();
                        if let Some(r) = self.ctx_state.renderer.as_mut() {
                            r.clear();
                        }
                    }
                }
                if changed {
                    st.save();
                    apply_style(ctx, st);
                    self.ctx_state.force_redraw = true;
                    for s in &mut self.sessions {
                        s.view_dirty = true;
                    }
                }
            });
            self.show_settings = open;
        }
        if self.show_about {
            let mut open = true;
            egui::Window::new("Über IFCnative").open(&mut open).resizable(false).show(ctx, |ui| {
                ui.heading("IFCnative");
                ui.label(format!("Version {}", env!("CARGO_PKG_VERSION")));
                ui.label("Nativer IFC-Editor für Windows – Rust, wgpu, egui.");
                ui.label("Eigener STEP-Parser, eigenes Dokumentmodell und eigener Geometrie-Kernel.");
                ui.label("Unterstützte Schemas: IFC2X3, IFC4, IFC4X3");
            });
            self.show_about = open;
        }
        if self.show_shortcuts {
            let mut open = true;
            egui::Window::new("Tastenkürzel").open(&mut open).show(ctx, |ui| {
                egui::Grid::new("keys").striped(true).show(ui, |ui| {
                    for (k, d) in [
                        ("Strg+O / Strg+S / Strg+Umschalt+S", "Öffnen / Speichern / Speichern unter"),
                        ("Strg+N / Strg+W", "Neues Projekt / Dokument schließen"),
                        ("Strg+Z / Strg+Y", "Rückgängig / Wiederholen"),
                        ("Entf / Strg+D", "Auswahl löschen / duplizieren"),
                        ("Strg+A / Esc", "Alles auswählen / Auswahl aufheben"),
                        ("H / Umschalt+H / I", "Ausblenden / Alles zeigen / Isolieren"),
                        ("F / Z", "Alles zeigen / Auf Auswahl zoomen"),
                        ("X / P", "Röntgenmodus / Orthografisch"),
                        ("M / B", "Messen / Rahmenauswahl"),
                        ("1 3 7 0 4 6 9", "Vorne, Rechts, Oben, Iso, Links, Hinten, Unten"),
                        ("W A S D Q E", "Kamera bewegen (Maus über 3D-Ansicht)"),
                        ("Linke Maus / Rechte Maus / Rad", "Drehen / Verschieben / Zoomen"),
                        ("Umschalt+Ziehen", "Rahmenauswahl"),
                        ("Doppelklick", "Auf Objekt zoomen"),
                        ("Alt+← / Alt+→", "Auswahlverlauf zurück / vor"),
                        ("Strg+F", "Filter öffnen"),
                    ] {
                        ui.label(RichText::new(k).monospace());
                        ui.label(d);
                        ui.end_row();
                    }
                });
            });
            self.show_shortcuts = open;
        }
        if let Some(d) = &mut self.new_dialog {
            let mut create = false;
            let mut cancel = false;
            egui::Window::new(format!("{} Neues Projekt", ic::NEW)).collapsible(false).resizable(false).show(ctx, |ui| {
                egui::Grid::new("new").num_columns(2).show(ui, |ui| {
                    ui.label("Projektname");
                    ui.text_edit_singleline(&mut d.name);
                    ui.end_row();
                    ui.label("Schema");
                    egui::ComboBox::from_id_salt("schema").selected_text(d.schema.display()).show_ui(ui, |ui| {
                        for sch in [ifc_doc::SchemaId::Ifc4, ifc_doc::SchemaId::Ifc4x3, ifc_doc::SchemaId::Ifc2x3] {
                            ui.selectable_value(&mut d.schema, sch, sch.display());
                        }
                    });
                    ui.end_row();
                });
                ui.separator();
                ui.label("Geschosse (Name, Höhe in m):");
                let mut remove = None;
                for (i, (n, e)) in d.storeys.iter_mut().enumerate() {
                    ui.horizontal(|ui| {
                        ui.text_edit_singleline(n);
                        ui.add(egui::DragValue::new(e).speed(0.1).suffix(" m"));
                        if ui.small_button(ic::CLOSE).clicked() {
                            remove = Some(i);
                        }
                    });
                }
                if let Some(i) = remove {
                    d.storeys.remove(i);
                }
                if ui.button(format!("{} Geschoss", ic::PLUS)).clicked() {
                    let next = d.storeys.last().map(|s| s.1 + 3.0).unwrap_or(0.0);
                    d.storeys.push((format!("{}. Obergeschoss", d.storeys.len()), next));
                }
                ui.separator();
                ui.horizontal(|ui| {
                    if ui.button("Erstellen").clicked() {
                        create = true;
                    }
                    if ui.button("Abbrechen").clicked() {
                        cancel = true;
                    }
                });
            });
            if create {
                let doc = ifc_doc::ops::new_project(d.schema, &d.name, &d.storeys);
                let mut s = Session::empty(doc);
                s.loading = None;
                s.geom_opts = self.ctx_state.settings.geom_options();
                s.status = "Neues Projekt erstellt".into();
                self.sessions.push(s);
                self.active = self.sessions.len() - 1;
                if let Some(r) = self.ctx_state.renderer.as_mut() {
                    r.clear();
                }
                self.new_dialog = None;
                self.open_tab(Tab::Builder);
            } else if cancel {
                self.new_dialog = None;
            }
        }
        if let Some(ids) = self.confirm_delete.clone() {
            let mut done = false;
            egui::Window::new(format!("{} Löschen", ic::DELETE)).collapsible(false).resizable(false).show(ctx, |ui| {
                let s = &self.sessions[self.active];
                ui.label(format!("{} Entities löschen?", ids.len()));
                let mut refs = 0;
                for &id in ids.iter().take(8) {
                    let r = s.doc.referencing(id).len();
                    refs += r;
                    ui.label(format!("• {} – {} Referenzen", ifc_doc::model::label(&s.doc, id), r));
                }
                if ids.len() > 8 {
                    ui.label(format!("… und {} weitere", ids.len() - 8));
                }
                ui.weak(format!("{refs} referenzierende Entities werden angepasst (Listeneinträge entfernt, leere Beziehungen gelöscht)."));
                ui.checkbox(&mut self.ctx_state.panel_state.delete_purge, "Abhängige, nicht mehr verwendete Daten mit entfernen");
                ui.horizontal(|ui| {
                    if ui.button(RichText::new("Löschen").color(Color32::from_rgb(240, 90, 80))).clicked() {
                        let purge = self.ctx_state.panel_state.delete_purge;
                        let s = &mut self.sessions[self.active];
                        let mut all = Vec::new();
                        for &id in &ids {
                            // deleting a spatial element deletes its contents
                            all.extend(s.tree.subtree(id));
                        }
                        if let Some(n) = s.edit("Löschen", |doc| ifc_doc::ops::delete_entities(doc, &all, purge)) {
                            s.status = format!("{n} Entities gelöscht");
                        }
                        s.select(vec![], false);
                        done = true;
                    }
                    if ui.button("Abbrechen").clicked() {
                        done = true;
                    }
                });
            });
            if done {
                self.confirm_delete = None;
            }
        }
        if let Some(i) = self.confirm_close {
            let mut done = false;
            egui::Window::new("Ungespeicherte Änderungen").collapsible(false).resizable(false).show(ctx, |ui| {
                ui.label(format!("„{}“ enthält ungespeicherte Änderungen.", self.sessions.get(i).map(|s| s.title()).unwrap_or_default()));
                ui.horizontal(|ui| {
                    if ui.button("Speichern").clicked() {
                        self.active = i;
                        self.save(false);
                        if !self.sessions[i].doc.is_dirty() {
                            self.close_session(i);
                        }
                        done = true;
                    }
                    if ui.button("Verwerfen").clicked() {
                        self.close_session(i);
                        done = true;
                    }
                    if ui.button("Abbrechen").clicked() {
                        done = true;
                    }
                });
            });
            if done {
                self.confirm_close = None;
            }
        }
    }

    fn recovery_dialog(&mut self, ctx: &egui::Context) {
        if self.recovery.is_empty() || self.args.screenshot.is_some() || self.args.view_screenshot.is_some() {
            return;
        }
        let mut open_all = false;
        let mut discard = false;
        egui::Window::new("Wiederherstellung").collapsible(false).resizable(false).show(ctx, |ui| {
            ui.label(format!("Es wurden {} automatisch gesicherte, ungespeicherte Dokumente gefunden.", self.recovery.len()));
            for p in &self.recovery {
                let when = std::fs::metadata(p).and_then(|m| m.modified()).ok().map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%d.%m.%Y %H:%M").to_string()).unwrap_or_default();
                ui.weak(format!("• {} ({when})", p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
            }
            ui.horizontal(|ui| {
                if ui.button("Öffnen").clicked() {
                    open_all = true;
                }
                if ui.button("Verwerfen").clicked() {
                    discard = true;
                }
            });
        });
        if open_all {
            let dir = Settings::recovery_dir().unwrap_or_default().join("restored");
            let _ = std::fs::create_dir_all(&dir);
            for p in std::mem::take(&mut self.recovery) {
                let target = dir.join(p.file_name().unwrap_or_default());
                if std::fs::rename(&p, &target).is_ok() {
                    self.open_path(target, ctx);
                }
            }
        } else if discard {
            for p in std::mem::take(&mut self.recovery) {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    fn toasts(&mut self, ctx: &egui::Context) {
        self.ctx_state.toasts.retain(|t| t.1.elapsed().as_secs_f32() < 4.0);
        if self.ctx_state.toasts.is_empty() {
            return;
        }
        egui::Area::new(egui::Id::new("toasts")).anchor(egui::Align2::RIGHT_BOTTOM, [-16.0, -40.0]).order(egui::Order::Tooltip).show(ctx, |ui| {
            for (msg, _, err) in &self.ctx_state.toasts {
                egui::Frame::popup(ui.style()).show(ui, |ui| {
                    ui.colored_label(if *err { Color32::from_rgb(240, 90, 80) } else { ui.visuals().text_color() }, msg);
                });
            }
        });
        ctx.request_repaint_after(std::time::Duration::from_millis(250));
    }

    fn welcome(&mut self, ui: &mut egui::Ui) {
        ui.vertical_centered(|ui| {
            ui.add_space(ui.available_height() * 0.18);
            ui.label(RichText::new("IFCnative").size(40.0).strong());
            ui.label(RichText::new("Nativer IFC-Editor – schnell auch bei großen Modellen").size(16.0).weak());
            ui.add_space(24.0);
            ui.horizontal(|ui| {
                ui.add_space((ui.available_width() - 420.0).max(0.0) / 2.0);
                if ui.add_sized([200.0, 40.0], egui::Button::new(RichText::new(format!("{} IFC öffnen …", ic::OPEN)).size(16.0))).clicked() {
                    self.ctx_state.actions.push(Action::OpenDialog);
                }
                if ui.add_sized([200.0, 40.0], egui::Button::new(RichText::new(format!("{} Neues Projekt …", ic::NEW)).size(16.0))).clicked() {
                    self.ctx_state.actions.push(Action::New);
                }
            });
            ui.add_space(24.0);
            if !self.ctx_state.settings.recent.is_empty() {
                ui.label(RichText::new("Zuletzt geöffnet").strong());
                ui.add_space(6.0);
                for p in self.ctx_state.settings.recent.clone().into_iter().take(10) {
                    let exists = p.exists();
                    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let size = std::fs::metadata(&p).map(|m| format!("{:.1} MB", m.len() as f64 / 1e6)).unwrap_or_else(|_| "nicht gefunden".into());
                    let r = ui.add_enabled(exists, egui::Button::new(format!("{}   {}   ({})", name, p.parent().map(|d| d.display().to_string()).unwrap_or_default(), size)).frame(false));
                    if r.clicked() {
                        self.ctx_state.actions.push(Action::Open(p));
                    }
                }
            }
            ui.add_space(20.0);
            ui.weak("Dateien können auch per Drag & Drop geöffnet werden.");
        });
    }

    fn handle_drops(&mut self, ctx: &egui::Context) {
        let dropped: Vec<PathBuf> = ctx.input(|i| i.raw.dropped_files.iter().map(|f| f.path().to_path_buf()).filter(|p| !p.as_os_str().is_empty()).collect());
        for p in dropped {
            let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if ext == "ids" || ext == "xml" {
                if let Some(s) = self.sessions.get(self.active) {
                    let _ = s;
                    self.ctx_state.panel_state.ids_path = Some(p.clone());
                    self.open_tab(Tab::Ids);
                }
            } else {
                self.open_path(p, ctx);
            }
        }
    }

    fn apply_cli(&mut self, ctx: &egui::Context) {
        if self.applied_args {
            return;
        }
        let Some(s) = self.sessions.get_mut(self.active) else {
            self.applied_args = true;
            return;
        };
        if s.loading.is_some() {
            return;
        }
        self.applied_args = true;
        if let Some(id) = self.args.select {
            s.select(vec![id], false);
            s.fit_selection();
        }
        if self.args.xray {
            s.xray = true;
            s.apply_visibility();
        }
        if let Some(c) = &self.args.color {
            s.color_mode = match c.as_str() {
                "class" => crate::session::ColorMode::ByClass,
                "storey" => crate::session::ColorMode::ByStorey,
                "material" => crate::session::ColorMode::ByMaterial,
                _ => crate::session::ColorMode::Ifc,
            };
            s.recolor();
        }
        for cmd in self.args.script.clone() {
            panels::script::run(cmd.as_str(), self, ctx);
        }
        if let Some(t) = self.args.tab.clone() {
            if let Some(tab) = Tab::ALL.iter().find(|x| format!("{x:?}").eq_ignore_ascii_case(&t)) {
                self.open_tab(*tab);
            }
        }
    }

    fn autosave(&mut self) {
        let mins = self.ctx_state.settings.autosave_minutes;
        if mins == 0 || self.last_autosave.elapsed().as_secs() < mins as u64 * 60 {
            return;
        }
        self.last_autosave = std::time::Instant::now();
        let Some(dir) = Settings::recovery_dir() else { return };
        let _ = std::fs::create_dir_all(&dir);
        for s in &self.sessions {
            if s.doc.is_dirty() && s.loading.is_none() {
                let bytes = s.doc.to_bytes();
                let _ = std::fs::write(dir.join(format!("session-{}.ifc", s.uid)), bytes);
            }
        }
    }
}

pub fn apply_style(ctx: &egui::Context, st: &Settings) {
    ctx.set_visuals(if st.dark { egui::Visuals::dark() } else { egui::Visuals::light() });
    ctx.set_zoom_factor(st.ui_scale.clamp(0.5, 3.0));
    ctx.global_style_mut(|s| {
        s.spacing.item_spacing = egui::vec2(6.0, 4.0);
        s.spacing.button_padding = egui::vec2(6.0, 3.0);
        s.interaction.tooltip_delay = 0.35;
    });
}

struct Viewer<'a> {
    session: Option<&'a mut Session>,
    app: &'a mut AppCtx,
    welcome: bool,
}

impl TabViewer for Viewer<'_> {
    type Tab = Tab;

    fn id(&mut self, tab: &mut Tab) -> egui::Id {
        egui::Id::new(("dock-tab", *tab))
    }

    fn title(&mut self, tab: &mut Tab) -> egui::WidgetText {
        tab.title().into()
    }

    fn ui(&mut self, ui: &mut egui::Ui, tab: &mut Tab) {
        let Some(s) = self.session.as_deref_mut() else {
            if *tab == Tab::Viewer {
                self.welcome = true;
            } else {
                ui.centered_and_justified(|ui| ui.weak("Kein Dokument geöffnet"));
            }
            return;
        };
        match tab {
            Tab::Viewer => panels::viewer::show(ui, s, self.app),
            Tab::Structure => panels::tree::show(ui, s, self.app),
            Tab::Classes => panels::classes::show(ui, s, self.app),
            Tab::Search => panels::search::show(ui, s, self.app),
            Tab::Inspector => panels::inspector::show(ui, s, self.app),
            Tab::History => panels::history::show(ui, s, self.app),
            Tab::Diagnostics => panels::diagnostics::show(ui, s, self.app),
            Tab::Graph => panels::graph::show(ui, s, self.app),
            Tab::Batch => panels::batch::show(ui, s, self.app),
            Tab::Builder => panels::builder::show(ui, s, self.app),
            Tab::Ids => panels::ids::show(ui, s, self.app),
            Tab::Diff => panels::diff::show(ui, s, self.app),
            Tab::Groups => panels::groups::show(ui, s, self.app),
            Tab::Materials => panels::materials::show(ui, s, self.app),
            Tab::Table => panels::table::show(ui, s, self.app),
            Tab::Stats => panels::stats::show(ui, s, self.app),
            Tab::Clash => panels::clash::show(ui, s, self.app),
        }
    }

    fn is_closeable(&self, tab: &Tab) -> bool {
        *tab != Tab::Viewer
    }

    fn scroll_bars(&self, tab: &Tab) -> [bool; 2] {
        match tab {
            Tab::Viewer | Tab::Structure | Tab::Graph | Tab::Table | Tab::Inspector | Tab::Search | Tab::Diagnostics | Tab::Ids | Tab::Diff | Tab::Batch => [false, false],
            _ => [false, true],
        }
    }

    fn clear_background(&self, tab: &Tab) -> bool {
        *tab != Tab::Viewer
    }
}

impl eframe::App for IfcApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.frames += 1;
        // loading
        let mut any_loading = false;
        for (i, s) in self.sessions.iter_mut().enumerate() {
            let budget = if i == self.active { std::time::Duration::from_millis(12) } else { std::time::Duration::from_millis(2) };
            s.poll_loading(budget);
            any_loading |= s.loading.is_some();
        }
        if any_loading {
            ctx.request_repaint_after(std::time::Duration::from_millis(30));
        }
        self.handle_drops(&ctx);
        self.shortcuts(&ctx);
        if self.ctx_state.request_delete {
            self.ctx_state.request_delete = false;
            self.ctx_state.actions.push(Action::DeleteSelection);
        }
        self.apply_cli(&ctx);

        egui::Panel::top("menu").show(ui, |ui| self.menu_bar(ui));
        egui::Panel::bottom("status").show(ui, |ui| self.status_bar(ui));

        let welcome;
        {
            let active = self.active;
            let session = self.sessions.get_mut(active);
            let mut viewer = Viewer { session, app: &mut self.ctx_state, welcome: false };
            let mut style = DockStyle::from_egui(ui.style());
            style.tab_bar.fill_tab_bar = false;
            DockArea::new(&mut self.dock).style(style).show_leaf_close_all_buttons(false).show_leaf_collapse_buttons(false).show_inside(ui, &mut viewer);
            welcome = viewer.welcome;
        }
        if welcome && self.sessions.is_empty() {
            let rect = ctx.content_rect();
            egui::Area::new(egui::Id::new("welcome")).fixed_pos(rect.min + egui::vec2(0.0, 30.0)).order(egui::Order::Middle).show(&ctx, |ui| {
                ui.set_min_size(rect.size() - egui::vec2(0.0, 60.0));
                egui::Frame::central_panel(ui.style()).show(ui, |ui| {
                    ui.set_min_size(rect.size() - egui::vec2(0.0, 60.0));
                    self.welcome(ui);
                });
            });
        }
        self.dialogs(&ctx);
        self.recovery_dialog(&ctx);
        self.process_actions(&ctx);
        self.toasts(&ctx);
        self.autosave();

        // window title
        let title = match self.sessions.get(self.active) {
            Some(s) => format!("{} – IFCnative", s.title()),
            None => "IFCnative".into(),
        };
        ctx.send_viewport_cmd(egui::ViewportCommand::Title(title));

        // screenshot automation
        if self.ctx_state.request_view_screenshot {
            self.ctx_state.request_view_screenshot = false;
            if let Some((w, h, data)) = self.ctx_state.renderer.as_ref().and_then(|r| r.read_color()) {
                if let Some(p) = rfd::FileDialog::new().add_filter("PNG", &["png"]).set_file_name("Ansicht.png").save_file() {
                    match image::save_buffer(&p, &data, w, h, image::ExtendedColorType::Rgba8) {
                        Ok(()) => self.ctx_state.toast("Bild gespeichert"),
                        Err(e) => self.ctx_state.error(e.to_string()),
                    }
                }
            }
        }
        if self.args.screenshot.is_some() || self.args.view_screenshot.is_some() {
            let ready = self.applied_args && self.sessions.iter().all(|s| s.loading.is_none());
            if ready {
                self.screenshot_state = self.screenshot_state.saturating_add(1);
                if self.screenshot_state == 6 {
                    if let Some(p) = &self.args.view_screenshot {
                        if let Some((w, h, data)) = self.ctx_state.renderer.as_ref().and_then(|r| r.read_color()) {
                            let _ = image::save_buffer(p, &data, w, h, image::ExtendedColorType::Rgba8);
                        }
                    }
                    if self.args.screenshot.is_some() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::UserData::default()));
                    } else {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
                let shot = ctx.input(|i| {
                    i.raw.events.iter().find_map(|e| match e {
                        egui::Event::Screenshot { image, .. } => Some(image.clone()),
                        _ => None,
                    })
                });
                if let (Some(img), Some(p)) = (shot, &self.args.screenshot) {
                    let [w, h] = img.size;
                    let bytes: Vec<u8> = img.pixels.iter().flat_map(|c| c.to_array()).collect();
                    let _ = image::save_buffer(p, &bytes, w as u32, h as u32, image::ExtendedColorType::Rgba8);
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            }
            ctx.request_repaint();
        }

        // confirm exit with unsaved changes
        if ctx.input(|i| i.viewport().close_requested()) && !self.exit_confirmed && self.args.screenshot.is_none() && self.args.view_screenshot.is_none() {
            if let Some(i) = self.sessions.iter().position(|s| s.doc.is_dirty()) {
                ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
                self.confirm_close = Some(i);
            }
        }
    }

    fn on_exit(&mut self) {
        self.ctx_state.settings.save();
    }
}
