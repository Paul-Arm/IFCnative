//! Relationship graph around the selected entity (radial layout, navigable,
//! filterable by relationship kind; relationships can be created and removed).

use crate::app::AppCtx;
use crate::session::Session;
use egui::{Align2, Color32, FontId, Pos2, Rect, Sense, Stroke, Vec2};
use ifc_doc::{model, ops, tflags, Document};
use rustc_hash::FxHashMap;

pub struct GraphState {
    pub depth: u8,
    pub show_resources: bool,
    pub zoom: f32,
    pub pan: Vec2,
    pub filter_rels: bool,
    /// Hidden relationship categories (bit per entry of CATEGORIES).
    pub hidden: u32,
    pub link_class: usize,
    menu_node: Option<u32>,
}

impl Default for GraphState {
    fn default() -> Self {
        GraphState { depth: 1, show_resources: false, zoom: 1.0, pan: Vec2::ZERO, filter_rels: true, hidden: 0, link_class: 0, menu_node: None }
    }
}

const CATEGORIES: [&str; 10] = ["Raumstruktur", "Zerlegung", "Eigenschaften", "Typ", "Material", "Zuordnungen", "Öffnungen", "Verbindungen", "Gruppen", "Sonstige"];

fn category(rel_upper: &str) -> usize {
    let t = rel_upper.trim_start_matches("IFCREL");
    match t {
        _ if t.starts_with("CONTAINEDINSPATIAL") || t.starts_with("REFERENCEDINSPATIAL") || t.starts_with("SPACEBOUNDARY") => 0,
        _ if t.starts_with("AGGREGATES") || t.starts_with("NESTS") || t.starts_with("DECOMPOSES") => 1,
        _ if t.starts_with("DEFINESBYPROPERTIES") || t.starts_with("DEFINESBYTEMPLATE") || t.starts_with("OVERRIDESPROPERTIES") => 2,
        _ if t.starts_with("DEFINESBYTYPE") => 3,
        _ if t.starts_with("ASSOCIATESMATERIAL") => 4,
        _ if t.starts_with("ASSOCIATES") => 5,
        _ if t.starts_with("VOIDS") || t.starts_with("FILLS") || t.starts_with("PROJECTS") => 6,
        _ if t.starts_with("CONNECTS") || t.starts_with("COVERS") || t.starts_with("FLOWCONTROL") || t.starts_with("INTERFERES") || t.starts_with("SEQUENCE") || t.starts_with("SERVICESBUILDINGS") => 7,
        _ if t.starts_with("ASSIGNSTOGROUP") => 8,
        _ if t.starts_with("ASSIGNS") => 5,
        _ => 9,
    }
}

fn color_of(doc: &Document, id: u32) -> Color32 {
    let f = doc.type_flags(id);
    if f & tflags::SPATIAL != 0 || f & tflags::PROJECT != 0 {
        Color32::from_rgb(90, 150, 255)
    } else if f & tflags::PRODUCT != 0 {
        Color32::from_rgb(70, 190, 170)
    } else if f & tflags::REL != 0 {
        Color32::from_rgb(240, 160, 60)
    } else if f & (tflags::PSET | tflags::QSET | tflags::PROPERTY | tflags::QUANTITY) != 0 {
        Color32::from_rgb(140, 200, 90)
    } else if f & tflags::TYPE_OBJECT != 0 {
        Color32::from_rgb(190, 120, 230)
    } else if f & tflags::MATERIAL != 0 {
        Color32::from_rgb(220, 110, 140)
    } else if f & tflags::GROUP != 0 {
        Color32::from_rgb(230, 210, 90)
    } else {
        Color32::from_rgb(150, 155, 165)
    }
}

const LEGEND: [(&str, [u8; 3]); 8] = [
    ("Raumstruktur", [90, 150, 255]),
    ("Bauteil/Produkt", [70, 190, 170]),
    ("Beziehung", [240, 160, 60]),
    ("Eigenschaften", [140, 200, 90]),
    ("Typ", [190, 120, 230]),
    ("Material", [220, 110, 140]),
    ("Gruppe", [230, 210, 90]),
    ("Sonstiges", [150, 155, 165]),
];

enum Act {
    Navigate(u32),
    DeleteRel(u32),
    Detach(u32, u32),
    Link(String, u32, Vec<u32>),
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.graph;
    let mut acts: Vec<Act> = Vec::new();
    ui.horizontal_wrapped(|ui| {
        ui.label("Tiefe");
        ui.add(egui::Slider::new(&mut st.depth, 1..=3));
        ui.checkbox(&mut st.filter_rels, "Beziehungen als Kanten").on_hover_text("Objekte über IfcRel… direkt verbinden (Kantenbeschriftung = Beziehungstyp)");
        ui.checkbox(&mut st.show_resources, "Ressourcen").on_hover_text("Geometrie, Platzierung, Owner History … anzeigen");
        ui.menu_button(format!("Filter ({}/{})", CATEGORIES.len() - st.hidden.count_ones() as usize, CATEGORIES.len()), |ui| {
            for (i, c) in CATEGORIES.iter().enumerate() {
                let mut on = st.hidden & (1 << i) == 0;
                if ui.checkbox(&mut on, *c).changed() {
                    st.hidden ^= 1 << i;
                }
            }
            ui.separator();
            if ui.button("Alle").clicked() {
                st.hidden = 0;
            }
            if ui.button("Nur Struktur").clicked() {
                st.hidden = !0b11;
            }
        });
        if ui.button("Ansicht zurücksetzen").clicked() {
            st.zoom = 1.0;
            st.pan = Vec2::ZERO;
        }
    });
    // link the first selected object with the others
    if s.selection.len() >= 2 {
        ui.horizontal_wrapped(|ui| {
            ui.label("Beziehung anlegen:");
            egui::ComboBox::from_id_salt("graph-link").selected_text(ops::REL_CLASSES[st.link_class].1).width(220.0).show_ui(ui, |ui| {
                for (i, (c, l)) in ops::REL_CLASSES.iter().enumerate() {
                    if s.doc.schema().entity(&c.to_ascii_uppercase()).is_some() {
                        ui.selectable_value(&mut st.link_class, i, *l).on_hover_text(*c);
                    }
                }
            });
            let first = s.selection[0];
            if ui.button(format!("„{}“ → {} weitere", model::label(&s.doc, first), s.selection.len() - 1)).on_hover_text("Erstes ausgewähltes Objekt = bestimmende Seite (Relating), übrige = zugeordnet (Related)").clicked() {
                acts.push(Act::Link(ops::REL_CLASSES[st.link_class].0.to_ascii_uppercase(), first, s.selection[1..].to_vec()));
            }
        });
    }
    let Some(&center) = s.selection.first() else {
        ui.weak("Ein Element auswählen, um seine Beziehungen zu sehen.");
        return;
    };
    let doc = &s.doc;
    let hidden = st.hidden;
    let keep = |id: u32| -> bool {
        if st.show_resources {
            return true;
        }
        let f = doc.type_flags(id);
        f & (tflags::ROOT | tflags::MATERIAL | tflags::PROPERTY | tflags::QUANTITY) != 0 || matches!(doc.type_name(id).unwrap_or(""), "IFCCLASSIFICATIONREFERENCE" | "IFCMATERIALLAYER" | "IFCDOCUMENTREFERENCE" | "IFCLIBRARYREFERENCE")
    };
    let rel_visible = |rel: u32| hidden & (1 << category(doc.type_name(rel).unwrap_or(""))) == 0;
    // neighbours with optional edge label (relationship)
    let neighbours = |id: u32| -> Vec<(u32, Option<u32>)> {
        let mut v: Vec<u32> = doc.references(id).into_iter().chain(doc.referencing(id)).filter(|&x| x != id && doc.exists(x)).collect();
        v.sort_unstable();
        v.dedup();
        let mut out: Vec<(u32, Option<u32>)> = Vec::new();
        for n in v {
            if doc.has_flag(n, tflags::REL) {
                if !rel_visible(n) {
                    continue;
                }
                if st.filter_rels {
                    // only the other side of the relationship (not the siblings on the same side)
                    let others: Vec<u32> = match ops::rel_roles(doc, doc.type_name(n).unwrap_or("")) {
                        Some((ri, di, _)) => {
                            let relating = doc.arg(n, ri).map(|v| v.ref_list()).unwrap_or_default();
                            if relating.contains(&id) {
                                doc.arg(n, di).map(|v| v.ref_list()).unwrap_or_default()
                            } else {
                                relating
                            }
                        }
                        None => doc.references(n),
                    };
                    for x in others {
                        if x != id && doc.exists(x) && keep(x) && !doc.has_flag(x, tflags::REL) {
                            out.push((x, Some(n)));
                        }
                    }
                    continue;
                }
            }
            if keep(n) || doc.has_flag(n, tflags::REL) {
                out.push((n, None));
            }
        }
        out.sort_unstable_by_key(|x| x.0);
        out.dedup_by_key(|x| x.0);
        out.truncate(80);
        out
    };
    let max_nodes = match st.depth {
        1 => 90,
        2 => 220,
        _ => 360,
    };
    let mut nodes: Vec<(u32, u8)> = vec![(center, 0)];
    let mut edges: Vec<(u32, u32, Option<u32>)> = Vec::new();
    let mut index: FxHashMap<u32, usize> = FxHashMap::default();
    index.insert(center, 0);
    let mut frontier = vec![center];
    let mut truncated = false;
    for d in 1..=st.depth {
        let mut next = Vec::new();
        for f in frontier {
            for (n, rel) in neighbours(f) {
                if !index.contains_key(&n) {
                    if nodes.len() >= max_nodes {
                        truncated = true;
                        continue;
                    }
                    index.insert(n, nodes.len());
                    nodes.push((n, d));
                    next.push(n);
                }
                edges.push((f, n, rel));
            }
        }
        frontier = next;
    }
    let (rect, resp) = ui.allocate_exact_size(ui.available_size(), Sense::click_and_drag());
    if resp.dragged() {
        st.pan += resp.drag_delta();
    }
    if resp.hovered() {
        let z = ui.input(|i| i.smooth_scroll_delta.y);
        if z != 0.0 {
            st.zoom = (st.zoom * (z * 0.002).exp()).clamp(0.2, 5.0);
        }
    }
    let painter = ui.painter_at(rect);
    let c = rect.center() + st.pan;
    // radial layout per ring; children placed near their parent's angle
    let mut pos: Vec<Pos2> = vec![c; nodes.len()];
    let mut angle: Vec<f32> = vec![0.0; nodes.len()];
    for ring in 1..=st.depth {
        let mut members: Vec<usize> = nodes.iter().enumerate().filter(|(_, n)| n.1 == ring).map(|(i, _)| i).collect();
        if ring > 1 {
            // sort by the angle of the first parent in the previous ring
            let parent_angle = |i: usize| -> f32 {
                let id = nodes[i].0;
                edges.iter().find(|e| e.1 == id && index.get(&e.0).map(|&p| nodes[p].1 == ring - 1).unwrap_or(false)).and_then(|e| index.get(&e.0)).map(|&p| angle[p]).unwrap_or(0.0)
            };
            let mut keyed: Vec<(f32, usize)> = members.iter().map(|&i| (parent_angle(i), i)).collect();
            keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
            members = keyed.into_iter().map(|x| x.1).collect();
        }
        // elliptical rings filling the panel
        let rx = ((rect.width() * 0.5 - 90.0) / st.depth as f32).max(60.0) * ring as f32 * st.zoom;
        let ry = ((rect.height() * 0.5 - 45.0) / st.depth as f32).max(45.0) * ring as f32 * st.zoom;
        let n = members.len().max(1) as f32;
        for (k, i) in members.iter().enumerate() {
            let a = std::f32::consts::TAU * k as f32 / n - std::f32::consts::FRAC_PI_2;
            angle[*i] = a;
            pos[*i] = c + Vec2::new(a.cos() * rx, a.sin() * ry);
        }
    }
    let pointer = resp.hover_pos();
    let mut hovered_node: Option<usize> = None;
    for (i, (_, depth)) in nodes.iter().enumerate() {
        let r = if *depth == 0 { 11.0 } else { 7.0 } * st.zoom.sqrt();
        if pointer.map(|q| q.distance(pos[i]) < r + 3.0).unwrap_or(false) {
            hovered_node = Some(i);
        }
    }
    let weak = ui.visuals().weak_text_color();
    let show_labels = nodes.len() <= 70;
    for (a, b, rel) in &edges {
        if let (Some(&ia), Some(&ib)) = (index.get(a), index.get(b)) {
            let hl = hovered_node.map(|h| h == ia || h == ib).unwrap_or(false);
            painter.line_segment([pos[ia], pos[ib]], Stroke::new(if hl { 2.0 } else { 1.0 }, if hl { Color32::from_rgb(240, 160, 60) } else { weak.gamma_multiply(0.6) }));
            if let Some(rel) = rel {
                if show_labels || hl {
                    let mid = pos[ia] + (pos[ib] - pos[ia]) * 0.5;
                    let t = doc.type_camel(*rel).unwrap_or("").trim_start_matches("IfcRel").to_string();
                    painter.text(mid, Align2::CENTER_CENTER, t, FontId::proportional(9.5), if hl { Color32::from_rgb(240, 160, 60) } else { weak });
                }
            }
        }
    }
    for (i, (id, depth)) in nodes.iter().enumerate() {
        let p = pos[i];
        let col = color_of(doc, *id);
        let r = if *depth == 0 { 11.0 } else { 7.0 } * st.zoom.sqrt();
        painter.circle_filled(p, r, col);
        if hovered_node == Some(i) {
            painter.circle_stroke(p, r + 3.0, Stroke::new(2.0, Color32::WHITE));
        }
        if *depth <= 1 || nodes.len() < 120 || hovered_node == Some(i) {
            let name = model::label(doc, *id);
            let text = if name.chars().count() > 28 { format!("{}…", name.chars().take(27).collect::<String>()) } else { name };
            let class = doc.type_camel(*id).unwrap_or("?");
            let label = if text.contains(class) { text } else { format!("{text}\n{class}") };
            painter.text(p + Vec2::new(0.0, r + 2.0), Align2::CENTER_TOP, label, FontId::proportional(if *depth == 0 { 13.0 } else { 11.0 }), ui.visuals().text_color());
        }
    }
    if let Some(h) = hovered_node {
        let id = nodes[h].0;
        let mut lines = vec![format!("#{id} {}", doc.type_camel(id).unwrap_or("?"))];
        if let Some(g) = doc.guid_of(id) {
            lines.push(g);
        }
        lines.push("Klick: navigieren · Rechtsklick: Aktionen".into());
        let text = lines.join("\n");
        let galley = painter.layout_no_wrap(text, FontId::proportional(11.0), ui.visuals().text_color());
        let at = pointer.unwrap_or(pos[h]) + Vec2::new(14.0, 14.0);
        let bg = Rect::from_min_size(at, galley.size() + Vec2::splat(8.0));
        painter.rect_filled(bg, 4.0, ui.visuals().extreme_bg_color);
        painter.galley(at + Vec2::splat(4.0), galley, ui.visuals().text_color());
        if resp.clicked() {
            acts.push(Act::Navigate(id));
        }
        if resp.secondary_clicked() {
            st.menu_node = Some(id);
        }
    }
    // legend + info
    painter.text(rect.left_top() + Vec2::new(8.0, 8.0), Align2::LEFT_TOP, format!("{} Knoten · {} Kanten{}", nodes.len(), edges.len(), if truncated { " · gekürzt" } else { "" }), FontId::proportional(11.0), weak);
    let mut y = rect.bottom() - 10.0 - LEGEND.len() as f32 * 14.0;
    for (name, c) in LEGEND {
        painter.circle_filled(Pos2::new(rect.right() - 110.0, y + 6.0), 4.5, Color32::from_rgb(c[0], c[1], c[2]));
        painter.text(Pos2::new(rect.right() - 100.0, y), Align2::LEFT_TOP, name, FontId::proportional(10.5), weak);
        y += 14.0;
    }
    // context menu for the node under the pointer at right-click time
    let menu_node = st.menu_node;
    resp.context_menu(|ui| {
        let Some(node) = menu_node.filter(|n| doc.exists(*n)) else {
            ui.weak("Rechtsklick auf einen Knoten");
            return;
        };
        ui.label(egui::RichText::new(model::label(doc, node)).strong());
        if ui.button("Auswählen / zentrieren").clicked() {
            acts.push(Act::Navigate(node));
            ui.close();
        }
        if doc.has_flag(node, tflags::REL) {
            if ui.button("Beziehung löschen").clicked() {
                acts.push(Act::DeleteRel(node));
                ui.close();
            }
            if node != center && ui.button(format!("„{}“ aus Beziehung lösen", model::label(doc, center))).clicked() {
                acts.push(Act::Detach(node, center));
                ui.close();
            }
        } else if node != center {
            // relationships linking center and node
            let links: Vec<u32> = doc.referencing(center).into_iter().filter(|&r| doc.has_flag(r, tflags::REL) && doc.references(r).contains(&node)).collect();
            for rel in links {
                let t = doc.type_camel(rel).unwrap_or("").to_string();
                if ui.button(format!("{t} #{rel} lösen")).on_hover_text("Knoten aus dieser Beziehung entfernen (leere Beziehungen werden gelöscht)").clicked() {
                    acts.push(Act::Detach(rel, node));
                    ui.close();
                }
            }
            ui.menu_button("Neue Beziehung: Mitte → Knoten", |ui| {
                for (c, l) in ops::REL_CLASSES {
                    if doc.schema().entity(&c.to_ascii_uppercase()).is_some() && ui.button(*l).on_hover_text(*c).clicked() {
                        acts.push(Act::Link(c.to_ascii_uppercase(), center, vec![node]));
                        ui.close();
                    }
                }
            });
            ui.menu_button("Neue Beziehung: Knoten → Mitte", |ui| {
                for (c, l) in ops::REL_CLASSES {
                    if doc.schema().entity(&c.to_ascii_uppercase()).is_some() && ui.button(*l).on_hover_text(*c).clicked() {
                        acts.push(Act::Link(c.to_ascii_uppercase(), node, vec![center]));
                        ui.close();
                    }
                }
            });
        }
    });
    for a in acts {
        match a {
            Act::Navigate(id) => {
                s.nav_back.push(center);
                s.selection = vec![id];
                s.scroll_tree_to = Some(id);
                s.apply_visibility();
            }
            Act::DeleteRel(rel) => {
                s.edit("Beziehung löschen", |doc| ops::delete_entities(doc, &[rel], false).map(|_| ()));
            }
            Act::Detach(rel, id) => {
                s.edit("Aus Beziehung lösen", |doc| ops::detach_from_relationship(doc, rel, id));
            }
            Act::Link(class, relating, related) => {
                if let Some(rel) = s.edit("Beziehung anlegen", |doc| ops::create_relationship(doc, &class, relating, &related)) {
                    app.toast(format!("Beziehung #{rel} angelegt"));
                } else if let Some(e) = s.last_error.clone() {
                    app.error(e);
                }
            }
        }
    }
}
