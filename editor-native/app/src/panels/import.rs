//! Table import dialog: CSV/TSV/XLSX file or clipboard → attributes and
//! properties of objects found through a key column (dry run first).

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use egui_extras::{Column, TableBuilder};
use ifc_doc::import::{self, ImportOptions, ImportTable, KeyIndex, KeyKind, Plan, RowStatus, Target};

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Delim {
    #[default]
    Auto,
    Semicolon,
    Comma,
    Tab,
    Pipe,
}

impl Delim {
    const ALL: [Delim; 5] = [Delim::Auto, Delim::Semicolon, Delim::Comma, Delim::Tab, Delim::Pipe];
    fn ch(self) -> Option<char> {
        match self {
            Delim::Auto => None,
            Delim::Semicolon => Some(';'),
            Delim::Comma => Some(','),
            Delim::Tab => Some('\t'),
            Delim::Pipe => Some('|'),
        }
    }
    fn label(self) -> &'static str {
        match self {
            Delim::Auto => "automatisch",
            Delim::Semicolon => "Semikolon ;",
            Delim::Comma => "Komma ,",
            Delim::Tab => "Tabulator",
            Delim::Pipe => "Senkrechter Strich |",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Filter {
    #[default]
    Changes,
    Problems,
    All,
}

#[derive(Default)]
pub struct ImportState {
    pub open: bool,
    source: String,
    path: Option<std::path::PathBuf>,
    raw: Option<String>,
    sheets: Vec<String>,
    sheet: usize,
    delim: Delim,
    table: ImportTable,
    targets: Vec<Target>,
    prop_text: Vec<String>,
    key: Option<(usize, KeyKind)>,
    opts: ImportOptions,
    index: Option<(u64, u64, KeyIndex)>,
    plan: Option<Plan>,
    plan_rev: Option<(u64, u64)>,
    dirty: bool,
    filter: Filter,
    error: Option<String>,
    millis: f64,
}

impl ImportState {
    /// Open the dialog with a file (CSV/TSV/TXT/XLSX/ODS).
    pub fn load_file(&mut self, path: std::path::PathBuf) {
        self.open = true;
        self.error = None;
        self.raw = None;
        self.sheets = import::sheet_names(&path).unwrap_or_default();
        self.sheet = 0;
        self.source = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        self.path = Some(path);
        self.reparse(true);
    }

    /// Open the dialog with text (e.g. cells copied from Excel).
    pub fn load_text(&mut self, text: String, source: &str) {
        self.open = true;
        self.error = None;
        self.path = None;
        self.sheets.clear();
        self.source = source.to_string();
        self.raw = Some(text);
        self.reparse(true);
    }

    fn reparse(&mut self, remap: bool) {
        let res = match (&self.raw, &self.path) {
            (Some(t), _) => Ok(import::parse_delimited(t, self.delim.ch())),
            (None, Some(p)) => import::read_file(p, self.sheets.get(self.sheet).map(|s| s.as_str()), self.delim.ch()),
            _ => Ok(ImportTable::default()),
        };
        match res {
            Ok(t) => {
                if t.is_empty() {
                    self.error = Some("Keine Daten gefunden (erste Zeile = Spaltenköpfe)".into());
                }
                self.table = t;
            }
            Err(e) => {
                self.error = Some(e.to_string());
                self.table = ImportTable::default();
            }
        }
        if remap || self.targets.len() != self.table.headers.len() {
            self.targets.clear();
            self.key = None;
        }
        self.plan = None;
        self.dirty = true;
    }

    fn ensure_index(&mut self, s: &Session) {
        let fresh = matches!(&self.index, Some((u, r, _)) if *u == s.uid && *r == s.doc.revision());
        if !fresh {
            self.index = Some((s.uid, s.doc.revision(), KeyIndex::build(&s.doc)));
        }
    }

    fn automap(&mut self, s: &Session) {
        let Some((_, _, ix)) = &self.index else { return };
        let (targets, key) = import::auto_map(&s.doc, ix, &self.table);
        self.prop_text = targets.iter().map(|t| if let Target::Prop(..) = t { t.label() } else { String::new() }).collect();
        self.targets = targets;
        self.key = key;
        self.dirty = true;
    }
}

fn paste_clipboard(st: &mut ImportState) {
    match arboard::Clipboard::new().and_then(|mut c| c.get_text()) {
        Ok(t) if !t.trim().is_empty() => st.load_text(t, "Zwischenablage"),
        Ok(_) => st.error = Some("Die Zwischenablage enthält keinen Text".into()),
        Err(e) => st.error = Some(format!("Zwischenablage nicht lesbar: {e}")),
    }
}

pub fn pick_file(st: &mut ImportState) {
    if let Some(p) = rfd::FileDialog::new().add_filter("Tabellen", &["csv", "tsv", "txt", "xlsx", "xlsm", "xls", "ods"]).pick_file() {
        st.load_file(p);
    }
}

const TARGET_CHOICES: [&str; 8] = ["– ignorieren", "Name", "Description", "ObjectType", "Tag", "LongName", "PredefinedType", "Eigenschaft …"];

fn choice_of(t: &Target) -> usize {
    match t {
        Target::Ignore => 0,
        Target::Attr(a) => TARGET_CHOICES.iter().position(|c| c == a).unwrap_or(0),
        Target::Prop(..) => 7,
    }
}

fn changes_text(st: &ImportState, r: &import::PlanRow, max: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    for ch in r.changes.iter().take(max) {
        let name = st.targets.get(ch.col).map(|t| t.label()).unwrap_or_default();
        let from = if ch.from.is_empty() { "(leer)".to_string() } else { ch.from.clone() };
        let to = if ch.to.is_empty() { "(löschen)".to_string() } else { ch.to.clone() };
        parts.push(format!("{name}: {from} → {to}"));
    }
    if r.changes.len() > max {
        parts.push(format!("… +{}", r.changes.len() - max));
    }
    parts.join("   ·   ")
}

/// The import window (shown while `app.panel_state.import.open`).
pub fn window(ctx: &egui::Context, s: &mut Session, app: &mut AppCtx) {
    if !app.panel_state.import.open {
        return;
    }
    let mut open = true;
    let mut apply = false;
    let mut select: Option<Vec<u32>> = None;
    let split_default = app.settings.split_shared_psets;
    egui::Window::new(format!("{} Tabelle importieren", ic::IMPORT))
        .open(&mut open)
        .default_size([1000.0, 660.0])
        .resizable(true)
        .collapsible(false)
        .show(ctx, |ui| {
            let st = &mut app.panel_state.import;
            // ---------------------------------------------------------- source
            ui.horizontal_wrapped(|ui| {
                if ui.button(format!("{} Datei …", ic::OPEN)).on_hover_text("CSV, TSV, TXT, XLSX, XLS, ODS").clicked() {
                    pick_file(st);
                }
                if ui.button(format!("{} Aus Zwischenablage", ic::PASTE)).on_hover_text("Zellen in Excel markieren, kopieren und hier einfügen").clicked() {
                    paste_clipboard(st);
                }
                if !st.source.is_empty() {
                    ui.separator();
                    ui.label(RichText::new(&st.source).strong());
                }
                if st.sheets.len() > 1 {
                    let mut sheet = st.sheet;
                    egui::ComboBox::from_id_salt("imp-sheet").selected_text(st.sheets[sheet].clone()).show_ui(ui, |ui| {
                        for (i, n) in st.sheets.iter().enumerate() {
                            ui.selectable_value(&mut sheet, i, n);
                        }
                    });
                    if sheet != st.sheet {
                        st.sheet = sheet;
                        st.reparse(true);
                    }
                }
                let text_source = st.raw.is_some() || st.path.as_ref().map(|p| !matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("xlsx" | "xlsm" | "xls" | "xlsb" | "ods"))).unwrap_or(false);
                if text_source {
                    let mut d = st.delim;
                    ui.label("Trenner:");
                    egui::ComboBox::from_id_salt("imp-delim").selected_text(d.label()).show_ui(ui, |ui| {
                        for x in Delim::ALL {
                            ui.selectable_value(&mut d, x, x.label());
                        }
                    });
                    if d != st.delim {
                        st.delim = d;
                        st.reparse(false);
                    }
                }
                if !st.table.is_empty() {
                    ui.weak(format!("{} Zeilen × {} Spalten", st.table.rows.len(), st.table.headers.len()));
                }
            });
            if let Some(e) = &st.error {
                ui.colored_label(Color32::from_rgb(240, 110, 90), e);
            }
            if st.table.is_empty() {
                ui.add_space(12.0);
                ui.label("Werte aus einer Tabelle in das Modell übernehmen:");
                ui.label("• erste Zeile = Spaltenköpfe, z. B. „GlobalId; Name; Pset_WallCommon.FireRating“");
                ui.label("• eine Schlüsselspalte (GlobalId, #STEP-Id, Tag oder Name) ordnet jede Zeile den Objekten zu");
                ui.label("• Spalten „Pset.Eigenschaft“ werden automatisch zugeordnet, Qto_-Sätze als Mengen geschrieben");
                ui.label("• „*.Eigenschaft“ schreibt in den passenden vorhandenen Satz bzw. Pset_<Klasse>Common");
                ui.label("• vor dem Übernehmen zeigt die Vorschau jede Änderung (alt → neu); alles ist ein Rückgängig-Schritt");
                ui.weak("Tipp: „Datei → Exportieren → Eigenschaften als Excel“ erzeugt eine passende Vorlage.");
                return;
            }
            st.ensure_index(s);
            if st.targets.len() != st.table.headers.len() {
                st.automap(s);
            }
            ui.separator();
            // ---------------------------------------------------------- key + mapping
            ui.horizontal(|ui| {
                ui.label(RichText::new(format!("{} Schlüssel", ic::KEY)).strong());
                let mut key = st.key;
                let cur_col = key.map(|k| st.table.headers[k.0].clone()).unwrap_or_else(|| "– keiner –".into());
                egui::ComboBox::from_id_salt("imp-key-col").selected_text(cur_col).show_ui(ui, |ui| {
                    ui.selectable_value(&mut key, None, "– keiner –");
                    for (i, h) in st.table.headers.iter().enumerate() {
                        let kind = key.map(|k| k.1).unwrap_or(KeyKind::GlobalId);
                        ui.selectable_value(&mut key, Some((i, kind)), h);
                    }
                });
                if let Some((c, mut kind)) = key {
                    egui::ComboBox::from_id_salt("imp-key-kind").selected_text(kind.label()).show_ui(ui, |ui| {
                        for k in KeyKind::ALL {
                            ui.selectable_value(&mut kind, k, k.label());
                        }
                    });
                    key = Some((c, kind));
                }
                if key != st.key {
                    // the key column is never written
                    if let Some((c, _)) = key {
                        if let Some(t) = st.targets.get_mut(c) {
                            *t = Target::Ignore;
                        }
                    }
                    st.key = key;
                    st.dirty = true;
                }
                if let Some(p) = &st.plan {
                    let found = p.rows.len() - p.not_found - p.no_key;
                    let color = if found == p.rows.len() { Color32::from_rgb(110, 200, 120) } else if found == 0 { Color32::from_rgb(240, 110, 90) } else { Color32::from_rgb(230, 180, 80) };
                    ui.colored_label(color, format!("{found} von {} Zeilen gefunden", p.rows.len()));
                }
                if ui.button("Automatisch zuordnen").clicked() {
                    st.automap(s);
                }
            });
            if st.key.is_none() {
                ui.colored_label(Color32::from_rgb(230, 180, 80), "Ohne Schlüsselspalte kann keine Zeile einem Objekt zugeordnet werden.");
            }
            egui::CollapsingHeader::new(RichText::new(format!("Spaltenzuordnung ({} von {} Spalten werden geschrieben)", st.targets.iter().filter(|t| **t != Target::Ignore).count(), st.table.headers.len())).strong())
                .id_salt("imp-map")
                .default_open(true)
                .show(ui, |ui| {
                    egui::ScrollArea::vertical().id_salt("imp-map-scroll").max_height(210.0).show(ui, |ui| {
                        egui::Grid::new("imp-map-grid").striped(true).num_columns(4).spacing([10.0, 3.0]).show(ui, |ui| {
                            ui.strong("Spalte");
                            ui.strong("Beispielwerte");
                            ui.strong("Ziel");
                            ui.strong("");
                            ui.end_row();
                            for c in 0..st.table.headers.len() {
                                ui.label(&st.table.headers[c]);
                                let samples = st.table.samples(c, 3).join(" | ");
                                ui.add(egui::Label::new(RichText::new(samples).weak()).truncate()).on_hover_text(st.table.samples(c, 12).join("\n"));
                                if st.key.map(|k| k.0) == Some(c) {
                                    ui.label(RichText::new(format!("{} Schlüssel", ic::KEY)).color(Color32::from_rgb(230, 190, 90)));
                                    ui.label("");
                                    ui.end_row();
                                    continue;
                                }
                                let mut choice = choice_of(&st.targets[c]);
                                let before = choice;
                                egui::ComboBox::from_id_salt(("imp-t", c)).width(150.0).selected_text(TARGET_CHOICES[choice]).show_ui(ui, |ui| {
                                    for (i, n) in TARGET_CHOICES.iter().enumerate() {
                                        ui.selectable_value(&mut choice, i, *n);
                                    }
                                });
                                if choice != before {
                                    st.targets[c] = match choice {
                                        0 => Target::Ignore,
                                        7 => {
                                            let h = st.table.headers[c].clone();
                                            let text = if st.prop_text[c].is_empty() { if h.contains('.') { h } else { format!("Pset_Import.{h}") } } else { st.prop_text[c].clone() };
                                            st.prop_text[c] = text.clone();
                                            match text.split_once('.') {
                                                Some((a, b)) => Target::Prop(a.trim().into(), b.trim().into()),
                                                None => Target::Prop("Pset_Import".into(), text),
                                            }
                                        }
                                        i => Target::Attr(TARGET_CHOICES[i].to_string()),
                                    };
                                    st.dirty = true;
                                }
                                if let Target::Prop(..) = st.targets[c] {
                                    let r = ui.add(egui::TextEdit::singleline(&mut st.prop_text[c]).hint_text("Pset.Eigenschaft").desired_width(260.0)).on_hover_text("Pset.Eigenschaft – „*.Eigenschaft“ schreibt in den Satz, der die Eigenschaft bereits enthält, sonst in Pset_<Klasse>Common");
                                    if r.changed() {
                                        if let Some((a, b)) = st.prop_text[c].split_once('.') {
                                            if !a.trim().is_empty() && !b.trim().is_empty() {
                                                st.targets[c] = Target::Prop(a.trim().into(), b.trim().into());
                                                st.dirty = true;
                                            }
                                        }
                                    }
                                } else {
                                    ui.label("");
                                }
                                ui.end_row();
                            }
                        });
                    });
                });
            // ---------------------------------------------------------- options
            ui.horizontal_wrapped(|ui| {
                let o = st.opts;
                ui.checkbox(&mut st.opts.overwrite_with_empty, "Leere Zellen löschen vorhandene Werte");
                ui.checkbox(&mut st.opts.all_matches, "Mehrfachtreffer: alle Objekte ändern");
                ui.checkbox(&mut st.opts.keep_types, "Datentyp vorhandener Eigenschaften beibehalten");
                ui.checkbox(&mut st.opts.split_shared, "Geteilte Psets vor dem Schreiben aufteilen").on_hover_text(format!("Voreinstellung aus den Einstellungen: {}", if split_default { "an" } else { "aus" }));
                if o.overwrite_with_empty != st.opts.overwrite_with_empty || o.all_matches != st.opts.all_matches {
                    st.dirty = true;
                }
            });
            // ---------------------------------------------------------- plan
            let rev = (s.uid, s.doc.revision());
            if st.dirty || st.plan_rev != Some(rev) {
                st.ensure_index(s);
                let t0 = std::time::Instant::now();
                if let Some((_, _, ix)) = &st.index {
                    st.plan = Some(import::plan(&s.doc, ix, &st.table, &st.targets, st.key, &st.opts));
                }
                st.millis = t0.elapsed().as_secs_f64() * 1000.0;
                st.dirty = false;
                st.plan_rev = Some(rev);
            }
            let Some(plan) = st.plan.as_ref() else { return };
            ui.separator();
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new(format!("{} Zeilen mit Änderungen", plan.updates)).strong().color(if plan.updates > 0 { Color32::from_rgb(110, 200, 120) } else { ui.visuals().text_color() }));
                ui.label(format!("({} Werte an {} Objekten)", plan.changed_cells, plan.objects));
                ui.weak("·");
                ui.label(format!("{} unverändert", plan.unchanged));
                for (n, label, color) in [(plan.not_found, "nicht gefunden", Color32::from_rgb(240, 110, 90)), (plan.ambiguous, "mehrdeutig", Color32::from_rgb(230, 180, 80)), (plan.no_key, "ohne Schlüssel", Color32::from_rgb(230, 180, 80))] {
                    if n > 0 {
                        ui.weak("·");
                        ui.colored_label(color, format!("{n} {label}"));
                    }
                }
                ui.weak(format!("({:.0} ms)", st.millis));
            });
            ui.horizontal(|ui| {
                ui.selectable_value(&mut st.filter, Filter::Changes, "Änderungen");
                ui.selectable_value(&mut st.filter, Filter::Problems, "Probleme");
                ui.selectable_value(&mut st.filter, Filter::All, "Alle Zeilen");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let can = plan.changed_cells > 0 && st.key.is_some();
                    if ui.add_enabled(can, egui::Button::new(RichText::new(format!("{} Übernehmen ({} Werte)", ic::CHECK, plan.changed_cells)).strong())).clicked() {
                        apply = true;
                    }
                    let ids: Vec<u32> = plan.rows.iter().filter(|r| r.status == RowStatus::Update).flat_map(|r| r.changes.iter().map(|c| c.id)).collect();
                    if ui.add_enabled(!ids.is_empty(), egui::Button::new(format!("{} Betroffene auswählen", ic::SELECT))).clicked() {
                        let mut ids = ids;
                        ids.sort_unstable();
                        ids.dedup();
                        select = Some(ids);
                    }
                });
            });
            let visible: Vec<usize> = plan
                .rows
                .iter()
                .enumerate()
                .filter(|(_, r)| match st.filter {
                    Filter::Changes => r.status == RowStatus::Update,
                    Filter::Problems => matches!(r.status, RowStatus::NotFound | RowStatus::Ambiguous | RowStatus::NoKey),
                    Filter::All => true,
                })
                .map(|(i, _)| i)
                .collect();
            if visible.is_empty() {
                ui.weak(match st.filter {
                    Filter::Changes => "Keine Änderungen – die Werte im Modell entsprechen bereits der Tabelle.",
                    Filter::Problems => "Keine Probleme.",
                    Filter::All => "Keine Zeilen.",
                });
                return;
            }
            let st = &app.panel_state.import;
            let plan = st.plan.as_ref().unwrap();
            let doc = &s.doc;
            TableBuilder::new(ui)
                .id_salt("imp-plan")
                .striped(true)
                .resizable(true)
                .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
                .column(Column::exact(52.0))
                .column(Column::initial(180.0).clip(true))
                .column(Column::exact(100.0))
                .column(Column::initial(200.0).clip(true))
                .column(Column::remainder().clip(true))
                .header(20.0, |mut h| {
                    for t in ["Zeile", "Schlüssel", "Status", "Objekt", "Änderungen"] {
                        h.col(|ui| {
                            ui.strong(t);
                        });
                    }
                })
                .body(|body| {
                    body.rows(20.0, visible.len(), |mut row| {
                        let r = &plan.rows[visible[row.index()]];
                        row.col(|ui| {
                            ui.weak(format!("{}", r.index + 2));
                        });
                        row.col(|ui| {
                            ui.label(&r.key);
                        });
                        row.col(|ui| {
                            let c = match r.status {
                                RowStatus::Update => Color32::from_rgb(110, 200, 120),
                                RowStatus::Unchanged => ui.visuals().weak_text_color(),
                                RowStatus::NotFound => Color32::from_rgb(240, 110, 90),
                                _ => Color32::from_rgb(230, 180, 80),
                            };
                            ui.colored_label(c, r.status.label());
                        });
                        row.col(|ui| {
                            if let Some(&first) = r.ids.first() {
                                let label = if r.ids.len() > 1 { format!("{} Objekte", r.ids.len()) } else { ifc_doc::model::label(doc, first) };
                                if ui.link(label).on_hover_text(r.ids.iter().take(20).map(|&i| ifc_doc::model::label(doc, i)).collect::<Vec<_>>().join("\n")).clicked() {
                                    select = Some(r.ids.clone());
                                }
                            }
                        });
                        row.col(|ui| {
                            if !r.changes.is_empty() {
                                ui.add(egui::Label::new(changes_text(st, r, 4)).truncate()).on_hover_text(changes_text(st, r, 40));
                            }
                        });
                    });
                });
        });
    if let Some(ids) = select {
        s.select(ids, false);
    }
    if apply {
        let st = &mut app.panel_state.import;
        if let Some(plan) = st.plan.take() {
            let targets = st.targets.clone();
            let opts = st.opts;
            let t0 = std::time::Instant::now();
            if let Some(n) = s.edit("Tabellenimport", |doc| import::apply(doc, &plan, &targets, &opts)) {
                app.toast(format!("Tabellenimport: {n} Werte in {} Objekten geschrieben ({:.0} ms)", plan.objects, t0.elapsed().as_secs_f64() * 1000.0));
            } else if let Some(e) = s.last_error.clone() {
                app.error(format!("Import fehlgeschlagen: {e}"));
            }
            app.panel_state.import.dirty = true;
        }
    }
    if !open {
        app.panel_state.import.open = false;
    }
}

/// Compute the plan (auto mapping) and apply it without UI (script command).
pub fn apply_now(s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.import;
    if st.table.is_empty() {
        return;
    }
    st.ensure_index(s);
    if st.targets.len() != st.table.headers.len() {
        st.automap(s);
    }
    let Some((_, _, ix)) = &st.index else { return };
    let plan = import::plan(&s.doc, ix, &st.table, &st.targets, st.key, &st.opts);
    let targets = st.targets.clone();
    let opts = st.opts;
    if let Some(n) = s.edit("Tabellenimport", |doc| import::apply(doc, &plan, &targets, &opts)) {
        app.toast(format!("Tabellenimport: {n} Werte geschrieben"));
    }
    app.panel_state.import.dirty = true;
}
