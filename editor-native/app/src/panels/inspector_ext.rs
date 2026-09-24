//! Additional inspector sections: placement, geometry, type objects, arbitrary
//! relationships, documents/libraries, approvals/constraints, units.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::panels::inspector::edit_field;
use crate::session::Session;
use egui::RichText;
use glam::{DMat4, DVec3};
use ifc_doc::ops::{self, BodyShape};
use ifc_doc::{model, tflags, Value};

fn engine(s: &Session) -> ifc_geom::Engine<'_> {
    ifc_geom::Engine::with_parts(&s.doc, s.geom_opts.clone(), s.scene.origin, Default::default())
}

/// World matrix (file units) of a product.
pub fn world_matrix(s: &Session, id: u32) -> DMat4 {
    let e = engine(s);
    e.product_matrix(&mut ifc_geom::Cache::default(), id)
}

pub fn placement_section(ui: &mut egui::Ui, s: &mut Session, id: u32) {
    if !s.doc.has_flag(id, tflags::PRODUCT) {
        return;
    }
    let unit = model::length_unit(&s.doc).0;
    let m = world_matrix(s, id);
    let world = m.w_axis.truncate() * unit;
    let rot_deg = m.x_axis.y.atan2(m.x_axis.x).to_degrees();
    let has_geom = s.doc.arg(id, 6).map(|v| !v.is_null()).unwrap_or(false);
    let mut new_world: Option<DVec3> = None;
    let mut new_rot: Option<f64> = None;
    let mut assign: Option<BodyShape> = None;
    let mut delete_geom = false;
    egui::CollapsingHeader::new(RichText::new("Platzierung & Geometrie").strong()).default_open(false).show(ui, |ui| {
        egui::Grid::new(("pl", id)).num_columns(2).show(ui, |ui| {
            ui.weak("Welt (m)");
            ui.horizontal(|ui| {
                let mut w = world;
                let mut changed = false;
                for (k, a) in ["X", "Y", "Z"].iter().enumerate() {
                    changed |= ui.add(egui::DragValue::new(&mut w[k]).speed(0.01).prefix(format!("{a} ")).max_decimals(4)).changed();
                }
                if changed {
                    new_world = Some(w);
                }
            });
            ui.end_row();
            ui.weak("Drehung um Z");
            let mut r = rot_deg;
            if ui.add(egui::DragValue::new(&mut r).speed(0.5).suffix("°").max_decimals(3)).changed() {
                new_rot = Some(r);
            }
            ui.end_row();
            if let Some(pl) = s.doc.arg(id, 5).and_then(|v| v.as_ref_id()) {
                let parent = s.doc.arg(pl, 0).and_then(|v| v.as_ref_id());
                let local = s.doc.arg(pl, 1).and_then(|v| v.as_ref_id()).map(|a| engine(s).axis2(a)).unwrap_or(DMat4::IDENTITY);
                let l = local.w_axis.truncate() * unit;
                ui.weak("Lokal (m)");
                ui.label(format!("{:.4}, {:.4}, {:.4}", l.x, l.y, l.z));
                ui.end_row();
                ui.weak("Relativ zu");
                ui.label(parent.map(|p| format!("#{p} {}", s.doc.type_camel(p).unwrap_or(""))).unwrap_or_else(|| "Weltursprung".into()));
                ui.end_row();
            }
            let origin = s.scene.origin;
            ui.weak("Viewer (m)");
            ui.label(format!("{:.3}, {:.3}, {:.3}", world.x - origin.x, world.y - origin.y, world.z - origin.z));
            ui.end_row();
        });
        ui.separator();
        if has_geom {
            if ui.button(format!("{} Nur Geometrie löschen", ic::DELETE)).on_hover_text("Objekt, Platzierung und Psets bleiben erhalten").clicked() {
                delete_geom = true;
            }
        } else {
            let k = ui.id().with(("assign-geom", id));
            let (mut kind, mut dims): (u8, [f64; 3]) = ui.data_mut(|d| d.get_temp(k)).unwrap_or((0, [1.0, 1.0, 1.0]));
            ui.horizontal(|ui| {
                ui.label("Geometrie zuweisen:");
                ui.selectable_value(&mut kind, 0, "Quader");
                ui.selectable_value(&mut kind, 1, "Zylinder");
            });
            ui.horizontal(|ui| {
                let labels = if kind == 0 { ["L", "B", "H"] } else { ["R", "–", "H"] };
                for i in 0..3 {
                    if kind == 1 && i == 1 {
                        continue;
                    }
                    ui.add(egui::DragValue::new(&mut dims[i]).speed(0.01).range(0.001..=1e5).prefix(format!("{} ", labels[i])).suffix(" m"));
                }
                if ui.button("Zuweisen").clicked() {
                    assign = Some(if kind == 0 { BodyShape::Box { x: dims[0] / unit, y: dims[1] / unit, z: dims[2] / unit, centered: false } } else { BodyShape::Cylinder { r: dims[0] / unit, h: dims[2] / unit } });
                }
            });
            ui.data_mut(|d| d.insert_temp(k, (kind, dims)));
        }
    });
    if new_world.is_some() || new_rot.is_some() {
        let w = new_world.unwrap_or(world);
        let delta = (w - world) / unit;
        let dr = new_rot.map(|r| r - rot_deg).unwrap_or(0.0);
        s.edit("Platzierung ändern", |doc| crate::panels::builder::transform_products(doc, &[id], delta, dr));
    }
    if let Some(shape) = assign {
        s.edit("Geometrie zuweisen", |doc| ops::assign_body(doc, id, &shape));
    }
    if delete_geom {
        s.edit("Geometrie löschen", |doc| ops::delete_geometry(doc, id));
    }
}

pub fn type_section(ui: &mut egui::Ui, s: &mut Session, id: u32) {
    if !s.doc.has_flag(id, tflags::ELEMENT) {
        return;
    }
    let default_class = ops::type_class_for(&s.doc, s.doc.type_name(id).unwrap_or(""));
    let k = ui.id().with(("newtype", id));
    let (mut name, mut tag): (String, String) = ui.data_mut(|d| d.get_temp(k)).unwrap_or_default();
    let mut create = false;
    let mut assign_existing: Option<u32> = None;
    ui.horizontal(|ui| {
        let types: Vec<u32> = s.doc.ids_of_type(&default_class);
        egui::ComboBox::from_id_salt(("typesel", id)).selected_text("Typ zuweisen …").width(150.0).show_ui(ui, |ui| {
            for t in types.iter().take(300) {
                if ui.selectable_label(false, model::label(&s.doc, *t)).clicked() {
                    assign_existing = Some(*t);
                }
            }
        });
        ui.add(egui::TextEdit::singleline(&mut name).hint_text(format!("neuer {}", s.doc.schema().camel(&default_class))).desired_width(130.0));
        ui.add(egui::TextEdit::singleline(&mut tag).hint_text("Tag").desired_width(60.0));
        if ui.add_enabled(!name.trim().is_empty(), egui::Button::new(ic::PLUS)).on_hover_text("Typ anlegen und zuweisen").clicked() {
            create = true;
        }
    });
    let targets: Vec<u32> = if s.selection.len() > 1 { s.selection.clone() } else { vec![id] };
    if create {
        let (n, t) = (name.trim().to_string(), tag.trim().to_string());
        s.edit("Typ anlegen", |doc| ops::create_type_object(doc, &default_class, &n, &t, &targets).map(|_| ()));
        name.clear();
        tag.clear();
    }
    if let Some(t) = assign_existing {
        s.edit("Typ zuweisen", |doc| ops::assign_type(doc, &targets, t));
    }
    ui.data_mut(|d| d.insert_temp(k, (name, tag)));
}

pub fn relationships_section(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx, id: u32, navigate: &mut Option<u32>) {
    if !s.doc.has_flag(id, tflags::ROOT) {
        return;
    }
    let rels = ops::relationships_of(&s.doc, id);
    let mut detach: Option<u32> = None;
    let mut create: Option<(String, bool, Vec<u32>)> = None;
    egui::CollapsingHeader::new(RichText::new(format!("IFC-Beziehungen ({})", rels.len())).strong()).default_open(false).show(ui, |ui| {
        for (rel, class, relating) in &rels {
            ui.horizontal(|ui| {
                ui.label(if *relating { "→" } else { "←" }).on_hover_text(if *relating { "dieses Objekt ist die bestimmende Seite (Relating)" } else { "dieses Objekt ist zugeordnet (Related)" });
                if ui.link(format!("{class} #{rel}")).clicked() {
                    *navigate = Some(*rel);
                }
                let t = s.doc.type_name(*rel).unwrap_or("").to_string();
                if let Some((ri, di, _)) = ops::rel_roles(&s.doc, &t) {
                    let other: Vec<u32> = if *relating { s.doc.arg(*rel, di).map(|v| v.ref_list()).unwrap_or_default() } else { s.doc.arg(*rel, ri).and_then(|v| v.as_ref_id()).into_iter().collect() };
                    let txt = other.iter().take(3).map(|o| model::label(&s.doc, *o)).collect::<Vec<_>>().join(", ");
                    ui.weak(if other.len() > 3 { format!("{txt} … (+{})", other.len() - 3) } else { txt });
                }
                if ui.small_button(ic::MINUS).on_hover_text("Objekt aus dieser Beziehung lösen").clicked() {
                    detach = Some(*rel);
                }
            });
        }
        ui.separator();
        let k = ui.id().with(("newrel", id));
        let (mut class_i, mut as_relating, mut targets): (usize, bool, String) = ui.data_mut(|d| d.get_temp(k)).unwrap_or((0, true, String::new()));
        let classes: Vec<(&str, &str)> = ops::REL_CLASSES.iter().copied().filter(|(c, _)| s.doc.schema().entity(&c.to_ascii_uppercase()).is_some()).collect();
        class_i = class_i.min(classes.len().saturating_sub(1));
        ui.horizontal(|ui| {
            egui::ComboBox::from_id_salt(("relclass", id)).selected_text(classes.get(class_i).map(|c| c.0).unwrap_or("")).width(220.0).show_ui(ui, |ui| {
                for (i, (c, d)) in classes.iter().enumerate() {
                    ui.selectable_value(&mut class_i, i, format!("{c} – {d}"));
                }
            });
            ui.selectable_value(&mut as_relating, true, "als Quelle");
            ui.selectable_value(&mut as_relating, false, "als Ziel");
        });
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut targets).hint_text("Gegenseite: #Ids, z. B. #12 #40").desired_width(170.0));
            if ui.button("= übrige Auswahl").on_hover_text("Alle ausgewählten Objekte außer diesem").clicked() {
                targets = s.selection.iter().filter(|&&x| x != id).map(|x| format!("#{x}")).collect::<Vec<_>>().join(" ");
            }
            if ui.button(format!("{} Beziehung", ic::PLUS)).clicked() {
                let others: Vec<u32> = targets.split(|c: char| c.is_whitespace() || c == ',').filter_map(|t| t.trim().trim_start_matches('#').parse().ok()).collect();
                if let Some((c, _)) = classes.get(class_i) {
                    create = Some((c.to_ascii_uppercase(), as_relating, others));
                }
            }
        });
        ui.data_mut(|d| d.insert_temp(k, (class_i, as_relating, targets)));
    });
    if let Some(rel) = detach {
        s.edit("Beziehung lösen", |doc| ops::detach_from_relationship(doc, rel, id));
    }
    if let Some((class, relating, others)) = create {
        if others.is_empty() {
            app.error("Bitte Gegenseite angeben (#Id oder Auswahl)");
        } else if relating {
            s.edit("Beziehung anlegen", |doc| ops::create_relationship(doc, &class, id, &others).map(|_| ()));
        } else {
            let src = others[0];
            s.edit("Beziehung anlegen", |doc| ops::create_relationship(doc, &class, src, &[id]).map(|_| ()));
        }
    }
}

pub fn resources_section(ui: &mut egui::Ui, s: &mut Session, id: u32, navigate: &mut Option<u32>) {
    if !s.doc.has_flag(id, tflags::ROOT) || s.doc.has_flag(id, tflags::REL) {
        return;
    }
    let docs = ops::associations_of(&s.doc, id, "IFCRELASSOCIATESDOCUMENT");
    let libs = ops::associations_of(&s.doc, id, "IFCRELASSOCIATESLIBRARY");
    let apps = ops::associations_of(&s.doc, id, "IFCRELASSOCIATESAPPROVAL");
    let cons = ops::associations_of(&s.doc, id, "IFCRELASSOCIATESCONSTRAINT");
    let total = docs.len() + libs.len() + apps.len() + cons.len();
    enum Add {
        Doc(String, String, String),
        Lib(String, String, String),
        Appr(String, String, String),
        Obj(String, String, String, String),
    }
    let mut add: Option<Add> = None;
    let mut remove: Option<u32> = None;
    egui::CollapsingHeader::new(RichText::new(format!("Dokumente, Bibliotheken, Freigaben ({total})")).strong()).default_open(false).show(ui, |ui| {
        let show_list = |ui: &mut egui::Ui, title: &str, list: &[(u32, u32)], navigate: &mut Option<u32>, remove: &mut Option<u32>| {
            for (rel, res) in list {
                ui.horizontal(|ui| {
                    ui.weak(title);
                    let a = s.doc.args(*res).unwrap_or_default();
                    let txt: Vec<String> = a.iter().filter_map(|v| v.as_str().map(|x| x.to_string())).filter(|x| !x.is_empty()).take(3).collect();
                    if ui.link(format!("#{res} {}", txt.join(" · "))).clicked() {
                        *navigate = Some(*res);
                    }
                    if ui.small_button(ic::MINUS).clicked() {
                        *remove = Some(*rel);
                    }
                });
            }
        };
        show_list(ui, "Dokument", &docs, navigate, &mut remove);
        show_list(ui, "Bibliothek", &libs, navigate, &mut remove);
        show_list(ui, "Freigabe", &apps, navigate, &mut remove);
        show_list(ui, "Constraint", &cons, navigate, &mut remove);
        ui.separator();
        let k = ui.id().with(("res-forms", id));
        let (mut kind, mut f1, mut f2, mut f3, mut f4): (u8, String, String, String, String) = ui.data_mut(|d| d.get_temp(k)).unwrap_or_default();
        ui.horizontal(|ui| {
            ui.selectable_value(&mut kind, 0, "Dokument");
            ui.selectable_value(&mut kind, 1, "Bibliothek");
            ui.selectable_value(&mut kind, 2, "Freigabe");
            ui.selectable_value(&mut kind, 3, "Constraint");
        });
        let hints: [&str; 4] = match kind {
            0 | 1 => ["Ort/URI", "Kennung", "Name", ""],
            2 => ["Kennung", "Name", "Status (z. B. Freigegeben)", ""],
            _ => ["Name", "Grad (HARD/SOFT/ADVISORY)", "Qualifier (z. B. REQUIREMENT)", "Quelle"],
        };
        ui.horizontal_wrapped(|ui| {
            ui.add(egui::TextEdit::singleline(&mut f1).hint_text(hints[0]).desired_width(120.0));
            ui.add(egui::TextEdit::singleline(&mut f2).hint_text(hints[1]).desired_width(100.0));
            ui.add(egui::TextEdit::singleline(&mut f3).hint_text(hints[2]).desired_width(120.0));
            if kind == 3 {
                ui.add(egui::TextEdit::singleline(&mut f4).hint_text(hints[3]).desired_width(90.0));
            }
            if ui.button(format!("{} Hinzufügen", ic::PLUS)).clicked() {
                add = Some(match kind {
                    0 => Add::Doc(f1.clone(), f2.clone(), f3.clone()),
                    1 => Add::Lib(f1.clone(), f2.clone(), f3.clone()),
                    2 => Add::Appr(f1.clone(), f2.clone(), f3.clone()),
                    _ => Add::Obj(f1.clone(), f2.clone(), f3.clone(), f4.clone()),
                });
                f1.clear();
                f2.clear();
                f3.clear();
                f4.clear();
            }
        });
        ui.data_mut(|d| d.insert_temp(k, (kind, f1, f2, f3, f4)));
    });
    let targets: Vec<u32> = if s.selection.len() > 1 { s.selection.clone() } else { vec![id] };
    if let Some(a) = add {
        match a {
            Add::Doc(l, i, n) => {
                s.edit("Dokument zuordnen", |doc| ops::add_document_reference(doc, &targets, &l, &i, &n).map(|_| ()));
            }
            Add::Lib(l, i, n) => {
                s.edit("Bibliothek zuordnen", |doc| ops::add_library_reference(doc, &targets, &l, &i, &n).map(|_| ()));
            }
            Add::Appr(i, n, st) => {
                s.edit("Freigabe zuordnen", |doc| ops::add_approval(doc, &targets, &i, &n, &st).map(|_| ()));
            }
            Add::Obj(n, g, q, src) => {
                s.edit("Constraint zuordnen", |doc| ops::add_objective(doc, &targets, &n, &g, &q, &src, "").map(|_| ()));
            }
        }
    }
    if let Some(rel) = remove {
        s.edit("Zuordnung entfernen", |doc| ops::detach_from_relationship(doc, rel, id));
    }
}

pub fn units_section(ui: &mut egui::Ui, s: &mut Session, id: u32) {
    if !s.doc.has_flag(id, tflags::PROJECT) {
        return;
    }
    let pt = s.doc.type_name(id).unwrap_or("IFCPROJECT").to_string();
    let ui_idx = s.doc.schema().attr_index(&pt, "UnitsInContext").unwrap_or(8);
    let units: Vec<u32> = s.doc.arg(id, ui_idx).and_then(|v| v.as_ref_id()).and_then(|ua| s.doc.arg(ua, 0)).map(|v| v.ref_list()).unwrap_or_default();
    let mut add: Option<(String, Option<String>, String)> = None;
    egui::CollapsingHeader::new(RichText::new(format!("Einheiten ({})", units.len())).strong()).default_open(true).show(ui, |ui| {
        egui::Grid::new(("units", id)).striped(true).num_columns(2).show(ui, |ui| {
            for u in &units {
                let a = s.doc.args(*u).unwrap_or_default();
                let t = s.doc.type_camel(*u).unwrap_or("");
                let ut = a.get(1).map(|v| v.display()).unwrap_or_default();
                ui.label(ut);
                let desc = match s.doc.type_name(*u).unwrap_or("") {
                    "IFCSIUNIT" => format!("{} {}", a.get(2).map(|v| v.display()).unwrap_or_default(), a.get(3).map(|v| v.display()).unwrap_or_default()),
                    _ => format!("{t} {}", a.get(2).map(|v| v.display()).unwrap_or_default()),
                };
                ui.label(desc.trim().to_string());
                ui.end_row();
            }
        });
        let k = ui.id().with(("addunit", id));
        let (mut ut, mut pre, mut name): (String, String, String) = ui.data_mut(|d| d.get_temp(k)).unwrap_or_else(|| ("LENGTHUNIT".into(), String::new(), "METRE".into()));
        ui.horizontal(|ui| {
            let schema = s.doc.schema();
            egui::ComboBox::from_id_salt("ut").selected_text(&ut).width(140.0).show_ui(ui, |ui| {
                for v in schema.enum_values("IfcUnitEnum").cloned().unwrap_or_default() {
                    ui.selectable_value(&mut ut, v.clone(), v);
                }
            });
            egui::ComboBox::from_id_salt("pre").selected_text(if pre.is_empty() { "—" } else { &pre }).width(80.0).show_ui(ui, |ui| {
                ui.selectable_value(&mut pre, String::new(), "—");
                for v in schema.enum_values("IfcSIPrefix").cloned().unwrap_or_default() {
                    ui.selectable_value(&mut pre, v.clone(), v);
                }
            });
            egui::ComboBox::from_id_salt("un").selected_text(&name).width(130.0).show_ui(ui, |ui| {
                for v in schema.enum_values("IfcSIUnitName").cloned().unwrap_or_default() {
                    ui.selectable_value(&mut name, v.clone(), v);
                }
            });
            if ui.button(format!("{} SI-Einheit", ic::PLUS)).clicked() {
                add = Some((ut.clone(), if pre.is_empty() { None } else { Some(pre.clone()) }, name.clone()));
            }
        });
        ui.data_mut(|d| d.insert_temp(k, (ut, pre, name)));
    });
    if let Some((ut, pre, n)) = add {
        s.edit("SI-Einheit setzen", |doc| ops::add_si_unit(doc, &ut, pre.as_deref(), &n).map(|_| ()));
    }
}

/// Pset tools row: search, add quantity, add property with type/kind.
pub fn pset_tools(ui: &mut egui::Ui, s: &mut Session, id: u32) -> String {
    let k = ui.id().with(("psetsearch", id));
    let mut q: String = ui.data_mut(|d| d.get_temp(k)).unwrap_or_default();
    ui.horizontal(|ui| {
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut q).hint_text("Psets/Eigenschaften/Werte durchsuchen").desired_width(220.0));
    });
    ui.data_mut(|d| d.insert_temp(k, q.clone()));
    // add quantity
    let qk = ui.id().with(("addqto", id));
    let (mut qto, mut qn, mut qkind, mut qv): (String, String, String, String) = ui.data_mut(|d| d.get_temp(qk)).unwrap_or_else(|| (crate::panels::quantities::qto_name(&s.doc, id), String::new(), "LENGTH".into(), String::new()));
    let mut add_q: Option<(String, String, String, f64)> = None;
    ui.horizontal_wrapped(|ui| {
        ui.weak("Menge:");
        ui.add(egui::TextEdit::singleline(&mut qto).desired_width(150.0));
        ui.add(egui::TextEdit::singleline(&mut qn).hint_text("Name").desired_width(90.0));
        egui::ComboBox::from_id_salt(("qkind", id)).selected_text(&qkind).width(80.0).show_ui(ui, |ui| {
            for kd in ["LENGTH", "AREA", "VOLUME", "COUNT", "WEIGHT", "TIME"] {
                ui.selectable_value(&mut qkind, kd.to_string(), kd);
            }
        });
        ui.add(egui::TextEdit::singleline(&mut qv).hint_text("Wert").desired_width(60.0));
        if ui.add_enabled(!qn.trim().is_empty(), egui::Button::new(ic::PLUS)).on_hover_text("Menge anlegen (Werte in Projekteinheiten)").clicked() {
            if let Ok(v) = qv.replace(',', ".").trim().parse::<f64>() {
                add_q = Some((qto.clone(), qn.trim().to_string(), qkind.clone(), v));
                qn.clear();
                qv.clear();
            }
        }
    });
    ui.data_mut(|d| d.insert_temp(qk, (qto, qn, qkind, qv)));
    if let Some((qto, n, kind, v)) = add_q {
        s.edit("Menge anlegen", |doc| ops::set_quantity(doc, id, &qto, &n, &kind, v));
    }
    q
}

/// Row to add a typed/composite property to a pset. Returns true if something was added.
pub fn add_property_row(ui: &mut egui::Ui, s: &mut Session, pset: u32) {
    let nk = ui.id().with(("newprop2", pset));
    let (mut n, mut v, mut ty, mut kind): (String, String, String, u8) = ui.data_mut(|d| d.get_temp(nk)).unwrap_or_else(|| (String::new(), String::new(), "Automatisch".into(), 0));
    let mut add = false;
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::TextEdit::singleline(&mut n).hint_text("Neue Eigenschaft").desired_width(110.0));
        egui::ComboBox::from_id_salt(("pkind", pset)).selected_text(["Einzelwert", "Liste", "Aufzählung", "Bereich", "Tabelle"][kind as usize]).width(90.0).show_ui(ui, |ui| {
            for (i, l) in ["Einzelwert", "Liste", "Aufzählung", "Bereich", "Tabelle"].iter().enumerate() {
                ui.selectable_value(&mut kind, i as u8, *l);
            }
        });
        let hint = match kind {
            1 | 2 => "a; b; c",
            3 => "min..max; Sollwert",
            4 => "x=>y; x2=>y2",
            _ => "Wert",
        };
        ui.add(egui::TextEdit::singleline(&mut v).hint_text(hint).desired_width(100.0));
        egui::ComboBox::from_id_salt(("ptype", pset)).selected_text(&ty).width(120.0).show_ui(ui, |ui| {
            for t in ["Automatisch", "IfcLabel", "IfcText", "IfcIdentifier", "IfcBoolean", "IfcLogical", "IfcInteger", "IfcReal", "IfcLengthMeasure", "IfcPositiveLengthMeasure", "IfcAreaMeasure", "IfcVolumeMeasure", "IfcMassMeasure", "IfcRatioMeasure", "IfcPositiveRatioMeasure", "IfcPlaneAngleMeasure", "IfcThermalTransmittanceMeasure", "IfcPowerMeasure", "IfcDate", "IfcDateTime", "IfcTime", "IfcCountMeasure", "IfcMonetaryMeasure"] {
                ui.selectable_value(&mut ty, t.to_string(), t);
            }
        });
        if ui.add_enabled(!n.trim().is_empty(), egui::Button::new(ic::PLUS)).clicked() {
            add = true;
        }
    });
    if add {
        let kind_e = match kind {
            1 => ops::PropertyKindInput::List,
            2 => ops::PropertyKindInput::Enumerated,
            3 => ops::PropertyKindInput::Bounded,
            4 => ops::PropertyKindInput::Table,
            _ => ops::PropertyKindInput::Single,
        };
        let base = if ty == "Automatisch" { String::new() } else { ty.to_ascii_uppercase() };
        let (name, val) = (n.trim().to_string(), v.clone());
        s.edit("Eigenschaft hinzufügen", |doc| ops::set_property_value_kind(doc, pset, &name, kind_e, &val, &base).map(|_| ()));
        n.clear();
        v.clear();
    }
    ui.data_mut(|d| d.insert_temp(nk, (n, v, ty, kind)));
}

#[allow(dead_code)]
fn _unused(_: Value) {}
