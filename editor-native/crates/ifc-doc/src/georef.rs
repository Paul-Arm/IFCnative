//! Georeferencing: IfcMapConversion + IfcProjectedCRS (IFC4+), site reference
//! latitude/longitude, local → map coordinate transformation.

use crate::document::Document;
use crate::{SchemaId, Value};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Georef {
    pub conversion: Option<u32>,
    pub crs: Option<u32>,
    pub eastings: f64,
    pub northings: f64,
    pub height: f64,
    pub abscissa: f64,
    pub ordinate: f64,
    pub scale: f64,
    pub crs_name: String,
    pub crs_description: String,
    pub geodetic_datum: String,
    pub vertical_datum: String,
    pub projection: String,
    pub zone: String,
}

impl Georef {
    /// Rotation of the local x axis against east (grid north), degrees, counter-clockwise.
    pub fn rotation_deg(&self) -> f64 {
        self.ordinate.atan2(self.abscissa).to_degrees()
    }
    pub fn set_rotation_deg(&mut self, d: f64) {
        let r = d.to_radians();
        self.abscissa = r.cos();
        self.ordinate = r.sin();
    }
    /// Local project coordinates (metres) → map coordinates (E, N, H in map units).
    pub fn to_map(&self, local_m: [f64; 3], unit: f64) -> [f64; 3] {
        let (x, y, z) = (local_m[0] / unit, local_m[1] / unit, local_m[2] / unit);
        let n = self.abscissa.hypot(self.ordinate).max(1e-12);
        let (c, s) = (self.abscissa / n, self.ordinate / n);
        let k = if self.scale == 0.0 { 1.0 } else { self.scale };
        [self.eastings + k * (x * c - y * s), self.northings + k * (x * s + y * c), self.height + k * z]
    }
    /// Defaults for a new georeferencing (ETRS89 / UTM 32N, scale from project unit to metres).
    pub fn new_default(doc: &Document) -> Georef {
        Georef {
            abscissa: 1.0,
            ordinate: 0.0,
            scale: crate::model::length_unit(doc).0,
            crs_name: "EPSG:25832".into(),
            crs_description: "ETRS89 / UTM zone 32N".into(),
            geodetic_datum: "ETRS89".into(),
            vertical_datum: "DHHN2016".into(),
            projection: "UTM".into(),
            zone: "32N".into(),
            ..Default::default()
        }
    }
}

fn f(v: Option<&Value>) -> f64 {
    v.and_then(|x| x.as_f64()).unwrap_or(0.0)
}
fn st(v: Option<&Value>) -> String {
    v.and_then(|x| x.as_str().map(|s| s.to_string())).unwrap_or_default()
}

pub fn read(doc: &Document) -> Option<Georef> {
    let conv = doc.ids_of_type("IFCMAPCONVERSION").into_iter().next()?;
    let a = doc.args(conv)?;
    let crs = a.get(1).and_then(|v| v.as_ref_id());
    let c = crs.and_then(|c| doc.args(c)).unwrap_or_default();
    let scale = a.get(7).and_then(|v| v.as_f64()).unwrap_or(1.0);
    Some(Georef {
        conversion: Some(conv),
        crs,
        eastings: f(a.get(2)),
        northings: f(a.get(3)),
        height: f(a.get(4)),
        abscissa: a.get(5).and_then(|v| v.as_f64()).unwrap_or(1.0),
        ordinate: f(a.get(6)),
        scale,
        crs_name: st(c.first()),
        crs_description: st(c.get(1)),
        geodetic_datum: st(c.get(2)),
        vertical_datum: st(c.get(3)),
        projection: st(c.get(4)),
        zone: st(c.get(5)),
    })
}

fn s_or_null(t: &str) -> Value {
    if t.trim().is_empty() {
        Value::Null
    } else {
        Value::Str(t.trim().to_string())
    }
}

/// Create or update IfcMapConversion and IfcProjectedCRS.
pub fn write(doc: &mut Document, g: &Georef) -> anyhow::Result<()> {
    if doc.schema_id == SchemaId::Ifc2x3 {
        anyhow::bail!("IfcMapConversion gibt es erst ab IFC4 (IFC2x3: Breite/Länge am IfcSite)");
    }
    let crs_args = |unit: Value| vec![Value::Str(g.crs_name.trim().to_string()), s_or_null(&g.crs_description), s_or_null(&g.geodetic_datum), s_or_null(&g.vertical_datum), s_or_null(&g.projection), s_or_null(&g.zone), unit];
    let crs = match g.crs.filter(|c| doc.exists(*c)) {
        Some(c) => {
            let unit = doc.arg(c, 6).unwrap_or(Value::Null);
            doc.set_args(c, &crs_args(unit))?;
            c
        }
        None => doc.create("IFCPROJECTEDCRS", &crs_args(Value::Null)),
    };
    let n = doc.schema().attr_names("IFCMAPCONVERSION").len().max(8);
    match g.conversion.filter(|c| doc.exists(*c)) {
        Some(c) => {
            let mut a = doc.args(c).unwrap_or_default();
            a.resize(n, Value::Null);
            a[1] = Value::Ref(crs);
            a[2] = Value::Real(g.eastings);
            a[3] = Value::Real(g.northings);
            a[4] = Value::Real(g.height);
            a[5] = Value::Real(g.abscissa);
            a[6] = Value::Real(g.ordinate);
            a[7] = Value::Real(g.scale);
            doc.set_args(c, &a)?;
        }
        None => {
            let ctx = doc.ids_of_type("IFCGEOMETRICREPRESENTATIONCONTEXT").into_iter().next().ok_or_else(|| anyhow::anyhow!("Kein Darstellungskontext im Modell"))?;
            let mut a = vec![Value::Null; n];
            a[0] = Value::Ref(ctx);
            a[1] = Value::Ref(crs);
            a[2] = Value::Real(g.eastings);
            a[3] = Value::Real(g.northings);
            a[4] = Value::Real(g.height);
            a[5] = Value::Real(g.abscissa);
            a[6] = Value::Real(g.ordinate);
            a[7] = Value::Real(g.scale);
            doc.create("IFCMAPCONVERSION", &a);
        }
    }
    Ok(())
}

/// Site reference latitude/longitude (decimal degrees) and elevation.
pub fn site_reference(doc: &Document) -> Option<(f64, f64, Option<f64>)> {
    let site = doc.ids_of_type("IFCSITE").into_iter().next()?;
    let angle = |v: Value| -> Option<f64> {
        let l: Vec<f64> = match v {
            Value::List(l) => l.iter().filter_map(|x| x.as_f64()).collect(),
            _ => return None,
        };
        let sign = if l.iter().any(|x| *x < 0.0) { -1.0 } else { 1.0 };
        let p = |i: usize| l.get(i).copied().unwrap_or(0.0).abs();
        Some(sign * (p(0) + p(1) / 60.0 + p(2) / 3600.0 + p(3) / 3.6e9))
    };
    let lat = angle(doc.attr(site, "RefLatitude")?)?;
    let lon = angle(doc.attr(site, "RefLongitude")?)?;
    let elev = doc.attr(site, "RefElevation").and_then(|v| v.as_f64());
    Some((lat, lon, elev))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_and_write() {
        let mut doc = crate::ops::new_project(SchemaId::Ifc4, "T", &[("EG".into(), 0.0)]);
        assert!(read(&doc).is_none());
        let mut g = Georef::new_default(&doc);
        g.eastings = 500_000.0;
        g.northings = 5_400_000.0;
        g.height = 100.0;
        g.set_rotation_deg(90.0);
        write(&mut doc, &g).unwrap();
        let r = read(&doc).unwrap();
        assert!((r.rotation_deg() - 90.0).abs() < 1e-9);
        let unit = crate::model::length_unit(&doc).0;
        let m = r.to_map([10.0, 0.0, 2.0], unit);
        assert!((m[0] - 500_000.0).abs() < 1e-6 && (m[1] - 5_400_010.0).abs() < 1e-6 && (m[2] - 102.0).abs() < 1e-6, "{m:?}");
        // update in place
        let mut r2 = r.clone();
        r2.eastings = 1.0;
        write(&mut doc, &r2).unwrap();
        assert_eq!(doc.ids_of_type("IFCMAPCONVERSION").len(), 1);
        assert_eq!(read(&doc).unwrap().eastings, 1.0);
    }
}
