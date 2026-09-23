//! Relationship graph around the selected entity (radial layout, navigable).

use crate::app::AppCtx;
use crate::session::Session;
use egui::{Align2, Color32, FontId, Pos2, Sense, Stroke, Vec2};
use ifc_doc::{model, tflags, Document};
use rustc_hash::FxHashMap;

#[derive(Default)]
pub struct GraphState {
    pub depth: u8,
    pub show_resources: bool,
    pub zoom: f32,
    pub pan: Vec2,
    pub filter_rels: bool,
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
    } else {
        Color32::from_rgb(150, 155, 165)
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.graph;
    if st.depth == 0 {
        st.depth = 1;
        st.zoom = 1.0;
    }
    ui.horizontal(|ui| {
        ui.label("Tiefe");
        ui.add(egui::Slider::new(&mut st.depth, 1..=2));
        ui.checkbox(&mut st.show_resources, "Geometrie-/Ressourcen-Entities");
        ui.checkbox(&mut st.filter_rels, "Beziehungen überspringen").on_hover_text("Objekte über IfcRel… direkt verbinden");
        if ui.button("Ansicht zurücksetzen").clicked() {
            st.zoom = 1.0;
            st.pan = Vec2::ZERO;
        }
    });
    let Some(&center) = s.selection.first() else {
        ui.weak("Ein Element auswählen, um seine Beziehungen zu sehen.");
        return;
    };
    let doc = &s.doc;
    let keep = |id: u32| -> bool {
        if st.show_resources {
            return true;
        }
        let f = doc.type_flags(id);
        f & (tflags::ROOT | tflags::MATERIAL | tflags::PROPERTY | tflags::QUANTITY) != 0 || matches!(doc.type_name(id).unwrap_or(""), "IFCCLASSIFICATIONREFERENCE" | "IFCMATERIALLAYER")
    };
    // neighbours
    let neighbours = |id: u32| -> Vec<u32> {
        let mut v: Vec<u32> = doc.references(id).into_iter().chain(doc.referencing(id)).filter(|&x| x != id && doc.exists(x)).collect();
        if st.filter_rels {
            let mut out = Vec::new();
            for n in v.drain(..) {
                if doc.has_flag(n, tflags::REL) {
                    out.extend(doc.references(n).into_iter().filter(|&x| x != id));
                } else {
                    out.push(n);
                }
            }
            v = out;
        }
        v.retain(|&x| keep(x));
        v.sort_unstable();
        v.dedup();
        v.truncate(60);
        v
    };
    let mut nodes: Vec<(u32, u8)> = vec![(center, 0)];
    let mut edges: Vec<(u32, u32)> = Vec::new();
    let mut index: FxHashMap<u32, usize> = FxHashMap::default();
    index.insert(center, 0);
    let mut frontier = vec![center];
    for d in 1..=st.depth {
        let mut next = Vec::new();
        for f in frontier {
            for n in neighbours(f) {
                if !index.contains_key(&n) {
                    if nodes.len() > 180 {
                        continue;
                    }
                    index.insert(n, nodes.len());
                    nodes.push((n, d));
                    next.push(n);
                }
                edges.push((f, n));
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
    // radial layout per ring
    let mut pos: Vec<Pos2> = vec![c; nodes.len()];
    for ring in 1..=st.depth {
        let members: Vec<usize> = nodes.iter().enumerate().filter(|(_, n)| n.1 == ring).map(|(i, _)| i).collect();
        let r = (140.0 + 150.0 * (ring as f32 - 1.0)) * st.zoom;
        let n = members.len().max(1) as f32;
        for (k, i) in members.iter().enumerate() {
            let a = std::f32::consts::TAU * k as f32 / n - std::f32::consts::FRAC_PI_2;
            pos[*i] = c + Vec2::new(a.cos(), a.sin()) * r;
        }
    }
    for (a, b) in &edges {
        if let (Some(&ia), Some(&ib)) = (index.get(a), index.get(b)) {
            painter.line_segment([pos[ia], pos[ib]], Stroke::new(1.0, ui.visuals().weak_text_color().gamma_multiply(0.6)));
        }
    }
    let mut clicked: Option<u32> = None;
    let pointer = resp.hover_pos();
    for (i, (id, depth)) in nodes.iter().enumerate() {
        let p = pos[i];
        let col = color_of(doc, *id);
        let r = if *depth == 0 { 11.0 } else { 7.0 } * st.zoom.sqrt();
        painter.circle_filled(p, r, col);
        let hovered = pointer.map(|q| q.distance(p) < r + 3.0).unwrap_or(false);
        if hovered {
            painter.circle_stroke(p, r + 3.0, Stroke::new(2.0, Color32::WHITE));
            if resp.clicked() {
                clicked = Some(*id);
            }
        }
        let name = model::label(doc, *id);
        let text = if name.chars().count() > 28 { format!("{}…", name.chars().take(27).collect::<String>()) } else { name };
        let class = doc.type_camel(*id).unwrap_or("?");
        let label = if text.contains(class) { text } else { format!("{text}\n{class}") };
        painter.text(p + Vec2::new(0.0, r + 2.0), Align2::CENTER_TOP, label, FontId::proportional(if *depth == 0 { 13.0 } else { 11.0 }), ui.visuals().text_color());
    }
    painter.text(rect.left_top() + Vec2::new(8.0, 8.0), Align2::LEFT_TOP, format!("{} Knoten · {} Kanten · Klick = navigieren, Ziehen = verschieben, Rad = Zoom", nodes.len(), edges.len()), FontId::proportional(11.0), ui.visuals().weak_text_color());
    if let Some(id) = clicked {
        s.nav_back.push(center);
        s.selection = vec![id];
        s.scroll_tree_to = Some(id);
        s.apply_visibility();
    }
}
