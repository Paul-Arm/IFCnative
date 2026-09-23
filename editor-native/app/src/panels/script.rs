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
        "ids" => {
            app.ctx_state.panel_state.ids_path = Some(arg.into());
            app.open_tab(Tab::Ids);
        }
        _ => {}
    }
}
