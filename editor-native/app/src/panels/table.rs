//! Spreadsheet view of objects with configurable property columns (editable).

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui_extras::{Column, TableBuilder};
use ifc_doc::{model, ops, tflags, Value};

#[derive(Default)]
pub struct TableState {
    pub class: String,
    pub columns: Vec<(String, String)>,
    pub new_col: String,
    pub rows: Vec<u32>,
    pub key: Option<(u64, u64, String, usize)>,
    pub use_selection: bool,
    pub sort_col: Option<usize>,
    pub sort_desc: bool,
}

fn cell_value(doc: &ifc_doc::Document, tree: &model::SpatialTree, id: u32, col: &(String, String)) -> String {
    match col.0.as_str() {
        "" => match col.1.as_str() {
            "Name" => doc.name_of(id).unwrap_or_default(),
            "Klasse" => doc.type_camel(id).unwrap_or("").to_string(),
            "GlobalId" => doc.guid_of(id).unwrap_or_default(),
            "Geschoss" => tree.storey_of(doc, id).map(|s| model::label(doc, s)).unwrap_or_default(),
            "Typ" => model::type_of(doc, id).map(|t| model::label(doc, t)).unwrap_or_default(),
            "Material" => model::materials_of(doc, id).first().and_then(|m| m.layers.first().map(|l| l.material_name.clone())).unwrap_or_default(),
            a => doc.attr(id, a).map(|v| v.display()).unwrap_or_default(),
        },
        ps => model::psets_of(doc, id).into_iter().filter(|p| p.name == ps).flat_map(|p| p.props).find(|p| p.name == col.1).map(|p| p.value.display()).unwrap_or_default(),
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let mut export_request: Option<u8> = None;
    let st = &mut app.panel_state.table;
    if st.columns.is_empty() {
        st.columns = vec![("".into(), "Name".into()), ("".into(), "Klasse".into()), ("".into(), "Geschoss".into()), ("".into(), "GlobalId".into())];
    }
    ui.horizontal(|ui| {
        ui.checkbox(&mut st.use_selection, "Nur Auswahl");
        ui.add(egui::TextEdit::singleline(&mut st.class).hint_text("Klasse (leer = alle)").desired_width(130.0));
        ui.add(egui::TextEdit::singleline(&mut st.new_col).hint_text("Spalte: Pset.Eigenschaft oder Attribut").desired_width(220.0));
        if ui.add_enabled(!st.new_col.trim().is_empty(), egui::Button::new(format!("{} Spalte", ic::PLUS))).clicked() {
            let c = st.new_col.trim().to_string();
            st.columns.push(match c.split_once('.') {
                Some((a, b)) => (a.to_string(), b.to_string()),
                None => ("".to_string(), c),
            });
            st.new_col.clear();
        }
        if ui.button(format!("{} Aktualisieren", ic::REDO)).clicked() {
            st.key = None;
        }
        if ui.button(format!("{} Alle Eigenschaften", ic::PLUS)).on_hover_text("Alle Pset-Eigenschaften der angezeigten Objekte als Spalten hinzufügen").clicked() {
            let mut seen: std::collections::BTreeSet<(String, String)> = st.columns.iter().cloned().collect();
            for &id in st.rows.iter().take(2000) {
                for ps in model::psets_of(&s.doc, id) {
                    for p in ps.props {
                        let c = (ps.name.clone(), p.name);
                        if seen.insert(c.clone()) {
                            st.columns.push(c);
                        }
                    }
                }
            }
        }
        ui.separator();
        if ui.button(format!("{} Import …", ic::IMPORT)).on_hover_text("CSV/Excel-Tabelle oder Zwischenablage in das Modell übernehmen").clicked() {
            app.actions.push(crate::app::Action::ImportTable);
        }
        ui.menu_button(format!("{} Export", ic::EXPORT), |ui| {
            if ui.button("In Zwischenablage (für Excel)").clicked() {
                export_request = Some(0);
                ui.close();
            }
            if ui.button("Als CSV …").clicked() {
                export_request = Some(1);
                ui.close();
            }
            if ui.button("Als Excel (XLSX) …").clicked() {
                export_request = Some(2);
                ui.close();
            }
        });
    });
    let key = (s.uid, s.doc.revision(), st.class.clone(), if st.use_selection { s.selection.len() } else { usize::MAX });
    if st.key.as_ref() != Some(&key) {
        let class = st.class.trim().to_ascii_uppercase();
        let class = if class.is_empty() || class.starts_with("IFC") { class } else { format!("IFC{class}") };
        let mut rows: Vec<u32> = if st.use_selection {
            s.selection.iter().flat_map(|&id| s.tree.subtree(id)).filter(|&id| s.doc.has_flag(id, tflags::PRODUCT)).collect()
        } else if class.is_empty() {
            s.doc.ids_with_flag(tflags::ELEMENT).into_iter().filter(|&i| !s.doc.has_flag(i, tflags::OPENING)).collect()
        } else {
            s.doc.ids_of_kind(&class)
        };
        rows.dedup();
        if let Some(c) = st.sort_col.and_then(|c| st.columns.get(c).cloned()) {
            let doc = &s.doc;
            let tree = &s.tree;
            let mut keyed: Vec<(String, u32)> = rows.iter().map(|&id| (cell_value(doc, tree, id, &c), id)).collect();
            keyed.sort_by(|a, b| natural_cmp(&a.0, &b.0));
            if st.sort_desc {
                keyed.reverse();
            }
            rows = keyed.into_iter().map(|x| x.1).collect();
        }
        st.rows = rows;
        st.key = Some(key);
    }
    if let Some(kind) = export_request {
        let mut headers = vec!["STEP-Id".to_string()];
        headers.extend(st.columns.iter().map(|c| if c.0.is_empty() { c.1.clone() } else { format!("{}.{}", c.0, c.1) }));
        if !st.columns.iter().any(|c| c.0.is_empty() && c.1 == "GlobalId") {
            headers.insert(1, "GlobalId".into());
        }
        let with_guid = headers.get(1).map(|h| h == "GlobalId").unwrap_or(false) && !st.columns.iter().any(|c| c.0.is_empty() && c.1 == "GlobalId");
        let rows: Vec<Vec<String>> = st
            .rows
            .iter()
            .map(|&id| {
                let mut r = vec![format!("#{id}")];
                if with_guid {
                    r.push(s.doc.guid_of(id).unwrap_or_default());
                }
                r.extend(st.columns.iter().map(|c| cell_value(&s.doc, &s.tree, id, c)));
                r
            })
            .collect();
        match kind {
            0 => match arboard::Clipboard::new().and_then(|mut c| c.set_text(ifc_doc::import::to_delimited(&headers, &rows, '\t'))) {
                Ok(()) => app.toast(format!("{} Zeilen in die Zwischenablage kopiert", rows.len())),
                Err(e) => app.error(format!("Zwischenablage: {e}")),
            },
            1 | 2 => {
                let ext = if kind == 2 { "xlsx" } else { "csv" };
                if let Some(p) = rfd::FileDialog::new().add_filter(ext, &[ext]).set_file_name(format!("Tabelle.{ext}")).save_file() {
                    let res = if kind == 2 { ifc_doc::import::write_xlsx_rows("Tabelle", &headers, &rows, &p) } else { ifc_doc::import::write_csv_rows(&headers, &rows, &p) };
                    match res {
                        Ok(()) => app.toast(format!("{} Zeilen exportiert", rows.len())),
                        Err(e) => app.error(e.to_string()),
                    }
                }
            }
            _ => {}
        }
    }
    let st = &mut app.panel_state.table;
    ui.weak(format!("{} Zeilen – Zellen der Eigenschaftsspalten und „Name“ sind editierbar", st.rows.len()));
    let cols = st.columns.clone();
    let rows = st.rows.clone();
    let mut edit: Option<(u32, (String, String), String)> = None;
    let mut remove_col: Option<usize> = None;
    let mut sort: Option<usize> = None;
    let mut select: Option<u32> = None;
    let sel: rustc_hash::FxHashSet<u32> = s.selection.iter().copied().collect();
    egui::ScrollArea::horizontal().show(ui, |ui| {
        let mut tb = TableBuilder::new(ui).striped(true).resizable(true).cell_layout(egui::Layout::left_to_right(egui::Align::Center)).column(Column::exact(70.0));
        for _ in &cols {
            tb = tb.column(Column::initial(140.0).at_least(60.0).clip(true));
        }
        tb.header(22.0, |mut h| {
            h.col(|ui| {
                ui.strong("#Id");
            });
            for (i, c) in cols.iter().enumerate() {
                h.col(|ui| {
                    let label = if c.0.is_empty() { c.1.clone() } else { format!("{}.{}", c.0, c.1) };
                    if ui.button(egui::RichText::new(label).strong()).on_hover_text("Sortieren").clicked() {
                        sort = Some(i);
                    }
                    if ui.small_button("✖").clicked() {
                        remove_col = Some(i);
                    }
                });
            }
        })
        .body(|body| {
            body.rows(20.0, rows.len(), |mut row| {
                let id = rows[row.index()];
                row.set_selected(sel.contains(&id));
                row.col(|ui| {
                    if ui.link(format!("#{id}")).clicked() {
                        select = Some(id);
                    }
                });
                for c in &cols {
                    row.col(|ui| {
                        let v = cell_value(&s.doc, &s.tree, id, c);
                        let editable = !c.0.is_empty() || c.1 == "Name";
                        if editable {
                            let key = ui.id().with(("cell", id, c.0.as_str(), c.1.as_str(), s.doc.revision()));
                            if let Some(n) = crate::panels::inspector::edit_field(ui, key, &v, ui.available_width()) {
                                edit = Some((id, c.clone(), n));
                            }
                        } else {
                            ui.label(v);
                        }
                    });
                }
            });
        });
    });
    let st = &mut app.panel_state.table;
    if let Some(i) = remove_col {
        st.columns.remove(i);
    }
    if let Some(i) = sort {
        if st.sort_col == Some(i) {
            st.sort_desc = !st.sort_desc;
        } else {
            st.sort_col = Some(i);
            st.sort_desc = false;
        }
        st.key = None;
    }
    if let Some(id) = select {
        s.select(vec![id], false);
    }
    if let Some((id, (ps, p), v)) = edit {
        let split = app.settings.split_shared_psets;
        if ps.is_empty() {
            s.edit("Name ändern", |doc| doc.set_arg(id, 2, if v.is_empty() { Value::Null } else { Value::Str(v) }));
        } else {
            s.edit(&format!("{p} setzen"), |doc| ops::set_property(doc, id, &ps, &p, ops::typed_value_from_text(&v, None), split));
        }
    }
}

/// Natural (numeric aware) string comparison.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    match (a.replace(',', ".").parse::<f64>(), b.replace(',', ".").parse::<f64>()) {
        (Ok(x), Ok(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
        _ => a.to_lowercase().cmp(&b.to_lowercase()),
    }
}
