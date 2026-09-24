//! 3D viewport panel: navigation, picking, box selection, measuring, sections.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::{SectionPlane, Session, Tool};
use crate::viewer::camera::ViewPreset;
use crate::viewer::renderer::RenderSettings;
use egui::{Align2, Color32, FontId, Pos2, Rect, Sense, Stroke, Vec2};
use glam::{Vec2 as GVec2, Vec3};

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let avail = ui.available_rect_before_wrap();
    toolbar(ui, s, app);
    let rect = ui.available_rect_before_wrap();
    let rect = if rect.height() < 50.0 { avail } else { rect };
    let resp = ui.allocate_rect(rect, Sense::click_and_drag());
    let ppp = ui.ctx().pixels_per_point();
    let w = (rect.width() * ppp).round().max(1.0) as u32;
    let h = (rect.height() * ppp).round().max(1.0) as u32;
    let size = GVec2::new(rect.width(), rect.height());

    let Some(renderer) = app.renderer.as_mut() else {
        ui.painter().text(rect.center(), Align2::CENTER_CENTER, "Kein GPU-Renderer verfügbar", FontId::proportional(16.0), Color32::GRAY);
        return;
    };

    // ---------------------------------------------------------------- input
    let settings = RenderSettings {
        background: app.settings.background(ui.visuals().dark_mode),
        selection_color: app.settings.selection_color,
        xray: s.xray,
        clip_planes: s.clip_planes(),
        hover_obj: s.hover_obj,
        edges: app.settings.show_edges,
    };
    let pointer = resp.hover_pos();
    let local = |p: Pos2| GVec2::new(p.x - rect.min.x, p.y - rect.min.y);

    if resp.hovered() {
        let scroll = ui.input(|i| i.smooth_scroll_delta.y + i.zoom_delta().ln() * 200.0);
        if scroll.abs() > 0.1 {
            let factor = (-scroll * 0.0025 * if app.settings.invert_zoom { -1.0 } else { 1.0 }).exp();
            let target = pointer.map(|p| {
                let (o, d) = s.camera.ray(local(p), size);
                // intersect with plane through camera target
                let n = -s.camera.dir();
                let denom = d.dot(n);
                if denom.abs() > 1e-6 {
                    let t = (s.camera.target - o).dot(n) / denom;
                    o + d * t.max(0.0)
                } else {
                    s.camera.target
                }
            });
            s.camera.zoom_towards(factor, target);
            s.view_dirty = true;
        }
    }
    let modifiers = ui.input(|i| i.modifiers);
    let box_mode = s.tool == Tool::BoxSelect || (modifiers.shift && resp.dragged_by(egui::PointerButton::Primary) && s.tool == Tool::Select && app.box_start.is_some()) ;
    if resp.drag_started_by(egui::PointerButton::Primary) && (s.tool == Tool::BoxSelect || modifiers.shift) {
        app.box_start = pointer;
    }
    if resp.dragged() {
        let d = resp.drag_delta();
        if app.box_start.is_some() && (s.tool == Tool::BoxSelect || modifiers.shift) {
            // box selection drag; drawn below
        } else if resp.dragged_by(egui::PointerButton::Primary) && !modifiers.ctrl {
            if let (true, Some(p)) = (app.settings.orbit_around_pick, app.orbit_pivot) {
                s.camera.orbit_around(p, d.x, d.y);
            } else {
                s.camera.orbit(d.x, d.y);
            }
            s.view_dirty = true;
        } else if resp.dragged_by(egui::PointerButton::Secondary) || resp.dragged_by(egui::PointerButton::Middle) || (resp.dragged_by(egui::PointerButton::Primary) && modifiers.ctrl) {
            s.camera.pan(d.x, d.y, rect.height());
            s.view_dirty = true;
        }
    }
    if resp.drag_started_by(egui::PointerButton::Primary) && app.settings.orbit_around_pick && app.box_start.is_none() {
        if let Some(p) = pointer {
            let lp = local(p);
            let r = renderer.pick(w, h, &s.camera, &settings, (lp.x * ppp) as u32, (lp.y * ppp) as u32);
            app.orbit_pivot = r.pos;
        }
    }
    if resp.drag_stopped() {
        app.orbit_pivot = None;
        if let (Some(a), Some(b)) = (app.box_start.take(), pointer) {
            let (la, lb) = (local(a), local(b));
            let x0 = (la.x.min(lb.x) * ppp) as u32;
            let x1 = (la.x.max(lb.x) * ppp) as u32;
            let y0 = (la.y.min(lb.y) * ppp) as u32;
            let y1 = (la.y.max(lb.y) * ppp) as u32;
            let objs = renderer.pick_rect(w, h, &s.camera, &settings, x0, y0, x1.max(x0 + 1), y1.max(y0 + 1));
            let ids: Vec<u32> = objs.into_iter().filter_map(|o| s.scene.objects.get(o as usize).map(|x| x.id)).collect();
            s.status = format!("{} Objekte per Rahmen ausgewählt", ids.len());
            s.select(ids, modifiers.ctrl);
        }
    }
    let _ = box_mode;

    // click: select / measure / section
    if resp.clicked() || resp.secondary_clicked() {
        if let Some(p) = pointer {
            let lp = local(p);
            let r = renderer.pick(w, h, &s.camera, &settings, (lp.x * ppp) as u32, (lp.y * ppp) as u32);
            if let Some(p) = r.pos {
                app.panel_state.builder_pick = Some(p.as_dvec3() + s.scene.origin);
            }
            match s.tool {
                Tool::Measure if resp.clicked() => {
                    if let Some(pos) = r.pos {
                        let pos = snap_vertex(s, r.obj, pos, &s.camera, size, app.settings.snap_px);
                        s.measure.points.push(pos);
                        if s.measure.points.len() == 2 {
                            let a = s.measure.points[0];
                            let b = s.measure.points[1];
                            s.measure.results.push((a, b));
                            s.measure.points.clear();
                            s.status = format!("Abstand: {:.3} m  (ΔX {:.3}, ΔY {:.3}, ΔZ {:.3})", a.distance(b), (b - a).x.abs(), (b - a).y.abs(), (b - a).z.abs());
                        }
                    }
                }
                Tool::Section if resp.clicked() => {
                    if let (Some(pos), Some(n)) = (r.pos, r.normal) {
                        let n = if n.dot(s.camera.dir()) < 0.0 { -n } else { n };
                        s.sections.push(SectionPlane { normal: -n, point: pos, enabled: true });
                        s.tool = Tool::Select;
                        s.status = "Schnittebene gesetzt".into();
                    }
                }
                _ => {
                    let id = r.obj.and_then(|o| s.scene.objects.get(o as usize)).map(|o| o.id);
                    if resp.secondary_clicked() {
                        if let Some(id) = id {
                            if !s.selection.contains(&id) {
                                s.select(vec![id], false);
                            }
                        }
                        app.context_menu_pos = Some(p);
                    } else {
                        match id {
                            Some(id) => s.select(vec![id], modifiers.ctrl || modifiers.command),
                            None => {
                                if !modifiers.ctrl {
                                    s.select(vec![], false)
                                }
                            }
                        }
                    }
                }
            }
            s.view_dirty = true;
        }
    }
    if resp.double_clicked() {
        s.fit_selection();
    }

    // keyboard navigation when hovered
    if resp.hovered() {
        let (fw, rt, up) = ui.input(|i| {
            let k = |key| if i.key_down(key) { 1.0 } else { 0.0 };
            (k(egui::Key::W) - k(egui::Key::S), k(egui::Key::D) - k(egui::Key::A), k(egui::Key::E) - k(egui::Key::Q))
        });
        if (fw != 0.0 || rt != 0.0 || up != 0.0) && !ui.ctx().egui_wants_keyboard_input() && !modifiers.ctrl {
            let dt = ui.input(|i| i.stable_dt).min(0.05);
            let speed = s.camera.dist.max(1.0) * 0.8 * dt;
            let f = -s.camera.dir();
            let f2 = Vec3::new(f.x, f.y, 0.0).normalize_or(Vec3::X);
            let r = f2.cross(Vec3::Z);
            s.camera.target += (f2 * fw + r * rt + Vec3::Z * up) * speed;
            s.view_dirty = true;
            ui.ctx().request_repaint();
        }
    }

    // ---------------------------------------------------------------- render
    renderer.sync(&mut s.scene);
    let aspect_changed = app.last_view_size != (w, h);
    if s.view_dirty || aspect_changed || app.force_redraw {
        renderer.render(w, h, &s.camera, &settings);
        s.view_dirty = false;
        app.force_redraw = false;
        app.last_view_size = (w, h);
    }
    if let Some(tex) = renderer.texture_id {
        ui.painter().image(tex, rect, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
    }

    // ---------------------------------------------------------------- overlays
    let painter = ui.painter_at(rect);
    let to_screen = |p: Vec3| s.camera.project(p, size).map(|q| Pos2::new(rect.min.x + q.x, rect.min.y + q.y));
    let accent = Color32::from_rgb(255, 170, 40);
    for (a, b) in &s.measure.results {
        if let (Some(pa), Some(pb)) = (to_screen(*a), to_screen(*b)) {
            painter.line_segment([pa, pb], Stroke::new(2.5, accent));
            painter.circle_filled(pa, 4.0, accent);
            painter.circle_filled(pb, 4.0, accent);
            let mid = pa + (pb - pa) * 0.5;
            let txt = format!("{:.3} m", a.distance(*b));
            let galley = painter.layout_no_wrap(txt, FontId::proportional(13.0), Color32::BLACK);
            let r = Rect::from_center_size(mid, galley.size() + Vec2::new(10.0, 4.0));
            painter.rect_filled(r, 4.0, accent);
            painter.galley(r.min + Vec2::new(5.0, 2.0), galley, Color32::BLACK);
        }
    }
    for p in &s.measure.points {
        if let Some(pp) = to_screen(*p) {
            painter.circle_stroke(pp, 6.0, Stroke::new(2.0, accent));
            if let Some(ptr) = pointer {
                painter.line_segment([pp, ptr], Stroke::new(1.0, accent));
            }
        }
    }
    if let (Some(a), Some(b)) = (app.box_start, pointer) {
        let r = Rect::from_two_pos(a, b);
        painter.rect_filled(r, 0.0, Color32::from_rgba_unmultiplied(80, 150, 255, 40));
        painter.rect_stroke(r, 0.0, Stroke::new(1.0, Color32::from_rgb(80, 150, 255)), egui::StrokeKind::Inside);
    }
    // axis gizmo
    let gc = Pos2::new(rect.min.x + 44.0, rect.max.y - 44.0);
    for (axis, col, label) in [(Vec3::X, Color32::from_rgb(230, 70, 70), "X"), (Vec3::Y, Color32::from_rgb(80, 200, 90), "Y"), (Vec3::Z, Color32::from_rgb(80, 130, 240), "Z")] {
        let v = s.camera.view().transform_vector3(axis);
        let end = gc + Vec2::new(v.x, -v.y) * 28.0;
        painter.line_segment([gc, end], Stroke::new(2.0, col));
        painter.text(end, Align2::CENTER_CENTER, label, FontId::proportional(11.0), col);
    }
    // legend
    if !s.legend.is_empty() {
        let mut y = rect.min.y + 10.0;
        let x = rect.max.x - 230.0;
        let bg = Rect::from_min_size(Pos2::new(x - 8.0, y - 6.0), Vec2::new(228.0, (s.legend.len().min(20) as f32) * 18.0 + 12.0));
        painter.rect_filled(bg, 6.0, ui.visuals().window_fill().gamma_multiply(0.92));
        for (k, c, n) in s.legend.iter().take(20) {
            painter.rect_filled(Rect::from_min_size(Pos2::new(x, y + 2.0), Vec2::new(12.0, 12.0)), 2.0, Color32::from_rgb(c[0], c[1], c[2]));
            let mut t = k.clone();
            if t.chars().count() > 26 {
                t = t.chars().take(25).collect::<String>() + "…";
            }
            painter.text(Pos2::new(x + 18.0, y), Align2::LEFT_TOP, format!("{t} ({n})"), FontId::proportional(12.0), ui.visuals().text_color());
            y += 18.0;
        }
    }
    // loading overlay
    if let Some(l) = &s.loading {
        if !l.geometry_done {
            let r = Rect::from_center_size(Pos2::new(rect.center().x, rect.max.y - 40.0), Vec2::new(360.0, 34.0));
            painter.rect_filled(r, 8.0, ui.visuals().window_fill());
            let bar = Rect::from_min_size(r.min + Vec2::new(10.0, 24.0), Vec2::new((r.width() - 20.0) * l.progress.clamp(0.0, 1.0), 4.0));
            painter.rect_filled(bar, 2.0, ui.visuals().selection.bg_fill);
            painter.text(r.min + Vec2::new(10.0, 6.0), Align2::LEFT_TOP, &l.message, FontId::proportional(12.0), ui.visuals().text_color());
        }
    }
    if s.scene.objects.is_empty() && s.loading.is_none() {
        painter.text(rect.center(), Align2::CENTER_CENTER, "Keine Geometrie – Datei öffnen (Strg+O) oder Elemente im Builder erzeugen", FontId::proportional(14.0), Color32::GRAY);
    }
    if s.tool != Tool::Select {
        let hint = match s.tool {
            Tool::Measure => "Messen: zwei Punkte anklicken (Esc beendet)",
            Tool::Section => "Schnitt: Fläche anklicken, um eine Schnittebene zu setzen",
            Tool::BoxSelect => "Rahmenauswahl: Rechteck aufziehen (Strg = hinzufügen)",
            Tool::Select => "",
        };
        painter.text(Pos2::new(rect.center().x, rect.min.y + 14.0), Align2::CENTER_TOP, hint, FontId::proportional(13.0), accent);
    }

    // context menu
    if let Some(p) = app.context_menu_pos {
        let mut close = false;
        egui::Area::new(egui::Id::new("viewer-ctx")).fixed_pos(p).order(egui::Order::Foreground).show(ui.ctx(), |ui| {
            egui::Frame::menu(ui.style()).show(ui, |ui| {
                ui.set_min_width(200.0);
                if ui.button(format!("{} Auf Auswahl zoomen", ic::FOCUS)).clicked() {
                    s.fit_selection();
                    close = true;
                }
                if ui.button(format!("{} Isolieren", ic::ISOLATE)).clicked() {
                    let sel = s.selection.clone();
                    s.isolate(&sel);
                    close = true;
                }
                if ui.button(format!("{} Ausblenden", ic::HIDE)).clicked() {
                    let sel = s.selection.clone();
                    s.hide(&sel);
                    close = true;
                }
                if ui.button(format!("{} Alles einblenden", ic::SHOW)).clicked() {
                    s.show_all();
                    close = true;
                }
                ui.separator();
                if ui.button(format!("{} Gleiche Klasse auswählen", ic::SELECT)).clicked() {
                    if let Some(&id) = s.selection.first() {
                        let ty = s.doc.type_name(id).unwrap_or("").to_string();
                        let ids: Vec<u32> = s.scene.objects.iter().map(|o| o.id).filter(|&i| s.doc.type_name(i) == Some(ty.as_str())).collect();
                        s.select(ids, false);
                    }
                    close = true;
                }
                if ui.button(format!("{} Löschen", ic::DELETE)).clicked() {
                    app.request_delete = true;
                    close = true;
                }
            });
        });
        if close || ui.input(|i| i.pointer.any_click() && !i.pointer.secondary_clicked()) && app.context_menu_frames > 1 {
            app.context_menu_pos = None;
            app.context_menu_frames = 0;
        } else {
            app.context_menu_frames += 1;
        }
    }
}

fn snap_vertex(s: &Session, obj: Option<u32>, pos: Vec3, cam: &crate::viewer::camera::Camera, size: GVec2, snap_px: f32) -> Vec3 {
    let Some(o) = obj.and_then(|o| s.scene.objects.get(o as usize)) else { return pos };
    let Some(g) = &o.geom else { return pos };
    let Some(sp) = cam.project(pos, size) else { return pos };
    let mut best = (snap_px, pos);
    for p in &g.positions {
        let v = Vec3::from(*p);
        if let Some(q) = cam.project(v, size) {
            let d = q.distance(sp);
            if d < best.0 {
                best = (d, v);
            }
        }
    }
    best.1
}

fn toolbar(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing.x = 3.0;
        let tool_btn = |ui: &mut egui::Ui, cur: &mut Tool, t: Tool, icon: &str, tip: &str| {
            if ui.selectable_label(*cur == t, icon).on_hover_text(tip).clicked() {
                *cur = if *cur == t { Tool::Select } else { t };
            }
        };
        tool_btn(ui, &mut s.tool, Tool::Select, ic::CURSOR, "Auswählen (Klick, Strg+Klick = hinzufügen)");
        tool_btn(ui, &mut s.tool, Tool::BoxSelect, ic::BOX_SELECT, "Rahmenauswahl (oder Umschalt+Ziehen)");
        tool_btn(ui, &mut s.tool, Tool::Measure, ic::RULER, "Messen (M)");
        tool_btn(ui, &mut s.tool, Tool::Section, ic::SECTION, "Schnittebene an Fläche setzen");
        ui.separator();
        if ui.button(ic::FIT).on_hover_text("Alles zeigen (F)").clicked() {
            s.fit_all();
        }
        if ui.button(ic::FOCUS).on_hover_text("Auf Auswahl zoomen (Z)").clicked() {
            s.fit_selection();
        }
        ui.menu_button(ic::CUBE, |ui| {
            for (p, n) in [(ViewPreset::Iso, "Isometrie"), (ViewPreset::Top, "Oben"), (ViewPreset::Bottom, "Unten"), (ViewPreset::Front, "Vorne"), (ViewPreset::Back, "Hinten"), (ViewPreset::Left, "Links"), (ViewPreset::Right, "Rechts")] {
                if ui.button(n).clicked() {
                    s.camera.set_preset(p);
                    s.fit_all();
                    ui.close();
                }
            }
        })
        .response
        .on_hover_text("Standardansichten");
        if ui.selectable_label(s.camera.ortho, ic::ORTHO).on_hover_text("Orthografisch / Perspektive (P)").clicked() {
            s.camera.ortho = !s.camera.ortho;
            s.view_dirty = true;
        }
        if ui.selectable_label(app.settings.show_edges, ic::EDGES).on_hover_text("Kanten anzeigen (K)").clicked() {
            app.settings.show_edges = !app.settings.show_edges;
            app.settings.save();
            s.view_dirty = true;
        }
        if ui.selectable_label(s.xray, ic::XRAY).on_hover_text("Röntgenmodus (X)").clicked() {
            s.xray = !s.xray;
            s.apply_visibility();
        }
        ui.separator();
        if ui.button(ic::ISOLATE).on_hover_text("Auswahl isolieren (I)").clicked() {
            let sel = s.selection.clone();
            s.isolate(&sel);
        }
        if ui.button(ic::HIDE).on_hover_text("Auswahl ausblenden (H)").clicked() {
            let sel = s.selection.clone();
            s.hide(&sel);
        }
        if ui.button(ic::SHOW).on_hover_text("Alles einblenden (Umschalt+H)").clicked() {
            s.show_all();
        }
        ui.separator();
        ui.menu_button(ic::PALETTE, |ui| {
            let mut changed = false;
            let modes = [(crate::session::ColorMode::Ifc, "IFC-Farben"), (crate::session::ColorMode::ByClass, "Nach Klasse"), (crate::session::ColorMode::ByStorey, "Nach Geschoss"), (crate::session::ColorMode::ByMaterial, "Nach Material")];
            for (m, n) in modes {
                if ui.selectable_label(s.color_mode == m, n).clicked() {
                    s.color_mode = m;
                    changed = true;
                }
            }
            ui.separator();
            ui.label("Nach Eigenschaft:");
            ui.horizontal(|ui| {
                ui.add(egui::TextEdit::singleline(&mut app.color_pset).hint_text("Pset").desired_width(110.0));
                ui.add(egui::TextEdit::singleline(&mut app.color_prop).hint_text("Eigenschaft").desired_width(110.0));
            });
            if ui.button("Anwenden").clicked() && !app.color_prop.is_empty() {
                s.color_mode = crate::session::ColorMode::ByProperty { pset: app.color_pset.clone(), prop: app.color_prop.clone() };
                changed = true;
            }
            if changed {
                s.recolor();
                ui.close();
            }
        })
        .response
        .on_hover_text("Einfärben");
        ui.menu_button(ic::SECTION_LIST, |ui| {
            ui.set_min_width(260.0);
            let bb = s.scene.bbox.unwrap_or((Vec3::ZERO, Vec3::ONE));
            ui.horizontal(|ui| {
                for (n, axis) in [("X", Vec3::X), ("Y", Vec3::Y), ("Z", Vec3::Z)] {
                    if ui.button(format!("+ Schnitt {n}")).clicked() {
                        s.sections.push(SectionPlane { normal: axis, point: (bb.0 + bb.1) * 0.5, enabled: true });
                        s.view_dirty = true;
                    }
                }
            });
            let mut remove = None;
            for (i, sec) in s.sections.iter_mut().enumerate() {
                ui.horizontal(|ui| {
                    ui.checkbox(&mut sec.enabled, "");
                    let axis = if sec.normal.x.abs() > 0.99 { 0 } else if sec.normal.y.abs() > 0.99 { 1 } else if sec.normal.z.abs() > 0.99 { 2 } else { 3 };
                    if axis < 3 {
                        let (lo, hi) = (bb.0[axis] - 0.01, bb.1[axis] + 0.01);
                        ui.add(egui::Slider::new(&mut sec.point[axis], lo..=hi).text(["X", "Y", "Z"][axis]));
                    } else {
                        ui.label("Freie Ebene");
                    }
                    if ui.button("⇄").on_hover_text("Richtung umkehren").clicked() {
                        sec.normal = -sec.normal;
                    }
                    if ui.button("✖").clicked() {
                        remove = Some(i);
                    }
                });
            }
            if let Some(i) = remove {
                s.sections.remove(i);
            }
            if !s.sections.is_empty() && ui.button("Alle Schnitte entfernen").clicked() {
                s.sections.clear();
            }
            s.view_dirty = true;
        })
        .response
        .on_hover_text("Schnittebenen");
        let storeys = s.doc.ids_of_type("IFCBUILDINGSTOREY");
        if !storeys.is_empty() {
            let cur = s.plan.map(|p| ifc_doc::model::label(&s.doc, p.0)).unwrap_or_else(|| "Grundriss".into());
            ui.menu_button(format!("{} {}", ic::PLAN, cur), |ui| {
                let mut sorted: Vec<(f32, u32)> = storeys.iter().map(|&st| (s.storey_elevation(st).unwrap_or(0.0), st)).collect();
                sorted.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
                for (z, st) in sorted {
                    if ui.selectable_label(s.plan.map(|p| p.0) == Some(st), format!("{}  ({:+.2} m)", ifc_doc::model::label(&s.doc, st), z + s.scene.origin.z as f32)).clicked() {
                        let cut = s.plan.map(|p| p.1).unwrap_or(1.2);
                        s.enter_plan(st, cut);
                        ui.close();
                    }
                }
                if let Some((st, mut cut)) = s.plan {
                    ui.separator();
                    if ui.add(egui::Slider::new(&mut cut, 0.1..=5.0).text("Schnitthöhe (m)")).changed() {
                        s.plan = Some((st, cut));
                        s.view_dirty = true;
                    }
                    if ui.button("Grundriss beenden").clicked() {
                        s.exit_plan();
                        ui.close();
                    }
                }
            })
            .response
            .on_hover_text("Geschoss als Grundriss (Schnitt + Draufsicht)");
        }
        if !s.measure.results.is_empty() && ui.button(ic::CLEAR).on_hover_text("Messungen löschen").clicked() {
            s.measure.results.clear();
        }
        ui.separator();
        if ui.button(ic::CAMERA).on_hover_text("Bildschirmfoto der 3D-Ansicht speichern").clicked() {
            app.request_view_screenshot = true;
        }
    });
}
