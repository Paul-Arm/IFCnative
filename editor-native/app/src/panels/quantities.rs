//! Quantity take-off from the triangulated geometry into IfcElementQuantity.

use crate::session::Session;
use glam::Vec3;
use ifc_doc::{model, ops, Value};

#[derive(Clone, Debug, Default)]
pub struct Measured {
    pub volume: f64,
    pub area: f64,
    pub footprint: f64,
    pub length: f64,
    pub width: f64,
    pub height: f64,
}

/// Measure a product from its mesh (metres).
pub fn measure(s: &Session, id: u32) -> Option<Measured> {
    let g = s.scene.obj(id)?.geom.clone()?;
    let mut vol = 0.0f64;
    let mut area = 0.0f64;
    let mut foot = 0.0f64;
    for t in g.indices.chunks_exact(3) {
        let a = Vec3::from(g.positions[t[0] as usize]).as_dvec3();
        let b = Vec3::from(g.positions[t[1] as usize]).as_dvec3();
        let c = Vec3::from(g.positions[t[2] as usize]).as_dvec3();
        vol += a.dot(b.cross(c));
        let n = (b - a).cross(c - a);
        area += n.length() * 0.5;
        if n.z < 0.0 {
            // downward facing faces = footprint (projected)
            foot += -n.z * 0.5;
        }
    }
    let (lo, hi) = (Vec3::from(g.min), Vec3::from(g.max));
    // principal horizontal extent via oriented footprint (use placement x-axis if available)
    let d = hi - lo;
    let (len, wid) = if d.x >= d.y { (d.x as f64, d.y as f64) } else { (d.y as f64, d.x as f64) };
    Some(Measured { volume: (vol / 6.0).abs(), area, footprint: foot, length: len, width: wid, height: d.z as f64 })
}

/// Name of the base quantity set for a class (IFC4 conventions).
pub fn qto_name(doc: &ifc_doc::Document, id: u32) -> String {
    let camel = doc.type_camel(id).unwrap_or("IfcElement").trim_start_matches("Ifc").trim_end_matches("StandardCase").to_string();
    format!("Qto_{camel}BaseQuantities")
}

/// Write computed quantities for the given products. Returns number of elements updated.
pub fn write_quantities(s: &mut Session, ids: &[u32]) -> usize {
    let unit = model::length_unit(&s.doc).0;
    let measures: Vec<(u32, Measured, String)> = ids.iter().filter_map(|&id| measure(s, id).map(|m| (id, m, qto_name(&s.doc, id)))).collect();
    let n = measures.len();
    s.edit("Mengen aus Geometrie", |doc| {
        for (id, m, qto) in &measures {
            let l = |v: f64| v / unit;
            ops::set_quantity(doc, *id, qto, "GrossVolume", "VOLUME", m.volume / (unit * unit * unit))?;
            ops::set_quantity(doc, *id, qto, "NetVolume", "VOLUME", m.volume / (unit * unit * unit))?;
            ops::set_quantity(doc, *id, qto, "GrossSurfaceArea", "AREA", m.area / (unit * unit))?;
            ops::set_quantity(doc, *id, qto, "GrossFootprintArea", "AREA", m.footprint / (unit * unit))?;
            ops::set_quantity(doc, *id, qto, "Length", "LENGTH", l(m.length))?;
            ops::set_quantity(doc, *id, qto, "Width", "LENGTH", l(m.width))?;
            ops::set_quantity(doc, *id, qto, "Height", "LENGTH", l(m.height))?;
        }
        Ok(())
    });
    let _ = Value::Null;
    n
}
