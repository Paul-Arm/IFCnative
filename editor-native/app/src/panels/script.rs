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
        "import" => {
            // import <table file>: open the import dialog with a CSV/XLSX file
            app.ctx_state.panel_state.import.load_file(arg.clone().into());
        }
        "import-apply" => {
            if let Some(s) = app.sessions.get_mut(app.active) {
                crate::panels::import::apply_now(s, &mut app.ctx_state);
            }
        }
        "plan" => {
            // plan [cut height]: floor plan of the first storey
            if let Some(s) = app.session() {
                let cut: f32 = arg.parse().unwrap_or(1.2);
                if let Some(st) = s.doc.ids_of_type("IFCBUILDINGSTOREY").first().copied() {
                    s.enter_plan(st, cut);
                }
            }
        }
        "cut-export" => {
            if let Some(s) = app.session() {
                if let Some(cut) = crate::viewer::cut_export::current_cut(s) {
                    let res = crate::viewer::cut_export::compute(s, &cut, if s.plan.is_some() { 3.0 } else { 0.0 });
                    let p = std::path::Path::new(&arg);
                    let r = if arg.ends_with(".dxf") { crate::viewer::cut_export::write_dxf(&res, p) } else { crate::viewer::cut_export::write_svg(&res, p) };
                    eprintln!("cut-export: {} objects, {} projection lines, {:?}", res.objects.len(), res.projection.len(), r.err());
                } else {
                    eprintln!("cut-export: no cut");
                }
            }
        }
        "merge-from" => {
            // merge-from <session index>
            if let Ok(i) = arg.parse::<usize>() {
                app.ctx_state.actions.push(crate::app::Action::MergeFrom(i));
                app.process_actions(_ctx);
            }
        }
        "diag" => {
            // run the model check on the next frame of the Prüfung tab
            app.ctx_state.panel_state.diag.ran_rev = Some((u64::MAX, 0));
            app.ctx_state.panel_state.diag.millis = 0.0;
            app.open_tab(Tab::Diagnostics);
        }
        "measure-demo" => {
            // draws an area, a chain and an angle on the scene bounding box (for screenshots)
            if let Some(s) = app.session() {
                if let Some((lo, hi)) = s.scene.robust_visible_bbox() {
                    use crate::session::{MeasureMode as M, MeasureShape};
                    let z = lo.z;
                    let a = glam::Vec3::new(lo.x, lo.y, z);
                    let b = glam::Vec3::new(hi.x, lo.y, z);
                    let c = glam::Vec3::new(hi.x, hi.y, z);
                    let d = glam::Vec3::new(lo.x, hi.y, z);
                    s.measure.shapes.push(MeasureShape { mode: M::Area, pts: vec![a, b, c, d] });
                    s.measure.shapes.push(MeasureShape { mode: M::Chain, pts: vec![a, glam::Vec3::new(lo.x, lo.y, hi.z), glam::Vec3::new(hi.x, lo.y, hi.z)] });
                    s.measure.shapes.push(MeasureShape { mode: M::Angle, pts: vec![b, c, glam::Vec3::new(hi.x, hi.y, hi.z)] });
                    s.tool = crate::session::Tool::Measure;
                    s.measure.mode = M::Area;
                    s.view_dirty = true;
                }
            }
        }
        "din276-auto" => {
            // assign all DIN 276 suggestions
            if let Some(s) = app.session() {
                let items: Vec<(u32, String)> = s.doc.ids_with_flag(ifc_doc::tflags::ELEMENT).into_iter().filter_map(|id| ifc_doc::din276::suggest(&s.doc, id).map(|c| (id, c.to_string()))).collect();
                s.edit("DIN 276 zuordnen", |doc| ifc_doc::din276::assign(doc, &items));
            }
        }
        "view-save" => {
            if let Some(s) = app.sessions.get(app.active) {
                let v = s.capture_view(&arg);
                let key = s.path.as_ref().map(|p| p.display().to_string()).unwrap_or_default();
                app.ctx_state.settings.views.entry(key).or_default().push(v);
            }
        }
        "view-restore" => {
            if let Some(s) = app.sessions.get_mut(app.active) {
                let key = s.path.as_ref().map(|p| p.display().to_string()).unwrap_or_default();
                if let Some(v) = app.ctx_state.settings.views.get(&key).and_then(|l| l.iter().find(|v| v.name == arg)).cloned() {
                    s.restore_view(&v);
                }
            }
        }
        "show-all" => {
            if let Some(s) = app.session() {
                s.show_all();
                s.sections.clear();
                s.camera = Default::default();
                s.fit_all();
            }
        }
        "section-box" => {
            if let Some(s) = app.session() {
                s.section_box_selection(0.2);
            }
        }
        "rename-pattern" => {
            // rename-pattern <pattern>: rename the selection (Name)
            if let Some(s) = app.session() {
                let ids = s.paint_targets();
                let order = crate::panels::rename::ordered(s, &ids, true, 1);
                let items: Vec<(u32, String)> = order.iter().map(|&(id, st, nr)| (id, crate::panels::rename::expand(s, id, &arg, st, nr))).collect();
                crate::panels::rename::apply(s, &items, 0, "", true);
            }
        }
        "report" => {
            if let Some(s) = app.sessions.get(app.active) {
                let img = app.ctx_state.renderer.as_ref().and_then(|r| r.read_color());
                let html = crate::report::build(s, &app.ctx_state, img);
                let _ = std::fs::write(&arg, html);
            }
        }
        "federate" => {
            app.ctx_state.federated = arg != "off";
            app.ctx_state.federated_dim = arg == "dim";
            if let Some(s) = app.session() {
                s.view_dirty = true;
            }
        }
        "mat-select" => {
            app.ctx_state.panel_state.materials.selected = arg.trim_start_matches('#').parse().ok();
        }
        "paint" => {
            // paint <r> <g> <b> [transparency]: colour the selection (0..1)
            let v: Vec<f64> = arg.split_whitespace().filter_map(|x| x.parse().ok()).collect();
            if let Some(s) = app.session() {
                let sel = s.paint_targets();
                let c = if v.len() >= 3 { Some(([v[0], v[1], v[2]], v.get(3).copied().unwrap_or(0.0))) } else { None };
                s.edit("Objekte einfärben", |doc| ifc_doc::material::set_object_color(doc, &sel, c));
            }
        }
        "mat-color" => {
            // mat-color <id> <r> <g> <b>
            let v: Vec<f64> = arg.split_whitespace().filter_map(|x| x.trim_start_matches('#').parse().ok()).collect();
            if v.len() >= 4 {
                if let Some(s) = app.session() {
                    s.edit("Materialfarbe", |doc| ifc_doc::material::set_material_color(doc, v[0] as u32, Some(([v[1], v[2], v[3]], 0.0))));
                }
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
        "tool" => {
            if let Some(s) = app.session() {
                s.tool = match arg.as_str() {
                    "move" => crate::session::Tool::Move,
                    "rotate" => crate::session::Tool::Rotate,
                    "measure" => crate::session::Tool::Measure,
                    "coords" => crate::session::Tool::PickCoords,
                    _ => crate::session::Tool::Select,
                };
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
