//! Model checks with one-click fixes.

use crate::app::AppCtx;
use crate::icons as ic;
use crate::session::Session;
use egui::{Color32, RichText};
use ifc_doc::{model, tflags, Document, Severity};
use rayon::prelude::*;
use rustc_hash::FxHashMap;

#[derive(Clone, Debug)]
pub struct Finding {
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    pub ids: Vec<u32>,
    pub fix: Option<Fix>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fix {
    Guids,
    Purge,
    ContainDefault,
    DeleteEmptyPsets,
    NameFromClass,
    ProxyClasses,
    DeleteDuplicates,
}

#[derive(Default)]
pub struct DiagState {
    pub findings: Vec<Finding>,
    pub ran_rev: Option<(u64, u64)>,
    pub millis: f64,
}

pub fn run_checks(doc: &Document, s: &Session) -> Vec<Finding> {
    let mut out = Vec::new();
    for d in doc.diagnostics.iter().take(200) {
        out.push(Finding { severity: d.severity, title: "Datei".into(), detail: d.message.clone(), ids: d.entity.into_iter().collect(), fix: None });
    }
    // schema conformance (all entities)
    for g in ifc_doc::validate::validate(doc, 5000) {
        let examples: Vec<String> = g.samples.iter().take(3).map(|i| format!("#{} {}", i.id, i.message)).collect();
        let mut ids: Vec<u32> = g.samples.iter().map(|i| i.id).collect();
        ids.dedup();
        out.push(Finding {
            severity: if g.kind.is_error() { Severity::Error } else { Severity::Warning },
            title: format!("Schema: {}", g.kind.title()),
            detail: format!("{} Fälle, z. B. {}", g.total, examples.join("; ")),
            ids,
            fix: None,
        });
    }
    // geometrically identical elements of the same class (copy & paste errors)
    {
        let mut groups: FxHashMap<(u16, [i64; 6], u32), Vec<u32>> = FxHashMap::default();
        for o in s.scene.objects.iter().filter(|o| o.geom.is_some() && o.tris > 0) {
            let q = |v: f32| (v * 100.0).round() as i64;
            let key = (doc.type_idx_of(o.id).unwrap_or(0), [q(o.min.x), q(o.min.y), q(o.min.z), q(o.max.x), q(o.max.y), q(o.max.z)], o.tris);
            groups.entry(key).or_default().push(o.id);
        }
        let mut dups: Vec<u32> = groups.values().filter(|g| g.len() > 1).flat_map(|g| {
            let mut g = g.clone();
            g.sort_unstable();
            g.into_iter().skip(1)
        }).collect();
        dups.sort_unstable();
        if !dups.is_empty() {
            out.push(Finding { severity: Severity::Warning, title: "Doppelte Elemente".into(), detail: format!("{} deckungsgleich mit einem Element derselben Klasse", dups.len()), ids: dups, fix: Some(Fix::DeleteDuplicates) });
        }
    }
    // proxies whose name reveals the class
    let proxies = doc.ids_of_type("IFCBUILDINGELEMENTPROXY");
    let sugg: Vec<(u32, &'static str)> = proxies.par_iter().filter_map(|&id| ifc_doc::ops::suggest_class_from_name(doc, id).map(|c| (id, c))).collect();
    if !sugg.is_empty() {
        let short = |t: String| if t.chars().count() > 24 { format!("{}…", t.chars().take(23).collect::<String>()) } else { t };
        let examples: Vec<String> = sugg.iter().take(2).map(|(id, c)| format!("„{}“ → {}", short(doc.name_of(*id).unwrap_or_default()), doc.schema().camel(c))).collect();
        out.push(Finding { severity: Severity::Info, title: "Proxys klassifizierbar".into(), detail: format!("{} per Name, z. B. {}", sugg.len(), examples.join(", ")), ids: sugg.iter().map(|x| x.0).collect(), fix: Some(Fix::ProxyClasses) });
    }
    // GUIDs
    let roots = doc.ids_with_flag(tflags::ROOT);
    let guids: Vec<(u32, String)> = roots.par_iter().map(|&id| (id, doc.guid_of(id).unwrap_or_default())).collect();
    let invalid: Vec<u32> = guids.iter().filter(|(_, g)| !ifc_doc::guid::is_valid(g)).map(|(i, _)| *i).collect();
    let mut seen: FxHashMap<&str, u32> = FxHashMap::default();
    let mut dups = Vec::new();
    for (id, g) in &guids {
        if let Some(prev) = seen.insert(g.as_str(), *id) {
            dups.push(prev);
            dups.push(*id);
        }
    }
    if !invalid.is_empty() {
        out.push(Finding { severity: Severity::Error, title: "Ungültige GlobalIds".into(), detail: format!("{} Objekte haben keine gültige 22-stellige GlobalId", invalid.len()), ids: invalid, fix: Some(Fix::Guids) });
    }
    if !dups.is_empty() {
        dups.sort_unstable();
        dups.dedup();
        out.push(Finding { severity: Severity::Error, title: "Doppelte GlobalIds".into(), detail: format!("{} Objekte teilen sich eine GlobalId", dups.len()), ids: dups, fix: Some(Fix::Guids) });
    }
    // products
    let products = doc.ids_with_flag(tflags::ELEMENT);
    let uncontained: Vec<u32> = products.par_iter().copied().filter(|&id| !doc.has_flag(id, tflags::OPENING) && !doc.has_flag(id, tflags::FEATURE) && s.tree.parent.get(&id).is_none()).collect();
    if !uncontained.is_empty() {
        out.push(Finding { severity: Severity::Warning, title: "Nicht in Raumstruktur".into(), detail: format!("{} Elemente sind keinem Geschoss/Gebäude zugeordnet", uncontained.len()), ids: uncontained, fix: Some(Fix::ContainDefault) });
    }
    let no_placement: Vec<u32> = products.par_iter().copied().filter(|&id| doc.arg(id, 5).map(|v| v.is_null()).unwrap_or(true)).collect();
    if !no_placement.is_empty() {
        out.push(Finding { severity: Severity::Warning, title: "Ohne Platzierung".into(), detail: format!("{} Elemente haben keine ObjectPlacement", no_placement.len()), ids: no_placement, fix: None });
    }
    let no_repr: Vec<u32> = products.par_iter().copied().filter(|&id| !doc.has_flag(id, tflags::OPENING) && doc.arg(id, 6).map(|v| v.is_null()).unwrap_or(true)).collect();
    if !no_repr.is_empty() {
        out.push(Finding { severity: Severity::Info, title: "Ohne Geometrie".into(), detail: format!("{} Elemente haben keine Repräsentation", no_repr.len()), ids: no_repr, fix: None });
    }
    let failed: Vec<u32> = products.iter().copied().filter(|&id| !doc.has_flag(id, tflags::OPENING) && doc.arg(id, 6).map(|v| !v.is_null()).unwrap_or(false) && !s.scene.has(id)).collect();
    if !failed.is_empty() {
        out.push(Finding { severity: Severity::Warning, title: "Geometrie nicht darstellbar".into(), detail: format!("{} Elemente mit Repräsentation konnten nicht trianguliert werden", failed.len()), ids: failed, fix: None });
    }
    let unnamed: Vec<u32> = products.par_iter().copied().filter(|&id| !doc.has_flag(id, tflags::OPENING) && doc.name_of(id).map(|n| n.trim().is_empty()).unwrap_or(true)).collect();
    if !unnamed.is_empty() {
        out.push(Finding { severity: Severity::Info, title: "Ohne Namen".into(), detail: format!("{} Elemente haben keinen Namen", unnamed.len()), ids: unnamed, fix: Some(Fix::NameFromClass) });
    }
    // psets
    let psets = doc.ids_of_type("IFCPROPERTYSET");
    let empty: Vec<u32> = psets.par_iter().copied().filter(|&p| doc.arg(p, 4).map(|v| v.ref_list().is_empty()).unwrap_or(true)).collect();
    if !empty.is_empty() {
        out.push(Finding { severity: Severity::Info, title: "Leere Property Sets".into(), detail: format!("{} Psets ohne Eigenschaften", empty.len()), ids: empty, fix: Some(Fix::DeleteEmptyPsets) });
    }
    let unattached: Vec<u32> = psets.par_iter().copied().filter(|&p| doc.referencing(p).is_empty()).collect();
    if !unattached.is_empty() {
        out.push(Finding { severity: Severity::Info, title: "Nicht zugeordnete Psets".into(), detail: format!("{} Psets hängen an keinem Objekt", unattached.len()), ids: unattached, fix: Some(Fix::Purge) });
    }
    // openings without host
    let openings = doc.ids_with_flag(tflags::OPENING);
    let orphan_open: Vec<u32> = openings.par_iter().copied().filter(|&o| doc.referencing_with_type(o, "IFCRELVOIDSELEMENT").is_empty()).collect();
    if !orphan_open.is_empty() {
        out.push(Finding { severity: Severity::Warning, title: "Öffnungen ohne Wirt".into(), detail: format!("{} Öffnungen sind keinem Bauteil zugeordnet", orphan_open.len()), ids: orphan_open, fix: None });
    }
    // orphan resources (sample-based count)
    let orphan_count = doc.recs().par_iter().filter(|r| !r.deleted()).filter(|r| {
        let f = doc.types[r.ty as usize].flags;
        f & tflags::ROOT == 0 && !matches!(doc.types[r.ty as usize].name.as_str(), "IFCOWNERHISTORY" | "IFCSTYLEDITEM" | "IFCPRESENTATIONLAYERASSIGNMENT" | "IFCMATERIALDEFINITIONREPRESENTATION" | "IFCUNITASSIGNMENT" | "IFCGEOMETRICREPRESENTATIONCONTEXT" | "IFCPRESENTATIONLAYERWITHSTYLE" | "IFCEXTERNALREFERENCERELATIONSHIP" | "IFCMATERIALPROPERTIES" | "IFCAPPLICATION" | "IFCPERSONANDORGANIZATION")
            && doc.referencing(r.id).is_empty()
    })
    .count();
    if orphan_count > 0 {
        out.push(Finding { severity: Severity::Info, title: "Ungenutzte Entities".into(), detail: format!("{orphan_count} Ressourcen werden von nichts referenziert"), ids: vec![], fix: Some(Fix::Purge) });
    }
    // storeys
    let storeys = doc.ids_of_type("IFCBUILDINGSTOREY");
    let mut elev: FxHashMap<String, Vec<u32>> = FxHashMap::default();
    for st in &storeys {
        let e = doc.attr(*st, "Elevation").and_then(|v| v.as_f64()).map(|v| format!("{v:.3}")).unwrap_or_else(|| "–".into());
        elev.entry(e).or_default().push(*st);
    }
    for (e, ids) in elev {
        if ids.len() > 1 {
            out.push(Finding { severity: Severity::Info, title: "Gleiche Geschosshöhe".into(), detail: format!("{} Geschosse mit Elevation {e}", ids.len()), ids, fix: None });
        }
    }
    if model::project(doc).is_none() {
        out.push(Finding { severity: Severity::Error, title: "Kein IfcProject".into(), detail: "Die Datei enthält kein IfcProject".into(), ids: vec![], fix: None });
    }
    if doc.schema_id == ifc_doc::SchemaId::Ifc2x3 && model::owner_history(doc).is_none() {
        out.push(Finding { severity: Severity::Warning, title: "Keine OwnerHistory".into(), detail: "IFC2X3 verlangt IfcOwnerHistory an allen IfcRoot-Objekten".into(), ids: vec![], fix: None });
    }
    out.sort_by(|a, b| b.severity.cmp(&a.severity));
    out
}

pub fn show(ui: &mut egui::Ui, s: &mut Session, app: &mut AppCtx) {
    let st = &mut app.panel_state.diag;
    let key = (s.uid, s.doc.revision());
    ui.horizontal(|ui| {
        // automatic re-check after edits only while it is fast (large models: on demand)
        let stale = st.ran_rev.is_some() && st.ran_rev != Some(key) && s.loading.is_none();
        if ui.button(format!("{} Modell prüfen", ic::CHECK)).clicked() || (stale && st.millis < 300.0) {
            let t = std::time::Instant::now();
            st.findings = run_checks(&s.doc, s);
            st.millis = t.elapsed().as_secs_f64() * 1000.0;
            st.ran_rev = Some(key);
        }
        if st.ran_rev.is_some() {
            let (e, w, i) = st.findings.iter().fold((0, 0, 0), |acc, f| match f.severity {
                Severity::Error => (acc.0 + 1, acc.1, acc.2),
                Severity::Warning => (acc.0, acc.1 + 1, acc.2),
                Severity::Info => (acc.0, acc.1, acc.2 + 1),
            });
            ui.colored_label(Color32::from_rgb(240, 90, 80), format!("{e} Fehler"));
            ui.colored_label(Color32::from_rgb(255, 170, 40), format!("{w} Warnungen"));
            ui.weak(format!("{i} Hinweise · {:.0} ms", st.millis));
            if st.ran_rev != Some(key) {
                ui.colored_label(Color32::from_rgb(230, 180, 80), "Modell geändert – erneut prüfen");
            }
        }
    });
    if st.ran_rev.is_none() {
        ui.weak("Prüft Schema-Konformität (Pflichtattribute, Verweise, Aufzählungen), GlobalIds, Raumstruktur, Platzierung, Geometrie, Psets, Öffnungen, ungenutzte Daten u. a.");
        return;
    }
    if st.findings.is_empty() {
        ui.colored_label(Color32::from_rgb(90, 200, 110), format!("{} Keine Befunde", ic::CHECK));
        return;
    }
    let mut fix: Option<(Fix, Vec<u32>)> = None;
    let mut select: Option<Vec<u32>> = None;
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for (i, f) in st.findings.iter().enumerate() {
            ui.horizontal(|ui| {
                let (icon, col) = match f.severity {
                    Severity::Error => (ic::WARN, Color32::from_rgb(240, 90, 80)),
                    Severity::Warning => (ic::WARN, Color32::from_rgb(255, 170, 40)),
                    Severity::Info => (ic::INFO, Color32::from_rgb(110, 170, 255)),
                };
                ui.colored_label(col, icon);
                ui.label(RichText::new(&f.title).strong());
                ui.label(&f.detail);
                if !f.ids.is_empty() && ui.small_button(format!("{} auswählen", ic::SELECT)).clicked() {
                    select = Some(f.ids.clone());
                }
                if let Some(fx) = f.fix {
                    let label = match fx {
                        Fix::Guids => "GlobalIds neu vergeben",
                        Fix::Purge => "Bereinigen",
                        Fix::ContainDefault => "dem ersten Geschoss zuordnen",
                        Fix::DeleteEmptyPsets => "leere Psets löschen",
                        Fix::NameFromClass => "Namen aus Klasse setzen",
                        Fix::ProxyClasses => "Klassen zuweisen",
                        Fix::DeleteDuplicates => "Duplikate löschen",
                    };
                    if ui.small_button(format!("{} {label}", ic::EDIT)).clicked() {
                        fix = Some((fx, f.ids.clone()));
                    }
                }
            });
            if i + 1 < st.findings.len() {
                ui.separator();
            }
        }
    });
    if let Some(ids) = select {
        s.select(ids, false);
    }
    if let Some((fx, ids)) = fix {
        match fx {
            Fix::Guids => {
                s.edit("GlobalIds reparieren", |doc| ifc_doc::ops::fix_guids(doc).map(|_| ()));
            }
            Fix::Purge => {
                s.edit("Bereinigen", |doc| {
                    ifc_doc::ops::purge_unused(doc);
                    Ok(())
                });
            }
            Fix::ContainDefault => {
                let target = s.doc.ids_of_type("IFCBUILDINGSTOREY").into_iter().next().or_else(|| s.doc.ids_with_flag(tflags::SPATIAL).into_iter().next());
                if let Some(t) = target {
                    s.edit("Elemente zuordnen", |doc| ifc_doc::ops::move_to_container(doc, &ids, t));
                }
            }
            Fix::DeleteEmptyPsets => {
                s.edit("Leere Psets löschen", |doc| {
                    for p in &ids {
                        ifc_doc::ops::delete_pset(doc, *p)?;
                    }
                    Ok(())
                });
            }
            Fix::DeleteDuplicates => {
                let n = ids.len();
                if s.edit("Duplikate löschen", |doc| ifc_doc::ops::delete_entities(doc, &ids, true).map(|_| ())).is_some() {
                    app.toast(format!("{n} doppelte Elemente gelöscht (je eines bleibt erhalten)"));
                }
            }
            Fix::ProxyClasses => {
                if let Some(n) = s.edit("Proxy-Klassen zuweisen", |doc| {
                    let mut n = 0;
                    for id in &ids {
                        if let Some(c) = ifc_doc::ops::suggest_class_from_name(doc, *id) {
                            ifc_doc::ops::change_class(doc, *id, c)?;
                            n += 1;
                        }
                    }
                    Ok(n)
                }) {
                    app.toast(format!("{n} Proxy-Elemente neu klassifiziert"));
                }
            }
            Fix::NameFromClass => {
                s.edit("Namen setzen", |doc| {
                    for &id in &ids {
                        let n = doc.type_camel(id).unwrap_or("Element").trim_start_matches("Ifc").to_string();
                        doc.set_arg(id, 2, ifc_doc::Value::Str(n))?;
                    }
                    Ok(())
                });
            }
        }
        app.panel_state.diag.ran_rev = Some((0, 0));
    }
}
