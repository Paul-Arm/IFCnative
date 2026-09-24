//! Room schedule (Raumbuch): all IfcSpaces with floor area, perimeter, height
//! and volume from the geometry; sums per storey; Excel/CSV export; write
//! Qto_SpaceBaseQuantities.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::RichText;
use egui_extras::{Column, TableBuilder};
use glam::Vec3;
use ifc_doc::{model, ops};
use rustc_hash::FxHashMap;

#[derive(Clone, Debug, Default)]
pub struct Room {
    pub id: u32,
    pub number: String,
    pub name: String,
    pub storey: String,
    pub area: f64,
    pub perimeter: f64,
    pub height: f64,
    pub volume: f64,
    /// NetFloorArea from the model's quantities (if any), m².
    pub qto_area: Option<f64>,
}

#[derive(Default)]
pub struct SpacesState {
    rows: Vec<Room>,
    key: Option<(u64, u64, usize)>,
    sort: usize,
    desc: bool,
    filter: String,
}

/// Floor area (downward faces), perimeter (boundary of the floor faces), height, volume.
pub fn measure_room(s: &Session, id: u32) -> Option<(f64, f64, f64, f64)> {
    let g = s.scene.obj(id)?.geom.clone()?;
    let mut vol = 0.0f64;
    let mut area = 0.0f64;
    let mut edges: FxHashMap<((i64, i64, i64), (i64, i64, i64)), (u32, f64)> = FxHashMap::default();
    let q = |p: glam::DVec3| ((p.x * 1e4).round() as i64, (p.y * 1e4).round() as i64, (p.z * 1e4).round() as i64);
    for t in g.indices.chunks_exact(3) {
        let a = Vec3::from(g.positions[t[0] as usize]).as_dvec3();
        let b = Vec3::from(g.positions[t[1] as usize]).as_dvec3();
        let c = Vec3::from(g.positions[t[2] as usize]).as_dvec3();
        vol += a.dot(b.cross(c));
        let n = (b - a).cross(c - a);
        let len = n.length();
        if len > 1e-12 && n.z / len < -0.7 {
            area += -n.z * 0.5;
            for (p, r) in [(a, b), (b, c), (c, a)] {
                let (kp, kr) = (q(p), q(r));
                let k = if kp < kr { (kp, kr) } else { (kr, kp) };
                let e = edges.entry(k).or_insert((0, p.distance(r)));
                e.0 += 1;
            }
        }
    }
    let perimeter: f64 = edges.values().filter(|(n, _)| *n == 1).map(|(_, l)| *l).sum();
    let height = (g.max[2] - g.min[2]) as f64;
    Some((area, perimeter, height, (vol / 6.0).abs()))
}

fn build(s: &Session) -> Vec<Room> {
    let doc = &s.doc;
    let unit = model::length_unit(doc).0;
    let mut out = Vec::new();
    for id in doc.ids_of_kind("IFCSPACE") {
        let (area, perimeter, height, volume) = measure_room(s, id).unwrap_or_default();
        let qto_area = model::psets_of(doc, id).into_iter().filter(|p| p.is_quantity).flat_map(|p| p.props).find(|p| p.name == "NetFloorArea").and_then(|p| p.value.as_f64()).map(|v| v * unit * unit);
        out.push(Room {
            id,
            number: doc.name_of(id).unwrap_or_default(),
            name: doc.attr_str(id, "LongName").unwrap_or_default(),
            storey: s.tree.storey_of(doc, id).map(|st| model::label(doc, st)).unwrap_or_default(),
            area,
            perimeter,
            height,
            volume,
            qto_area,
        });
    }
    out
}

const HEADERS: [&str; 8] = ["Nummer", "Bezeichnung", "Geschoss", "Fläche m²", "Umfang m", "Höhe m", "Volumen m³", "Fläche (Modell) m²"];

fn cell(r: &Room, c: usize) -> String {
    match c {
        0 => r.number.clone(),
        1 => r.name.clone(),
        2 => r.storey.clone(),
        3 => format!("{:.2}", r.area),
        4 => format!("{:.2}", r.perimeter),
        5 => format!("{:.2}", r.height),
        6 => format!("{:.2}", r.volume),
        _ => r.qto_area.map(|v| format!("{v:.2}")).unwrap_or_default(),
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.spaces;
    let key = (s.uid, s.doc.revision(), s.scene.objects.len());
    if st.key != Some(key) {
        st.rows = build(s);
        st.key = Some(key);
    }
    let mut export: Option<u8> = None;
    let mut write_qto = false;
    let mut select: Option<Vec<u32>> = None;
    ui.horizontal_wrapped(|ui| {
        ui.label(RichText::new(format!("{} Räume", st.rows.len())).strong());
        ui.label(ic::SEARCH);
        ui.add(egui::TextEdit::singleline(&mut st.filter).hint_text("Nummer, Name, Geschoss").desired_width(150.0));
        ui.separator();
        if ui.add_enabled(!st.rows.is_empty(), egui::Button::new(format!("{} Excel …", ic::EXPORT))).clicked() {
            export = Some(2);
        }
        if ui.add_enabled(!st.rows.is_empty(), egui::Button::new("CSV …")).clicked() {
            export = Some(1);
        }
        if ui.add_enabled(!st.rows.is_empty(), egui::Button::new(format!("{} Zwischenablage", ic::COPY))).clicked() {
            export = Some(0);
        }
        ui.separator();
        if ui.add_enabled(!st.rows.is_empty(), egui::Button::new(format!("{} Mengen schreiben", ic::EDIT))).on_hover_text("NetFloorArea, GrossFloorArea, NetPerimeter, Height, NetVolume, GrossVolume in Qto_SpaceBaseQuantities").clicked() {
            write_qto = true;
        }
        if ui.add_enabled(!st.rows.is_empty(), egui::Button::new(format!("{} Alle auswählen", ic::SELECT))).clicked() {
            select = Some(st.rows.iter().map(|r| r.id).collect());
        }
        if ui.add_enabled(!st.rows.is_empty(), egui::Button::new(format!("{} Nach Fläche einfärben", ic::PALETTE))).on_hover_text("Räume im 3D nach Flächenklassen färben (Räume werden eingeblendet)").clicked() {
            const BINS: [(f64, &str, [u8; 4]); 5] = [(10.0, "< 10 m²", [120, 190, 240, 170]), (20.0, "10–20 m²", [110, 200, 140, 170]), (50.0, "20–50 m²", [240, 200, 90, 170]), (100.0, "50–100 m²", [240, 140, 70, 170]), (f64::MAX, "≥ 100 m²", [220, 80, 70, 170])];
            let mut map: rustc_hash::FxHashMap<u32, String> = rustc_hash::FxHashMap::default();
            for r in &st.rows {
                let b = BINS.iter().find(|b| r.area < b.0).unwrap_or(&BINS[4]);
                map.insert(r.id, b.1.to_string());
            }
            let ids: Vec<u32> = st.rows.iter().map(|r| r.id).collect();
            s.color_mode = crate::session::ColorMode::Custom { title: "Raumfläche".into(), map: std::sync::Arc::new(map), colors: BINS.iter().map(|b| (b.1.to_string(), b.2)).collect(), other: None };
            s.class_hidden.remove("IFCSPACE");
            for id in &ids {
                s.hidden.remove(id);
            }
            s.recolor();
            s.apply_visibility();
        }
    });
    if st.rows.is_empty() {
        ui.weak("Das Modell enthält keine Räume (IfcSpace).");
        return;
    }
    let filter = st.filter.to_lowercase();
    let mut rows: Vec<&Room> = st.rows.iter().filter(|r| filter.is_empty() || r.number.to_lowercase().contains(&filter) || r.name.to_lowercase().contains(&filter) || r.storey.to_lowercase().contains(&filter)).collect();
    let sc = st.sort;
    rows.sort_by(|a, b| {
        let o = match sc {
            3 => a.area.partial_cmp(&b.area).unwrap_or(std::cmp::Ordering::Equal),
            4 => a.perimeter.partial_cmp(&b.perimeter).unwrap_or(std::cmp::Ordering::Equal),
            5 => a.height.partial_cmp(&b.height).unwrap_or(std::cmp::Ordering::Equal),
            6 => a.volume.partial_cmp(&b.volume).unwrap_or(std::cmp::Ordering::Equal),
            7 => a.qto_area.unwrap_or(-1.0).partial_cmp(&b.qto_area.unwrap_or(-1.0)).unwrap_or(std::cmp::Ordering::Equal),
            c => crate::panels::table::natural_cmp(&cell(a, c), &cell(b, c)),
        };
        o.then_with(|| crate::panels::table::natural_cmp(&a.number, &b.number))
    });
    if st.desc {
        rows.reverse();
    }
    // sums per storey
    let mut sums: Vec<(String, usize, f64, f64)> = Vec::new();
    for r in &rows {
        match sums.iter_mut().find(|x| x.0 == r.storey) {
            Some(x) => {
                x.1 += 1;
                x.2 += r.area;
                x.3 += r.volume;
            }
            None => sums.push((r.storey.clone(), 1, r.area, r.volume)),
        }
    }
    sums.sort_by(|a, b| crate::panels::table::natural_cmp(&a.0, &b.0));
    let total_area: f64 = rows.iter().map(|r| r.area).sum();
    let total_vol: f64 = rows.iter().map(|r| r.volume).sum();
    ui.horizontal_wrapped(|ui| {
        ui.label(RichText::new(format!("Summe: {total_area:.2} m² · {total_vol:.2} m³")).strong());
        for (name, n, a, _) in &sums {
            ui.weak(format!("· {}: {n} Räume, {a:.2} m²", if name.is_empty() { "(ohne Geschoss)" } else { name }));
        }
    });
    let mut sort_click: Option<usize> = None;
    let sel: rustc_hash::FxHashSet<u32> = s.selection.iter().copied().collect();
    TableBuilder::new(ui)
        .striped(true)
        .resizable(true)
        .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
        .column(Column::initial(80.0).clip(true))
        .column(Column::initial(160.0).clip(true))
        .column(Column::initial(120.0).clip(true))
        .columns(Column::initial(80.0), 5)
        .header(20.0, |mut h| {
            for (i, t) in HEADERS.iter().enumerate() {
                h.col(|ui| {
                    let arrow = if sc == i { if st.desc { " ▼" } else { " ▲" } } else { "" };
                    if ui.button(RichText::new(format!("{t}{arrow}")).strong()).clicked() {
                        sort_click = Some(i);
                    }
                });
            }
        })
        .body(|body| {
            body.rows(20.0, rows.len(), |mut row| {
                let r = rows[row.index()];
                row.set_selected(sel.contains(&r.id));
                for c in 0..HEADERS.len() {
                    row.col(|ui| {
                        let t = cell(r, c);
                        if c == 0 {
                            if ui.link(if t.is_empty() { format!("#{}", r.id) } else { t }).clicked() {
                                select = Some(vec![r.id]);
                            }
                        } else if c >= 3 {
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                // model quantity deviating > 5 % from geometry is highlighted
                                if c == 7 {
                                    if let Some(q) = r.qto_area {
                                        if r.area > 0.0 && ((q - r.area) / r.area).abs() > 0.05 {
                                            ui.colored_label(egui::Color32::from_rgb(230, 180, 80), t).on_hover_text("weicht mehr als 5 % von der Geometrie ab");
                                            return;
                                        }
                                    }
                                }
                                ui.label(t);
                            });
                        } else {
                            ui.label(t);
                        }
                    });
                }
            });
        });
    if let Some(c) = sort_click {
        if st.sort == c {
            st.desc = !st.desc;
        } else {
            st.sort = c;
            st.desc = false;
        }
    }
    if let Some(kind) = export {
        let headers: Vec<String> = HEADERS.iter().map(|h| h.to_string()).collect();
        let data: Vec<Vec<String>> = rows.iter().map(|r| (0..HEADERS.len()).map(|c| cell(r, c)).collect()).collect();
        match kind {
            0 => {
                ui.ctx().copy_text(ifc_doc::import::to_delimited(&headers, &data, '\t'));
                app.toast(format!("{} Räume kopiert", data.len()));
            }
            _ => {
                let ext = if kind == 2 { "xlsx" } else { "csv" };
                if let Some(p) = rfd::FileDialog::new().add_filter(ext, &[ext]).set_file_name(format!("Raumbuch.{ext}")).save_file() {
                    let res = if kind == 2 { ifc_doc::import::write_xlsx_rows("Raumbuch", &headers, &data, &p) } else { ifc_doc::import::write_csv_rows(&headers, &data, &p) };
                    match res {
                        Ok(()) => app.toast(format!("Raumbuch mit {} Räumen exportiert", data.len())),
                        Err(e) => app.error(e.to_string()),
                    }
                }
            }
        }
    }
    if write_qto {
        let unit = model::length_unit(&s.doc).0;
        let rooms: Vec<Room> = app.panel_state.spaces.rows.clone();
        let (a2, a3) = (unit * unit, unit * unit * unit);
        if s
            .edit("Raummengen schreiben", |doc| {
                for r in rooms.iter().filter(|r| r.area > 0.0) {
                    let q = "Qto_SpaceBaseQuantities";
                    ops::set_quantity(doc, r.id, q, "NetFloorArea", "AREA", r.area / a2)?;
                    ops::set_quantity(doc, r.id, q, "GrossFloorArea", "AREA", r.area / a2)?;
                    ops::set_quantity(doc, r.id, q, "NetPerimeter", "LENGTH", r.perimeter / unit)?;
                    ops::set_quantity(doc, r.id, q, "Height", "LENGTH", r.height / unit)?;
                    ops::set_quantity(doc, r.id, q, "NetVolume", "VOLUME", r.volume / a3)?;
                    ops::set_quantity(doc, r.id, q, "GrossVolume", "VOLUME", r.volume / a3)?;
                }
                Ok(())
            })
            .is_some()
        {
            app.toast("Raummengen geschrieben (Qto_SpaceBaseQuantities)");
        }
    }
    if let Some(ids) = select {
        s.select(ids, false);
    }
}
