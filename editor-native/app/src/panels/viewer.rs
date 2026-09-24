//! 3D viewport panel: navigation, picking, box selection, measuring, sections.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::{SectionPlane, Session, Tool};
use crate::viewer::camera::ViewPreset;
use crate::viewer::renderer::RenderSettings;
use egui::{Align2, Color32, FontId, Pos2, Rect, Sense, Stroke, Vec2};
use glam::{Vec2 as GVec2, Vec3};

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx, others: &mut [(usize, &mut Session)]) {
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
        grid: app.settings.show_grid && !s.scene.objects.is_empty(),
        grid_fade: s.camera.dist * 4.0 + 50.0,
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
    let gizmo_active = matches!(s.tool, Tool::Move | Tool::Rotate) && !s.selection.is_empty();
    let gizmo_center = if gizmo_active { s.scene.bbox_of(s.selection.clone()).map(|(lo, hi)| (lo + hi) * 0.5) } else { None };
    let gizmo_hit = |p: Pos2, s: &Session| -> Option<u8> {
        let c = gizmo_center?;
        let cs = s.camera.project(c, size)?;
        let cs = Pos2::new(rect.min.x + cs.x, rect.min.y + cs.y);
        if s.tool == Tool::Rotate {
            let d = (p - cs).length();
            return if (d - 70.0).abs() < 12.0 { Some(3) } else { None };
        }
        let scale = s.camera.dist * 0.12;
        for (k, axis) in [Vec3::X, Vec3::Y, Vec3::Z].iter().enumerate() {
            if let Some(e) = s.camera.project(c + *axis * scale, size) {
                let e = Pos2::new(rect.min.x + e.x, rect.min.y + e.y);
                // distance point-segment
                let ab = e - cs;
                let t = ((p - cs).dot(ab) / ab.length_sq().max(1.0)).clamp(0.0, 1.0);
                if (cs + ab * t - p).length() < 9.0 {
                    return Some(k as u8);
                }
            }
        }
        None
    };
    if gizmo_active && resp.drag_started_by(egui::PointerButton::Primary) {
        if let Some(p) = pointer {
            if let Some(axis) = gizmo_hit(p, s) {
                s.gizmo_drag = Some((axis, Vec3::ZERO, 0.0));
            }
        }
    }
    if let (Some((axis, mut delta, mut rot)), true) = (s.gizmo_drag, resp.dragged()) {
        let d = resp.drag_delta();
        if let Some(c) = gizmo_center {
            if axis == 3 {
                if let (Some(p), Some(cs)) = (pointer, s.camera.project(c, size)) {
                    let cs = Pos2::new(rect.min.x + cs.x, rect.min.y + cs.y);
                    let a0 = (p - d - cs).angle();
                    let a1 = (p - cs).angle();
                    rot -= (a1 - a0).to_degrees();
                }
            } else {
                let mut dir = Vec3::ZERO;
                dir[axis as usize] = 1.0;
                let scale = s.camera.dist * 0.12;
                if let (Some(a), Some(b)) = (s.camera.project(c, size), s.camera.project(c + dir * scale, size)) {
                    let sd = b - a;
                    let len2 = sd.length_squared().max(1.0);
                    let t = (d.x * sd.x + d.y * sd.y) / len2;
                    delta += dir * t * scale;
                }
            }
        }
        s.gizmo_drag = Some((axis, delta, rot));
        s.view_dirty = true;
    }
    if resp.drag_stopped() {
        if let Some((_, delta, rot)) = s.gizmo_drag.take() {
            let unit = ifc_doc::model::length_unit(&s.doc).0;
            let sel = s.selection.clone();
            let snap = |v: f32| if app.settings.snap_px > 0.0 { (v * 100.0).round() / 100.0 } else { v };
            let d = glam::DVec3::new(snap(delta.x) as f64, snap(delta.y) as f64, snap(delta.z) as f64) / unit;
            let r = (rot as f64 * 2.0).round() / 2.0;
            if d.length() > 0.0 || r.abs() > 0.0 {
                s.edit(if r.abs() > 0.0 { "Drehen" } else { "Verschieben" }, |doc| crate::panels::builder::transform_products(doc, &sel, d, r));
            }
        }
    }
    if resp.drag_started_by(egui::PointerButton::Primary) && (s.tool == Tool::BoxSelect || modifiers.shift) {
        app.box_start = pointer;
    }
    if resp.dragged() {
        let d = resp.drag_delta();
        if app.box_start.is_some() && (s.tool == Tool::BoxSelect || modifiers.shift) {
            // box selection drag; drawn below
        } else if s.gizmo_drag.is_some() {
            // gizmo handles the drag
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
                        let pos = snap_vertex(s, r.obj.filter(|_| r.layer == 0), pos, &s.camera, size, app.settings.snap_px);
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
                Tool::PickCoords if resp.clicked() => {
                    if let Some(pos) = r.pos {
                        s.picked_coord = Some(pos);
                        let w = pos.as_dvec3() + s.scene.origin;
                        let json = format!("{{\"x\": {:.4}, \"y\": {:.4}, \"z\": {:.4}}}", w.x, w.y, w.z);
                        ui.ctx().copy_text(json);
                        s.status = format!("Koordinate kopiert: X {:.4}  Y {:.4}  Z {:.4} m", w.x, w.y, w.z);
                        app.panel_state.builder_pick = Some(w);
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
                _ if r.layer > 0 && resp.clicked() => {
                    // object of another (federated) model: activate that model
                    if let Some((si, o)) = others.get(r.layer as usize - 1) {
                        if let Some(id) = r.obj.and_then(|x| o.scene.objects.get(x as usize)).map(|x| x.id) {
                            app.actions.push(crate::app::Action::FocusFederated(*si, id));
                        }
                    }
                }
                _ => {
                    let id = if r.layer == 0 { r.obj.and_then(|o| s.scene.objects.get(o as usize)).map(|o| o.id) } else { None };
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
    renderer.begin_layers();
    let mut layers_changed = renderer.sync_layer(s.uid, 0, &mut s.scene, Vec3::ZERO, false);
    if app.federated {
        for (k, (_, o)) in others.iter_mut().enumerate().take(250) {
            if o.scene.objects.is_empty() || app.federated_excluded.contains(&o.uid) {
                continue;
            }
            let off = (o.scene.origin - s.scene.origin).as_vec3();
            layers_changed |= renderer.sync_layer(o.uid, (k + 1) as u8, &mut o.scene, off, app.federated_dim);
        }
    }
    layers_changed |= renderer.end_layers();
    if layers_changed {
        s.view_dirty = true;
    }
    if settings.grid {
        if let Some((lo, hi)) = s.scene.robust_visible_bbox() {
            let z = s.doc.ids_of_type("IFCBUILDINGSTOREY").into_iter().filter_map(|st| s.storey_elevation(st)).fold(f32::MAX, f32::min);
            let z = if z == f32::MAX || z < lo.z - 1.0 || z > hi.z { lo.z } else { z };
            renderer.set_grid(lo.truncate(), hi.truncate(), z - 0.002, ui.visuals().dark_mode);
        }
    }
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
    // move/rotate gizmo
    if let Some(c) = gizmo_center {
        let (drag_axis, delta, rot) = s.gizmo_drag.map(|g| (Some(g.0), g.1, g.2)).unwrap_or((None, Vec3::ZERO, 0.0));
        let c2 = c + delta;
        if let Some(cs) = to_screen(c2) {
            if s.tool == Tool::Rotate {
                let col = if drag_axis == Some(3) { accent } else { Color32::from_rgb(80, 130, 240) };
                painter.circle_stroke(cs, 70.0, Stroke::new(3.0, col));
                if rot != 0.0 {
                    painter.text(cs + Vec2::new(0.0, -86.0), Align2::CENTER_CENTER, format!("{rot:+.1}°"), FontId::proportional(14.0), accent);
                }
            } else {
                let scale = s.camera.dist * 0.12;
                for (k, (axis, col)) in [(Vec3::X, Color32::from_rgb(230, 70, 70)), (Vec3::Y, Color32::from_rgb(80, 200, 90)), (Vec3::Z, Color32::from_rgb(80, 130, 240))].iter().enumerate() {
                    if let Some(e) = to_screen(c2 + *axis * scale) {
                        let col = if drag_axis == Some(k as u8) { accent } else { *col };
                        painter.arrow(cs, e - cs, Stroke::new(3.0, col));
                    }
                }
                if delta != Vec3::ZERO {
                    painter.text(cs + Vec2::new(12.0, -18.0), Align2::LEFT_BOTTOM, format!("Δ {:.2} / {:.2} / {:.2} m", delta.x, delta.y, delta.z), FontId::proportional(13.0), accent);
                }
            }
            // ghost bbox of the moved selection
            if let Some((lo, hi)) = s.scene.bbox_of(s.selection.clone()) {
                draw_box(&painter, lo + delta, hi + delta, &to_screen, Stroke::new(1.0, accent));
            }
        }
    }
    if app.settings.show_selection_box && s.gizmo_drag.is_none() && !s.selection.is_empty() {
        if let Some((lo, hi)) = s.scene.bbox_of(s.selection.clone()) {
            draw_box(&painter, lo, hi, &to_screen, Stroke::new(1.5, accent));
        }
    }
    if let (Some(p), Tool::PickCoords) = (s.picked_coord, s.tool) {
        if let Some(ps) = to_screen(p) {
            let w = p.as_dvec3() + s.scene.origin;
            for (axis, col) in [(Vec3::X, Color32::from_rgb(230, 70, 70)), (Vec3::Y, Color32::from_rgb(80, 200, 90)), (Vec3::Z, Color32::from_rgb(80, 130, 240))] {
                if let Some(e) = to_screen(p + axis * s.camera.dist * 0.05) {
                    painter.line_segment([ps, e], Stroke::new(2.0, col));
                }
            }
            let txt = format!("X {:.3}\nY {:.3}\nZ {:.3}", w.x, w.y, w.z);
            let galley = painter.layout_no_wrap(txt, FontId::monospace(12.0), ui.visuals().text_color());
            let r = Rect::from_min_size(ps + Vec2::new(10.0, 10.0), galley.size() + Vec2::new(10.0, 6.0));
            painter.rect_filled(r, 4.0, ui.visuals().window_fill().gamma_multiply(0.95));
            painter.galley(r.min + Vec2::new(5.0, 3.0), galley, ui.visuals().text_color());
        }
    }
    // view cube (clickable)
    view_cube(ui, &painter, rect, s);
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
            Tool::PickCoords => "Koordinaten: Punkt anklicken (wird als JSON kopiert)",
            Tool::Move => "Verschieben: Achspfeil ziehen (G)",
            Tool::Rotate => "Drehen: Ring ziehen (R)",
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
        tool_btn(ui, &mut s.tool, Tool::PickCoords, ic::ph::MAP_PIN, "Koordinaten picken (kopiert JSON)");
        tool_btn(ui, &mut s.tool, Tool::Move, ic::MOVE, "Verschieben-Gizmo (G)");
        tool_btn(ui, &mut s.tool, Tool::Rotate, ic::ph::ARROWS_CLOCKWISE, "Drehen-Gizmo um Z (R)");
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
        if app.open_docs.len() > 1 {
            let n_on = app.open_docs.iter().filter(|(u, _)| *u != s.uid && !app.federated_excluded.contains(u)).count();
            let label = if app.federated { format!("{} {}", ic::LAYERS, n_on + 1) } else { ic::LAYERS.to_string() };
            let r = ui.add(egui::Button::selectable(app.federated, label)).on_hover_text("Föderierte Ansicht: alle geöffneten Modelle gemeinsam anzeigen (Rechtsklick: Modelle wählen)");
            if r.clicked() {
                app.federated = !app.federated;
                s.view_dirty = true;
            }
            r.context_menu(|ui| {
                ui.label(egui::RichText::new("Föderierte Ansicht").strong());
                if ui.checkbox(&mut app.federated, "Alle geöffneten Modelle zeigen").changed() {
                    s.view_dirty = true;
                }
                if ui.checkbox(&mut app.federated_dim, "Andere Modelle abgeblendet").changed() {
                    s.view_dirty = true;
                }
                ui.separator();
                for (uid, title) in app.open_docs.clone() {
                    if uid == s.uid {
                        ui.label(format!("● {title} (aktiv)"));
                        continue;
                    }
                    let mut on = !app.federated_excluded.contains(&uid);
                    if ui.checkbox(&mut on, &title).changed() {
                        if on {
                            app.federated_excluded.remove(&uid);
                        } else {
                            app.federated_excluded.insert(uid);
                        }
                        s.view_dirty = true;
                    }
                }
                ui.weak("Klick auf ein Objekt eines anderen Modells aktiviert dieses Modell.");
            });
        }
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

fn draw_box(painter: &egui::Painter, lo: Vec3, hi: Vec3, to_screen: &dyn Fn(Vec3) -> Option<Pos2>, stroke: Stroke) {
    let c = [
        Vec3::new(lo.x, lo.y, lo.z),
        Vec3::new(hi.x, lo.y, lo.z),
        Vec3::new(hi.x, hi.y, lo.z),
        Vec3::new(lo.x, hi.y, lo.z),
        Vec3::new(lo.x, lo.y, hi.z),
        Vec3::new(hi.x, lo.y, hi.z),
        Vec3::new(hi.x, hi.y, hi.z),
        Vec3::new(lo.x, hi.y, hi.z),
    ];
    for (a, b) in [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)] {
        if let (Some(p), Some(q)) = (to_screen(c[a]), to_screen(c[b])) {
            painter.line_segment([p, q], stroke);
        }
    }
}

/// Small clickable view cube in the top right corner.
fn view_cube(ui: &mut egui::Ui, painter: &egui::Painter, rect: Rect, s: &mut Session) {
    let center = Pos2::new(rect.max.x - 60.0, rect.min.y + 60.0);
    let size = 26.0;
    let view = s.camera.view();
    let proj = |v: Vec3| -> (Pos2, f32) {
        let r = view.transform_vector3(v);
        (center + Vec2::new(r.x, -r.y) * size, r.z)
    };
    use crate::viewer::camera::ViewPreset as V;
    let faces: [(Vec3, Vec3, Vec3, &str, V); 6] = [
        (Vec3::Z, Vec3::X, Vec3::Y, "Oben", V::Top),
        (-Vec3::Z, Vec3::X, -Vec3::Y, "Unten", V::Bottom),
        (-Vec3::Y, Vec3::X, Vec3::Z, "Vorne", V::Front),
        (Vec3::Y, -Vec3::X, Vec3::Z, "Hinten", V::Back),
        (Vec3::X, Vec3::Y, Vec3::Z, "Rechts", V::Right),
        (-Vec3::X, -Vec3::Y, Vec3::Z, "Links", V::Left),
    ];
    let mut drawn: Vec<(f32, Vec<Pos2>, &str, V)> = Vec::new();
    for (n, u, v, label, preset) in faces {
        let (_, depth) = proj(n);
        let pts: Vec<Pos2> = [n - u - v, n + u - v, n + u + v, n - u + v].iter().map(|p| proj(*p * 0.5).0).collect();
        drawn.push((depth, pts, label, preset));
    }
    drawn.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let pointer = ui.input(|i| i.pointer.hover_pos());
    let clicked = ui.input(|i| i.pointer.primary_clicked());
    let mut hit: Option<V> = None;
    for (depth, pts, label, preset) in &drawn {
        if *depth < 0.0 {
            continue; // back faces
        }
        let inside = pointer.map(|p| point_in_poly(p, pts)).unwrap_or(false);
        let fill = if inside { Color32::from_rgba_unmultiplied(255, 170, 40, 200) } else { ui.visuals().widgets.inactive.bg_fill.gamma_multiply(0.9) };
        painter.add(egui::Shape::convex_polygon(pts.clone(), fill, Stroke::new(1.0, ui.visuals().widgets.inactive.fg_stroke.color.gamma_multiply(0.6))));
        let c = pts.iter().fold(Vec2::ZERO, |a, p| a + p.to_vec2()) / pts.len() as f32;
        if *depth > 0.35 {
            painter.text(c.to_pos2(), Align2::CENTER_CENTER, *label, FontId::proportional(9.5), ui.visuals().text_color());
        }
        if inside && clicked {
            hit = Some(*preset);
        }
    }
    if let Some(p) = hit {
        s.camera.set_preset(p);
        s.fit_all();
    }
}

fn point_in_poly(p: Pos2, poly: &[Pos2]) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if ((a.y > p.y) != (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y + 1e-9) + a.x) {
            inside = !inside;
        }
        j = i;
    }
    inside
}
