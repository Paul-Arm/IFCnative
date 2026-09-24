//! Structure tree (spatial hierarchy / by type / flat), virtualized.

use crate::app::{Action, AppCtx};
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText, Sense};
use ifc_doc::model::{self, Link};
use ifc_doc::tflags;

/// Synthetic row id for the "free objects" folder.
pub const FREE_ID: u32 = u32::MAX - 7;

/// Products without spatial container or aggregation parent.
pub fn free_objects(s: &Session) -> Vec<u32> {
    let doc = &s.doc;
    doc.ids_with_flag(tflags::ELEMENT).into_iter().filter(|&e| !doc.has_flag(e, tflags::OPENING) && !doc.has_flag(e, tflags::FEATURE) && !s.tree.parent.contains_key(&e)).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TreeMode {
    #[default]
    Spatial,
    Types,
    Flat,
}

#[derive(Clone, Debug)]
pub struct Row {
    pub id: u32,
    pub depth: u16,
    pub has_children: bool,
    pub expanded: bool,
    pub link: Option<Link>,
    /// Synthetic group header (type objects without occurrences etc.)
    pub header: Option<String>,
}

#[derive(Default)]
pub struct TreeState {
    pub mode: TreeMode,
    pub search: String,
    pub rows: Vec<Row>,
    pub key: (u64, u64, u64, usize, TreeMode, String),
    pub last_clicked: Option<usize>,
    pub show_openings: bool,
}

fn expanded_key(s: &Session) -> u64 {
    let mut h: u64 = s.expanded.len() as u64;
    for id in &s.expanded {
        h = h.wrapping_add((*id as u64).wrapping_mul(0x9E3779B97F4A7C15));
    }
    h
}

fn rebuild(st: &mut TreeState, s: &Session) {
    st.rows.clear();
    let doc = &s.doc;
    let q = st.search.trim().to_lowercase();
    if !q.is_empty() {
        // flat search results over all rooted entities
        let ids = doc.ids_with_flag(tflags::PRODUCT | tflags::PROJECT | tflags::GROUP | tflags::TYPE_OBJECT);
        for id in ids {
            if st.rows.len() > 20_000 {
                break;
            }
            let name = doc.name_of(id).unwrap_or_default().to_lowercase();
            let class = doc.type_camel(id).unwrap_or("").to_lowercase();
            let guid = doc.guid_of(id).unwrap_or_default().to_lowercase();
            let tag = doc.attr_str(id, "Tag").unwrap_or_default().to_lowercase();
            let desc = doc.attr_str(id, "Description").unwrap_or_default().to_lowercase();
            let id_match = format!("#{id}") == q || id.to_string() == q;
            if name.contains(&q) || class.contains(&q) || (q.len() >= 4 && guid.contains(&q)) || tag.contains(&q) || desc.contains(&q) || id_match {
                st.rows.push(Row { id, depth: 0, has_children: false, expanded: false, link: None, header: None });
            }
        }
        return;
    }
    match st.mode {
        TreeMode::Spatial => {
            let mut stack: Vec<(u32, u16, Option<Link>)> = s.tree.roots.iter().rev().map(|&r| (r, 0, None)).collect();
            while let Some((id, depth, link)) = stack.pop() {
                let children: Vec<(u32, Link)> = s.tree.children_of(id).iter().copied().filter(|(c, l)| st.show_openings || (*l != Link::Voids && !doc.has_flag(*c, tflags::OPENING))).collect();
                let expanded = s.expanded.contains(&id);
                st.rows.push(Row { id, depth, has_children: !children.is_empty(), expanded, link, header: None });
                if expanded {
                    for (c, l) in children.iter().rev() {
                        stack.push((*c, depth + 1, Some(*l)));
                    }
                }
                if st.rows.len() > 2_000_000 {
                    break;
                }
            }
            let free = free_objects(s);
            if !free.is_empty() {
                let expanded = s.expanded.contains(&FREE_ID);
                st.rows.push(Row { id: FREE_ID, depth: 0, has_children: true, expanded, link: None, header: Some(format!("Freie Objekte ({})", free.len())) });
                if expanded {
                    for f in free {
                        st.rows.push(Row { id: f, depth: 1, has_children: false, expanded: false, link: None, header: None });
                    }
                }
            }
        }
        TreeMode::Types => {
            let mut types = doc.ids_with_flag(tflags::TYPE_OBJECT);
            types.sort_by_key(|&t| (doc.type_camel(t).unwrap_or("").to_string(), model::label(doc, t)));
            for t in types {
                let occ = model::occurrences_of_type(doc, t);
                let expanded = s.expanded.contains(&t);
                st.rows.push(Row { id: t, depth: 0, has_children: !occ.is_empty(), expanded, link: None, header: None });
                if expanded {
                    for o in occ {
                        st.rows.push(Row { id: o, depth: 1, has_children: false, expanded: false, link: None, header: None });
                    }
                }
            }
        }
        TreeMode::Flat => {
            let mut ids: Vec<u32> = doc.ids_with_flag(tflags::PRODUCT).into_iter().filter(|&i| st.show_openings || !doc.has_flag(i, tflags::OPENING)).collect();
            ids.sort_by_key(|&i| (doc.type_camel(i).unwrap_or("").to_string(), i));
            for id in ids {
                st.rows.push(Row { id, depth: 0, has_children: false, expanded: false, link: None, header: None });
            }
        }
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.tree;
    ui.horizontal(|ui| {
        ui.selectable_value(&mut st.mode, TreeMode::Spatial, "Räumlich").on_hover_text("Projekt → Grundstück → Gebäude → Geschoss → Elemente");
        ui.selectable_value(&mut st.mode, TreeMode::Types, "Typen").on_hover_text("Typobjekte mit ihren Vorkommen");
        ui.selectable_value(&mut st.mode, TreeMode::Flat, "Flach").on_hover_text("Alle Elemente nach Klasse");
        ui.checkbox(&mut st.show_openings, "Öffnungen").on_hover_text("IfcOpeningElement anzeigen");
    });
    ui.horizontal(|ui| {
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.search).hint_text("Name, Klasse, GlobalId, Tag oder #Id …").desired_width(f32::INFINITY));
    });
    ui.horizontal(|ui| {
        if ui.small_button(format!("{} Alle aufklappen", ic::CARET_DOWN)).clicked() {
            for (p, ch) in s.tree.children.iter() {
                if ch.iter().any(|(c, _)| s.doc.has_flag(*c, tflags::SPATIAL) || s.tree.children.contains_key(c)) || s.doc.has_flag(*p, tflags::SPATIAL) || s.doc.has_flag(*p, tflags::PROJECT) {
                    s.expanded.insert(*p);
                }
            }
        }
        if ui.small_button(format!("{} Alle zuklappen", ic::CARET_RIGHT)).clicked() {
            s.expanded.clear();
            for r in &s.tree.roots {
                s.expanded.insert(*r);
            }
        }
    });
    if s.doc.ids_with_flag(tflags::SPATIAL).is_empty() && s.loading.is_none() {
        ui.colored_label(egui::Color32::from_rgb(255, 170, 40), "Das Modell hat keine Raumstruktur.");
        if ui.button(format!("{} Raumstruktur anlegen …", ic::LAYERS)).clicked() {
            app.panel_state.structure_dialog = true;
        }
    }
    let st = &mut app.panel_state.tree;
    ui.separator();
    let key = (s.uid, s.doc.revision(), expanded_key(s), s.tree.children.len(), st.mode, st.search.clone());
    if key != st.key {
        rebuild(st, s);
        st.key = key;
    }
    let row_h = ui.text_style_height(&egui::TextStyle::Body) + 5.0;
    let total = st.rows.len();
    let mut scroll = egui::ScrollArea::vertical().auto_shrink([false, false]);
    if let Some(target) = s.scroll_tree_to.take() {
        if let Some(i) = st.rows.iter().position(|r| r.id == target) {
            let y = i as f32 * (row_h + ui.spacing().item_spacing.y);
            scroll = scroll.vertical_scroll_offset((y - 120.0).max(0.0));
        }
    }
    let sel: rustc_hash::FxHashSet<u32> = s.selection.iter().copied().collect();
    let mut toggle: Option<u32> = None;
    let mut clicked: Option<(usize, u32, egui::Modifiers)> = None;
    let mut dbl: Option<u32> = None;
    let mut ctx_action: Option<(&'static str, u32)> = None;
    let mut visibility_toggle: Option<u32> = None;
    scroll.show_rows(ui, row_h, total, |ui, range| {
        for i in range {
            let row = st.rows[i].clone();
            if let Some(h) = &row.header {
                let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), row_h), Sense::click());
                let col = ui.visuals().text_color();
                ui.painter().text(egui::pos2(rect.min.x + 4.0, rect.center().y), egui::Align2::LEFT_CENTER, if row.expanded { ic::CARET_DOWN } else { ic::CARET_RIGHT }, egui::FontId::proportional(12.0), col);
                ui.painter().text(egui::pos2(rect.min.x + 22.0, rect.center().y), egui::Align2::LEFT_CENTER, format!("{} {h}", ic::ph::FOLDER_DASHED), egui::FontId::proportional(13.0), col.gamma_multiply(0.8));
                if resp.clicked() {
                    toggle = Some(row.id);
                }
                resp.context_menu(|ui| {
                    if ui.button(format!("{} Alle auswählen", ic::SELECT)).clicked() {
                        ctx_action = Some(("select-free", row.id));
                        ui.close();
                    }
                    if ui.button(format!("{} Neues freies Objekt anlegen …", ic::PLUS)).clicked() {
                        ctx_action = Some(("new-free", row.id));
                        ui.close();
                    }
                    if ui.button(format!("{} Raumstruktur anlegen und zuordnen …", ic::LAYERS)).clicked() {
                        ctx_action = Some(("ensure-structure", row.id));
                        ui.close();
                    }
                });
                continue;
            }
            let doc = &s.doc;
            let ty = doc.type_name(row.id).unwrap_or("");
            let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), row_h), Sense::click());
            let selected = sel.contains(&row.id);
            if selected {
                ui.painter().rect_filled(rect, 3.0, ui.visuals().selection.bg_fill.gamma_multiply(0.7));
            } else if resp.hovered() {
                ui.painter().rect_filled(rect, 3.0, ui.visuals().widgets.hovered.weak_bg_fill);
            }
            let indent = 14.0 * row.depth as f32 + 4.0;
            let mut x = rect.min.x + indent;
            let text_color = ui.visuals().text_color();
            if row.has_children {
                let arrow_rect = egui::Rect::from_min_size(egui::pos2(x, rect.min.y), egui::vec2(16.0, row_h));
                let ar = ui.interact(arrow_rect, ui.id().with(("arrow", row.id, i)), Sense::click());
                ui.painter().text(arrow_rect.center(), egui::Align2::CENTER_CENTER, if row.expanded { ic::CARET_DOWN } else { ic::CARET_RIGHT }, egui::FontId::proportional(12.0), text_color);
                if ar.clicked() {
                    toggle = Some(row.id);
                }
            }
            x += 18.0;
            let hidden = s.hidden.contains(&row.id) || s.class_hidden.contains(ty);
            let icon_col = if doc.has_flag(row.id, tflags::SPATIAL) || doc.has_flag(row.id, tflags::PROJECT) { Color32::from_rgb(110, 170, 255) } else { Color32::from_rgb(170, 175, 185) };
            ui.painter().text(egui::pos2(x, rect.center().y), egui::Align2::LEFT_CENTER, ic::for_class(ty), egui::FontId::proportional(14.0), icon_col);
            x += 20.0;
            let label = model::label(doc, row.id);
            let class = doc.type_camel(row.id).unwrap_or("?");
            let mut job = egui::text::LayoutJob::default();
            let base_col = if hidden { text_color.gamma_multiply(0.45) } else { text_color };
            job.append(&label, 0.0, egui::TextFormat { color: base_col, font_id: egui::FontId::proportional(13.0), ..Default::default() });
            if label != format!("{class} #{}", row.id) {
                job.append(&format!("  {class}"), 0.0, egui::TextFormat { color: base_col.gamma_multiply(0.55), font_id: egui::FontId::proportional(11.5), ..Default::default() });
            }
            if row.has_children && !row.expanded {
                let n = s.tree.children_of(row.id).len();
                job.append(&format!("  ({n})"), 0.0, egui::TextFormat { color: base_col.gamma_multiply(0.5), font_id: egui::FontId::proportional(11.5), ..Default::default() });
            }
            let galley = ui.painter().layout_job(job);
            ui.painter().galley(egui::pos2(x, rect.center().y - galley.size().y / 2.0), galley, text_color);
            // eye toggle on hover
            if resp.hovered() || hidden {
                let eye_rect = egui::Rect::from_min_size(egui::pos2(rect.max.x - 22.0, rect.min.y), egui::vec2(20.0, row_h));
                let er = ui.interact(eye_rect, ui.id().with(("eye", row.id, i)), Sense::click());
                ui.painter().text(eye_rect.center(), egui::Align2::CENTER_CENTER, if hidden { ic::HIDE } else { ic::SHOW }, egui::FontId::proportional(13.0), text_color.gamma_multiply(if er.hovered() { 1.0 } else { 0.6 }));
                if er.clicked() {
                    visibility_toggle = Some(row.id);
                    continue;
                }
            }
            if resp.clicked() {
                clicked = Some((i, row.id, ui.input(|inp| inp.modifiers)));
            }
            if resp.double_clicked() {
                dbl = Some(row.id);
            }
            resp.context_menu(|ui| {
                if ui.button(format!("{} Zoomen", ic::FOCUS)).clicked() {
                    ctx_action = Some(("zoom", row.id));
                    ui.close();
                }
                if ui.button(format!("{} Isolieren", ic::ISOLATE)).clicked() {
                    ctx_action = Some(("isolate", row.id));
                    ui.close();
                }
                if ui.button(format!("{} Ausblenden", ic::HIDE)).clicked() {
                    ctx_action = Some(("hide", row.id));
                    ui.close();
                }
                if ui.button(format!("{} Untergeordnete auswählen", ic::SELECT)).clicked() {
                    ctx_action = Some(("children", row.id));
                    ui.close();
                }
                let ptype = doc.type_name(row.id).unwrap_or("").to_string();
                ui.menu_button(format!("{} Neues Element anlegen", ic::PLUS), |ui| {
                    let spatial_children: &[(&str, &str)] = match ptype.as_str() {
                        "IFCPROJECT" => &[("IFCSITE", "Grundstück"), ("IFCBUILDING", "Gebäude")],
                        "IFCSITE" => &[("IFCBUILDING", "Gebäude"), ("IFCSITE", "Teilgelände")],
                        "IFCBUILDING" => &[("IFCBUILDINGSTOREY", "Geschoss")],
                        "IFCBUILDINGSTOREY" => &[("IFCSPACE", "Raum")],
                        _ => &[],
                    };
                    for (c, n) in spatial_children {
                        if ui.button(format!("{} {n}", ic::for_class(c))).clicked() {
                            app.panel_state.tree_new = Some((row.id, c.to_string(), n.to_string()));
                            ui.close();
                        }
                    }
                    if ptype != "IFCPROJECT" {
                        let label = if doc.has_flag(row.id, tflags::ELEMENT) { "Teil-Element (aggregiert) …" } else { "Bauteil im Builder …" };
                        if ui.button(format!("{} {label}", ic::BUILD)).clicked() {
                            ctx_action = Some(("new-element", row.id));
                            ui.close();
                        }
                    }
                    if ptype == "IFCBUILDINGSTOREY" {
                        for (c, n) in [("IFCSENSOR", "Sensor"), ("IFCACTUATOR", "Aktor")] {
                            if doc.schema().entity(c).is_some() && ui.button(n).clicked() {
                                app.panel_state.tree_new = Some((row.id, c.to_string(), n.to_string()));
                                ui.close();
                            }
                        }
                    }
                });
                if doc.has_flag(row.id, tflags::ELEMENT) && ui.button(format!("{} Gruppen verwalten …", ic::GROUP)).clicked() {
                    ctx_action = Some(("groups", row.id));
                    ui.close();
                }
                if doc.type_name(row.id) == Some("IFCBUILDINGSTOREY") && ui.button(format!("{} Grundriss anzeigen", ic::PLAN)).clicked() {
                    ctx_action = Some(("plan", row.id));
                    ui.close();
                }
                if ui.button(format!("{} GlobalId kopieren", ic::COPY)).clicked() {
                    ctx_action = Some(("copyguid", row.id));
                    ui.close();
                }
                ui.separator();
                if ui.button(format!("{} Löschen …", ic::DELETE)).clicked() {
                    ctx_action = Some(("delete", row.id));
                    ui.close();
                }
            });
            // drag & drop: move elements onto spatial containers
            if resp.drag_started() {
                app.panel_state.dragging = Some(row.id);
            }
            if let Some(dragged) = app.panel_state.dragging {
                if resp.hovered() && dragged != row.id && doc.has_flag(row.id, tflags::SPATIAL) {
                    ui.painter().rect_stroke(rect, 3.0, egui::Stroke::new(1.5, ui.visuals().selection.stroke.color), egui::StrokeKind::Inside);
                    if ui.input(|i| i.pointer.any_released()) {
                        app.panel_state.drop_target = Some((dragged, row.id));
                    }
                }
            }
        }
    });
    if ui.input(|i| i.pointer.any_released()) {
        app.panel_state.dragging = None;
    }
    if let Some((dragged, target)) = app.panel_state.drop_target.take() {
        let mut elems: Vec<u32> = if s.selection.contains(&dragged) { s.selection.clone() } else { vec![dragged] };
        elems.retain(|&e| e != target && s.doc.has_flag(e, tflags::ELEMENT));
        if !elems.is_empty() {
            let name = model::label(&s.doc, target);
            if s.edit("In Raumstruktur verschieben", |doc| ifc_doc::ops::move_to_container(doc, &elems, target)).is_some() {
                app.toast(format!("{} Elemente nach „{name}“ verschoben", elems.len()));
            }
        }
    }
    if let Some((parent, class, name)) = app.panel_state.tree_new.take() {
        let spatial = matches!(class.as_str(), "IFCSITE" | "IFCBUILDING" | "IFCBUILDINGSTOREY" | "IFCSPACE");
        let res = if spatial {
            s.edit(&format!("{name} anlegen"), |doc| ifc_doc::ops::create_spatial(doc, &class, &name, parent, None))
        } else {
            let spec = ifc_doc::ops::NewElement { class_upper: class.clone(), name: name.clone(), container: Some(parent), location: [0.0; 3], rotation_deg: 0.0, shape: None, predefined_type: None };
            s.edit(&format!("{name} anlegen"), |doc| ifc_doc::ops::create_element(doc, &spec))
        };
        if let Some(nid) = res {
            s.select(vec![nid], false);
        }
    }
    structure_dialog(ui.ctx(), s, app);
    if let Some(id) = toggle {
        if !s.expanded.remove(&id) {
            s.expanded.insert(id);
        }
    }
    if let Some(id) = visibility_toggle {
        let ty = s.doc.type_name(id).unwrap_or("").to_string();
        if s.hidden.contains(&id) || s.class_hidden.contains(&ty) {
            for d in s.tree.subtree(id) {
                s.hidden.remove(&d);
            }
            s.class_hidden.remove(&ty);
            s.apply_visibility();
        } else {
            s.hide(&[id]);
        }
    }
    if let Some((i, id, m)) = clicked {
        if m.shift {
            if let Some(last) = st_last(app) {
                let (a, b) = (last.min(i), last.max(i));
                let ids: Vec<u32> = app.panel_state.tree.rows[a..=b].iter().map(|r| r.id).collect();
                s.select(ids, false);
            } else {
                s.select(vec![id], false);
            }
        } else {
            s.select(vec![id], m.ctrl || m.command);
        }
        app.panel_state.tree.last_clicked = Some(i);
        s.scroll_tree_to = None;
    }
    if let Some(id) = dbl {
        s.select(vec![id], false);
        s.fit_selection();
    }
    if let Some((what, id)) = ctx_action {
        match what {
            "zoom" => {
                s.select(vec![id], false);
                s.fit_selection();
            }
            "isolate" => s.isolate(&[id]),
            "hide" => s.hide(&[id]),
            "children" => {
                let ids = s.tree.subtree(id);
                s.select(ids, false);
            }
            "plan" => s.enter_plan(id, 1.2),
            "copyguid" => {
                if let Some(g) = s.doc.guid_of(id) {
                    ui.ctx().copy_text(g);
                    app.toast("GlobalId kopiert");
                }
            }
            "delete" => {
                if s.doc.has_flag(id, tflags::PROJECT) {
                    app.error("Das IfcProject kann nicht gelöscht werden");
                } else {
                    if !s.selection.contains(&id) {
                        s.select(vec![id], false);
                    }
                    app.actions.push(Action::DeleteSelection);
                }
            }
            "select-free" => {
                let f = free_objects(s);
                s.select(f, false);
            }
            "new-free" => {
                app.panel_state.builder.container = None;
                app.panel_state.builder.aggregate_parent = None;
                app.panel_state.builder.free = true;
                app.actions.push(Action::OpenTab(crate::app::Tab::Builder));
            }
            "new-element" => {
                if s.doc.has_flag(id, tflags::ELEMENT) {
                    app.panel_state.builder.aggregate_parent = Some(id);
                } else {
                    app.panel_state.builder.container = Some(id);
                    app.panel_state.builder.aggregate_parent = None;
                }
                app.panel_state.builder.free = false;
                app.actions.push(Action::OpenTab(crate::app::Tab::Builder));
            }
            "groups" => {
                s.select(vec![id], false);
                app.actions.push(Action::OpenTab(crate::app::Tab::Groups));
            }
            "ensure-structure" => {
                app.panel_state.structure_dialog = true;
            }
            _ => {}
        }
    }
    if total == 0 {
        ui.weak(if app.panel_state.tree.search.is_empty() { "Keine Einträge" } else { "Keine Treffer" });
    }
    let _ = RichText::new("");
}

fn st_last(app: &AppCtx) -> Option<usize> {
    app.panel_state.tree.last_clicked
}

/// Dialog: create missing Project → Site → Building → Storey levels.
fn structure_dialog(ctx: &egui::Context, s: &mut Session, app: &mut AppCtx) {
    if !app.panel_state.structure_dialog {
        return;
    }
    let k = egui::Id::new("structure-dialog");
    let (mut names, mut attach): ([String; 4], bool) = ctx.data_mut(|d| d.get_temp(k)).unwrap_or_else(|| (["Projekt".into(), "Grundstück".into(), "Gebäude".into(), "Erdgeschoss".into()], true));
    let mut open = true;
    let mut apply = false;
    egui::Window::new("Raumstruktur anlegen").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
        ui.label("Fehlende Ebenen werden ergänzt, vorhandene wiederverwendet.");
        egui::Grid::new("sd").num_columns(2).show(ui, |ui| {
            for (i, l) in ["Projekt", "Standort", "Gebäude", "Geschoss"].iter().enumerate() {
                ui.label(*l);
                ui.text_edit_singleline(&mut names[i]);
                ui.end_row();
            }
        });
        ui.checkbox(&mut attach, "Alle nicht zugeordneten Bauteile dem Geschoss zuordnen");
        if ui.button("Anlegen").clicked() {
            apply = true;
        }
    });
    if apply {
        let n = names.clone();
        let res = s.edit("Raumstruktur anlegen", |doc| ifc_doc::ops::ensure_spatial_structure(doc, [&n[0], &n[1], &n[2], &n[3]], attach));
        if let Some(st) = res {
            s.select(vec![st], false);
        }
        open = false;
    }
    ctx.data_mut(|d| d.insert_temp(k, (names, attach)));
    app.panel_state.structure_dialog = open;
}
