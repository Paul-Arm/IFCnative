//! Groups, systems, zones and assets: categorized list, membership manager
//! for the current selection, context actions (select, isolate, colour, …).

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::RichText;
use ifc_doc::{model, ops, tflags, Value};

#[derive(Default)]
pub struct GroupsState {
    pub name: String,
    pub class: String,
    pub filter: String,
    pub color: Option<[f32; 3]>,
    cache: Option<((u64, u64), Vec<GroupRow>)>,
    open: Option<u32>,
}

#[derive(Clone)]
struct GroupRow {
    id: u32,
    class: String,
    label: String,
    /// sorted
    members: Vec<u32>,
}

const CLASSES: [&str; 8] = ["IfcGroup", "IfcSystem", "IfcZone", "IfcDistributionSystem", "IfcDistributionCircuit", "IfcBuildingSystem", "IfcAsset", "IfcInventory"];

fn category(class: &str) -> &'static str {
    match class {
        "IfcZone" => "Zonen",
        "IfcSystem" | "IfcBuildingSystem" | "IfcBuiltSystem" => "Systeme",
        "IfcDistributionSystem" | "IfcDistributionCircuit" | "IfcElectricalCircuit" => "Verteilsysteme",
        "IfcAsset" | "IfcInventory" => "Inventar",
        "IfcStructuralAnalysisModel" | "IfcStructuralLoadGroup" | "IfcStructuralLoadCase" | "IfcStructuralResultGroup" => "Statik",
        _ => "Gruppen",
    }
}

enum Act {
    Create(String, String, Vec<u32>),
    Select(u32),
    Isolate(u32),
    Hide(u32),
    Add(u32, Vec<u32>),
    Remove(u32, Vec<u32>),
    Delete(u32),
    Rename(u32, String),
    SetAttr(u32, &'static str, String),
    Color(u32, [f32; 3]),
    Pick(u32),
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let rev = (s.uid, s.doc.revision());
    let st = &mut app.panel_state.groups;
    if st.class.is_empty() {
        st.class = "IfcGroup".into();
    }
    if st.cache.as_ref().map(|c| c.0) != Some(rev) {
        let doc = &s.doc;
        let rows: Vec<GroupRow> = doc
            .ids_with_flag(tflags::GROUP)
            .into_iter()
            .map(|g| {
                let mut members = model::group_members(doc, g);
                members.sort_unstable();
                members.dedup();
                GroupRow { id: g, class: doc.type_camel(g).unwrap_or("IfcGroup").to_string(), label: model::label(doc, g), members }
            })
            .collect();
        st.cache = Some((rev, rows));
    }
    let rows = st.cache.as_ref().map(|c| c.1.clone()).unwrap_or_default();
    let mut acts: Vec<Act> = Vec::new();
    let sel: Vec<u32> = s.selection.clone();
    // ---------------------------------------------------------------- create
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::TextEdit::singleline(&mut st.name).hint_text("Name der neuen Gruppe").desired_width(160.0));
        egui::ComboBox::from_id_salt("gclass").selected_text(&st.class).show_ui(ui, |ui| {
            for c in CLASSES {
                if s.doc.schema().entity(&c.to_ascii_uppercase()).is_some() {
                    ui.selectable_value(&mut st.class, c.to_string(), c);
                }
            }
        });
        let label = if sel.is_empty() { format!("{} Anlegen (leer)", ic::PLUS) } else { format!("{} Aus Auswahl ({})", ic::PLUS, sel.len()) };
        if ui.add_enabled(!st.name.trim().is_empty(), egui::Button::new(label)).clicked() {
            acts.push(Act::Create(st.name.trim().to_string(), st.class.to_ascii_uppercase(), sel.clone()));
            st.name.clear();
        }
        ui.separator();
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Gruppen filtern").desired_width(130.0));
        let mut c = st.color.unwrap_or([0.3, 0.7, 0.5]);
        if ui.color_edit_button_rgb(&mut c).on_hover_text("Farbe für „Mitglieder einfärben“").changed() {
            st.color = Some(c);
        }
    });
    ui.separator();
    if rows.is_empty() {
        ui.weak("Keine Gruppen, Systeme oder Zonen im Modell.");
    }
    let filter = st.filter.to_lowercase();
    let color = st.color.unwrap_or([0.3, 0.7, 0.5]);
    let open = st.open;
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        // ------------------------------------------------------------ membership manager
        if !sel.is_empty() && !rows.is_empty() {
            let containing: Vec<&GroupRow> = rows.iter().filter(|r| sel.iter().any(|x| r.members.binary_search(x).is_ok())).collect();
            egui::CollapsingHeader::new(RichText::new(format!("{} Gruppen der Auswahl ({} von {})", ic::CHECK, containing.len(), rows.len())).strong()).id_salt("grp-membership").default_open(true).show(ui, |ui| {
                ui.weak("Haken setzen/entfernen ordnet alle ausgewählten Objekte zu bzw. entfernt sie.");
                egui::Grid::new("grp-mem-grid").num_columns(2).show(ui, |ui| {
                    for r in rows.iter().filter(|r| filter.is_empty() || r.label.to_lowercase().contains(&filter)).take(300) {
                        let n_in = sel.iter().filter(|x| r.members.binary_search(x).is_ok()).count();
                        let mut state = n_in == sel.len();
                        let cb = egui::Checkbox::new(&mut state, format!("{} {}", ic::GROUP, r.label)).indeterminate(n_in > 0 && n_in < sel.len());
                        if ui.add(cb).clicked() {
                            if n_in == sel.len() {
                                acts.push(Act::Remove(r.id, sel.clone()));
                            } else {
                                acts.push(Act::Add(r.id, sel.clone()));
                            }
                        }
                        ui.weak(format!("{} · {} Mitglieder", r.class, r.members.len()));
                        ui.end_row();
                    }
                });
            });
            ui.separator();
        }
        // ------------------------------------------------------------ categories
        let mut cats: Vec<&'static str> = rows.iter().map(|r| category(&r.class)).collect();
        cats.sort();
        cats.dedup();
        for cat in cats {
            let in_cat: Vec<&GroupRow> = rows.iter().filter(|r| category(&r.class) == cat && (filter.is_empty() || r.label.to_lowercase().contains(&filter) || r.class.to_lowercase().contains(&filter))).collect();
            if in_cat.is_empty() {
                continue;
            }
            egui::CollapsingHeader::new(RichText::new(format!("{cat} ({})", in_cat.len())).strong()).id_salt(("grp-cat", cat)).default_open(true).show(ui, |ui| {
                for r in in_cat {
                    let is_open = open == Some(r.id);
                    let n_sel = sel.iter().filter(|x| r.members.binary_search(x).is_ok()).count();
                    let resp = ui
                        .horizontal(|ui| {
                            let caret = if is_open { ic::CARET_DOWN } else { ic::CARET_RIGHT };
                            if ui.small_button(caret).clicked() {
                                acts.push(Act::Pick(if is_open { 0 } else { r.id }));
                            }
                            let text = RichText::new(format!("{} {}", ic::GROUP, r.label));
                            let resp = ui.selectable_label(n_sel > 0 && n_sel == sel.len(), text);
                            if resp.clicked() {
                                acts.push(Act::Select(r.id));
                            }
                            ui.weak(format!("{} · {}", r.members.len(), r.class));
                            resp
                        })
                        .inner;
                    resp.on_hover_text("Klick: Mitglieder auswählen · Rechtsklick: Aktionen").context_menu(|ui| {
                        ui.label(RichText::new(&r.label).strong());
                        if ui.button(format!("{} Mitglieder auswählen", ic::SELECT)).clicked() {
                            acts.push(Act::Select(r.id));
                            ui.close();
                        }
                        if ui.button(format!("{} Isolieren", ic::ISOLATE)).clicked() {
                            acts.push(Act::Isolate(r.id));
                            ui.close();
                        }
                        if ui.button(format!("{} Ausblenden", ic::HIDE)).clicked() {
                            acts.push(Act::Hide(r.id));
                            ui.close();
                        }
                        ui.separator();
                        if ui.add_enabled(!sel.is_empty(), egui::Button::new(format!("{} Auswahl hinzufügen", ic::PLUS))).clicked() {
                            acts.push(Act::Add(r.id, sel.clone()));
                            ui.close();
                        }
                        if ui.add_enabled(n_sel > 0, egui::Button::new(format!("{} Auswahl entfernen", ic::MINUS))).clicked() {
                            acts.push(Act::Remove(r.id, sel.clone()));
                            ui.close();
                        }
                        if ui.button(format!("{} Mitglieder einfärben", ic::PALETTE)).on_hover_text("Farbe aus der Werkzeugleiste des Gruppen-Panels").clicked() {
                            acts.push(Act::Color(r.id, color));
                            ui.close();
                        }
                        ui.separator();
                        if ui.button(RichText::new(format!("{} Gruppe löschen", ic::DELETE)).color(egui::Color32::from_rgb(240, 110, 90))).clicked() {
                            acts.push(Act::Delete(r.id));
                            ui.close();
                        }
                    });
                    if is_open {
                        ui.indent(("grp-detail", r.id), |ui| {
                            egui::Grid::new(("grp-attrs", r.id)).num_columns(2).show(ui, |ui| {
                                ui.label("Name");
                                let name = s.doc.name_of(r.id).unwrap_or_default();
                                if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with(("gname", r.id, s.doc.revision())), &name, 200.0) {
                                    acts.push(Act::Rename(r.id, n));
                                }
                                ui.end_row();
                                for (attr, label) in [("Description", "Beschreibung"), ("ObjectType", "Objekttyp"), ("LongName", "Langname")] {
                                    let ty = s.doc.type_name(r.id).unwrap_or("");
                                    if s.doc.schema().attr_index(ty, attr).is_none() {
                                        continue;
                                    }
                                    ui.label(label);
                                    let v = s.doc.attr_str(r.id, attr).unwrap_or_default();
                                    if let Some(n) = crate::panels::inspector::edit_field(ui, ui.id().with(("gattr", r.id, attr, s.doc.revision())), &v, 200.0) {
                                        acts.push(Act::SetAttr(r.id, attr, n));
                                    }
                                    ui.end_row();
                                }
                            });
                            for m in r.members.iter().take(200) {
                                let is_group = s.doc.has_flag(*m, tflags::GROUP);
                                let text = format!("{} {}", if is_group { ic::GROUP } else { ic::for_class(s.doc.type_name(*m).unwrap_or("")) }, model::label(&s.doc, *m));
                                if ui.link(text).clicked() {
                                    if is_group {
                                        acts.push(Act::Pick(*m));
                                    } else {
                                        app.panel_state.pending_select = Some(vec![*m]);
                                    }
                                }
                            }
                            if r.members.len() > 200 {
                                ui.weak(format!("… {} weitere", r.members.len() - 200));
                            }
                        });
                    }
                }
            });
        }
    });
    if let Some(sel) = app.panel_state.pending_select.take() {
        s.select(sel, false);
    }
    // ---------------------------------------------------------------- actions
    let members_of = |id: u32| rows.iter().find(|r| r.id == id).map(|r| r.members.clone()).unwrap_or_default();
    for a in acts {
        match a {
            Act::Create(n, c, members) => {
                if let Some(g) = s.edit("Gruppe anlegen", |doc| ops::create_group(doc, &c, &n, &members)) {
                    app.toast(format!("{} #{g} mit {} Mitgliedern angelegt", c, members.len()));
                    app.panel_state.groups.open = Some(g);
                }
            }
            Act::Select(g) => s.select(members_of(g), false),
            Act::Isolate(g) => {
                let m = members_of(g);
                s.isolate(&m);
            }
            Act::Hide(g) => {
                let m = members_of(g);
                s.hide(&m);
            }
            Act::Add(g, m) => {
                s.edit("Zur Gruppe hinzufügen", |doc| ops::add_to_group(doc, g, &m));
            }
            Act::Remove(g, m) => {
                s.edit("Aus Gruppe entfernen", |doc| ops::remove_from_group(doc, g, &m));
            }
            Act::Delete(g) => {
                s.edit("Gruppe löschen", |doc| ops::delete_entities(doc, &[g], true).map(|_| ()));
            }
            Act::Rename(g, n) => {
                s.edit("Gruppe umbenennen", |doc| doc.set_arg(g, 2, if n.trim().is_empty() { Value::Null } else { Value::Str(n) }));
            }
            Act::SetAttr(g, attr, v) => {
                s.edit(&format!("{attr} setzen"), |doc| doc.set_attr(g, attr, if v.trim().is_empty() { Value::Null } else { Value::Str(v) }));
            }
            Act::Color(g, c) => {
                let m: Vec<u32> = members_of(g).into_iter().filter(|&x| s.doc.has_flag(x, tflags::PRODUCT)).collect();
                if let Some(n) = s.edit("Gruppe einfärben", |doc| ifc_doc::material::set_object_color(doc, &m, Some(([c[0] as f64, c[1] as f64, c[2] as f64], 0.0)))) {
                    app.toast(format!("{n} Geometrie-Elemente eingefärbt"));
                }
            }
            Act::Pick(g) => app.panel_state.groups.open = if g == 0 { None } else { Some(g) },
        }
    }
}
