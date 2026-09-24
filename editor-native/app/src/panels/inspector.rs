//! Entity inspector: attributes, property sets, quantities, type, materials,
//! classifications, relationships, raw STEP – all editable.

use crate::app::{Action, AppCtx};
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::model::{self, PropKind};
use ifc_doc::{ops, tflags, Value};

/// Single line editor that commits on Enter/focus loss. Returns the new text when changed.
pub fn edit_field(ui: &mut egui::Ui, key: egui::Id, current: &str, width: f32) -> Option<String> {
    let mut buf: String = ui.data_mut(|d| d.get_temp::<String>(key)).unwrap_or_else(|| current.to_string());
    let resp = ui.add(egui::TextEdit::singleline(&mut buf).desired_width(width));
    let mut out = None;
    if resp.has_focus() {
        ui.data_mut(|d| d.insert_temp(key, buf.clone()));
    }
    if resp.lost_focus() {
        if buf != current {
            out = Some(buf.clone());
        }
        ui.data_mut(|d| d.remove::<String>(key));
    }
    out
}

fn link(ui: &mut egui::Ui, s: &Session, id: u32) -> bool {
    let label = if s.doc.exists(id) { format!("#{id} {}", short_label(s, id)) } else { format!("#{id} (fehlt)") };
    ui.link(RichText::new(label).color(Color32::from_rgb(110, 170, 255))).clicked()
}

fn short_label(s: &Session, id: u32) -> String {
    let class = s.doc.type_camel(id).unwrap_or("?").to_string();
    match s.doc.name_of(id) {
        Some(n) if !n.is_empty() => format!("{class} „{n}“"),
        _ => class,
    }
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let Some(&id) = s.selection.first() else {
        ui.add_space(20.0);
        ui.vertical_centered(|ui| {
            ui.weak("Nichts ausgewählt.");
            ui.weak("Element in der 3D-Ansicht oder Struktur anklicken.");
        });
        project_summary(ui, s);
        georef_section(ui, s, app);
        return;
    };
    if !s.doc.exists(id) {
        ui.weak(format!("#{id} existiert nicht mehr."));
        return;
    }
    let mut navigate: Option<u32> = None;
    // header
    ui.horizontal(|ui| {
        if ui.add_enabled(!s.nav_back.is_empty(), egui::Button::new(ic::ph::ARROW_LEFT).small()).on_hover_text("Zurück (Alt+←)").clicked() {
            if let Some(prev) = s.nav_back.pop() {
                s.nav_fwd.push(id);
                s.selection = vec![prev];
                s.apply_visibility();
                return;
            }
        }
        if ui.add_enabled(!s.nav_fwd.is_empty(), egui::Button::new(ic::ph::ARROW_RIGHT).small()).on_hover_text("Vor (Alt+→)").clicked() {
            if let Some(next) = s.nav_fwd.pop() {
                s.nav_back.push(id);
                s.selection = vec![next];
                s.apply_visibility();
                return;
            }
        }
        let ty = s.doc.type_name(id).unwrap_or("").to_string();
        ui.label(RichText::new(ic::for_class(&ty)).size(18.0));
        ui.label(RichText::new(s.doc.type_camel(id).unwrap_or("?")).strong().size(15.0));
        ui.weak(format!("#{id}"));
    });
    if s.selection.len() > 1 {
        ui.colored_label(Color32::from_rgb(255, 170, 40), format!("{} Objekte ausgewählt – angezeigt wird das zuerst gewählte. Mehrfachbearbeitung im Tab „Pset-Stapel“.", s.selection.len()));
        if ui.small_button(format!("{} Pset-Stapel öffnen", ic::TAG)).clicked() {
            app.actions.push(Action::OpenTab(crate::app::Tab::Batch));
        }
    }
    if let Some(g) = s.doc.guid_of(id) {
        ui.horizontal(|ui| {
            ui.weak("GlobalId");
            ui.monospace(&g);
            if ui.small_button(ic::COPY).on_hover_text("Kopieren").clicked() {
                ui.ctx().copy_text(g.clone());
                app.toast("GlobalId kopiert");
            }
            if !ifc_doc::guid::is_valid(&g) {
                ui.colored_label(Color32::from_rgb(240, 90, 80), "ungültig");
            }
        });
    }
    ui.separator();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        attributes(ui, s, id, &mut navigate);
        crate::panels::inspector_ext::units_section(ui, s, id);
        crate::panels::inspector_ext::placement_section(ui, s, id);
        if s.doc.has_flag(id, tflags::ROOT) && !s.doc.has_flag(id, tflags::REL) {
            psets(ui, s, app, id, &mut navigate);
        }
        if s.doc.has_flag(id, tflags::PRODUCT) || s.doc.has_flag(id, tflags::TYPE_OBJECT) {
            type_and_material(ui, s, app, id, &mut navigate);
        }
        relations(ui, s, app, id, &mut navigate);
        crate::panels::inspector_ext::relationships_section(ui, s, app, id, &mut navigate);
        crate::panels::inspector_ext::resources_section(ui, s, id, &mut navigate);
        raw_step(ui, s, app, id);
    });
    if let Some(n) = navigate {
        s.nav_back.push(id);
        s.nav_fwd.clear();
        s.selection = vec![n];
        s.scroll_tree_to = Some(n);
        s.apply_visibility();
    }
}

fn project_summary(ui: &mut egui::Ui, s: &Session) {
    ui.add_space(16.0);
    ui.separator();
    ui.label(RichText::new("Datei").strong());
    let h = &s.doc.header;
    egui::Grid::new("hdr").num_columns(2).striped(true).show(ui, |ui| {
        for (k, v) in [
            ("Schema", h.schema.join(", ")),
            ("Name", h.name.clone()),
            ("Zeitstempel", h.time_stamp.clone()),
            ("Autor", h.author.join(", ")),
            ("Organisation", h.organization.join(", ")),
            ("Anwendung", h.originating_system.clone()),
            ("Präprozessor", h.preprocessor.clone()),
            ("Beschreibung", h.description.join("; ")),
        ] {
            ui.weak(k);
            ui.label(v);
            ui.end_row();
        }
        let (u, l) = model::length_unit(&s.doc);
        ui.weak("Längeneinheit");
        ui.label(format!("{l} (×{u})"));
        ui.end_row();
        if let Some(st) = &s.doc.load_stats {
            ui.weak("Parsen");
            ui.label(format!("{:.0} ms für {:.1} MB", st.total_ms, st.bytes as f64 / 1e6));
            ui.end_row();
        }
    });
}

/// Georeferencing (IfcMapConversion/IfcProjectedCRS) view and editor.
fn georef_section(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    use ifc_doc::georef::{self, Georef};
    ui.add_space(8.0);
    let current = georef::read(&s.doc);
    let key = ui.id().with(("georef-edit", s.uid, s.doc.revision()));
    let mut edit: Option<Georef> = ui.data_mut(|d| d.get_temp::<Option<Georef>>(key)).flatten();
    let mut apply: Option<Georef> = None;
    egui::CollapsingHeader::new(RichText::new(format!("{} Georeferenzierung", ic::ph::GLOBE_HEMISPHERE_WEST)).strong()).id_salt("georef").default_open(true).show(ui, |ui| {
        if let Some((lat, lon, elev)) = georef::site_reference(&s.doc) {
            ui.horizontal(|ui| {
                ui.weak("Grundstück");
                ui.label(format!("{lat:.6}° N, {lon:.6}° E{}", elev.map(|e| format!(", {e:.2}")).unwrap_or_default()));
                if ui.small_button(ic::COPY).on_hover_text("Koordinaten kopieren").clicked() {
                    ui.ctx().copy_text(format!("{lat:.7}, {lon:.7}"));
                }
            });
        }
        let ifc2x3 = s.doc.schema_id == ifc_doc::SchemaId::Ifc2x3;
        match (&current, &mut edit) {
            (None, None) => {
                ui.weak(if ifc2x3 { "IFC2x3: keine IfcMapConversion (nur Breite/Länge am Grundstück)." } else { "Keine Kartenprojektion (IfcMapConversion) hinterlegt." });
                if !ifc2x3 && ui.button(format!("{} Georeferenzierung anlegen", ic::PLUS)).clicked() {
                    edit = Some(Georef::new_default(&s.doc));
                }
            }
            (_, e) => {
                let mut g = e.clone().unwrap_or_else(|| current.clone().unwrap_or_default());
                let before = g.clone();
                egui::Grid::new("georef-grid").num_columns(2).spacing([10.0, 4.0]).show(ui, |ui| {
                    let mut num = |ui: &mut egui::Ui, label: &str, v: &mut f64, dec: usize, tip: &str| {
                        ui.weak(label).on_hover_text(tip);
                        ui.add(egui::DragValue::new(v).speed(0.01).max_decimals(dec).min_decimals(dec.min(3)));
                        ui.end_row();
                    };
                    num(ui, "Rechtswert (E)", &mut g.eastings, 4, "Eastings des Projektursprungs");
                    num(ui, "Hochwert (N)", &mut g.northings, 4, "Northings des Projektursprungs");
                    num(ui, "Höhe", &mut g.height, 4, "OrthogonalHeight");
                    let mut rot = g.rotation_deg();
                    ui.weak("Drehung °").on_hover_text("Winkel der lokalen x-Achse gegen Gitter-Ost (gegen den Uhrzeigersinn)");
                    if ui.add(egui::DragValue::new(&mut rot).speed(0.05).max_decimals(6)).changed() {
                        g.set_rotation_deg(rot);
                    }
                    ui.end_row();
                    num(ui, "Maßstab", &mut g.scale, 6, "Projekt-Einheit → Karteneinheit (z. B. 0.001 bei mm → m)");
                    for (label, v) in [("CRS", &mut g.crs_name), ("Beschreibung", &mut g.crs_description), ("Geod. Datum", &mut g.geodetic_datum), ("Höhenbezug", &mut g.vertical_datum), ("Projektion", &mut g.projection), ("Zone", &mut g.zone)] {
                        ui.weak(label);
                        ui.add(egui::TextEdit::singleline(v).desired_width(200.0));
                        ui.end_row();
                    }
                });
                if g != before || e.is_some() {
                    *e = Some(g.clone());
                }
                if e.is_some() {
                    ui.horizontal(|ui| {
                        if ui.button(RichText::new(format!("{} Übernehmen", ic::CHECK)).strong()).clicked() {
                            apply = Some(g.clone());
                        }
                        if ui.button("Verwerfen").clicked() {
                            *e = None;
                        }
                    });
                }
                if let Some(c) = &current {
                    let o = c.to_map([0.0; 3], model::length_unit(&s.doc).0);
                    ui.weak(format!("Projektursprung → E {:.3}  N {:.3}  H {:.3}", o[0], o[1], o[2]));
                }
            }
        }
    });
    if let Some(g) = apply {
        if s.edit("Georeferenzierung", |doc| georef::write(doc, &g)).is_some() {
            app.toast("Georeferenzierung gespeichert");
        }
        edit = None;
    }
    ui.data_mut(|d| d.insert_temp(key, edit));
}

fn attributes(ui: &mut egui::Ui, s: &mut Session, id: u32, navigate: &mut Option<u32>) {
    let ty = s.doc.type_name(id).unwrap_or("").to_string();
    let schema = s.doc.schema();
    let defs = schema.entity(&ty).map(|e| e.attrs.clone()).unwrap_or_default();
    let args = s.doc.args(id).unwrap_or_default();
    let mut edit: Option<(usize, Value)> = None;
    egui::CollapsingHeader::new(RichText::new("Attribute").strong()).default_open(true).show(ui, |ui| {
        egui::Grid::new(("attrs", id)).num_columns(2).striped(true).min_col_width(90.0).show(ui, |ui| {
            for (i, v) in args.iter().enumerate() {
                let def = defs.get(i);
                let name = def.map(|d| d.name.clone()).unwrap_or_else(|| format!("Arg {i}"));
                ui.label(RichText::new(&name).weak()).on_hover_text(def.map(|d| format!("{}{}", d.ty, if d.optional { " (optional)" } else { "" })).unwrap_or_default());
                let key = ui.id().with(("attr", id, i, s.doc.revision()));
                match v {
                    Value::Ref(r) => {
                        ui.horizontal(|ui| {
                            if link(ui, s, *r) {
                                *navigate = Some(*r);
                            }
                        });
                    }
                    Value::List(l) if l.iter().any(|x| matches!(x, Value::Ref(_))) => {
                        ui.vertical(|ui| {
                            for x in l.iter().take(30) {
                                if let Value::Ref(r) = x {
                                    if link(ui, s, *r) {
                                        *navigate = Some(*r);
                                    }
                                }
                            }
                            if l.len() > 30 {
                                ui.weak(format!("… {} weitere", l.len() - 30));
                            }
                        });
                    }
                    Value::Derived => {
                        ui.weak("* (abgeleitet)");
                    }
                    _ => {
                        let ty_name = def.map(|d| d.ty.clone()).unwrap_or_default();
                        if let Some(values) = schema.enum_values(&ty_name).cloned() {
                            let cur = v.as_enum().unwrap_or("").to_string();
                            let mut sel = cur.clone();
                            egui::ComboBox::from_id_salt(key).selected_text(if cur.is_empty() { "—".to_string() } else { cur.clone() }).show_ui(ui, |ui| {
                                if def.map(|d| d.optional).unwrap_or(true) {
                                    ui.selectable_value(&mut sel, String::new(), "— (leer)");
                                }
                                for e in &values {
                                    ui.selectable_value(&mut sel, e.clone(), e);
                                }
                            });
                            if sel != cur {
                                edit = Some((i, if sel.is_empty() { Value::Null } else { Value::Enum(sel) }));
                            }
                        } else {
                            let prim = schema.primitive_of(&ty_name).unwrap_or("").to_string();
                            if prim == "boolean" || prim == "logical" || matches!(v, Value::Enum(e) if e == "T" || e == "F" || e == "U") {
                                let cur = v.as_enum().unwrap_or("").to_string();
                                let mut sel = cur.clone();
                                egui::ComboBox::from_id_salt(key).selected_text(v.display()).show_ui(ui, |ui| {
                                    ui.selectable_value(&mut sel, String::new(), "— (leer)");
                                    ui.selectable_value(&mut sel, "T".to_string(), "TRUE");
                                    ui.selectable_value(&mut sel, "F".to_string(), "FALSE");
                                    if prim == "logical" {
                                        ui.selectable_value(&mut sel, "U".to_string(), "UNKNOWN");
                                    }
                                });
                                if sel != cur {
                                    edit = Some((i, if sel.is_empty() { Value::Null } else { Value::Enum(sel) }));
                                }
                            } else {
                                let cur = v.display();
                                if let Some(t) = edit_field(ui, key, &cur, f32::INFINITY) {
                                    let nv = if t.trim().is_empty() && def.map(|d| d.optional).unwrap_or(true) {
                                        Value::Null
                                    } else {
                                        match (&prim[..], v) {
                                            ("number", _) | (_, Value::Real(_)) => t.replace(',', ".").trim().parse::<f64>().map(Value::Real).unwrap_or(Value::Str(t)),
                                            (_, Value::Int(_)) => t.trim().parse::<i64>().map(Value::Int).unwrap_or(Value::Str(t)),
                                            (_, Value::Typed(tn, _)) => ops::typed_value(tn, &t, &s.doc),
                                            _ => Value::Str(t),
                                        }
                                    };
                                    edit = Some((i, nv));
                                }
                            }
                        }
                    }
                }
                ui.end_row();
            }
        });
    });
    if let Some((i, v)) = edit {
        let name = defs.get(i).map(|d| d.name.clone()).unwrap_or_default();
        s.edit(&format!("{name} ändern"), |doc| doc.set_arg(id, i, v));
    }
}

fn value_editor(ui: &mut egui::Ui, key: egui::Id, v: &Value) -> Option<Value> {
    // booleans as checkbox-like combo
    if let Value::Typed(t, inner) = v {
        if let Value::Enum(e) = inner.as_ref() {
            if t == "IFCBOOLEAN" || t == "IFCLOGICAL" {
                let mut sel = e.clone();
                egui::ComboBox::from_id_salt(key).selected_text(v.display()).width(110.0).show_ui(ui, |ui| {
                    ui.selectable_value(&mut sel, "T".to_string(), "TRUE");
                    ui.selectable_value(&mut sel, "F".to_string(), "FALSE");
                    if t == "IFCLOGICAL" {
                        ui.selectable_value(&mut sel, "U".to_string(), "UNKNOWN");
                    }
                });
                if &sel != e {
                    return Some(Value::Typed(t.clone(), Box::new(Value::Enum(sel))));
                }
                return None;
            }
        }
    }
    let cur = v.display();
    edit_field(ui, key, &cur, f32::INFINITY).map(|t| ops::typed_value_from_text(&t, if v.is_null() { None } else { Some(v) }))
}

fn psets(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx, id: u32, navigate: &mut Option<u32>) {
    let all_sets = model::psets_of(&s.doc, id);
    let split = app.settings.split_shared_psets;
    enum Op {
        SetValue(u32, u32, String, Value, bool),
        Remove(u32, u32),
        DeletePset(u32),
        RenamePset(u32, String),
        AddProp(u32, String, String),
        AddPset(String),
        RenameProp(u32, String),
        SetQuantity(u32, usize, f64),
    }
    let mut op: Option<Op> = None;
    let header = format!("Eigenschaften ({})", all_sets.iter().filter(|p| !p.is_quantity).count());
    let mut sets = all_sets.clone();
    let mut dup: Option<(u32, String)> = None;
    let mut composite: Option<(u32, String, ops::PropertyKindInput, String, String)> = None;
    egui::CollapsingHeader::new(RichText::new(header).strong()).default_open(true).show(ui, |ui| {
        let q = crate::panels::inspector_ext::pset_tools(ui, s, id).to_lowercase();
        if !q.is_empty() {
            sets = all_sets
                .iter()
                .cloned()
                .filter_map(|mut ps| {
                    if ps.name.to_lowercase().contains(&q) {
                        return Some(ps);
                    }
                    ps.props.retain(|p| p.name.to_lowercase().contains(&q) || p.value.display().to_lowercase().contains(&q));
                    if ps.props.is_empty() {
                        None
                    } else {
                        Some(ps)
                    }
                })
                .collect();
        }
        for ps in sets.iter().filter(|p| !p.is_quantity) {
            let mut title = RichText::new(format!("{}  ({})", ps.name, ps.props.len()));
            if ps.from_type.is_some() {
                title = title.italics();
            }
            egui::CollapsingHeader::new(title).id_salt(("ps", ps.id)).default_open(true).show(ui, |ui| {
                ui.horizontal(|ui| {
                    if let Some(t) = ps.from_type {
                        ui.weak("vom Typ");
                        if link(ui, s, t) {
                            *navigate = Some(t);
                        }
                    } else if ps.shared_count > 1 {
                        ui.weak(format!("geteilt mit {} Objekten", ps.shared_count)).on_hover_text(if split { "Änderungen erzeugen eine eigene Kopie für dieses Objekt (Einstellung)" } else { "Änderungen wirken auf alle Objekte" });
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ps.from_type.is_none() {
                            if ui.small_button(ic::DELETE).on_hover_text("Pset löschen").clicked() {
                                op = Some(Op::DeletePset(ps.id));
                            }
                            if ui.small_button(ic::COPY).on_hover_text("Pset duplizieren").clicked() {
                                dup = Some((ps.id, format!("{} (Kopie)", ps.name)));
                            }
                            let rk = ui.id().with(("rename-pset", ps.id));
                            let mut renaming = ui.data_mut(|d| d.get_temp::<bool>(rk)).unwrap_or(false);
                            if ui.small_button(ic::EDIT).on_hover_text("Umbenennen").clicked() {
                                renaming = !renaming;
                                ui.data_mut(|d| d.insert_temp(rk, renaming));
                            }
                            if renaming {
                                if let Some(n) = edit_field(ui, rk.with("f"), &ps.name, 140.0) {
                                    op = Some(Op::RenamePset(ps.id, n));
                                    ui.data_mut(|d| d.insert_temp(rk, false));
                                }
                            }
                        }
                    });
                });
                egui::Grid::new(("props", ps.id)).num_columns(3).striped(true).min_col_width(60.0).show(ui, |ui| {
                    for p in &ps.props {
                        let pk = ui.id().with(("pn", p.id));
                        let name_resp = ui.label(&p.name);
                        name_resp.context_menu(|ui| {
                            ui.label("Eigenschaft umbenennen:");
                            if let Some(n) = edit_field(ui, pk, &p.name, 180.0) {
                                op = Some(Op::RenameProp(p.id, n));
                                ui.close();
                            }
                        });
                        let key = ui.id().with(("pv", p.id, s.doc.revision()));
                        match p.kind {
                            PropKind::Single if ps.from_type.is_none() => {
                                if let Some(v) = value_editor(ui, key, &p.value) {
                                    op = Some(Op::SetValue(id, ps.id, p.name.clone(), v, ps.shared_count > 1 && split));
                                }
                            }
                            PropKind::List | PropKind::Enumerated | PropKind::Bounded | PropKind::Table if ps.from_type.is_none() => {
                                let (kind, text) = composite_text(p);
                                let base = first_type(&p.value);
                                if let Some(t) = edit_field(ui, key, &text, f32::INFINITY) {
                                    composite = Some((ps.id, p.name.clone(), kind, t, base));
                                }
                            }
                            _ => {
                                ui.label(p.value.display());
                            }
                        }
                        if ps.from_type.is_none() {
                            if ui.small_button(ic::MINUS).on_hover_text("Eigenschaft entfernen").clicked() {
                                op = Some(Op::Remove(ps.id, p.id));
                            }
                        } else {
                            ui.label("");
                        }
                        ui.end_row();
                    }
                });
                if ps.from_type.is_none() {
                    crate::panels::inspector_ext::add_property_row(ui, s, ps.id);
                }
            });
        }
        let ak = ui.id().with(("newpset", id));
        let mut name: String = ui.data_mut(|d| d.get_temp(ak)).unwrap_or_default();
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut name).hint_text("Neues Pset, z. B. Pset_WallCommon").desired_width(200.0));
            if ui.add_enabled(!name.trim().is_empty(), egui::Button::new(format!("{} Pset", ic::PLUS))).clicked() {
                op = Some(Op::AddPset(name.trim().to_string()));
                name.clear();
            }
        });
        ui.data_mut(|d| d.insert_temp(ak, name));
    });
    let qsets: Vec<_> = sets.iter().filter(|p| p.is_quantity).collect();
    if !qsets.is_empty() {
        egui::CollapsingHeader::new(RichText::new(format!("Mengen ({})", qsets.len())).strong()).default_open(true).show(ui, |ui| {
            for q in qsets {
                egui::CollapsingHeader::new(&q.name).id_salt(("qs", q.id)).default_open(true).show(ui, |ui| {
                    egui::Grid::new(("qprops", q.id)).num_columns(3).striped(true).show(ui, |ui| {
                        for p in &q.props {
                            ui.label(&p.name);
                            let key = ui.id().with(("qv", p.id, s.doc.revision()));
                            if let Some(t) = edit_field(ui, key, &p.value.display(), 120.0) {
                                if let Ok(v) = t.replace(',', ".").trim().parse::<f64>() {
                                    let ty = s.doc.type_name(p.id).unwrap_or("").to_string();
                                    let vi = s.doc.schema().attr_names(&ty).iter().position(|n| n.ends_with("Value")).unwrap_or(3);
                                    op = Some(Op::SetQuantity(p.id, vi, v));
                                }
                            }
                            ui.weak(p.unit.map(|u| format!("#{u}")).unwrap_or_else(|| quantity_unit(&s.doc, p.id)));
                            ui.end_row();
                        }
                    });
                });
            }
        });
    }
    if let Some((ps, n)) = dup {
        let objs: Vec<u32> = vec![id];
        s.edit("Pset duplizieren", |doc| ops::duplicate_pset(doc, ps, &objs, &n).map(|_| ()));
    }
    if let Some((ps, name, kind, text, base)) = composite {
        s.edit(&format!("{name} setzen"), |doc| ops::set_property_value_kind(doc, ps, &name, kind, &text, &base).map(|_| ()));
    }
    if let Some(op) = op {
        match op {
            Op::SetValue(el, ps, name, v, split_now) => {
                s.edit(&format!("{name} setzen"), |doc| {
                    if split_now {
                        let pset_name = doc.arg(ps, 2).and_then(|v| v.as_str().map(|x| x.to_string())).unwrap_or_default();
                        ops::set_property(doc, el, &pset_name, &name, v, true)
                    } else {
                        ops::set_property_in_pset(doc, ps, &name, v)
                    }
                });
            }
            Op::Remove(ps, p) => {
                s.edit("Eigenschaft entfernen", |doc| ops::remove_property(doc, ps, p));
            }
            Op::DeletePset(ps) => {
                s.edit("Pset löschen", |doc| ops::delete_pset(doc, ps));
            }
            Op::RenamePset(ps, n) => {
                s.edit("Pset umbenennen", |doc| ops::rename_pset(doc, ps, &n));
            }
            Op::AddProp(ps, n, v) => {
                s.edit("Eigenschaft hinzufügen", |doc| ops::set_property_in_pset(doc, ps, &n, ops::typed_value_from_text(&v, None)));
            }
            Op::AddPset(n) => {
                s.edit("Pset hinzufügen", |doc| {
                    ops::create_pset(doc, &[id], &n, false);
                    Ok(())
                });
            }
            Op::RenameProp(p, n) => {
                s.edit("Eigenschaft umbenennen", |doc| ops::rename_property(doc, p, &n));
            }
            Op::SetQuantity(q, vi, v) => {
                s.edit("Menge ändern", |doc| doc.set_arg(q, vi, Value::Real(v)));
            }
        }
    }
}

/// Editable text form of a composite property value.
fn composite_text(p: &model::PropView) -> (ops::PropertyKindInput, String) {
    let items = |v: &Value| -> Vec<String> { v.as_list().map(|l| l.iter().map(|x| x.display()).collect()).unwrap_or_default() };
    match p.kind {
        PropKind::List => (ops::PropertyKindInput::List, items(&p.value).join("; ")),
        PropKind::Enumerated => (ops::PropertyKindInput::Enumerated, items(&p.value).join("; ")),
        PropKind::Bounded => {
            let l = p.value.as_list().map(|l| l.to_vec()).unwrap_or_default();
            let lo = l.first().map(|v| v.display()).unwrap_or_default();
            let hi = l.get(1).map(|v| v.display()).unwrap_or_default();
            (ops::PropertyKindInput::Bounded, format!("{lo}..{hi}"))
        }
        _ => {
            let l = p.value.as_list().map(|l| l.to_vec()).unwrap_or_default();
            let a = l.first().map(items).unwrap_or_default();
            let b = l.get(1).map(items).unwrap_or_default();
            (ops::PropertyKindInput::Table, a.iter().zip(b.iter()).map(|(x, y)| format!("{x}=>{y}")).collect::<Vec<_>>().join("; "))
        }
    }
}

fn first_type(v: &Value) -> String {
    match v {
        Value::Typed(t, _) => t.clone(),
        Value::List(l) => l.iter().map(first_type).find(|t| !t.is_empty()).unwrap_or_default(),
        _ => String::new(),
    }
}

fn quantity_unit(doc: &ifc_doc::Document, q: u32) -> String {
    let t = doc.type_name(q).unwrap_or("");
    let ut = match t {
        "IFCQUANTITYLENGTH" => "LENGTHUNIT",
        "IFCQUANTITYAREA" => "AREAUNIT",
        "IFCQUANTITYVOLUME" => "VOLUMEUNIT",
        "IFCQUANTITYWEIGHT" => "MASSUNIT",
        "IFCQUANTITYTIME" => "TIMEUNIT",
        _ => return String::new(),
    };
    model::unit_of_type(doc, ut).map(|u| u.1).unwrap_or_default()
}

fn type_and_material(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx, id: u32, navigate: &mut Option<u32>) {
    let doc = &s.doc;
    let ty = model::type_of(doc, id);
    let mats = model::materials_of(doc, id);
    let cls = model::classifications_of(doc, id);
    let mut assign_mat: Option<u32> = None;
    let mut new_mat: Option<String> = None;
    let mut add_cls: Option<(String, String, String)> = None;
    let mut remove_cls: Option<u32> = None;
    egui::CollapsingHeader::new(RichText::new("Typ, Material, Klassifikation").strong()).default_open(true).show(ui, |ui| {
        egui::Grid::new(("tm", id)).num_columns(2).striped(true).show(ui, |ui| {
            if !doc.has_flag(id, tflags::TYPE_OBJECT) {
                ui.weak("Typ");
                match ty {
                    Some(t) => {
                        if link(ui, s, t) {
                            *navigate = Some(t);
                        }
                    }
                    None => {
                        ui.weak("—");
                    }
                }
                ui.end_row();
            } else {
                let occ = model::occurrences_of_type(doc, id);
                ui.weak("Vorkommen");
                ui.horizontal(|ui| {
                    ui.label(format!("{}", occ.len()));
                    if !occ.is_empty() && ui.small_button("auswählen").clicked() {
                        app.panel_state.pending_select = Some(occ.clone());
                    }
                });
                ui.end_row();
            }
            for m in &mats {
                ui.weak("Material");
                ui.vertical(|ui| {
                    ui.horizontal(|ui| {
                        if link(ui, s, m.root) {
                            *navigate = Some(m.root);
                        }
                    });
                    for l in &m.layers {
                        let t = l.thickness.map(|t| format!(" – {}", ifc_doc::step::fmt_real_display(t))).unwrap_or_default();
                        ui.label(format!("• {}{}", l.material_name, t));
                    }
                });
                ui.end_row();
            }
            for c in &cls {
                ui.weak("Klassifikation");
                ui.horizontal(|ui| {
                    ui.label(format!("{} {} ({})", c.identification, c.name, c.source));
                    if ui.small_button(ic::MINUS).on_hover_text("Zuordnung entfernen").clicked() {
                        remove_cls = Some(c.rel);
                    }
                });
                ui.end_row();
            }
        });
        let _ = ();
        ui.horizontal(|ui| {
            let materials = doc.ids_of_type("IFCMATERIAL");
            egui::ComboBox::from_id_salt(("assign-mat", id)).selected_text("Material zuweisen …").width(170.0).show_ui(ui, |ui| {
                for m in materials.iter().take(500) {
                    if ui.selectable_label(false, model::material_name(doc, *m)).clicked() {
                        assign_mat = Some(*m);
                    }
                }
            });
            let k = ui.id().with(("newmat", id));
            let mut n: String = ui.data_mut(|d| d.get_temp(k)).unwrap_or_default();
            ui.add(egui::TextEdit::singleline(&mut n).hint_text("neues Material").desired_width(110.0));
            if ui.add_enabled(!n.trim().is_empty(), egui::Button::new(ic::PLUS)).clicked() {
                new_mat = Some(n.trim().to_string());
                n.clear();
            }
            ui.data_mut(|d| d.insert_temp(k, n));
        });
        let k = ui.id().with(("newcls", id));
        let (mut sys, mut code, mut name): (String, String, String) = ui.data_mut(|d| d.get_temp(k)).unwrap_or_else(|| ("".into(), "".into(), "".into()));
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut sys).hint_text("System").desired_width(80.0));
            ui.add(egui::TextEdit::singleline(&mut code).hint_text("Code").desired_width(70.0));
            ui.add(egui::TextEdit::singleline(&mut name).hint_text("Bezeichnung").desired_width(100.0));
            if ui.add_enabled(!sys.trim().is_empty() && !code.trim().is_empty(), egui::Button::new(format!("{} Klass.", ic::PLUS))).clicked() {
                add_cls = Some((sys.clone(), code.clone(), name.clone()));
                code.clear();
                name.clear();
            }
        });
        ui.data_mut(|d| d.insert_temp(k, (sys, code, name)));
    });
    crate::panels::inspector_ext::type_section(ui, s, id);
    let targets: Vec<u32> = if s.selection.len() > 1 { s.selection.clone() } else { vec![id] };
    if let Some(m) = assign_mat {
        s.edit("Material zuweisen", |doc| ops::assign_material(doc, &targets, m));
    }
    if let Some(n) = new_mat {
        s.edit("Material anlegen und zuweisen", |doc| {
            let m = ops::create_material(doc, &n, None);
            ops::assign_material(doc, &targets, m)
        });
    }
    if let Some((a, b, c)) = add_cls {
        s.edit("Klassifikation zuweisen", |doc| ops::assign_classification(doc, &targets, &a, &b, &c).map(|_| ()));
    }
    if let Some(rel) = remove_cls {
        s.edit("Klassifikation entfernen", |doc| {
            let mut a = doc.args(rel).unwrap_or_default();
            let l: Vec<Value> = a[4].ref_list().into_iter().filter(|&x| x != id).map(Value::Ref).collect();
            if l.is_empty() {
                doc.delete(rel);
                Ok(())
            } else {
                a[4] = Value::List(l);
                doc.set_args(rel, &a)
            }
        });
    }
    if let Some(sel) = app.panel_state.pending_select.take() {
        s.select(sel, false);
    }
}

fn relations(ui: &mut egui::Ui, s: &mut Session, _app: &mut AppCtx, id: u32, navigate: &mut Option<u32>) {
    let doc = &s.doc;
    let referencing = doc.referencing(id);
    let mut move_to: Option<u32> = None;
    egui::CollapsingHeader::new(RichText::new(format!("Beziehungen ({})", referencing.len())).strong()).default_open(false).show(ui, |ui| {
        if doc.has_flag(id, tflags::PRODUCT) {
            let path = s.tree.path_to(id);
            if path.len() > 1 {
                ui.horizontal_wrapped(|ui| {
                    ui.weak("Pfad:");
                    for (i, p) in path.iter().enumerate() {
                        if i > 0 {
                            ui.weak("›");
                        }
                        if ui.link(model::label(doc, *p)).clicked() {
                            *navigate = Some(*p);
                        }
                    }
                });
            }
            if doc.has_flag(id, tflags::ELEMENT) {
                let storeys = doc.ids_with_flag(tflags::SPATIAL);
                let cur = s.tree.container_of(doc, id);
                egui::ComboBox::from_id_salt(("move", id)).selected_text(cur.map(|c| format!("in: {}", model::label(doc, c))).unwrap_or_else(|| "keiner Struktur zugeordnet".into())).width(260.0).show_ui(ui, |ui| {
                    for st in storeys {
                        if ui.selectable_label(Some(st) == cur, format!("{} {}", doc.type_camel(st).unwrap_or(""), model::label(doc, st))).clicked() {
                            move_to = Some(st);
                        }
                    }
                });
            }
        }
        let groups = model::groups_of(doc, id);
        for g in groups {
            ui.horizontal(|ui| {
                ui.weak("Gruppe");
                if link(ui, s, g) {
                    *navigate = Some(g);
                }
            });
        }
        ui.separator();
        ui.weak("Referenziert von:");
        let mut by_type: std::collections::BTreeMap<String, Vec<u32>> = Default::default();
        for r in &referencing {
            by_type.entry(doc.type_camel(*r).unwrap_or("?").to_string()).or_default().push(*r);
        }
        for (t, ids) in by_type {
            egui::CollapsingHeader::new(format!("{t} ({})", ids.len())).id_salt(("inv", id, t.clone())).show(ui, |ui| {
                for r in ids.iter().take(300) {
                    if link(ui, s, *r) {
                        *navigate = Some(*r);
                    }
                }
            });
        }
        let refs = doc.references(id);
        ui.weak(format!("Verweist auf ({}):", refs.len()));
        ui.horizontal_wrapped(|ui| {
            for r in refs.iter().take(100) {
                if link(ui, s, *r) {
                    *navigate = Some(*r);
                }
            }
        });
    });
    if let Some(c) = move_to {
        s.edit("In Raumstruktur verschieben", |doc| ops::move_to_container(doc, &[id], c));
    }
}

fn raw_step(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx, id: u32) {
    let key = egui::Id::new(("raw", id, s.doc.revision()));
    let ty = s.doc.type_name(id).unwrap_or("").to_string();
    let cur = s.doc.raw_args_str(id).unwrap_or_default();
    let mut apply: Option<(String, String)> = None;
    let mut change_class: Option<String> = None;
    egui::CollapsingHeader::new(RichText::new("STEP (roh)").strong()).default_open(false).show(ui, |ui| {
        let (mut t, mut a): (String, String) = ui.data_mut(|d| d.get_temp(key)).unwrap_or_else(|| (ty.clone(), cur.clone()));
        ui.horizontal(|ui| {
            ui.monospace(format!("#{id}="));
            ui.add(egui::TextEdit::singleline(&mut t).font(egui::TextStyle::Monospace).desired_width(220.0));
        });
        ui.add(egui::TextEdit::multiline(&mut a).font(egui::TextStyle::Monospace).desired_width(f32::INFINITY).desired_rows(3));
        ui.horizontal(|ui| {
            if ui.button("Übernehmen").clicked() {
                apply = Some((t.clone(), a.clone()));
            }
            if ui.button("Zurücksetzen").clicked() {
                t = ty.clone();
                a = cur.clone();
            }
            if ui.button(format!("{} Kopieren", ic::COPY)).clicked() {
                ui.ctx().copy_text(s.doc.step_line(id).unwrap_or_default());
            }
        });
        ui.data_mut(|d| d.insert_temp(key, (t, a)));
        if s.doc.has_flag(id, tflags::ELEMENT) {
            ui.separator();
            let schema = s.doc.schema();
            let mut classes = schema.concrete_subtypes_named(if s.doc.schema_id == ifc_doc::SchemaId::Ifc4x3 { "IfcBuiltElement" } else { "IfcBuildingElement" });
            classes.extend(schema.concrete_subtypes_named("IfcFurnishingElement"));
            classes.extend(schema.concrete_subtypes_named("IfcDistributionElement"));
            egui::ComboBox::from_id_salt(("cls", id)).selected_text("Klasse ändern …").width(220.0).show_ui(ui, |ui| {
                for c in classes {
                    if ui.selectable_label(false, &c).clicked() {
                        change_class = Some(c.to_ascii_uppercase());
                    }
                }
            });
        }
    });
    if let Some((t, a)) = apply {
        let res = s.edit("STEP bearbeiten", |doc| doc.set_raw(id, Some(&t), &a));
        if res.is_none() {
            app.error(s.last_error.clone().unwrap_or_default());
        }
    }
    if let Some(c) = change_class {
        s.edit("Klasse ändern", |doc| ops::change_class(doc, id, &c));
    }
}
