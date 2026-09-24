//! Batch property editing across many objects: value overview, set/remove,
//! rename, change data type, add empty sets, select by value, matrix view.

use crate::app::{Action, AppCtx, Tab};
use crate::icons as ic;
use crate::session::Session;
use egui::RichText;
use ifc_doc::{model, ops, tflags, Value};
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default, Clone)]
pub struct PropSummary {
    pub values: BTreeMap<String, usize>,
    pub types: BTreeSet<String>,
    pub count: usize,
}

#[derive(Default)]
pub struct BatchState {
    pub pset: String,
    pub prop: String,
    pub value: String,
    pub vtype: String,
    pub summary: BTreeMap<(String, String), PropSummary>,
    pub summary_key: Option<(u64, u64, usize)>,
    pub filter: String,
    pub new_pset: String,
    pub rename_to: String,
    pub pattern: String,
    pub pattern_target: usize,
    pub pattern_prop: String,
    pub pattern_start: u32,
    pub pattern_restart: bool,
}

pub const TYPES: [&str; 18] = [
    "IfcLabel",
    "IfcText",
    "IfcIdentifier",
    "IfcBoolean",
    "IfcLogical",
    "IfcInteger",
    "IfcReal",
    "IfcLengthMeasure",
    "IfcPositiveLengthMeasure",
    "IfcAreaMeasure",
    "IfcVolumeMeasure",
    "IfcMassMeasure",
    "IfcRatioMeasure",
    "IfcPositiveRatioMeasure",
    "IfcThermalTransmittanceMeasure",
    "IfcCountMeasure",
    "IfcDate",
    "IfcPlaneAngleMeasure",
];

fn targets(s: &Session) -> Vec<u32> {
    let mut v: Vec<u32> = s.selection.iter().flat_map(|&id| s.tree.subtree(id)).filter(|&id| s.doc.has_flag(id, tflags::PRODUCT) && !s.doc.has_flag(id, tflags::OPENING)).collect();
    v.sort_unstable();
    v.dedup();
    v
}

enum Act {
    Set,
    Remove(String, String),
    Rename(String, String, String),
    RenamePset(String, String),
    Retype(String, String, String),
    AddPset(String),
    SelectValue(String, String, Option<String>),
    PatternRename(Vec<(u32, String)>),
    Replace(String, String, String, String),
    Columns(Vec<(String, String)>),
}

fn type_label(v: &Value) -> Option<String> {
    match v {
        Value::Typed(t, _) => Some(camel(t)),
        Value::List(l) => l.first().and_then(type_label),
        _ => None,
    }
}

fn fmt_num(v: f64) -> String {
    if v.abs() >= 1000.0 {
        format!("{v:.0}")
    } else if v.fract().abs() < 1e-9 {
        format!("{v:.0}")
    } else {
        format!("{v:.3}")
    }
}

fn camel(upper: &str) -> String {
    TYPES.iter().find(|t| t.eq_ignore_ascii_case(upper)).map(|t| t.to_string()).unwrap_or_else(|| upper.to_string())
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let t = targets(s);
    let st = &mut app.panel_state.batch;
    let mut acts: Vec<Act> = Vec::new();
    ui.horizontal(|ui| {
        ui.label(RichText::new(format!("{} Zielobjekte", t.len())).strong());
        ui.weak("(aktuelle Auswahl inkl. untergeordneter Elemente)");
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui.button(format!("{} Tabelle importieren …", ic::IMPORT)).on_hover_text("CSV/Excel/Zwischenablage mit Schlüsselspalte übernehmen").clicked() {
                app.actions.push(Action::ImportTable);
            }
        });
    });
    if t.is_empty() {
        ui.weak("Elemente auswählen (3D-Ansicht, Struktur, Klassen oder Filter), um ihre Eigenschaften gemeinsam zu bearbeiten.");
    }
    ui.separator();
    // ---------------------------------------------------------------- setter
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::TextEdit::singleline(&mut st.pset).hint_text("Pset").desired_width(150.0));
        ui.add(egui::TextEdit::singleline(&mut st.prop).hint_text("Eigenschaft").desired_width(130.0));
        ui.add(egui::TextEdit::singleline(&mut st.value).hint_text("Wert").desired_width(120.0));
        if st.vtype.is_empty() {
            st.vtype = "Automatisch".into();
        }
        egui::ComboBox::from_id_salt("vtype").selected_text(&st.vtype).width(150.0).show_ui(ui, |ui| {
            ui.selectable_value(&mut st.vtype, "Automatisch".to_string(), "Automatisch");
            for ty in TYPES {
                ui.selectable_value(&mut st.vtype, ty.to_string(), ty);
            }
        });
        let ok = !t.is_empty() && !st.pset.trim().is_empty() && !st.prop.trim().is_empty();
        if ui.add_enabled(ok, egui::Button::new(format!("{} Auf alle setzen", ic::EDIT))).clicked() {
            acts.push(Act::Set);
        }
        if ui.add_enabled(!t.is_empty() && !st.prop.trim().is_empty(), egui::Button::new(format!("{} Bei allen entfernen", ic::DELETE))).clicked() {
            acts.push(Act::Remove(st.pset.trim().to_string(), st.prop.trim().to_string()));
        }
    });
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::TextEdit::singleline(&mut st.new_pset).hint_text("Neues Pset (leer)").desired_width(150.0));
        if ui.add_enabled(!t.is_empty() && !st.new_pset.trim().is_empty(), egui::Button::new(format!("{} Allen hinzufügen", ic::PLUS))).on_hover_text("Legt bei allen Zielobjekten ohne diesen Satz ein leeres Pset an").clicked() {
            acts.push(Act::AddPset(st.new_pset.trim().to_string()));
        }
        ui.separator();
        ui.add(egui::TextEdit::singleline(&mut st.rename_to).hint_text("Neuer Name").desired_width(130.0)).on_hover_text("Für „Umbenennen“ im Kontextmenü einer Eigenschaft oder eines Psets");
    });
    // ---------------------------------------------------------------- rename by pattern
    egui::CollapsingHeader::new(format!("{} Umbenennen nach Muster", ic::EDIT)).id_salt("pattern-rename").show(ui, |ui| {
        if st.pattern.is_empty() {
            st.pattern = "{Geschoss}-{Klasse}-{Nr:03}".into();
            st.pattern_start = 1;
        }
        ui.horizontal_wrapped(|ui| {
            ui.add(egui::TextEdit::singleline(&mut st.pattern).desired_width(260.0).font(egui::TextStyle::Monospace));
            ui.menu_button("Platzhalter", |ui| {
                for (t, d) in crate::panels::rename::TOKENS {
                    if ui.button(format!("{t}  – {d}")).clicked() {
                        st.pattern.push_str(t);
                        ui.close();
                    }
                }
            });
            ui.label("→");
            egui::ComboBox::from_id_salt("pat-target").selected_text(crate::panels::rename::TARGETS[st.pattern_target]).show_ui(ui, |ui| {
                for (i, t) in crate::panels::rename::TARGETS.iter().enumerate() {
                    ui.selectable_value(&mut st.pattern_target, i, *t);
                }
            });
            if st.pattern_target == 5 {
                ui.add(egui::TextEdit::singleline(&mut st.pattern_prop).hint_text("Pset.Eigenschaft").desired_width(160.0));
            }
        });
        ui.horizontal(|ui| {
            ui.label("Start");
            ui.add(egui::DragValue::new(&mut st.pattern_start).range(0..=1_000_000));
            ui.checkbox(&mut st.pattern_restart, "Nummerierung je Geschoss neu");
            ui.weak("Reihenfolge: Geschoss, dann oben→unten, links→rechts");
        });
        if !t.is_empty() {
            let order = crate::panels::rename::ordered(s, &t, st.pattern_restart, st.pattern_start);
            // preview only the first rows (expanding is done for all on apply)
            egui::Grid::new("pat-preview").num_columns(2).striped(true).show(ui, |ui| {
                for &(id, sti, nr) in order.iter().take(6) {
                    ui.weak(ifc_doc::model::label(&s.doc, id));
                    ui.label(format!("→ {}", crate::panels::rename::expand(s, id, &st.pattern, sti, nr)));
                    ui.end_row();
                }
            });
            if order.len() > 6 {
                ui.weak(format!("… und {} weitere", order.len() - 6));
            }
            let ok = st.pattern_target != 5 || st.pattern_prop.contains('.');
            if ui.add_enabled(ok, egui::Button::new(egui::RichText::new(format!("{} {} Objekte umbenennen", ic::CHECK, order.len())).strong())).clicked() {
                let items: Vec<(u32, String)> = order.iter().map(|&(id, sti, nr)| (id, crate::panels::rename::expand(s, id, &st.pattern, sti, nr))).collect();
                acts.push(Act::PatternRename(items));
            }
        }
    });
    // ---------------------------------------------------------------- summary
    let key = (s.uid, s.doc.revision(), t.len());
    if st.summary_key != Some(key) && t.len() <= 200_000 {
        let doc = &s.doc;
        let parts: Vec<Vec<((String, String), String, Option<String>)>> = t
            .par_iter()
            .map(|&id| model::psets_of(doc, id).into_iter().flat_map(|ps| ps.props.into_iter().map(move |p| ((ps.name.clone(), p.name.clone()), p.value.display(), type_label(&p.value)))).collect())
            .collect();
        let mut summary: BTreeMap<(String, String), PropSummary> = BTreeMap::new();
        for v in parts {
            for (k, val, ty) in v {
                let e = summary.entry(k).or_default();
                *e.values.entry(val).or_default() += 1;
                e.count += 1;
                if let Some(ty) = ty {
                    e.types.insert(ty);
                }
            }
        }
        st.summary = summary;
        st.summary_key = Some(key);
    }
    ui.separator();
    let filter_changed;
    {
        let r = ui.horizontal(|ui| {
            ui.label(ic::SEARCH);
            let r = ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Eigenschaften filtern").desired_width(200.0));
            let shown: Vec<(String, String)> = st.summary.keys().filter(|(ps, p)| st.filter.is_empty() || ps.to_lowercase().contains(&st.filter.to_lowercase()) || p.to_lowercase().contains(&st.filter.to_lowercase())).cloned().collect();
            if ui.add_enabled(!shown.is_empty(), egui::Button::new(format!("{} Als Matrix ({})", ic::TABLE, shown.len().min(40)))).on_hover_text("Objekte × Eigenschaften in der Tabelle bearbeiten (max. 40 Spalten)").clicked() {
                acts.push(Act::Columns(shown.into_iter().take(40).collect()));
            }
            ui.weak("Rechtsklick auf Eigenschaft/Wert für weitere Aktionen");
            r
        });
        filter_changed = r.inner.changed();
    }
    let _ = filter_changed;
    let filter = st.filter.to_lowercase();
    let n_targets = t.len();
    let mut pick: Option<(String, String, String)> = None;
    let rename_to = st.rename_to.trim().to_string();
    let replace_with = st.value.clone();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        egui::Grid::new("batch-sum").num_columns(4).striped(true).show(ui, |ui| {
            ui.strong("Pset");
            ui.strong("Eigenschaft");
            ui.strong("Typ");
            ui.strong(format!("Werte (bei {n_targets} Objekten)"));
            ui.end_row();
            let mut last_ps = String::new();
            for ((ps, p), sum) in &st.summary {
                if !filter.is_empty() && !ps.to_lowercase().contains(&filter) && !p.to_lowercase().contains(&filter) {
                    continue;
                }
                let ps_label = if *ps == last_ps { RichText::new(ps).weak() } else { RichText::new(ps) };
                last_ps = ps.clone();
                ui.add(egui::Label::new(ps_label).sense(egui::Sense::click())).context_menu(|ui| {
                    ui.label(RichText::new(ps).strong());
                    if ui.add_enabled(!rename_to.is_empty(), egui::Button::new(format!("Pset umbenennen in „{rename_to}“"))).clicked() {
                        acts.push(Act::RenamePset(ps.clone(), rename_to.clone()));
                        ui.close();
                    }
                    if ui.button("Objekte mit diesem Pset auswählen").clicked() {
                        acts.push(Act::SelectValue(ps.clone(), String::new(), None));
                        ui.close();
                    }
                });
                let pr = ui.add(egui::Label::new(p).sense(egui::Sense::click()));
                if pr.clicked() {
                    pick = Some((ps.clone(), p.clone(), String::new()));
                }
                pr.on_hover_text("Klick: in Editor übernehmen · Rechtsklick: Aktionen").context_menu(|ui| {
                    ui.label(RichText::new(format!("{ps}.{p}")).strong());
                    if ui.button(format!("{} Als Tabellenspalte", ic::TABLE)).clicked() {
                        acts.push(Act::Columns(vec![(ps.clone(), p.clone())]));
                        ui.close();
                    }
                    if ui.button("Objekte mit dieser Eigenschaft auswählen").clicked() {
                        acts.push(Act::SelectValue(ps.clone(), p.clone(), None));
                        ui.close();
                    }
                    if ui.add_enabled(!rename_to.is_empty(), egui::Button::new(format!("Umbenennen in „{rename_to}“"))).clicked() {
                        acts.push(Act::Rename(ps.clone(), p.clone(), rename_to.clone()));
                        ui.close();
                    }
                    ui.menu_button("Datentyp ändern", |ui| {
                        for ty in TYPES {
                            if ui.button(ty).clicked() {
                                acts.push(Act::Retype(ps.clone(), p.clone(), ty.to_string()));
                                ui.close();
                            }
                        }
                    });
                    ui.separator();
                    if ui.button(RichText::new(format!("{} Bei allen entfernen", ic::DELETE)).color(egui::Color32::from_rgb(240, 110, 90))).clicked() {
                        acts.push(Act::Remove(ps.clone(), p.clone()));
                        ui.close();
                    }
                });
                let tys: Vec<&str> = sum.types.iter().map(|x| x.trim_start_matches("Ifc")).collect();
                let mut ty_text = tys.join(", ");
                // numeric values: sum and mean
                let nums: Vec<(f64, usize)> = sum.values.iter().filter_map(|(v, n)| v.replace(',', ".").parse::<f64>().ok().map(|f| (f, *n))).collect();
                if !nums.is_empty() && nums.len() == sum.values.len() {
                    let total: f64 = nums.iter().map(|(f, n)| f * *n as f64).sum();
                    let count: usize = nums.iter().map(|(_, n)| n).sum();
                    ty_text = format!("{ty_text}  Σ {} · Ø {}", fmt_num(total), fmt_num(total / count.max(1) as f64));
                }
                if tys.len() > 1 {
                    ui.colored_label(egui::Color32::from_rgb(230, 180, 80), ty_text).on_hover_text("Uneinheitliche Datentypen – per Rechtsklick vereinheitlichen");
                } else {
                    ui.weak(ty_text);
                }
                ui.horizontal_wrapped(|ui| {
                    for (v, n) in sum.values.iter().take(8) {
                        let r = ui.small_button(format!("{} ({n})", if v.is_empty() { "—" } else { v }));
                        if r.clicked() {
                            pick = Some((ps.clone(), p.clone(), v.clone()));
                        }
                        r.on_hover_text("Klick: in Editor übernehmen · Rechtsklick: Aktionen").context_menu(|ui| {
                            if ui.button(format!("Objekte mit „{v}“ auswählen")).clicked() {
                                acts.push(Act::SelectValue(ps.clone(), p.clone(), Some(v.clone())));
                                ui.close();
                            }
                            if ui.button(format!("„{v}“ ersetzen durch „{replace_with}“ (Feld Wert)")).clicked() {
                                acts.push(Act::Replace(ps.clone(), p.clone(), v.clone(), replace_with.clone()));
                                ui.close();
                            }
                        });
                    }
                    if sum.values.len() > 8 {
                        ui.weak(format!("+{} weitere", sum.values.len() - 8));
                    }
                    if sum.count < n_targets {
                        ui.weak(format!("fehlt bei {}", n_targets - sum.count));
                    }
                });
                ui.end_row();
            }
        });
    });
    if let Some((a, b, c)) = pick {
        st.pset = a;
        st.prop = b;
        st.value = c;
    }
    // ---------------------------------------------------------------- actions
    let split = app.settings.split_shared_psets;
    for a in acts {
        let st = &app.panel_state.batch;
        match a {
            Act::Set => {
                let (pset, prop) = (st.pset.trim().to_string(), st.prop.trim().to_string());
                let value = if st.vtype == "Automatisch" { ops::typed_value_from_text(&st.value, None) } else { ops::typed_value(&st.vtype.to_ascii_uppercase(), &st.value, &s.doc) };
                let n = t.len();
                if s.edit(&format!("{prop} bei {n} Objekten setzen"), |doc| {
                    // objects sharing one pset get it updated once (all of them receive the same value)
                    for &id in &t {
                        ops::set_property(doc, id, &pset, &prop, value.clone(), false)?;
                    }
                    Ok(())
                })
                .is_some()
                {
                    app.toast(format!("{prop} bei {n} Objekten gesetzt"));
                }
            }
            Act::Remove(pset, prop) => {
                let mut removed = 0usize;
                s.edit(&format!("{prop} entfernen"), |doc| {
                    for &id in &t {
                        for ps in model::psets_of(doc, id) {
                            if ps.from_type.is_some() || (!pset.is_empty() && ps.name != pset) {
                                continue;
                            }
                            for p in ps.props.iter().filter(|p| p.name == prop) {
                                if doc.exists(p.id) && doc.exists(ps.id) {
                                    ops::remove_property(doc, ps.id, p.id)?;
                                    removed += 1;
                                }
                            }
                        }
                    }
                    Ok(())
                });
                app.toast(format!("{removed} Eigenschaften entfernt"));
            }
            Act::Rename(pset, prop, to) => {
                let mut n = 0usize;
                s.edit(&format!("{prop} umbenennen"), |doc| {
                    let mut done = rustc_hash::FxHashSet::default();
                    for &id in &t {
                        for ps in model::psets_of(doc, id).into_iter().filter(|x| x.name == pset && x.from_type.is_none()) {
                            for p in ps.props.iter().filter(|p| p.name == prop) {
                                if done.insert(p.id) {
                                    ops::rename_property(doc, p.id, &to)?;
                                    n += 1;
                                }
                            }
                        }
                    }
                    Ok(())
                });
                app.toast(format!("{n} Eigenschaften umbenannt"));
            }
            Act::RenamePset(pset, to) => {
                let mut n = 0usize;
                s.edit(&format!("{pset} umbenennen"), |doc| {
                    let mut done = rustc_hash::FxHashSet::default();
                    for &id in &t {
                        for ps in model::psets_of(doc, id).into_iter().filter(|x| x.name == pset && x.from_type.is_none()) {
                            if done.insert(ps.id) {
                                ops::rename_pset(doc, ps.id, &to)?;
                                n += 1;
                            }
                        }
                    }
                    Ok(())
                });
                app.toast(format!("{n} Psets umbenannt"));
            }
            Act::Retype(pset, prop, ty) => {
                let mut n = 0usize;
                let mut failed = 0usize;
                s.edit(&format!("Datentyp von {prop} ändern"), |doc| {
                    let mut done = rustc_hash::FxHashSet::default();
                    for &id in &t {
                        for ps in model::psets_of(doc, id).into_iter().filter(|x| x.name == pset && x.from_type.is_none()) {
                            for p in ps.props.iter().filter(|p| p.name == prop) {
                                if done.insert(p.id) {
                                    if ops::retype_property(doc, p.id, &ty.to_ascii_uppercase())? {
                                        n += 1;
                                    } else {
                                        failed += 1;
                                    }
                                }
                            }
                        }
                    }
                    Ok(())
                });
                app.toast(if failed > 0 { format!("{n} Werte umgewandelt, {failed} nicht umwandelbar (unverändert)") } else { format!("{n} Werte in {ty} umgewandelt") });
            }
            Act::AddPset(name) => {
                let mut n = 0usize;
                s.edit(&format!("{name} hinzufügen"), |doc| {
                    for &id in &t {
                        if ops::find_pset(doc, id, &name).is_none() {
                            ops::create_pset(doc, &[id], &name, name.starts_with("Qto_"));
                            n += 1;
                        }
                    }
                    Ok(())
                });
                app.toast(format!("{name} bei {n} Objekten angelegt"));
            }
            Act::SelectValue(pset, prop, value) => {
                let doc = &s.doc;
                let ids: Vec<u32> = t
                    .par_iter()
                    .copied()
                    .filter(|&id| {
                        model::psets_of(doc, id).into_iter().filter(|ps| ps.name == pset).any(|ps| prop.is_empty() || ps.props.iter().any(|p| p.name == prop && value.as_ref().map(|v| p.value.display() == *v).unwrap_or(true)))
                    })
                    .collect();
                let n = ids.len();
                s.select(ids, false);
                app.toast(format!("{n} Objekte ausgewählt"));
            }
            Act::Replace(pset, prop, from, to) => {
                let mut n = 0usize;
                s.edit(&format!("{prop}: Wert ersetzen"), |doc| {
                    let mut done = rustc_hash::FxHashSet::default();
                    for &id in &t {
                        for ps in model::psets_of(doc, id).into_iter().filter(|x| x.name == pset && x.from_type.is_none()) {
                            for p in ps.props.iter().filter(|p| p.name == prop && p.value.display() == from) {
                                if done.insert(p.id) {
                                    let hint = match &p.value {
                                        Value::List(l) => l.first().cloned(),
                                        v => Some(v.clone()),
                                    };
                                    ops::set_property_in_pset(doc, ps.id, &prop, ops::typed_value_from_text(&to, hint.as_ref().filter(|v| matches!(v, Value::Typed(..)))))?;
                                    n += 1;
                                }
                            }
                        }
                    }
                    Ok(())
                });
                app.toast(format!("{n} Werte ersetzt"));
            }
            Act::PatternRename(items) => {
                let (target, prop) = (st.pattern_target, st.pattern_prop.clone());
                if let Some(n) = crate::panels::rename::apply(s, &items, target, &prop, split) {
                    app.toast(format!("{n} Objekte umbenannt"));
                }
            }
            Act::Columns(cols) => {
                let ts = &mut app.panel_state.table;
                ts.use_selection = true;
                for c in cols {
                    if !ts.columns.contains(&c) {
                        ts.columns.push(c);
                    }
                }
                ts.key = None;
                app.actions.push(Action::OpenTab(Tab::Table));
            }
        }
    }
    let _ = split;
}
