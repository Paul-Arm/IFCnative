//! Material library: list, usage, rename, create layer sets, assign.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use ifc_doc::{model, ops, Value};

#[derive(Default)]
pub struct MaterialsState {
    pub filter: String,
    pub new_name: String,
    pub layers: Vec<(String, f64)>,
    pub set_name: String,
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let unit = model::length_unit(&s.doc).0;
    let st = &mut app.panel_state.materials;
    let mut create: Option<String> = None;
    ui.horizontal(|ui| {
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Material suchen").desired_width(150.0));
        ui.add(egui::TextEdit::singleline(&mut st.new_name).hint_text("Neues Material").desired_width(120.0));
        if ui.add_enabled(!st.new_name.trim().is_empty(), egui::Button::new(ic::PLUS)).clicked() {
            create = Some(st.new_name.trim().to_string());
            st.new_name.clear();
        }
    });
    if let Some(n) = create {
        s.edit("Material anlegen", |doc| {
            ops::create_material(doc, &n, None);
            Ok(())
        });
    }
    let st = &mut app.panel_state.materials;
    ui.separator();
    let mats = s.doc.ids_of_type("IFCMATERIAL");
    let filter = st.filter.to_lowercase();
    let mut action: Option<(&str, u32, String)> = None;
    egui::Grid::new("mats").num_columns(4).striped(true).show(ui, |ui| {
        ui.strong("Material");
        ui.strong("Kategorie");
        ui.strong("Verwendung");
        ui.label("");
        ui.end_row();
        for m in mats {
            let name = model::material_name(&s.doc, m);
            if !filter.is_empty() && !name.to_lowercase().contains(&filter) {
                continue;
            }
            let key = ui.id().with(("matname", m, s.doc.revision()));
            if let Some(n) = crate::panels::inspector::edit_field(ui, key, &name, 150.0) {
                action = Some(("rename", m, n));
            }
            ui.label(s.doc.attr_str(m, "Category").unwrap_or_default());
            let users = users_of_material(&s.doc, m);
            ui.label(users.len().to_string());
            ui.horizontal(|ui| {
                if ui.small_button("Verwender").on_hover_text("Objekte mit diesem Material auswählen").clicked() {
                    action = Some(("select", m, String::new()));
                }
                if ui.small_button("Zuweisen").on_hover_text("Der aktuellen Auswahl zuweisen").clicked() {
                    action = Some(("assign", m, String::new()));
                }
            });
            ui.end_row();
        }
    });
    ui.separator();
    ui.collapsing(format!("{} Schichtaufbau anlegen und zuweisen", ic::LAYERS), |ui| {
        ui.horizontal(|ui| {
            ui.label("Name");
            ui.text_edit_singleline(&mut st.set_name);
        });
        let mut remove = None;
        for (i, (n, t)) in st.layers.iter_mut().enumerate() {
            ui.horizontal(|ui| {
                ui.add(egui::TextEdit::singleline(n).hint_text("Material").desired_width(140.0));
                ui.add(egui::DragValue::new(t).speed(0.005).suffix(" m").max_decimals(3));
                if ui.small_button(ic::CLOSE).clicked() {
                    remove = Some(i);
                }
            });
        }
        if let Some(i) = remove {
            st.layers.remove(i);
        }
        ui.horizontal(|ui| {
            if ui.button(format!("{} Schicht", ic::PLUS)).clicked() {
                st.layers.push(("Beton".into(), 0.2));
            }
            if ui.add_enabled(!st.layers.is_empty() && !s.selection.is_empty(), egui::Button::new("Anlegen + der Auswahl zuweisen")).clicked() {
                action = Some(("layerset", 0, String::new()));
            }
        });
    });
    if let Some((a, m, n)) = action {
        match a {
            "rename" => {
                s.edit("Material umbenennen", |doc| doc.set_arg(m, 0, Value::Str(n)));
            }
            "select" => {
                let u = users_of_material(&s.doc, m);
                s.select(u, false);
            }
            "assign" => {
                let sel = s.selection.clone();
                s.edit("Material zuweisen", |doc| ops::assign_material(doc, &sel, m));
            }
            "layerset" => {
                let st = &app.panel_state.materials;
                let layers: Vec<(String, f64)> = st.layers.iter().map(|(n, t)| (n.clone(), t / unit)).collect();
                let name = if st.set_name.is_empty() { "Schichtaufbau".to_string() } else { st.set_name.clone() };
                let sel = s.selection.clone();
                s.edit("Schichtaufbau zuweisen", |doc| {
                    let set = ops::create_layer_set(doc, &name, &layers);
                    ops::assign_material(doc, &sel, set)
                });
            }
            _ => {}
        }
    }
}

/// Objects associated (directly or via layer/constituent sets) with a material.
pub fn users_of_material(doc: &ifc_doc::Document, m: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let mut stack = vec![m];
    let mut seen = rustc_hash::FxHashSet::default();
    while let Some(x) = stack.pop() {
        if !seen.insert(x) || seen.len() > 10_000 {
            continue;
        }
        for r in doc.referencing(x) {
            match doc.type_name(r).unwrap_or("") {
                "IFCRELASSOCIATESMATERIAL" => out.extend(doc.arg(r, 4).map(|v| v.ref_list()).unwrap_or_default()),
                "IFCMATERIALLAYER" | "IFCMATERIALLAYERSET" | "IFCMATERIALLAYERSETUSAGE" | "IFCMATERIALLIST" | "IFCMATERIALCONSTITUENT" | "IFCMATERIALCONSTITUENTSET" | "IFCMATERIALPROFILE" | "IFCMATERIALPROFILESET" | "IFCMATERIALPROFILESETUSAGE" => stack.push(r),
                _ => {}
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}
