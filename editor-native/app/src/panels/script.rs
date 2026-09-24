//! Tiny command interface used for automation/testing (`--do <cmd>`).

use crate::app::{IfcApp, Tab};

pub fn run(cmd: &str, app: &mut IfcApp, _ctx: &egui::Context) {
    let mut parts = cmd.splitn(2, ' ');
    let verb = parts.next().unwrap_or("");
    let arg = parts.next().unwrap_or("").trim().to_string();
    match verb {
        "select-class" => {
            if let Some(s) = app.session() {
                let t = arg.to_ascii_uppercase();
                let ids: Vec<u32> = s.scene.objects.iter().map(|o| o.id).filter(|&i| s.doc.type_name(i) == Some(t.as_str())).collect();
                s.select(ids, false);
            }
        }
        "isolate-selection" => {
            if let Some(s) = app.session() {
                let sel = s.selection.clone();
                s.isolate(&sel);
                s.fit_selection();
            }
        }
        "section-z" => {
            if let Some(s) = app.session() {
                if let Some((lo, hi)) = s.scene.bbox {
                    let f: f32 = arg.parse().unwrap_or(0.5);
                    let z = lo.z + (hi.z - lo.z) * f;
                    s.sections.push(crate::session::SectionPlane { normal: glam::Vec3::Z, point: glam::Vec3::new(0.0, 0.0, z), enabled: true });
                    s.view_dirty = true;
                }
            }
        }
        "view" => {
            if let Some(s) = app.session() {
                use crate::viewer::camera::ViewPreset as V;
                let p = match arg.as_str() {
                    "top" => V::Top,
                    "front" => V::Front,
                    "right" => V::Right,
                    _ => V::Iso,
                };
                s.camera.set_preset(p);
                s.fit_all();
            }
        }
        "tab" => {
            if let Some(tab) = Tab::ALL.iter().find(|x| format!("{x:?}").eq_ignore_ascii_case(&arg)) {
                app.open_tab(*tab);
            }
        }
        "select-id" => {
            if let Some(s) = app.session() {
                let ids: Vec<u32> = arg.split_whitespace().filter_map(|x| x.trim_start_matches('#').parse().ok()).collect();
                s.select(ids, false);
            }
        }
        "set-prop" => {
            if let Some(s) = app.session() {
                let p: Vec<&str> = arg.splitn(3, ' ').collect();
                if p.len() == 3 {
                    let sel = s.selection.clone();
                    let (ps, pr, v) = (p[0].to_string(), p[1].to_string(), p[2].to_string());
                    s.edit("Skript: Eigenschaft", |doc| {
                        for id in &sel {
                            ifc_doc::ops::set_property(doc, *id, &ps, &pr, ifc_doc::ops::typed_value_from_text(&v, None), true)?;
                        }
                        Ok(())
                    });
                }
            }
        }
        "move" => {
            if let Some(s) = app.session() {
                let v: Vec<f64> = arg.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                if v.len() == 3 {
                    let unit = ifc_doc::model::length_unit(&s.doc).0;
                    let sel = s.selection.clone();
                    let d = glam::DVec3::new(v[0], v[1], v[2]) / unit;
                    s.edit("Skript: Verschieben", |doc| crate::panels::builder::transform_products(doc, &sel, d, 0.0));
                }
            }
        }
        "quantities" => {
            if let Some(s) = app.session() {
                let sel = s.selection.clone();
                crate::panels::quantities::write_quantities(s, &sel);
            }
        }
        "create-wall" => {
            if let Some(s) = app.session() {
                let st = s.doc.ids_of_type("IFCBUILDINGSTOREY").into_iter().next();
                let unit = ifc_doc::model::length_unit(&s.doc).0;
                let spec = ifc_doc::ops::NewElement { class_upper: "IFCWALL".into(), name: "Skriptwand".into(), container: st, location: [0.0, 0.0, 0.0], rotation_deg: 0.0, shape: Some(ifc_doc::ops::BodyShape::Box { x: 4.0 / unit, y: 0.3 / unit, z: 2.5 / unit, centered: false }), predefined_type: None };
                if let Some(id) = s.edit("Skript: Wand", |doc| ifc_doc::ops::create_element(doc, &spec)) {
                    s.select(vec![id], false);
                }
            }
        }
        "delete-selection" => {
            if let Some(s) = app.session() {
                let sel = s.selection.clone();
                s.edit("Skript: Löschen", |doc| ifc_doc::ops::delete_entities(doc, &sel, true).map(|_| ()));
            }
        }
        "undo" => {
            if let Some(s) = app.session() {
                if let Some(doc) = s.doc_mut() {
                    doc.undo();
                }
                s.after_edit();
            }
        }
        "save" => {
            if let Some(s) = app.session() {
                if let Some(doc) = s.doc_mut() {
                    if let Err(e) = doc.save_as(std::path::Path::new(&arg)) {
                        eprintln!("save failed: {e}");
                    }
                }
            }
        }
        "palette" => {
            app.open_palette(&arg);
        }
        "combine" => {
            if let Some(s) = app.session() {
                let sel = s.selection.clone();
                if let Some(n) = s.edit("Kombinieren", |doc| crate::panels::builder::combine(doc, &sel, false)) {
                    s.select(vec![n], false);
                }
            }
        }
        "split-z" => {
            if let Some(s) = app.session() {
                let sel = s.selection.clone();
                let unit = ifc_doc::model::length_unit(&s.doc).0;
                if let Some((lo, hi)) = s.scene.bbox_of(sel.clone()) {
                    let c = ((lo + hi) * 0.5).as_dvec3() + s.scene.origin;
                    if let Some(parts) = s.edit("Zerteilen", |doc| crate::panels::builder::split(doc, &sel, c / unit, glam::DVec3::Z)) {
                        s.select(parts, false);
                    }
                }
            }
        }
        "print-status" => {
            if let Some(s) = app.session() {
                println!("STATUS: {} | objects={} tris={} sel={:?} dirty={}", s.status, s.scene.objects.len(), s.scene.total_tris, s.selection, s.doc.is_dirty());
            }
        }
        "ids" => {
            app.ctx_state.panel_state.ids_path = Some(arg.into());
            app.open_tab(Tab::Ids);
        }
        _ => {}
    }
}
