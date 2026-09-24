//! 2D export of a cut through the visible model (floor plan or section):
//! cut polygons per object (closed loops where possible) plus optional
//! projected edges below the cut, written as SVG (scale 1:100) or DXF (R12).

use crate::session::Session;
use crate::viewer::scene::flags;
use glam::{DVec3, Vec3};
use rustc_hash::FxHashMap;
use std::fmt::Write as _;

/// Cut plane in scene coordinates; `normal` points to the removed side.
pub struct Cut {
    pub normal: Vec3,
    pub point: Vec3,
    pub label: String,
}

/// The active floor plan cut or the first enabled section plane.
pub fn current_cut(s: &Session) -> Option<Cut> {
    if let Some((st, cut)) = s.plan {
        let z = s.storey_elevation(st)? + cut;
        return Some(Cut { normal: Vec3::Z, point: Vec3::new(0.0, 0.0, z), label: format!("Grundriss {} (Schnitthöhe {:+.2} m)", ifc_doc::model::label(&s.doc, st), cut) });
    }
    let sec = s.sections.iter().find(|x| x.enabled)?;
    Some(Cut { normal: sec.normal.normalize_or(Vec3::Z), point: sec.point, label: "Schnitt".into() })
}

pub struct ObjCut {
    pub id: u32,
    pub class: String,
    pub name: String,
    pub color: [u8; 4],
    /// Cut polylines (closed where the section is closed).
    pub loops: Vec<(Vec<[f64; 2]>, bool)>,
}

pub struct CutResult {
    pub objects: Vec<ObjCut>,
    /// Projected edges below the cut (2D segments).
    pub projection: Vec<[[f64; 2]; 2]>,
    pub label: String,
}

struct Basis {
    n: DVec3,
    p: DVec3,
    u: DVec3,
    v: DVec3,
    origin: DVec3,
}

impl Basis {
    fn new(cut: &Cut, origin: DVec3) -> Basis {
        let n = cut.normal.as_dvec3().normalize();
        let (u, v) = if n.z.abs() > 0.99 {
            (DVec3::X, DVec3::Y)
        } else {
            // vertical section: look against the normal, Z up
            let u = DVec3::Z.cross(n).normalize();
            (u, n.cross(u).normalize())
        };
        Basis { n, p: cut.point.as_dvec3(), u, v, origin }
    }
    fn dist(&self, q: DVec3) -> f64 {
        self.n.dot(q - self.p)
    }
    fn to2d(&self, q: DVec3) -> [f64; 2] {
        let w = q + self.origin;
        [self.u.dot(w), self.v.dot(w)]
    }
}

fn key(p: [f64; 2]) -> (i64, i64) {
    ((p[0] * 1e5).round() as i64, (p[1] * 1e5).round() as i64)
}

/// Chain unordered segments into polylines (closed loops where possible).
fn chain(segs: Vec<[[f64; 2]; 2]>) -> Vec<(Vec<[f64; 2]>, bool)> {
    let mut adj: FxHashMap<(i64, i64), Vec<usize>> = FxHashMap::default();
    for (i, s) in segs.iter().enumerate() {
        adj.entry(key(s[0])).or_default().push(i);
        adj.entry(key(s[1])).or_default().push(i);
    }
    let mut used = vec![false; segs.len()];
    let mut out = Vec::new();
    for start in 0..segs.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let mut pts = vec![segs[start][0], segs[start][1]];
        // extend forward, then backward
        for dir in 0..2 {
            loop {
                let end = if dir == 0 { *pts.last().unwrap() } else { pts[0] };
                let next = adj.get(&key(end)).and_then(|l| l.iter().copied().find(|&i| !used[i]));
                let Some(i) = next else { break };
                used[i] = true;
                let s = segs[i];
                let other = if key(s[0]) == key(end) { s[1] } else { s[0] };
                if dir == 0 {
                    pts.push(other);
                } else {
                    pts.insert(0, other);
                }
            }
        }
        let closed = pts.len() > 3 && key(pts[0]) == key(*pts.last().unwrap());
        if closed {
            pts.pop();
        }
        out.push((pts, closed));
    }
    out
}

/// Cut all visible objects; `depth` > 0 adds edges up to that distance behind the cut.
pub fn compute(s: &Session, cut: &Cut, depth: f64) -> CutResult {
    use rayon::prelude::*;
    let b = Basis::new(cut, s.scene.origin);
    let eps = 1e-7;
    let items: Vec<(u32, std::sync::Arc<ifc_geom::ProductGeom>)> = s.scene.objects.iter().enumerate().filter(|(i, o)| o.geom.is_some() && s.scene.state[*i][0] & flags::HIDDEN == 0).map(|(_, o)| (o.id, o.geom.clone().unwrap())).collect();
    let per: Vec<(Option<ObjCut>, Vec<[[f64; 2]; 2]>)> = items
        .par_iter()
        .map(|(id, g)| {
            // bbox test
            let (lo, hi) = (Vec3::from(g.min).as_dvec3(), Vec3::from(g.max).as_dvec3());
            let mut dmin = f64::MAX;
            let mut dmax = f64::MIN;
            for k in 0..8 {
                let c = DVec3::new(if k & 1 == 0 { lo.x } else { hi.x }, if k & 2 == 0 { lo.y } else { hi.y }, if k & 4 == 0 { lo.z } else { hi.z });
                let d = b.dist(c);
                dmin = dmin.min(d);
                dmax = dmax.max(d);
            }
            let mut cut_obj = None;
            if dmin < 0.0 && dmax > 0.0 {
                let mut segs: Vec<[[f64; 2]; 2]> = Vec::new();
                for t in g.indices.chunks_exact(3) {
                    let p: [DVec3; 3] = [0, 1, 2].map(|k| Vec3::from(g.positions[t[k] as usize]).as_dvec3());
                    let d: [f64; 3] = p.map(|q| b.dist(q));
                    if (d[0] > eps && d[1] > eps && d[2] > eps) || (d[0] < -eps && d[1] < -eps && d[2] < -eps) {
                        continue;
                    }
                    if d.iter().all(|x| x.abs() <= eps) {
                        continue; // coplanar face
                    }
                    let mut hits: Vec<DVec3> = Vec::with_capacity(3);
                    for (a, c) in [(0, 1), (1, 2), (2, 0)] {
                        if d[a].abs() <= eps {
                            hits.push(p[a]);
                        } else if (d[a] < 0.0) != (d[c] < 0.0) && d[c].abs() > eps {
                            let f = d[a] / (d[a] - d[c]);
                            hits.push(p[a] + (p[c] - p[a]) * f);
                        }
                    }
                    hits.dedup_by(|x, y| x.distance(*y) < 1e-9);
                    if hits.len() >= 2 && hits[0].distance(hits[1]) > 1e-7 {
                        segs.push([b.to2d(hits[0]), b.to2d(hits[1])]);
                    }
                }
                if !segs.is_empty() {
                    let color = g.colors.first().copied().unwrap_or([200, 200, 200, 255]);
                    cut_obj = Some(ObjCut { id: *id, class: s.doc.type_camel(*id).unwrap_or("IfcProduct").to_string(), name: ifc_doc::model::label(&s.doc, *id), color, loops: chain(segs) });
                }
            }
            // projection of feature edges behind the cut (removed side has d > 0)
            let mut proj = Vec::new();
            if depth > 0.0 && dmin < 0.0 && dmax > -depth {
                for e in g.edges.chunks_exact(2) {
                    let a = Vec3::from(g.positions[e[0] as usize]).as_dvec3();
                    let c = Vec3::from(g.positions[e[1] as usize]).as_dvec3();
                    let (da, dc) = (b.dist(a), b.dist(c));
                    if (da > 0.0 && dc > 0.0) || da < -depth && dc < -depth {
                        continue;
                    }
                    // clip to the kept side
                    let (a, c) = if da > 0.0 { (a + (c - a) * (da / (da - dc)), c) } else if dc > 0.0 { (a, a + (c - a) * (da / (da - dc))) } else { (a, c) };
                    let (p2, q2) = (b.to2d(a), b.to2d(c));
                    if (p2[0] - q2[0]).abs() + (p2[1] - q2[1]).abs() > 1e-6 {
                        proj.push([p2, q2]);
                    }
                }
            }
            (cut_obj, proj)
        })
        .collect();
    let mut objects = Vec::new();
    let mut projection = Vec::new();
    for (o, p) in per {
        if let Some(o) = o {
            objects.push(o);
        }
        projection.extend(p);
    }
    objects.sort_by(|a, b| a.class.cmp(&b.class).then(a.id.cmp(&b.id)));
    CutResult { objects, projection, label: cut.label.clone() }
}

fn bounds(r: &CutResult) -> Option<([f64; 2], [f64; 2])> {
    let mut lo = [f64::MAX; 2];
    let mut hi = [f64::MIN; 2];
    let mut any = false;
    let mut add = |p: &[f64; 2]| {
        any = true;
        for k in 0..2 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    };
    for o in &r.objects {
        for (l, _) in &o.loops {
            l.iter().for_each(&mut add);
        }
    }
    for s in &r.projection {
        add(&s[0]);
        add(&s[1]);
    }
    any.then_some((lo, hi))
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// SVG in metres, printed at 1:100 (1 m = 10 mm), y up.
pub fn write_svg(r: &CutResult, path: &std::path::Path) -> anyhow::Result<()> {
    let (lo, hi) = bounds(r).ok_or_else(|| anyhow::anyhow!("Der Schnitt trifft keine sichtbare Geometrie"))?;
    let m = 1.0;
    let (w, h) = (hi[0] - lo[0] + 2.0 * m, hi[1] - lo[1] + 2.0 * m);
    let x0 = lo[0] - m;
    let y0 = -(hi[1] + m);
    let mut out = String::new();
    let _ = writeln!(out, r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    let _ = writeln!(out, r#"<svg xmlns="http://www.w3.org/2000/svg" width="{:.1}mm" height="{:.1}mm" viewBox="{x0:.4} {y0:.4} {w:.4} {h:.4}">"#, w * 10.0, h * 10.0);
    let _ = writeln!(out, "<title>{}</title>", esc(&r.label));
    let _ = writeln!(out, "<!-- IFCnative: Koordinaten in Metern, Maßstab 1:100 bei Druck in Originalgröße -->");
    let _ = writeln!(out, r#"<style>path{{vector-effect:non-scaling-stroke}} .cut{{stroke:#111;stroke-width:1.2}} .proj{{stroke:#777;stroke-width:0.5;fill:none}}</style>"#);
    let _ = writeln!(out, r#"<g transform="scale(1,-1)">"#);
    if !r.projection.is_empty() {
        let _ = write!(out, r#"<g id="Ansicht"><path class="proj" d=""#);
        for s in &r.projection {
            let _ = write!(out, "M{:.4} {:.4}L{:.4} {:.4}", s[0][0], s[0][1], s[1][0], s[1][1]);
        }
        let _ = writeln!(out, r#""/></g>"#);
    }
    let mut class = String::new();
    for o in &r.objects {
        if o.class != class {
            if !class.is_empty() {
                let _ = writeln!(out, "</g>");
            }
            class = o.class.clone();
            let _ = writeln!(out, r#"<g id="{}">"#, esc(&class));
        }
        let [cr, cg, cb, _] = o.color;
        // lighter fill of the object colour
        let f = |c: u8| (c as f32 * 0.7 + 255.0 * 0.3) as u8;
        let mut d = String::new();
        let mut open_d = String::new();
        for (pts, closed) in &o.loops {
            let target = if *closed { &mut d } else { &mut open_d };
            for (i, p) in pts.iter().enumerate() {
                let _ = write!(target, "{}{:.4} {:.4}", if i == 0 { "M" } else { "L" }, p[0], p[1]);
            }
            if *closed {
                target.push('Z');
            }
        }
        if !d.is_empty() {
            let _ = writeln!(out, r##"<path class="cut" fill="#{:02x}{:02x}{:02x}" fill-rule="evenodd" data-id="#{}" d="{d}"><title>{} ({})</title></path>"##, f(cr), f(cg), f(cb), o.id, esc(&o.name), esc(&o.class));
        }
        if !open_d.is_empty() {
            let _ = writeln!(out, r##"<path class="cut" fill="none" data-id="#{}" d="{open_d}"/>"##, o.id);
        }
    }
    if !class.is_empty() {
        let _ = writeln!(out, "</g>");
    }
    let _ = writeln!(out, "</g>\n</svg>");
    std::fs::write(path, out)?;
    Ok(())
}

/// DXF R12 (ASCII): one layer per IFC class, closed cut loops as polylines, projection on layer "Ansicht".
pub fn write_dxf(r: &CutResult, path: &std::path::Path) -> anyhow::Result<()> {
    if r.objects.is_empty() && r.projection.is_empty() {
        anyhow::bail!("Der Schnitt trifft keine sichtbare Geometrie");
    }
    let mut layers: Vec<String> = r.objects.iter().map(|o| o.class.clone()).collect();
    layers.sort();
    layers.dedup();
    let mut out = String::new();
    let mut w = |code: i32, v: &str| {
        let _ = writeln!(out, "{code}\n{v}");
    };
    w(0, "SECTION");
    w(2, "HEADER");
    w(9, "$ACADVER");
    w(1, "AC1009");
    w(9, "$INSUNITS");
    w(70, "6");
    w(0, "ENDSEC");
    w(0, "SECTION");
    w(2, "TABLES");
    w(0, "TABLE");
    w(2, "LAYER");
    w(70, &(layers.len() + 1).to_string());
    let aci = [7, 1, 3, 5, 6, 4, 2, 30, 140, 200];
    for (i, l) in layers.iter().chain(std::iter::once(&"Ansicht".to_string())).enumerate() {
        w(0, "LAYER");
        w(2, l);
        w(70, "0");
        w(62, &(if l == "Ansicht" { 8 } else { aci[i % aci.len()] }).to_string());
        w(6, "CONTINUOUS");
    }
    w(0, "ENDTAB");
    w(0, "ENDSEC");
    w(0, "SECTION");
    w(2, "ENTITIES");
    let f = |v: f64| format!("{v:.5}");
    for o in &r.objects {
        for (pts, closed) in &o.loops {
            w(0, "POLYLINE");
            w(8, &o.class);
            w(66, "1");
            w(70, if *closed { "1" } else { "0" });
            w(10, "0");
            w(20, "0");
            w(30, "0");
            for p in pts {
                w(0, "VERTEX");
                w(8, &o.class);
                w(10, &f(p[0]));
                w(20, &f(p[1]));
                w(30, "0");
            }
            w(0, "SEQEND");
            w(8, &o.class);
        }
    }
    for s in &r.projection {
        w(0, "LINE");
        w(8, "Ansicht");
        w(10, &f(s[0][0]));
        w(20, &f(s[0][1]));
        w(30, "0");
        w(11, &f(s[1][0]));
        w(21, &f(s[1][1]));
        w(31, "0");
    }
    w(0, "ENDSEC");
    w(0, "EOF");
    std::fs::write(path, out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chains_square() {
        let s = vec![[[0.0, 0.0], [1.0, 0.0]], [[1.0, 1.0], [0.0, 1.0]], [[1.0, 0.0], [1.0, 1.0]], [[0.0, 1.0], [0.0, 0.0]]];
        let c = chain(s);
        assert_eq!(c.len(), 1);
        assert!(c[0].1);
        assert_eq!(c[0].0.len(), 4);
    }
}
