//! Create elements with simple bodies; move/rotate placements; edit extrusion dimensions.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use glam::{DMat4, DVec3};
use ifc_doc::ops::{BodyShape, NewElement};
use ifc_doc::{model, ops, tflags, Document, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ShapeKind {
    #[default]
    Box,
    Cylinder,
    None,
}

pub struct BuilderState {
    pub class: String,
    pub name: String,
    pub container: Option<u32>,
    pub loc: [f64; 3],
    pub rot: f64,
    pub shape: ShapeKind,
    pub dims: [f64; 3],
    pub radius: f64,
    pub centered: bool,
    pub count: u32,
    pub spacing: [f64; 3],
    pub mv: [f64; 3],
    pub rz: f64,
    pub storey_name: String,
    pub storey_elev: f64,
}

impl Default for BuilderState {
    fn default() -> Self {
        BuilderState {
            class: "IfcWall".into(),
            name: "Wand".into(),
            container: None,
            loc: [0.0; 3],
            rot: 0.0,
            shape: ShapeKind::Box,
            dims: [5.0, 0.3, 3.0],
            radius: 0.2,
            centered: false,
            count: 1,
            spacing: [0.0, 1.0, 0.0],
            mv: [0.0; 3],
            rz: 0.0,
            storey_name: "Neues Geschoss".into(),
            storey_elev: 0.0,
        }
    }
}

const PRESETS: &[(&str, &str, [f64; 3], bool)] = &[
    ("IfcWall", "Wand", [5.0, 0.3, 3.0], false),
    ("IfcSlab", "Decke", [10.0, 8.0, 0.25], false),
    ("IfcColumn", "Stütze", [0.4, 0.4, 3.0], true),
    ("IfcBeam", "Träger", [5.0, 0.3, 0.5], false),
    ("IfcMember", "Stab", [3.0, 0.1, 0.1], false),
    ("IfcPlate", "Platte", [2.0, 1.0, 0.02], false),
    ("IfcFooting", "Fundament", [1.5, 1.5, 0.6], true),
    ("IfcRoof", "Dach", [10.0, 8.0, 0.3], false),
    ("IfcCovering", "Belag", [5.0, 5.0, 0.05], false),
    ("IfcDoor", "Tür", [1.0, 0.1, 2.1], false),
    ("IfcWindow", "Fenster", [1.2, 0.1, 1.4], false),
    ("IfcRailing", "Geländer", [3.0, 0.05, 1.0], false),
    ("IfcStair", "Treppe", [3.0, 1.2, 3.0], false),
    ("IfcSpace", "Raum", [5.0, 4.0, 2.8], false),
    ("IfcFurnishingElement", "Möbel", [1.6, 0.8, 0.75], false),
    ("IfcBuildingElementProxy", "Proxy", [1.0, 1.0, 1.0], true),
];

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let unit = model::length_unit(&s.doc).0;
    let st = &mut app.panel_state.builder;
    ui.heading(format!("{} Element erstellen", ic::BUILD));
    ui.horizontal_wrapped(|ui| {
        for (c, n, d, centered) in PRESETS {
            if ui.selectable_label(st.class == *c, *n).clicked() {
                st.class = c.to_string();
                st.name = n.to_string();
                st.dims = *d;
                st.centered = *centered;
            }
        }
    });
    let spatial: Vec<u32> = s.doc.ids_with_flag(tflags::SPATIAL).into_iter().filter(|&id| s.doc.type_name(id) != Some("IFCSPACE")).collect();
    if st.container.map(|c| !s.doc.exists(c)).unwrap_or(true) {
        st.container = s.doc.ids_of_type("IFCBUILDINGSTOREY").into_iter().next().or_else(|| spatial.first().copied());
    }
    egui::Grid::new("builder").num_columns(2).spacing([10.0, 6.0]).show(ui, |ui| {
        ui.label("Klasse");
        ui.text_edit_singleline(&mut st.class);
        ui.end_row();
        ui.label("Name");
        ui.text_edit_singleline(&mut st.name);
        ui.end_row();
        ui.label("Enthalten in");
        egui::ComboBox::from_id_salt("container").selected_text(st.container.map(|c| model::label(&s.doc, c)).unwrap_or_else(|| "—".into())).width(220.0).show_ui(ui, |ui| {
            for c in &spatial {
                ui.selectable_value(&mut st.container, Some(*c), format!("{} {}", s.doc.type_camel(*c).unwrap_or(""), model::label(&s.doc, *c)));
            }
        });
        ui.end_row();
        ui.label("Position (m)");
        ui.horizontal(|ui| {
            for (i, a) in ["X", "Y", "Z"].iter().enumerate() {
                ui.add(egui::DragValue::new(&mut st.loc[i]).speed(0.05).prefix(format!("{a} ")).max_decimals(3));
            }
        });
        ui.end_row();
        ui.label("Drehung");
        ui.add(egui::DragValue::new(&mut st.rot).speed(1.0).suffix("°").range(-360.0..=360.0));
        ui.end_row();
        ui.label("Körper");
        ui.horizontal(|ui| {
            ui.selectable_value(&mut st.shape, ShapeKind::Box, "Quader");
            ui.selectable_value(&mut st.shape, ShapeKind::Cylinder, "Zylinder");
            ui.selectable_value(&mut st.shape, ShapeKind::None, "ohne");
        });
        ui.end_row();
        match st.shape {
            ShapeKind::Box => {
                ui.label("Abmessungen (m)");
                ui.horizontal(|ui| {
                    for (i, a) in ["L", "B", "H"].iter().enumerate() {
                        ui.add(egui::DragValue::new(&mut st.dims[i]).speed(0.01).range(0.001..=1e5).prefix(format!("{a} ")).max_decimals(3));
                    }
                    ui.checkbox(&mut st.centered, "zentriert");
                });
                ui.end_row();
            }
            ShapeKind::Cylinder => {
                ui.label("Radius / Höhe (m)");
                ui.horizontal(|ui| {
                    ui.add(egui::DragValue::new(&mut st.radius).speed(0.01).range(0.001..=1e4));
                    ui.add(egui::DragValue::new(&mut st.dims[2]).speed(0.01).range(0.001..=1e5));
                });
                ui.end_row();
            }
            ShapeKind::None => {}
        }
        ui.label("Anzahl / Abstand");
        ui.horizontal(|ui| {
            ui.add(egui::DragValue::new(&mut st.count).range(1..=500));
            for (i, a) in ["ΔX", "ΔY", "ΔZ"].iter().enumerate() {
                ui.add(egui::DragValue::new(&mut st.spacing[i]).speed(0.05).prefix(format!("{a} ")).max_decimals(3));
            }
        });
        ui.end_row();
    });
    let pick = app.panel_state.builder_pick;
    let mut create = false;
    let mut use_pick = false;
    ui.horizontal(|ui| {
        if ui.button(format!("{} Erstellen", ic::PLUS)).clicked() {
            create = true;
        }
        if let Some(p) = pick {
            if ui.button("Position aus letztem Klick").on_hover_text(format!("Weltkoordinaten {:.2}, {:.2}, {:.2} m", p.x, p.y, p.z)).clicked() {
                use_pick = true;
            }
        }
    });
    if use_pick {
        if let Some(p) = pick {
            st.loc = [p.x, p.y, p.z];
        }
    }
    let mut storey_req: Option<(String, f64)> = None;
    ui.separator();
    ui.collapsing(format!("{} Geschoss anlegen", ic::LAYERS), |ui| {
        ui.horizontal(|ui| {
            ui.text_edit_singleline(&mut st.storey_name);
            ui.add(egui::DragValue::new(&mut st.storey_elev).speed(0.1).suffix(" m"));
            if ui.button(format!("{} Geschoss", ic::PLUS)).clicked() {
                storey_req = Some((st.storey_name.clone(), st.storey_elev / unit));
            }
        });
    });
    if create {
        let spec_base = st_to_spec(st, unit);
        let class_upper = st.class.trim().to_ascii_uppercase();
        let count = st.count.max(1);
        let spacing = st.spacing;
        let name = st.name.clone();
        if s.doc.schema().entity(&class_upper).is_none() {
            app.error(format!("Unbekannte Klasse {} im Schema {}", class_upper, s.doc.schema_id.display()));
        } else {
            let created = s.edit(&format!("{name} erstellen"), |doc| {
                let mut ids = Vec::new();
                for k in 0..count {
                    let mut spec = spec_base.clone();
                    for a in 0..3 {
                        spec.location[a] += spacing[a] * k as f64 / unit;
                    }
                    if count > 1 {
                        spec.name = format!("{} {}", spec.name, k + 1);
                    }
                    ids.push(ops::create_element(doc, &spec)?);
                }
                Ok(ids)
            });
            if let Some(ids) = created {
                app.toast(format!("{} Element(e) erstellt", ids.len()));
                s.select(ids, false);
                s.needs_fit = false;
            }
        }
    }
    if let Some((n, e)) = storey_req {
        let building = s.doc.ids_of_type("IFCBUILDING").into_iter().next().or_else(|| s.doc.ids_with_flag(tflags::SPATIAL).into_iter().next());
        match building {
            Some(b) => {
                s.edit("Geschoss anlegen", |doc| ops::create_spatial(doc, "IFCBUILDINGSTOREY", &n, b, Some(e)).map(|_| ()));
            }
            None => app.error("Kein Gebäude vorhanden"),
        }
    }
    ui.separator();
    transform_ui(ui, s, app, unit);
    ui.separator();
    dimensions_ui(ui, s, app, unit);
}

fn st_to_spec(st: &BuilderState, unit: f64) -> NewElement {
    let shape = match st.shape {
        ShapeKind::Box => Some(BodyShape::Box { x: st.dims[0] / unit, y: st.dims[1] / unit, z: st.dims[2] / unit, centered: st.centered }),
        ShapeKind::Cylinder => Some(BodyShape::Cylinder { r: st.radius / unit, h: st.dims[2] / unit }),
        ShapeKind::None => None,
    };
    NewElement { class_upper: st.class.trim().to_ascii_uppercase(), name: st.name.clone(), container: st.container, location: [st.loc[0] / unit, st.loc[1] / unit, st.loc[2] / unit], rotation_deg: st.rot, shape, predefined_type: None }
}

/// Resolve a placement matrix (file units) using the geometry engine.
fn placement_matrix(doc: &Document, pl: Option<u32>) -> DMat4 {
    match pl {
        Some(p) => {
            let e = ifc_geom::Engine::with_parts(doc, Default::default(), DVec3::ZERO, Default::default());
            e.placement(&mut ifc_geom::Cache::default(), p, 0)
        }
        None => DMat4::IDENTITY,
    }
}

/// Move/rotate products by a world delta (file units) and a rotation about the world Z axis.
pub fn transform_products(doc: &mut Document, ids: &[u32], delta_world: DVec3, rot_deg: f64) -> anyhow::Result<()> {
    for &id in ids {
        let Some(pl) = doc.arg(id, 5).and_then(|v| v.as_ref_id()) else { continue };
        if doc.type_name(pl) != Some("IFCLOCALPLACEMENT") {
            continue;
        }
        let pa = doc.args(pl).unwrap_or_default();
        let parent = pa.first().and_then(|v| v.as_ref_id());
        let parent_m = placement_matrix(doc, parent);
        let local_m = pa.get(1).and_then(|v| v.as_ref_id()).map(|a| {
            let e = ifc_geom::Engine::with_parts(doc, Default::default(), DVec3::ZERO, Default::default());
            e.axis2(a)
        })
        .unwrap_or(DMat4::IDENTITY);
        let world = parent_m * local_m;
        let rot = DMat4::from_rotation_z(rot_deg.to_radians());
        let pivot = world.w_axis.truncate();
        let new_world = DMat4::from_translation(pivot + delta_world) * rot * DMat4::from_translation(-pivot) * world;
        let new_local = parent_m.inverse() * new_world;
        let loc = new_local.w_axis.truncate();
        let z = new_local.z_axis.truncate().normalize();
        let x = new_local.x_axis.truncate().normalize();
        let r = |v: f64| (v * 1e9).round() / 1e9;
        let p = doc.create("IFCCARTESIANPOINT", &[Value::List(vec![Value::Real(r(loc.x)), Value::Real(r(loc.y)), Value::Real(r(loc.z))])]);
        let zd = doc.create("IFCDIRECTION", &[Value::List(vec![Value::Real(r(z.x)), Value::Real(r(z.y)), Value::Real(r(z.z))])]);
        let xd = doc.create("IFCDIRECTION", &[Value::List(vec![Value::Real(r(x.x)), Value::Real(r(x.y)), Value::Real(r(x.z))])]);
        let ax = doc.create("IFCAXIS2PLACEMENT3D", &[Value::Ref(p), Value::Ref(zd), Value::Ref(xd)]);
        // shared placements are not modified in place
        let shared = doc.referencing(pl).into_iter().filter(|&r| doc.has_flag(r, tflags::PRODUCT)).count() > 1;
        if shared {
            let npl = doc.create("IFCLOCALPLACEMENT", &[parent.map(Value::Ref).unwrap_or(Value::Null), Value::Ref(ax)]);
            doc.set_arg(id, 5, Value::Ref(npl))?;
        } else {
            doc.set_arg(pl, 1, Value::Ref(ax))?;
        }
    }
    Ok(())
}

fn transform_ui(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx, unit: f64) {
    let sel: Vec<u32> = s.selection.iter().copied().filter(|&id| s.doc.has_flag(id, tflags::PRODUCT)).collect();
    let st = &mut app.panel_state.builder;
    ui.collapsing(format!("{} Auswahl verschieben / drehen ({})", ic::MOVE, sel.len()), |ui| {
        ui.horizontal(|ui| {
            for (i, a) in ["ΔX", "ΔY", "ΔZ"].iter().enumerate() {
                ui.add(egui::DragValue::new(&mut st.mv[i]).speed(0.05).prefix(format!("{a} ")).suffix(" m").max_decimals(3));
            }
        });
        ui.horizontal(|ui| {
            ui.add(egui::DragValue::new(&mut st.rz).speed(1.0).prefix("Drehung Z ").suffix("°"));
            let enabled = !sel.is_empty() && (st.mv.iter().any(|v| *v != 0.0) || st.rz != 0.0);
            if ui.add_enabled(enabled, egui::Button::new("Anwenden")).clicked() {
                let d = DVec3::new(st.mv[0], st.mv[1], st.mv[2]) / unit;
                let rz = st.rz;
                s.edit("Verschieben/Drehen", |doc| transform_products(doc, &sel, d, rz));
            }
            if ui.button("Duplizieren + verschieben").clicked() && !sel.is_empty() {
                let d = [st.mv[0] / unit, st.mv[1] / unit, st.mv[2] / unit];
                if let Some(ids) = s.edit("Duplizieren", |doc| ops::duplicate(doc, &sel, d)) {
                    s.select(ids, false);
                }
            }
        });
    });
}

/// Single extruded solid with editable parameters: (solid, profile, profile type).
fn extrusion_of(doc: &Document, id: u32) -> Option<(u32, u32, String)> {
    let pds = doc.arg(id, 6)?.as_ref_id()?;
    for rep in doc.arg(pds, 2)?.ref_list() {
        let items = doc.arg(rep, 3)?.ref_list();
        if items.len() == 1 && doc.type_name(items[0]) == Some("IFCEXTRUDEDAREASOLID") {
            let prof = doc.arg(items[0], 0)?.as_ref_id()?;
            return Some((items[0], prof, doc.type_name(prof)?.to_string()));
        }
    }
    None
}

fn dimensions_ui(ui: &mut egui::Ui, s: &mut Session, _app: &mut AppCtx, unit: f64) {
    let Some(&id) = s.selection.first() else { return };
    let Some((solid, prof, pty)) = extrusion_of(&s.doc, id) else { return };
    let depth = s.doc.arg(solid, 3).and_then(|v| v.as_f64()).unwrap_or(0.0) * unit;
    let mut edits: Vec<(u32, usize, f64)> = Vec::new();
    ui.collapsing(format!("{} Abmessungen von „{}“", ic::EDIT, model::label(&s.doc, id)), |ui| {
        egui::Grid::new("dims").num_columns(2).show(ui, |ui| {
            let mut d = depth;
            ui.label("Extrusionslänge (m)");
            if ui.add(egui::DragValue::new(&mut d).speed(0.01).max_decimals(4)).changed() {
                edits.push((solid, 3, d / unit));
            }
            ui.end_row();
            let fields: &[(&str, usize)] = match pty.as_str() {
                "IFCRECTANGLEPROFILEDEF" => &[("Breite X", 3), ("Tiefe Y", 4)],
                "IFCCIRCLEPROFILEDEF" => &[("Radius", 3)],
                "IFCRECTANGLEHOLLOWPROFILEDEF" => &[("Breite X", 3), ("Tiefe Y", 4), ("Wandstärke", 5)],
                "IFCCIRCLEHOLLOWPROFILEDEF" => &[("Radius", 3), ("Wandstärke", 4)],
                "IFCISHAPEPROFILEDEF" => &[("Breite", 3), ("Höhe", 4), ("Stegdicke", 5), ("Flanschdicke", 6)],
                _ => &[],
            };
            for (label, idx) in fields {
                let mut v = s.doc.arg(prof, *idx).and_then(|v| v.as_f64()).unwrap_or(0.0) * unit;
                ui.label(format!("{label} (m)"));
                if ui.add(egui::DragValue::new(&mut v).speed(0.005).max_decimals(4).range(0.0001..=1e5)).changed() {
                    edits.push((prof, *idx, v / unit));
                }
                ui.end_row();
            }
        });
        let shared = s.doc.referencing(prof).len() > 1 || s.doc.referencing(solid).len() > 1;
        if shared {
            ui.colored_label(egui::Color32::from_rgb(255, 170, 40), "Profil/Körper wird von mehreren Objekten verwendet – Änderungen wirken auf alle.");
        }
    });
    if !edits.is_empty() {
        s.edit("Abmessungen ändern", |doc| {
            for (e, i, v) in &edits {
                doc.set_arg(*e, *i, Value::Real(*v))?;
            }
            Ok(())
        });
    }
}
