//! Material library: materials and material sets with appearance, properties,
//! layers/constituents, usage, merging and assignment.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::material::{self as mt, Rgba};
use ifc_doc::{model, ops, SchemaId, Value};

#[derive(Default)]
pub struct MaterialsState {
    pub filter: String,
    pub new_name: String,
    pub layers: Vec<(String, f64)>,
    pub set_name: String,
    pub selected: Option<u32>,
    color: Option<(u32, [f32; 3], f32)>,
    paint: Option<([f32; 3], f32)>,
    merge_target: Option<u32>,
    new_prop: (String, String, String),
    preset: usize,
    add_mat: Option<u32>,
    cache: Option<((u64, u64), Vec<Row>)>,
}

#[derive(Clone)]
struct Row {
    id: u32,
    name: String,
    detail: String,
    users: usize,
    color: Option<Color32>,
    is_set: bool,
}

const CATEGORIES: [&str; 12] = ["concrete", "steel", "aluminium", "block", "brick", "stone", "wood", "glass", "gypsum", "plastic", "earth", "insulation"];

fn c32(c: Rgba) -> Color32 {
    Color32::from_rgba_unmultiplied((c.0[0] * 255.0) as u8, (c.0[1] * 255.0) as u8, (c.0[2] * 255.0) as u8, ((1.0 - c.1) * 255.0) as u8)
}

fn swatch(ui: &mut egui::Ui, c: Option<Color32>) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(14.0, 14.0), egui::Sense::hover());
    match c {
        Some(c) => {
            ui.painter().rect_filled(rect, 3.0, c.to_opaque());
        }
        None => {
            ui.painter().rect_stroke(rect, 3.0, egui::Stroke::new(1.0, ui.visuals().weak_text_color()), egui::StrokeKind::Inside);
        }
    }
}

fn kind_label(doc: &ifc_doc::Document, id: u32) -> &'static str {
    match doc.type_name(id).unwrap_or("") {
        "IFCMATERIALLAYERSET" => "Schichtaufbau",
        "IFCMATERIALCONSTITUENTSET" => "Bestandteile",
        "IFCMATERIALPROFILESET" => "Profilsatz",
        "IFCMATERIALLIST" => "Materialliste",
        _ => "Material",
    }
}

fn build_rows(doc: &ifc_doc::Document) -> Vec<Row> {
    let mut rows: Vec<Row> = doc
        .ids_of_type("IFCMATERIAL")
        .into_iter()
        .map(|m| Row {
            id: m,
            name: model::material_name(doc, m),
            detail: doc.attr_str(m, "Category").unwrap_or_default(),
            users: mt::users(doc, m).len(),
            color: mt::material_color(doc, m).map(c32),
            is_set: false,
        })
        .collect();
    rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let mut sets: Vec<Row> = mt::material_sets(doc)
        .into_iter()
        .map(|id| {
            let name = mt::set_name(doc, id);
            let n = mt::set_items(doc, id).len();
            Row { id, name: if name.is_empty() { format!("#{id}") } else { name }, detail: format!("{} · {n}", kind_label(doc, id)), users: mt::users(doc, id).len(), color: None, is_set: true }
        })
        .collect();
    sets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    rows.extend(sets);
    rows
}

enum Act {
    Create(String),
    Rename(u32, String),
    SetAttr(u32, &'static str, String),
    Color(u32, Option<Rgba>),
    Paint(Option<Rgba>),
    Select(Vec<u32>),
    Assign(u32),
    SetProp(u32, String, String, String, Option<Value>),
    RemoveProp(u32, u32),
    Preset(u32, String),
    Merge(u32, u32),
    Delete(u32),
    PurgeUnused,
    SetName(u32, String),
    ItemMaterial(u32, u32, u32),
    ItemThickness(u32, f64),
    ItemArg(u32, usize, Value),
    AddItem(u32, u32, f64),
    RemoveItem(u32, u32),
    MoveItem(u32, u32, i32),
    UsageArg(u32, usize, Value),
    NewLayerSet,
    NewConstituentSet,
    QuickLayerSet(String, Vec<(String, f64)>),
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let unit = model::length_unit(&s.doc).0;
    let ifc4 = s.doc.schema_id != SchemaId::Ifc2x3;
    let rev = (s.uid, s.doc.revision());
    let st = &mut app.panel_state.materials;
    if st.cache.as_ref().map(|c| c.0) != Some(rev) {
        st.cache = Some((rev, build_rows(&s.doc)));
    }
    let rows = st.cache.as_ref().map(|c| c.1.clone()).unwrap_or_default();
    if st.selected.map(|id| !s.doc.exists(id)).unwrap_or(false) {
        st.selected = None;
    }
    let mut acts: Vec<Act> = Vec::new();
    // ---------------------------------------------------------------- toolbar
    ui.horizontal_wrapped(|ui| {
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Material suchen").desired_width(140.0));
        ui.add(egui::TextEdit::singleline(&mut st.new_name).hint_text("Neues Material").desired_width(120.0));
        if ui.add_enabled(!st.new_name.trim().is_empty(), egui::Button::new(ic::PLUS)).on_hover_text("Material anlegen").clicked() {
            acts.push(Act::Create(st.new_name.trim().to_string()));
            st.new_name.clear();
        }
        ui.menu_button(format!("{} Satz", ic::LAYERS), |ui| {
            if ui.button("Neuer Schichtaufbau").clicked() {
                acts.push(Act::NewLayerSet);
                ui.close();
            }
            if ui.add_enabled(ifc4, egui::Button::new("Neue Bestandteile (IFC4)")).clicked() {
                acts.push(Act::NewConstituentSet);
                ui.close();
            }
        });
        let unused = rows.iter().filter(|r| !r.is_set && r.users == 0).count();
        if ui.add_enabled(unused > 0, egui::Button::new(format!("{} {unused} unbenutzte", ic::DELETE))).on_hover_text("Materialien ohne Verwendung löschen").clicked() {
            acts.push(Act::PurgeUnused);
        }
        ui.separator();
        // colour the selection (item styles)
        let (mut rgb, mut tr) = st.paint.unwrap_or(([0.85, 0.35, 0.25], 0.0));
        ui.label("Auswahl einfärben");
        let r1 = ui.color_edit_button_rgb(&mut rgb);
        let r2 = ui.add(egui::DragValue::new(&mut tr).range(0.0..=0.95).speed(0.01).prefix("Transp. "));
        if r1.changed() || r2.changed() {
            st.paint = Some((rgb, tr));
        }
        let has_sel = !s.selection.is_empty();
        if ui.add_enabled(has_sel, egui::Button::new("Anwenden")).clicked() {
            acts.push(Act::Paint(Some(([rgb[0] as f64, rgb[1] as f64, rgb[2] as f64], tr as f64))));
        }
        if ui.add_enabled(has_sel, egui::Button::new("Farbe entfernen")).on_hover_text("Objektfarben der Auswahl entfernen (Material- bzw. Klassenfarbe gilt wieder)").clicked() {
            acts.push(Act::Paint(None));
        }
    });
    ui.separator();
    let filter = st.filter.to_lowercase();
    let visible: Vec<&Row> = rows.iter().filter(|r| filter.is_empty() || r.name.to_lowercase().contains(&filter) || r.detail.to_lowercase().contains(&filter)).collect();
    let selected = st.selected;
    let avail = ui.available_height();
    let narrow = ui.available_width() < 640.0;
    let mut clicked: Option<u32> = None;
    if narrow {
        // stacked: list on top, details below
        let h = (avail * 0.38).clamp(120.0, 260.0);
        list_ui(ui, &visible, selected, h, &mut clicked);
        ui.separator();
        egui::ScrollArea::vertical().id_salt("mat-detail").auto_shrink([false, false]).show(ui, |ui| {
            detail_ui(ui, &mut app.panel_state.materials, s, unit, ifc4, &rows, &mut acts);
        });
    } else {
        ui.horizontal_top(|ui| {
            ui.vertical(|ui| {
                ui.set_width((ui.available_width() * 0.36).clamp(220.0, 360.0));
                list_ui(ui, &visible, selected, avail - 20.0, &mut clicked);
            });
            ui.separator();
            ui.vertical(|ui| {
                egui::ScrollArea::vertical().id_salt("mat-detail").max_height(avail - 4.0).auto_shrink([false, false]).show(ui, |ui| {
                    detail_ui(ui, &mut app.panel_state.materials, s, unit, ifc4, &rows, &mut acts);
                });
            });
        });
    }
    if let Some(id) = clicked {
        app.panel_state.materials.selected = Some(id);
    }
    // ---------------------------------------------------------------- apply
    for a in acts {
        let st = &mut app.panel_state.materials;
        match a {
            Act::Create(n) => {
                if let Some(m) = s.edit("Material anlegen", |doc| Ok(ops::create_material(doc, &n, None))) {
                    st.selected = Some(m);
                }
            }
            Act::Rename(m, n) => {
                s.edit("Material umbenennen", |doc| doc.set_arg(m, 0, Value::Str(n)));
            }
            Act::SetAttr(m, attr, v) => {
                s.edit(&format!("{attr} setzen"), |doc| doc.set_attr(m, attr, if v.trim().is_empty() { Value::Null } else { Value::Str(v) }));
            }
            Act::Color(m, c) => {
                s.edit("Materialfarbe", |doc| mt::set_material_color(doc, m, c));
                st.color = None;
            }
            Act::Paint(c) => {
                let sel = s.paint_targets();
                if let Some(n) = s.edit(if c.is_some() { "Objekte einfärben" } else { "Objektfarbe entfernen" }, |doc| mt::set_object_color(doc, &sel, c)) {
                    app.toast(if c.is_some() { format!("{n} Geometrie-Elemente eingefärbt") } else { "Objektfarben entfernt".to_string() });
                }
            }
            Act::Select(ids) => s.select(ids, false),
            Act::Assign(m) => {
                let sel = s.selection.clone();
                s.edit("Material zuweisen", |doc| ops::assign_material(doc, &sel, m));
            }
            Act::SetProp(m, set, p, v, typed) => {
                let doc_ref = &s.doc;
                let value = typed.unwrap_or_else(|| match mt::preset_type(&set, &p) {
                    Some(t) if !v.trim().is_empty() => ops::typed_value(t, &v, doc_ref),
                    _ if v.trim().is_empty() => Value::Null,
                    _ => ops::typed_value_from_text(&v, None),
                });
                s.edit("Materialeigenschaft setzen", |doc| mt::set_property(doc, m, &set, &p, value));
            }
            Act::RemoveProp(set, p) => {
                s.edit("Materialeigenschaft entfernen", |doc| mt::remove_property(doc, set, p));
            }
            Act::Preset(m, name) => {
                s.edit("Eigenschaftsvorlage hinzufügen", |doc| mt::add_preset(doc, m, &name));
            }
            Act::Merge(from, to) => {
                if let Some(n) = s.edit("Materialien zusammenführen", |doc| mt::merge_into(doc, from, to)) {
                    app.toast(format!("Zusammengeführt – {n} Verweise umgehängt"));
                    app.panel_state.materials.selected = Some(to);
                }
            }
            Act::Delete(m) => {
                s.edit("Material löschen", |doc| if doc.type_name(m) == Some("IFCMATERIAL") { mt::delete_material(doc, m) } else { ops::delete_entities(doc, &[m], false).map(|_| ()) });
                st.selected = None;
            }
            Act::PurgeUnused => {
                let unused = mt::unused_materials(&s.doc);
                if let Some(()) = s.edit("Unbenutzte Materialien löschen", |doc| {
                    for m in &unused {
                        mt::delete_material(doc, *m)?;
                    }
                    Ok(())
                }) {
                    app.toast(format!("{} unbenutzte Materialien gelöscht", unused.len()));
                }
            }
            Act::SetName(set, n) => {
                if let Some((_, Some(ni))) = mt::set_layout(&s.doc, set) {
                    s.edit("Satz umbenennen", |doc| doc.set_arg(set, ni, if n.trim().is_empty() { Value::Null } else { Value::Str(n) }));
                }
            }
            Act::ItemMaterial(set, item, m) => {
                s.edit("Material ändern", |doc| mt::set_item_material(doc, set, item, m));
            }
            Act::ItemThickness(item, t) => {
                s.edit("Schichtdicke", |doc| doc.set_arg(item, 1, Value::Real(t)));
            }
            Act::ItemArg(item, i, v) => {
                s.edit("Satzelement ändern", |doc| doc.set_arg(item, i, v));
            }
            Act::AddItem(set, m, t) => {
                s.edit("Satzelement hinzufügen", |doc| mt::add_item(doc, set, m, t).map(|_| ()));
            }
            Act::RemoveItem(set, item) => {
                s.edit("Satzelement entfernen", |doc| mt::remove_item(doc, set, item));
            }
            Act::MoveItem(set, item, d) => {
                s.edit("Reihenfolge ändern", |doc| mt::move_item(doc, set, item, d));
            }
            Act::UsageArg(u, i, v) => {
                s.edit("Schichtverwendung ändern", |doc| doc.set_arg(u, i, v));
            }
            Act::NewLayerSet => {
                if let Some(id) = s.edit("Schichtaufbau anlegen", |doc| Ok(ops::create_layer_set(doc, "Neuer Schichtaufbau", &[]))) {
                    st.selected = Some(id);
                }
            }
            Act::QuickLayerSet(name, layers) => {
                let sel = s.selection.clone();
                s.edit("Schichtaufbau zuweisen", |doc| {
                    let set = ops::create_layer_set(doc, &name, &layers);
                    ops::assign_material(doc, &sel, set)
                });
            }
            Act::NewConstituentSet => {
                if let Some(id) = s.edit("Bestandteile anlegen", |doc| Ok(mt::create_constituent_set(doc, "Neue Bestandteile"))) {
                    st.selected = Some(id);
                }
            }
        }
    }
}

fn list_ui(ui: &mut egui::Ui, visible: &[&Row], selected: Option<u32>, height: f32, clicked: &mut Option<u32>) {
    let mats = visible.iter().filter(|r| !r.is_set).count();
    ui.weak(format!("{mats} Materialien · {} Sätze", visible.len() - mats));
    egui::ScrollArea::vertical().id_salt("mat-list").max_height(height).auto_shrink([false, true]).show_rows(ui, 20.0, visible.len(), |ui, range| {
        for r in &visible[range] {
            ui.horizontal(|ui| {
                if r.is_set {
                    ui.label(RichText::new(ic::LAYERS).weak());
                } else {
                    swatch(ui, r.color);
                }
                let text = RichText::new(&r.name);
                let resp = ui.selectable_label(selected == Some(r.id), if r.users == 0 { text.weak() } else { text });
                if resp.clicked() {
                    *clicked = Some(r.id);
                }
                resp.on_hover_text(format!("{} – {} Objekte", if r.detail.is_empty() { "Material" } else { &r.detail }, r.users));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.weak(r.users.to_string());
                    if !r.detail.is_empty() {
                        ui.add(egui::Label::new(RichText::new(&r.detail).weak().small()).truncate());
                    }
                });
            });
        }
    });
}

fn detail_ui(ui: &mut egui::Ui, st: &mut MaterialsState, s: &Session, unit: f64, ifc4: bool, rows: &[Row], acts: &mut Vec<Act>) {
    match st.selected {
        None => {
            ui.weak("Material oder Materialsatz auswählen.");
            ui.add_space(8.0);
            layer_builder(ui, st, s, acts);
        }
        Some(id) if s.doc.type_name(id) == Some("IFCMATERIAL") => material_detail(ui, st, s, id, ifc4, rows, acts),
        Some(id) => set_detail(ui, st, s, id, unit, rows, acts),
    }
}

fn material_combo(ui: &mut egui::Ui, salt: impl std::hash::Hash + std::fmt::Debug, rows: &[Row], current: Option<u32>, width: f32) -> Option<u32> {
    let mut pick = None;
    let label = current.and_then(|c| rows.iter().find(|r| r.id == c)).map(|r| r.name.clone()).unwrap_or_else(|| "– wählen –".into());
    egui::ComboBox::from_id_salt(salt).width(width).selected_text(label).height(320.0).show_ui(ui, |ui| {
        for r in rows.iter().filter(|r| !r.is_set) {
            ui.horizontal(|ui| {
                swatch(ui, r.color);
                if ui.selectable_label(current == Some(r.id), &r.name).clicked() {
                    pick = Some(r.id);
                }
            });
        }
    });
    pick
}

fn material_detail(ui: &mut egui::Ui, st: &mut MaterialsState, s: &Session, m: u32, ifc4: bool, rows: &[Row], acts: &mut Vec<Act>) {
    let doc = &s.doc;
    let name = model::material_name(doc, m);
    let color = mt::material_color(doc, m);
    ui.horizontal(|ui| {
        swatch(ui, color.map(c32));
        ui.label(RichText::new(&name).heading());
        ui.weak(format!("#{m}"));
    });
    egui::Grid::new(("mat-attrs", m)).num_columns(2).spacing([12.0, 4.0]).show(ui, |ui| {
        ui.label("Name");
        if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with(("mname", m, doc.revision())), &name, 240.0) {
            acts.push(Act::Rename(m, n));
        }
        ui.end_row();
        for (attr, label) in [("Description", "Beschreibung"), ("Category", "Kategorie")] {
            ui.label(label);
            if ifc4 {
                let v = doc.attr_str(m, attr).unwrap_or_default();
                ui.horizontal(|ui| {
                    if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with((attr, m, doc.revision())), &v, 240.0) {
                        acts.push(Act::SetAttr(m, attr, n));
                    }
                    if attr == "Category" {
                        ui.menu_button(ic::CARET_DOWN, |ui| {
                            for c in CATEGORIES {
                                if ui.button(c).clicked() {
                                    acts.push(Act::SetAttr(m, "Category", c.to_string()));
                                    ui.close();
                                }
                            }
                        })
                        .response
                        .on_hover_text("Empfohlene Kategorien (IFC4)");
                    }
                });
            } else {
                ui.weak("erst ab IFC4");
            }
            ui.end_row();
        }
    });
    ui.add_space(6.0);
    // ------------------------------------------------------------ appearance
    ui.label(RichText::new("Darstellung").strong());
    ui.horizontal(|ui| {
        let cur = color.map(|c| ([c.0[0] as f32, c.0[1] as f32, c.0[2] as f32], c.1 as f32)).unwrap_or(([0.75, 0.75, 0.75], 0.0));
        let (mut rgb, mut tr) = match st.color {
            Some((id, rgb, tr)) if id == m => (rgb, tr),
            _ => cur,
        };
        let r1 = ui.color_edit_button_rgb(&mut rgb);
        ui.label("Transparenz");
        let r2 = ui.add(egui::Slider::new(&mut tr, 0.0..=0.95).fixed_decimals(2));
        if r1.changed() || r2.changed() {
            st.color = Some((m, rgb, tr));
        }
        let pending = matches!(st.color, Some((id, _, _)) if id == m);
        if ui.add_enabled(pending, egui::Button::new(RichText::new(format!("{} Übernehmen", ic::CHECK)).strong())).clicked() {
            acts.push(Act::Color(m, Some(([rgb[0] as f64, rgb[1] as f64, rgb[2] as f64], tr as f64))));
        }
        if ui.add_enabled(color.is_some(), egui::Button::new("Entfernen")).on_hover_text("Materialfarbe entfernen").clicked() {
            acts.push(Act::Color(m, None));
        }
    });
    if color.is_none() {
        ui.weak("Keine Materialfarbe – Objekte ohne eigene Darstellung nutzen die Klassenfarbe.");
    }
    ui.add_space(6.0);
    // ------------------------------------------------------------ usage
    let users = mt::users(doc, m);
    ui.label(RichText::new("Verwendung").strong());
    ui.horizontal_wrapped(|ui| {
        ui.label(format!("{} Objekte", users.len()));
        if ui.add_enabled(!users.is_empty(), egui::Button::new(format!("{} Auswählen", ic::SELECT))).clicked() {
            acts.push(Act::Select(users.clone()));
        }
        if ui.add_enabled(!s.selection.is_empty(), egui::Button::new("Der Auswahl zuweisen")).on_hover_text("Ersetzt die bisherige Materialzuordnung der ausgewählten Objekte").clicked() {
            acts.push(Act::Assign(m));
        }
    });
    let containers = mt::containers_of(doc, m);
    if !containers.is_empty() {
        ui.horizontal_wrapped(|ui| {
            ui.weak("in:");
            for c in containers {
                let n = mt::set_name(doc, c);
                if ui.link(format!("{} {}", kind_label(doc, c), if n.is_empty() { format!("#{c}") } else { n })).clicked() {
                    st.selected = Some(c);
                }
            }
        });
    }
    ui.add_space(6.0);
    // ------------------------------------------------------------ properties
    ui.label(RichText::new("Materialeigenschaften").strong());
    let sets = mt::property_sets(doc, m);
    if sets.is_empty() {
        ui.weak("Keine Eigenschaften.");
    }
    for set in &sets {
        egui::CollapsingHeader::new(format!("{} ({})", set.name, set.props.len())).id_salt(("mps", set.id)).default_open(true).show(ui, |ui| {
            egui::Grid::new(("mps-grid", set.id)).num_columns(3).striped(true).show(ui, |ui| {
                for p in &set.props {
                    ui.label(&p.name).on_hover_text(mt::preset_type(&set.name, &p.name).unwrap_or(""));
                    let v = p.value.display();
                    if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with(("mpv", p.id, doc.revision())), &v, 160.0) {
                        let typed = match (&p.value, n.trim().is_empty()) {
                            (Value::Typed(t, _), false) => Some(ops::typed_value(t, &n, doc)),
                            _ => None,
                        };
                        acts.push(Act::SetProp(m, set.name.clone(), p.name.clone(), n, typed));
                    }
                    if ui.small_button(ic::CLOSE).on_hover_text("Eigenschaft entfernen").clicked() {
                        acts.push(Act::RemoveProp(set.id, p.id));
                    }
                    ui.end_row();
                }
            });
        });
    }
    ui.horizontal_wrapped(|ui| {
        let np = &mut st.new_prop;
        ui.add(egui::TextEdit::singleline(&mut np.0).hint_text("Satz (Pset_Material…)").desired_width(150.0));
        ui.add(egui::TextEdit::singleline(&mut np.1).hint_text("Eigenschaft").desired_width(110.0));
        ui.add(egui::TextEdit::singleline(&mut np.2).hint_text("Wert").desired_width(80.0));
        let ok = !np.0.trim().is_empty() && !np.1.trim().is_empty();
        if ui.add_enabled(ok, egui::Button::new(ic::PLUS)).clicked() {
            acts.push(Act::SetProp(m, np.0.trim().to_string(), np.1.trim().to_string(), np.2.clone(), None));
            np.1.clear();
            np.2.clear();
        }
    });
    ui.horizontal(|ui| {
        ui.label("Vorlage");
        egui::ComboBox::from_id_salt("mat-preset").selected_text(mt::PRESETS[st.preset].0).show_ui(ui, |ui| {
            for (i, p) in mt::PRESETS.iter().enumerate() {
                ui.selectable_value(&mut st.preset, i, p.0).on_hover_text(p.1.iter().map(|x| x.0).collect::<Vec<_>>().join(", "));
            }
        });
        if ui.button(format!("{} Hinzufügen", ic::PLUS)).clicked() {
            acts.push(Act::Preset(m, mt::PRESETS[st.preset].0.to_string()));
        }
    });
    ui.add_space(6.0);
    // ------------------------------------------------------------ merge / delete
    ui.label(RichText::new("Bereinigen").strong());
    ui.horizontal_wrapped(|ui| {
        ui.label("Zusammenführen in");
        let others: Vec<Row> = rows.iter().filter(|r| !r.is_set && r.id != m).cloned().collect();
        if let Some(t) = material_combo(ui, ("merge", m), &others, st.merge_target.filter(|t| *t != m), 180.0) {
            st.merge_target = Some(t);
        }
        if let Some(t) = st.merge_target.filter(|t| *t != m && doc.exists(*t)) {
            if ui.button("Zusammenführen").on_hover_text("Alle Verwendungen auf das Zielmaterial umhängen und dieses Material löschen").clicked() {
                acts.push(Act::Merge(m, t));
            }
        }
        if ui.button(RichText::new(format!("{} Löschen", ic::DELETE)).color(Color32::from_rgb(240, 110, 90))).on_hover_text("Material löschen (Verweise werden entfernt)").clicked() {
            acts.push(Act::Delete(m));
        }
    });
}

fn set_detail(ui: &mut egui::Ui, st: &mut MaterialsState, s: &Session, set: u32, unit: f64, rows: &[Row], acts: &mut Vec<Act>) {
    let doc = &s.doc;
    let ty = doc.type_name(set).unwrap_or("").to_string();
    let name = mt::set_name(doc, set);
    ui.horizontal(|ui| {
        ui.label(RichText::new(ic::LAYERS).heading());
        ui.label(RichText::new(if name.is_empty() { format!("#{set}") } else { name.clone() }).heading());
        ui.weak(format!("{} · #{set}", kind_label(doc, set)));
    });
    if let Some((_, Some(_))) = mt::set_layout(doc, set) {
        ui.horizontal(|ui| {
            ui.label("Name");
            if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with(("sname", set, doc.revision())), &name, 240.0) {
                acts.push(Act::SetName(set, n));
            }
        });
    }
    let users = mt::users(doc, set);
    ui.horizontal_wrapped(|ui| {
        ui.label(format!("{} Objekte", users.len()));
        if ui.add_enabled(!users.is_empty(), egui::Button::new(format!("{} Auswählen", ic::SELECT))).clicked() {
            acts.push(Act::Select(users.clone()));
        }
        if ui.add_enabled(!s.selection.is_empty(), egui::Button::new("Der Auswahl zuweisen")).clicked() {
            acts.push(Act::Assign(set));
        }
        if ui.button(RichText::new(format!("{} Löschen", ic::DELETE)).color(Color32::from_rgb(240, 110, 90))).clicked() {
            acts.push(Act::Delete(set));
        }
    });
    ui.add_space(4.0);
    let items = mt::set_items(doc, set);
    let is_layers = ty == "IFCMATERIALLAYERSET";
    let is_const = ty == "IFCMATERIALCONSTITUENTSET";
    let ifc4 = doc.schema_id != SchemaId::Ifc2x3;
    let mm = |t: f64| t * unit * 1000.0;
    egui::Grid::new(("set-items", set)).num_columns(7).striped(true).spacing([8.0, 4.0]).show(ui, |ui| {
        ui.strong("#");
        ui.strong("Material");
        ui.strong(if is_layers { "Dicke" } else if is_const { "Anteil" } else { "" });
        ui.strong(if is_layers || is_const || ty == "IFCMATERIALPROFILESET" { "Name" } else { "" });
        ui.strong(if ifc4 && (is_layers || is_const || ty == "IFCMATERIALPROFILESET") { "Kategorie" } else { "" });
        ui.strong(if is_layers { "belüftet" } else { "" });
        ui.label("");
        ui.end_row();
        for (i, &it) in items.iter().enumerate() {
            ui.weak(format!("{}", i + 1));
            let cur = mt::item_material(doc, it);
            if let Some(nm) = material_combo(ui, ("item-mat", it), rows, cur, 150.0) {
                acts.push(Act::ItemMaterial(set, it, nm));
            }
            let a = doc.args(it).unwrap_or_default();
            if is_layers {
                let mut t = mm(a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0));
                let r = ui.add(egui::DragValue::new(&mut t).range(0.0..=100_000.0).speed(1.0).suffix(" mm").max_decimals(1));
                if r.drag_stopped() || (r.changed() && !r.dragged()) {
                    acts.push(Act::ItemThickness(it, t / 1000.0 / unit));
                }
            } else if is_const {
                let mut f = a.get(3).and_then(|v| v.as_f64()).unwrap_or(0.0) * 100.0;
                let r = ui.add(egui::DragValue::new(&mut f).range(0.0..=100.0).speed(0.5).suffix(" %").max_decimals(1));
                if r.drag_stopped() || (r.changed() && !r.dragged()) {
                    acts.push(Act::ItemArg(it, 3, Value::Real(f / 100.0)));
                }
            } else {
                ui.label("");
            }
            // name / category per item kind
            let (ni, ci) = match ty.as_str() {
                "IFCMATERIALLAYERSET" if ifc4 => (Some(3), Some(5)),
                "IFCMATERIALCONSTITUENTSET" => (Some(0), Some(4)),
                "IFCMATERIALPROFILESET" => (Some(0), Some(5)),
                _ => (None, None),
            };
            for idx in [ni, ci] {
                match idx {
                    Some(k) => {
                        let v = a.get(k).and_then(|v| v.as_str().map(|x| x.to_string())).unwrap_or_default();
                        if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with(("itm", it, k, doc.revision())), &v, 110.0) {
                            acts.push(Act::ItemArg(it, k, if n.trim().is_empty() { Value::Null } else { Value::Str(n) }));
                        }
                    }
                    None => {
                        ui.label("");
                    }
                }
            }
            if is_layers {
                let mut vent = matches!(a.get(2), Some(Value::Enum(e)) if e == "T");
                if ui.checkbox(&mut vent, "").changed() {
                    acts.push(Act::ItemArg(it, 2, Value::Enum(if vent { "T".into() } else { "F".into() })));
                }
            } else {
                ui.label("");
            }
            ui.horizontal(|ui| {
                if ui.add_enabled(i > 0, egui::Button::new(ic::ph::ARROW_UP).small()).clicked() {
                    acts.push(Act::MoveItem(set, it, -1));
                }
                if ui.add_enabled(i + 1 < items.len(), egui::Button::new(ic::ph::ARROW_DOWN).small()).clicked() {
                    acts.push(Act::MoveItem(set, it, 1));
                }
                if ui.small_button(ic::CLOSE).on_hover_text("Entfernen").clicked() {
                    acts.push(Act::RemoveItem(set, it));
                }
            });
            ui.end_row();
        }
    });
    if is_layers {
        let total: f64 = items.iter().filter_map(|&l| doc.arg(l, 1).and_then(|v| v.as_f64())).sum();
        ui.label(RichText::new(format!("Gesamtdicke {:.1} mm", mm(total))).strong());
    }
    if is_const {
        let total: f64 = items.iter().filter_map(|&l| doc.arg(l, 3).and_then(|v| v.as_f64())).sum();
        if total > 0.0 && (total - 1.0).abs() > 0.005 {
            ui.colored_label(Color32::from_rgb(230, 180, 80), format!("Summe der Anteile {:.1} % (sollte 100 % sein)", total * 100.0));
        }
    }
    if ty != "IFCMATERIALPROFILESET" {
        ui.horizontal(|ui| {
            let cur = st.add_mat.filter(|m| doc.exists(*m));
            if let Some(nm) = material_combo(ui, ("add-item", set), rows, cur, 150.0) {
                st.add_mat = Some(nm);
            }
            let label = if is_layers { "Schicht hinzufügen" } else if is_const { "Bestandteil hinzufügen" } else { "Material hinzufügen" };
            if ui.add_enabled(cur.is_some(), egui::Button::new(format!("{} {label}", ic::PLUS))).clicked() {
                acts.push(Act::AddItem(set, cur.unwrap(), 0.1 / unit));
            }
        });
    }
    // layer set usages (direction, sense, offset)
    if is_layers {
        let usages: Vec<u32> = doc.referencing_with_type(set, "IFCMATERIALLAYERSETUSAGE");
        if !usages.is_empty() {
            ui.add_space(6.0);
            ui.label(RichText::new(format!("Verwendungen ({})", usages.len())).strong());
            egui::Grid::new(("usages", set)).num_columns(5).striped(true).show(ui, |ui| {
                ui.strong("Verwendung");
                ui.strong("Richtung");
                ui.strong("Sinn");
                ui.strong("Versatz");
                ui.strong("Objekte");
                ui.end_row();
                for u in usages.iter().take(200) {
                    let a = doc.args(*u).unwrap_or_default();
                    ui.weak(format!("#{u}"));
                    let dir = a.get(1).map(|v| v.display()).unwrap_or_default();
                    egui::ComboBox::from_id_salt(("udir", *u)).selected_text(dir.clone()).width(70.0).show_ui(ui, |ui| {
                        for d in ["AXIS1", "AXIS2", "AXIS3"] {
                            if ui.selectable_label(dir == d, d).clicked() {
                                acts.push(Act::UsageArg(*u, 1, Value::Enum(d.into())));
                            }
                        }
                    });
                    let sense = a.get(2).map(|v| v.display()).unwrap_or_default();
                    egui::ComboBox::from_id_salt(("usense", *u)).selected_text(sense.clone()).width(90.0).show_ui(ui, |ui| {
                        for d in ["POSITIVE", "NEGATIVE"] {
                            if ui.selectable_label(sense == d, d).clicked() {
                                acts.push(Act::UsageArg(*u, 2, Value::Enum(d.into())));
                            }
                        }
                    });
                    let mut off = mm(a.get(3).and_then(|v| v.as_f64()).unwrap_or(0.0));
                    let r = ui.add(egui::DragValue::new(&mut off).speed(1.0).suffix(" mm").max_decimals(1));
                    if r.drag_stopped() || (r.changed() && !r.dragged()) {
                        acts.push(Act::UsageArg(*u, 3, Value::Real(off / 1000.0 / unit)));
                    }
                    let objs = mt::users(doc, *u);
                    if ui.link(objs.len().to_string()).clicked() {
                        acts.push(Act::Select(objs));
                    }
                    ui.end_row();
                }
            });
        }
    }
}

/// Quick layer set builder (shown when nothing is selected).
fn layer_builder(ui: &mut egui::Ui, st: &mut MaterialsState, s: &Session, acts: &mut Vec<Act>) {
    ui.label(RichText::new(format!("{} Schichtaufbau schnell anlegen und zuweisen", ic::LAYERS)).strong());
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
            // create the set, then assign it through the generic path
            let unit = model::length_unit(&s.doc).0;
            let layers: Vec<(String, f64)> = st.layers.iter().map(|(n, t)| (n.clone(), t / unit)).collect();
            let name = if st.set_name.is_empty() { "Schichtaufbau".to_string() } else { st.set_name.clone() };
            acts.push(Act::QuickLayerSet(name, layers));
        }
    });
}

/// Objects associated (directly or via layer/constituent sets) with a material.
pub fn users_of_material(doc: &ifc_doc::Document, m: u32) -> Vec<u32> {
    mt::users(doc, m)
}
