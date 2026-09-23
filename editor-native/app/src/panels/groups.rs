//! Groups, systems and zones.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use ifc_doc::{model, ops, tflags};

#[derive(Default)]
pub struct GroupsState {
    pub name: String,
    pub class: String,
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.groups;
    if st.class.is_empty() {
        st.class = "IfcGroup".into();
    }
    let mut create: Option<(String, String, Vec<u32>)> = None;
    ui.horizontal(|ui| {
        ui.add(egui::TextEdit::singleline(&mut st.name).hint_text("Name der neuen Gruppe").desired_width(160.0));
        egui::ComboBox::from_id_salt("gclass").selected_text(&st.class).show_ui(ui, |ui| {
            for c in ["IfcGroup", "IfcSystem", "IfcZone", "IfcDistributionSystem", "IfcBuildingSystem"] {
                if s.doc.schema().entity(&c.to_ascii_uppercase()).is_some() {
                    ui.selectable_value(&mut st.class, c.to_string(), c);
                }
            }
        });
        if ui.add_enabled(!st.name.trim().is_empty(), egui::Button::new(format!("{} aus Auswahl", ic::PLUS))).clicked() {
            let members = s.selection.clone();
            create = Some((st.name.trim().to_string(), st.class.to_ascii_uppercase(), members));
        }
    });
    if let Some((n, c, members)) = create {
        if let Some(g) = s.edit("Gruppe anlegen", |doc| ops::create_group(doc, &c, &n, &members)) {
            app.toast(format!("Gruppe #{g} mit {} Mitgliedern angelegt", members.len()));
        }
        app.panel_state.groups.name.clear();
    }
    ui.separator();
    let groups = s.doc.ids_with_flag(tflags::GROUP);
    if groups.is_empty() {
        ui.weak("Keine Gruppen, Systeme oder Zonen im Modell.");
    }
    let mut action: Option<(&str, u32)> = None;
    for g in groups {
        let members = model::group_members(&s.doc, g);
        let title = format!("{} {} ({})  {}", ic::GROUP, model::label(&s.doc, g), members.len(), s.doc.type_camel(g).unwrap_or(""));
        egui::CollapsingHeader::new(title).id_salt(("grp", g)).show(ui, |ui| {
            ui.horizontal(|ui| {
                if ui.small_button("Auswählen").clicked() {
                    action = Some(("select", g));
                }
                if ui.small_button("Isolieren").clicked() {
                    action = Some(("isolate", g));
                }
                if ui.small_button(format!("{} Auswahl hinzufügen", ic::PLUS)).clicked() {
                    action = Some(("add", g));
                }
                if ui.small_button(format!("{} Auswahl entfernen", ic::MINUS)).clicked() {
                    action = Some(("remove", g));
                }
                if ui.small_button(ic::DELETE).on_hover_text("Gruppe löschen").clicked() {
                    action = Some(("delete", g));
                }
            });
            for m in members.iter().take(200) {
                if ui.link(format!("{} {}", ic::for_class(s.doc.type_name(*m).unwrap_or("")), model::label(&s.doc, *m))).clicked() {
                    app.panel_state.pending_select = Some(vec![*m]);
                }
            }
            if members.len() > 200 {
                ui.weak(format!("… {} weitere", members.len() - 200));
            }
        });
    }
    if let Some(sel) = app.panel_state.pending_select.take() {
        s.select(sel, false);
    }
    if let Some((a, g)) = action {
        let sel = s.selection.clone();
        match a {
            "select" => s.select(model::group_members(&s.doc, g), false),
            "isolate" => {
                let m = model::group_members(&s.doc, g);
                s.isolate(&m);
            }
            "add" => {
                s.edit("Zur Gruppe hinzufügen", |doc| ops::add_to_group(doc, g, &sel));
            }
            "remove" => {
                s.edit("Aus Gruppe entfernen", |doc| ops::remove_from_group(doc, g, &sel));
            }
            "delete" => {
                s.edit("Gruppe löschen", |doc| ops::delete_entities(doc, &[g], true).map(|_| ()));
            }
            _ => {}
        }
    }
}
