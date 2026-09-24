//! Model report as a single self-contained HTML file: file info, view image,
//! statistics per class, model check findings, IDS results, rooms, cost groups.

use crate::app::AppCtx;
use crate::session::Session;
use ifc_doc::{din276, model, tflags};
use std::fmt::Write as _;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn fmt_int(n: usize) -> String {
    crate::session::fmt_count(n)
}

/// Build the report; `image` is an optional RGBA view capture (w, h, data).
pub fn build(s: &Session, app: &AppCtx, image: Option<(u32, u32, Vec<u8>)>) -> String {
    let doc = &s.doc;
    let mut h = String::new();
    let file = s.path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| s.title().trim_end_matches('•').trim().to_string());
    let title = format!("Modellbericht – {file}");
    let _ = write!(
        h,
        r#"<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>{}</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:32px auto;max-width:1100px;color:#1d232b;padding:0 16px}}
h1{{font-size:26px;margin-bottom:4px}} h2{{font-size:19px;margin-top:34px;border-bottom:2px solid #e3e7ec;padding-bottom:4px}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}} th,td{{border-bottom:1px solid #e6e9ee;padding:5px 8px;text-align:left;vertical-align:top}}
th{{background:#f4f6f8}} td.n,th.n{{text-align:right;font-variant-numeric:tabular-nums}}
.muted{{color:#6b7480}} .err{{color:#c0392b;font-weight:600}} .warn{{color:#c77c02;font-weight:600}} .ok{{color:#2e8b57;font-weight:600}}
.kpi{{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px}} .kpi div{{background:#f4f6f8;border-radius:8px;padding:10px 14px;min-width:150px}}
.kpi b{{display:block;font-size:20px}} img{{max-width:100%;border-radius:8px;margin-top:14px;border:1px solid #e3e7ec}}
@media print{{h2{{break-after:avoid}} table{{break-inside:auto}}}}
</style></head><body>"#,
        esc(&title)
    );
    let hd = &doc.header;
    let _ = write!(h, "<h1>{}</h1><div class=muted>Erstellt mit IFCnative {} am {}</div>", esc(&title), env!("CARGO_PKG_VERSION"), chrono::Local::now().format("%d.%m.%Y %H:%M"));
    let (unit, ul) = model::length_unit(doc);
    let products = doc.ids_with_flag(tflags::PRODUCT).len();
    let _ = write!(
        h,
        "<div class=kpi><div>Schema<b>{}</b></div><div>Entities<b>{}</b></div><div>Objekte mit Geometrie<b>{}</b></div><div>Dreiecke<b>{}</b></div><div>Produkte<b>{}</b></div><div>Längeneinheit<b>{} </b></div></div>",
        esc(&hd.schema.join(", ")),
        fmt_int(doc.live_count()),
        fmt_int(s.scene.objects.len()),
        fmt_int(s.scene.total_tris),
        fmt_int(products),
        esc(&format!("{ul} (×{unit})"))
    );
    if let Some((w, hgt, rgba)) = image {
        let mut png = Vec::new();
        if let Some(img) = image::RgbaImage::from_raw(w, hgt, rgba) {
            let _ = img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png);
            let _ = write!(h, r#"<img alt="Ansicht" src="data:image/png;base64,{}">"#, base64(&png));
        }
    }
    // file header
    let _ = write!(h, "<h2>Datei</h2><table>");
    for (k, v) in [("Datei", s.path.as_ref().map(|p| p.display().to_string()).unwrap_or_default()), ("Name", hd.name.clone()), ("Zeitstempel", hd.time_stamp.clone()), ("Autor", hd.author.join(", ")), ("Organisation", hd.organization.join(", ")), ("Anwendung", hd.originating_system.clone()), ("Beschreibung", hd.description.join("; "))] {
        let _ = write!(h, "<tr><th style='width:180px'>{k}</th><td>{}</td></tr>", esc(&v));
    }
    if let Some(g) = ifc_doc::georef::read(doc) {
        let _ = write!(h, "<tr><th>Georeferenzierung</th><td>{} · E {:.3} · N {:.3} · H {:.3} · Drehung {:.4}°</td></tr>", esc(&g.crs_name), g.eastings, g.northings, g.height, g.rotation_deg());
    }
    let _ = write!(h, "</table>");
    // spatial structure
    let storeys = doc.ids_of_type("IFCBUILDINGSTOREY");
    if !storeys.is_empty() {
        let _ = write!(h, "<h2>Geschosse</h2><table><tr><th>Geschoss</th><th class=n>Höhe m</th><th class=n>Elemente</th></tr>");
        let mut rows: Vec<(f32, u32)> = storeys.iter().map(|&st| (s.storey_elevation(st).unwrap_or(0.0) + s.scene.origin.z as f32, st)).collect();
        rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        for (z, st) in rows {
            let n = s.tree.subtree(st).into_iter().filter(|&x| doc.has_flag(x, tflags::ELEMENT)).count();
            let _ = write!(h, "<tr><td>{}</td><td class=n>{z:.3}</td><td class=n>{}</td></tr>", esc(&model::label(doc, st)), fmt_int(n));
        }
        let _ = write!(h, "</table>");
    }
    // classes
    let mut counts: Vec<(String, usize, f64)> = Vec::new();
    for (ti, n) in doc.type_counts() {
        let info = &doc.types[ti as usize];
        if info.flags & tflags::PRODUCT == 0 || info.flags & tflags::SPATIAL != 0 {
            continue;
        }
        let vol: f64 = doc.ids_of_type(&info.name).iter().filter_map(|&id| crate::panels::quantities::measure(s, id)).map(|m| m.volume).sum();
        counts.push((info.camel.clone(), n, vol));
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    let _ = write!(h, "<h2>Bauteile nach Klasse</h2><table><tr><th>Klasse</th><th class=n>Anzahl</th><th class=n>Volumen m³</th></tr>");
    for (c, n, v) in &counts {
        let _ = write!(h, "<tr><td>{}</td><td class=n>{}</td><td class=n>{v:.2}</td></tr>", esc(c), fmt_int(*n));
    }
    let _ = write!(h, "</table>");
    // checks
    let findings = crate::panels::diagnostics::run_checks(doc, s);
    let _ = write!(h, "<h2>Modellprüfung</h2>");
    if findings.is_empty() {
        let _ = write!(h, "<p class=ok>Keine Befunde.</p>");
    } else {
        let _ = write!(h, "<table><tr><th style='width:90px'>Stufe</th><th>Befund</th><th>Details</th><th class=n>Objekte</th></tr>");
        for f in &findings {
            let (cls, lbl) = match f.severity {
                ifc_doc::Severity::Error => ("err", "Fehler"),
                ifc_doc::Severity::Warning => ("warn", "Warnung"),
                ifc_doc::Severity::Info => ("muted", "Hinweis"),
            };
            let _ = write!(h, "<tr><td class={cls}>{lbl}</td><td>{}</td><td>{}</td><td class=n>{}</td></tr>", esc(&f.title), esc(&f.detail), f.ids.len());
        }
        let _ = write!(h, "</table>");
    }
    // IDS
    let ids = &app.panel_state.ids;
    if let Some((name, _)) = &ids.ids {
        if !ids.results.is_empty() {
            let _ = write!(h, "<h2>IDS-Prüfung – {}</h2><table><tr><th>Anforderung</th><th>Status</th><th class=n>Anwendbar</th><th class=n>Erfüllt</th><th class=n>Verstöße</th></tr>", esc(name));
            for r in &ids.results {
                let (cls, lbl) = match r.status {
                    ifc_doc::ids::SpecStatus::Pass => ("ok", "erfüllt"),
                    ifc_doc::ids::SpecStatus::Fail => ("err", "nicht erfüllt"),
                    ifc_doc::ids::SpecStatus::NotApplicable => ("muted", "nicht anwendbar"),
                };
                let _ = write!(h, "<tr><td>{}</td><td class={cls}>{lbl}</td><td class=n>{}</td><td class=n>{}</td><td class=n>{}</td></tr>", esc(&r.name), r.applicable.len(), r.passed, r.failures.len());
            }
            let _ = write!(h, "</table>");
        }
    }
    // rooms
    let spaces = doc.ids_of_kind("IFCSPACE");
    if !spaces.is_empty() {
        let _ = write!(h, "<h2>Raumbuch</h2><table><tr><th>Nummer</th><th>Bezeichnung</th><th>Geschoss</th><th class=n>Fläche m²</th><th class=n>Volumen m³</th></tr>");
        let (mut ta, mut tv) = (0.0, 0.0);
        for id in spaces {
            let (a, _, _, v) = crate::panels::spaces::measure_room(s, id).unwrap_or_default();
            ta += a;
            tv += v;
            let st = s.tree.storey_of(doc, id).map(|x| model::label(doc, x)).unwrap_or_default();
            let _ = write!(h, "<tr><td>{}</td><td>{}</td><td>{}</td><td class=n>{a:.2}</td><td class=n>{v:.2}</td></tr>", esc(&doc.name_of(id).unwrap_or_default()), esc(&doc.attr_str(id, "LongName").unwrap_or_default()), esc(&st));
        }
        let _ = write!(h, "<tr><th colspan=3>Summe</th><th class=n>{ta:.2}</th><th class=n>{tv:.2}</th></tr></table>");
    }
    // cost groups
    let mut kg: std::collections::BTreeMap<String, (usize, f64)> = Default::default();
    for id in doc.ids_with_flag(tflags::ELEMENT) {
        if let Some(c) = din276::current(doc, id) {
            let e = kg.entry(c).or_default();
            e.0 += 1;
            e.1 += crate::panels::quantities::measure(s, id).map(|m| m.volume).unwrap_or(0.0);
        }
    }
    if !kg.is_empty() {
        let _ = write!(h, "<h2>Kostengruppen DIN 276</h2><table><tr><th>KG</th><th>Bezeichnung</th><th class=n>Anzahl</th><th class=n>Volumen m³</th></tr>");
        for (c, (n, v)) in &kg {
            let _ = write!(h, "<tr><td>{c}</td><td>{}</td><td class=n>{n}</td><td class=n>{v:.2}</td></tr>", esc(din276::name_of(c).unwrap_or("")));
        }
        let _ = write!(h, "</table>");
    }
    let _ = write!(h, "<p class=muted style='margin-top:40px'>Mengen aus der triangulierten Geometrie (Näherung). Bericht erzeugt von IFCnative.</p></body></html>");
    h
}

/// Objects with attributes, structure, type, material, classification, psets and quantities as JSON.
pub fn json_export(s: &Session, ids: &[u32]) -> String {
    use serde_json::{json, Map, Value as J};
    let doc = &s.doc;
    let val = |v: &ifc_doc::Value| -> J {
        let t = v.display();
        match t.parse::<f64>() {
            Ok(f) if f.is_finite() && !t.is_empty() => json!(f),
            _ => match t.as_str() {
                "TRUE" => J::Bool(true),
                "FALSE" => J::Bool(false),
                "" => J::Null,
                _ => J::String(t),
            },
        }
    };
    let items: Vec<J> = ids
        .iter()
        .map(|&id| {
            let mut psets = Map::new();
            let mut qtos = Map::new();
            for ps in model::psets_of(doc, id) {
                let mut m = Map::new();
                for p in &ps.props {
                    m.insert(p.name.clone(), val(&p.value));
                }
                let target = if ps.is_quantity { &mut qtos } else { &mut psets };
                target.entry(ps.name.clone()).or_insert_with(|| J::Object(Map::new()));
                if let Some(J::Object(o)) = target.get_mut(&ps.name) {
                    o.extend(m);
                }
            }
            json!({
                "id": id,
                "GlobalId": doc.guid_of(id),
                "Klasse": doc.type_camel(id),
                "Name": doc.name_of(id),
                "Beschreibung": doc.attr_str(id, "Description"),
                "ObjectType": doc.attr_str(id, "ObjectType"),
                "Tag": doc.attr_str(id, "Tag"),
                "Geschoss": s.tree.storey_of(doc, id).and_then(|st| doc.name_of(st)),
                "Typ": model::type_of(doc, id).and_then(|t| doc.name_of(t)),
                "Material": model::materials_of(doc, id).iter().flat_map(|m| m.layers.iter().map(|l| l.material_name.clone())).collect::<Vec<_>>(),
                "Klassifikation": model::classifications_of(doc, id).iter().map(|c| json!({"System": c.source, "Code": c.identification, "Name": c.name})).collect::<Vec<_>>(),
                "Psets": psets,
                "Mengen": qtos,
            })
        })
        .collect();
    serde_json::to_string_pretty(&json!({
        "Datei": s.path.as_ref().map(|p| p.display().to_string()),
        "Schema": doc.schema_id.display(),
        "Längeneinheit": model::length_unit(doc).1,
        "Objekte": items,
    }))
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn b64() {
        assert_eq!(super::base64(b"Man"), "TWFu");
        assert_eq!(super::base64(b"Ma"), "TWE=");
        assert_eq!(super::base64(b"M"), "TQ==");
    }
}
