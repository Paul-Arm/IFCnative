//! Curve sampling and profile definitions (2D areas for sweeps).

use crate::engine::{Cache, Engine};
use crate::mesh::{area2, dedup_ring2};
use glam::{DMat4, DVec2, DVec3};
use ifc_doc::Value;
use std::f64::consts::{PI, TAU};

#[derive(Clone, Debug, Default)]
pub struct Poly2 {
    pub outer: Vec<DVec2>,
    pub holes: Vec<Vec<DVec2>>,
}

#[derive(Clone, Debug, Default)]
pub struct Profile {
    pub polys: Vec<Poly2>,
    /// Open curves (IfcArbitraryOpenProfileDef without thickness) -> extruded as surfaces.
    pub open: Vec<Vec<DVec2>>,
}

impl Profile {
    pub fn transformed(mut self, m: &DMat4) -> Profile {
        let tf = |p: &mut DVec2| {
            let q = m.transform_point3(DVec3::new(p.x, p.y, 0.0));
            *p = DVec2::new(q.x, q.y);
        };
        for poly in &mut self.polys {
            poly.outer.iter_mut().for_each(tf);
            for h in &mut poly.holes {
                h.iter_mut().for_each(tf);
            }
        }
        for o in &mut self.open {
            o.iter_mut().for_each(tf);
        }
        self.normalize();
        self
    }

    /// Make outer rings CCW and holes CW, drop degenerate rings.
    pub fn normalize(&mut self) {
        for poly in &mut self.polys {
            dedup_ring2(&mut poly.outer, 1e-9);
            if area2(&poly.outer) < 0.0 {
                poly.outer.reverse();
            }
            for h in &mut poly.holes {
                dedup_ring2(h, 1e-9);
                if area2(h) > 0.0 {
                    h.reverse();
                }
            }
            poly.holes.retain(|h| h.len() >= 3);
        }
        self.polys.retain(|p| p.outer.len() >= 3 && area2(&p.outer).abs() > 1e-14);
    }
}

pub fn circle_pts(c: DVec2, r: f64, n: usize) -> Vec<DVec2> {
    (0..n).map(|i| {
        let a = TAU * i as f64 / n as f64;
        c + DVec2::new(a.cos(), a.sin()) * r
    })
    .collect()
}

/// Rectangle with optional rounded corners (radius r), CCW, centered.
fn rounded_rect(w: f64, h: f64, r: f64, seg: usize) -> Vec<DVec2> {
    let (hw, hh) = (w / 2.0, h / 2.0);
    if r <= 1e-12 || r * 2.0 > w.min(h) {
        return vec![DVec2::new(-hw, -hh), DVec2::new(hw, -hh), DVec2::new(hw, hh), DVec2::new(-hw, hh)];
    }
    let mut out = Vec::new();
    let corners = [(DVec2::new(hw - r, -hh + r), -PI / 2.0), (DVec2::new(hw - r, hh - r), 0.0), (DVec2::new(-hw + r, hh - r), PI / 2.0), (DVec2::new(-hw + r, -hh + r), PI)];
    let n = seg.max(2);
    for (c, a0) in corners {
        for i in 0..=n {
            let a = a0 + (PI / 2.0) * i as f64 / n as f64;
            out.push(c + DVec2::new(a.cos(), a.sin()) * r);
        }
    }
    out
}

impl<'a> Engine<'a> {
    pub(crate) fn segments_for_radius(&self, r: f64) -> usize {
        let rm = (r * self.unit).abs();
        let n = (TAU * rm / 0.04).ceil() as usize;
        n.clamp(self.opts.min_circle_segments, self.opts.max_circle_segments)
    }

    pub(crate) fn f(&self, args: &[Value], i: usize) -> f64 {
        args.get(i).and_then(|v| v.as_f64()).unwrap_or(0.0)
    }

    pub(crate) fn opt_f(&self, args: &[Value], i: usize) -> Option<f64> {
        args.get(i).and_then(|v| v.as_f64())
    }

    /// Profile definition -> 2D areas (in profile coordinates, positioned).
    pub fn profile(&self, c: &mut Cache, id: u32, depth: u32) -> Profile {
        if depth > 16 {
            return Profile::default();
        }
        if let Some(p) = c.profiles.get(&id) {
            return p.clone();
        }
        let p = self.profile_uncached(c, id, depth);
        c.profiles.insert(id, p.clone());
        p
    }

    fn profile_uncached(&self, c: &mut Cache, id: u32, depth: u32) -> Profile {
        let Some(ty) = self.doc.type_name(id) else { return Profile::default() };
        let ty = ty.to_string();
        let Some(a) = self.doc.args(id) else { return Profile::default() };
        let pos_m = if ty.ends_with("PROFILEDEF") && !ty.starts_with("IFCARBITRARY") && !matches!(ty.as_str(), "IFCDERIVEDPROFILEDEF" | "IFCMIRROREDPROFILEDEF" | "IFCCOMPOSITEPROFILEDEF" | "IFCCENTERLINEPROFILEDEF") {
            a.get(2).and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY)
        } else {
            DMat4::IDENTITY
        };
        let pos = || pos_m;
        let mut prof = Profile::default();
        let simple = |outer: Vec<DVec2>| Profile { polys: vec![Poly2 { outer, holes: vec![] }], open: vec![] };
        match ty.as_str() {
            "IFCRECTANGLEPROFILEDEF" => {
                prof = simple(rounded_rect(self.f(&a, 3), self.f(&a, 4), 0.0, 0));
                return prof.transformed(&pos());
            }
            "IFCROUNDEDRECTANGLEPROFILEDEF" => {
                let r = self.f(&a, 5);
                prof = simple(rounded_rect(self.f(&a, 3), self.f(&a, 4), r, self.segments_for_radius(r) / 4));
                return prof.transformed(&pos());
            }
            "IFCRECTANGLEHOLLOWPROFILEDEF" => {
                let (w, h, t) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5));
                let ri = self.opt_f(&a, 6).unwrap_or(0.0);
                let ro = self.opt_f(&a, 7).unwrap_or(0.0);
                let outer = rounded_rect(w, h, ro, self.segments_for_radius(ro) / 4);
                let mut inner = rounded_rect(w - 2.0 * t, h - 2.0 * t, ri, self.segments_for_radius(ri) / 4);
                inner.reverse();
                prof.polys.push(Poly2 { outer, holes: if t > 0.0 && t * 2.0 < w.min(h) { vec![inner] } else { vec![] } });
                return prof.transformed(&pos());
            }
            "IFCCIRCLEPROFILEDEF" => {
                let r = self.f(&a, 3);
                prof = simple(circle_pts(DVec2::ZERO, r, self.segments_for_radius(r)));
                return prof.transformed(&pos());
            }
            "IFCCIRCLEHOLLOWPROFILEDEF" => {
                let r = self.f(&a, 3);
                let t = self.f(&a, 4);
                let n = self.segments_for_radius(r);
                let mut inner = circle_pts(DVec2::ZERO, (r - t).max(0.0), n);
                inner.reverse();
                prof.polys.push(Poly2 { outer: circle_pts(DVec2::ZERO, r, n), holes: if t > 0.0 && t < r { vec![inner] } else { vec![] } });
                return prof.transformed(&pos());
            }
            "IFCELLIPSEPROFILEDEF" => {
                let (ra, rb) = (self.f(&a, 3), self.f(&a, 4));
                let n = self.segments_for_radius(ra.max(rb));
                let pts = (0..n).map(|i| {
                    let t = TAU * i as f64 / n as f64;
                    DVec2::new(ra * t.cos(), rb * t.sin())
                });
                prof = simple(pts.collect());
                return prof.transformed(&pos());
            }
            "IFCISHAPEPROFILEDEF" => {
                let (w, d, tw, tf) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let (hw, hd, htw) = (w / 2.0, d / 2.0, tw / 2.0);
                let pts = vec![
                    DVec2::new(-hw, -hd),
                    DVec2::new(hw, -hd),
                    DVec2::new(hw, -hd + tf),
                    DVec2::new(htw, -hd + tf),
                    DVec2::new(htw, hd - tf),
                    DVec2::new(hw, hd - tf),
                    DVec2::new(hw, hd),
                    DVec2::new(-hw, hd),
                    DVec2::new(-hw, hd - tf),
                    DVec2::new(-htw, hd - tf),
                    DVec2::new(-htw, -hd + tf),
                    DVec2::new(-hw, -hd + tf),
                ];
                return simple(pts).transformed(&pos());
            }
            "IFCASYMMETRICISHAPEPROFILEDEF" => {
                let (bw, d, tw, btf) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let tfw = self.opt_f(&a, 8).unwrap_or(bw);
                let ttf = self.opt_f(&a, 9).unwrap_or(btf);
                let (hb, ht, hd, htw) = (bw / 2.0, tfw / 2.0, d / 2.0, tw / 2.0);
                let pts = vec![
                    DVec2::new(-hb, -hd),
                    DVec2::new(hb, -hd),
                    DVec2::new(hb, -hd + btf),
                    DVec2::new(htw, -hd + btf),
                    DVec2::new(htw, hd - ttf),
                    DVec2::new(ht, hd - ttf),
                    DVec2::new(ht, hd),
                    DVec2::new(-ht, hd),
                    DVec2::new(-ht, hd - ttf),
                    DVec2::new(-htw, hd - ttf),
                    DVec2::new(-htw, -hd + btf),
                    DVec2::new(-hb, -hd + btf),
                ];
                return simple(pts).transformed(&pos());
            }
            "IFCLSHAPEPROFILEDEF" => {
                let d = self.f(&a, 3);
                let w = self.opt_f(&a, 4).unwrap_or(d);
                let t = self.f(&a, 5);
                let (hw, hd) = (w / 2.0, d / 2.0);
                let pts = vec![DVec2::new(-hw, -hd), DVec2::new(hw, -hd), DVec2::new(hw, -hd + t), DVec2::new(-hw + t, -hd + t), DVec2::new(-hw + t, hd), DVec2::new(-hw, hd)];
                return simple(pts).transformed(&pos());
            }
            "IFCTSHAPEPROFILEDEF" => {
                let (d, fw, tw, tf) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let (hd, hf, ht) = (d / 2.0, fw / 2.0, tw / 2.0);
                let pts = vec![
                    DVec2::new(-ht, -hd),
                    DVec2::new(ht, -hd),
                    DVec2::new(ht, hd - tf),
                    DVec2::new(hf, hd - tf),
                    DVec2::new(hf, hd),
                    DVec2::new(-hf, hd),
                    DVec2::new(-hf, hd - tf),
                    DVec2::new(-ht, hd - tf),
                ];
                return simple(pts).transformed(&pos());
            }
            "IFCUSHAPEPROFILEDEF" => {
                let (d, fw, tw, tf) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let (hd, hf) = (d / 2.0, fw / 2.0);
                let pts = vec![
                    DVec2::new(-hf, -hd),
                    DVec2::new(hf, -hd),
                    DVec2::new(hf, -hd + tf),
                    DVec2::new(-hf + tw, -hd + tf),
                    DVec2::new(-hf + tw, hd - tf),
                    DVec2::new(hf, hd - tf),
                    DVec2::new(hf, hd),
                    DVec2::new(-hf, hd),
                ];
                return simple(pts).transformed(&pos());
            }
            "IFCCSHAPEPROFILEDEF" => {
                let (d, w, t, g) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let (hd, hw) = (d / 2.0, w / 2.0);
                let pts = vec![
                    DVec2::new(-hw, -hd),
                    DVec2::new(hw, -hd),
                    DVec2::new(hw, -hd + g),
                    DVec2::new(hw - t, -hd + g),
                    DVec2::new(hw - t, -hd + t),
                    DVec2::new(-hw + t, -hd + t),
                    DVec2::new(-hw + t, hd - t),
                    DVec2::new(hw - t, hd - t),
                    DVec2::new(hw - t, hd - g),
                    DVec2::new(hw, hd - g),
                    DVec2::new(hw, hd),
                    DVec2::new(-hw, hd),
                ];
                return simple(pts).transformed(&pos());
            }
            "IFCZSHAPEPROFILEDEF" => {
                let (d, fw, tw, tf) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let (hd, ht) = (d / 2.0, tw / 2.0);
                let pts = vec![
                    DVec2::new(-fw + ht, -hd),
                    DVec2::new(ht, -hd),
                    DVec2::new(ht, hd - tf),
                    DVec2::new(fw - ht, hd - tf),
                    DVec2::new(fw - ht, hd),
                    DVec2::new(-ht, hd),
                    DVec2::new(-ht, -hd + tf),
                    DVec2::new(-fw + ht, -hd + tf),
                ];
                return simple(pts).transformed(&pos());
            }
            "IFCTRAPEZIUMPROFILEDEF" => {
                let (bx, tx, y, off) = (self.f(&a, 3), self.f(&a, 4), self.f(&a, 5), self.f(&a, 6));
                let pts = vec![DVec2::new(-bx / 2.0, -y / 2.0), DVec2::new(bx / 2.0, -y / 2.0), DVec2::new(-bx / 2.0 + off + tx, y / 2.0), DVec2::new(-bx / 2.0 + off, y / 2.0)];
                return simple(pts).transformed(&pos());
            }
            "IFCARBITRARYCLOSEDPROFILEDEF" | "IFCARBITRARYPROFILEDEFWITHVOIDS" => {
                let outer = a.get(2).and_then(|v| v.as_ref_id()).map(|cid| self.curve2(c, cid)).unwrap_or_default();
                let mut holes = Vec::new();
                if ty == "IFCARBITRARYPROFILEDEFWITHVOIDS" {
                    for h in a.get(3).map(|v| v.ref_list()).unwrap_or_default() {
                        holes.push(self.curve2(c, h));
                    }
                }
                prof.polys.push(Poly2 { outer, holes });
                prof.normalize();
                return prof;
            }
            "IFCARBITRARYOPENPROFILEDEF" => {
                let pts = a.get(2).and_then(|v| v.as_ref_id()).map(|cid| self.curve2(c, cid)).unwrap_or_default();
                prof.open.push(pts);
                return prof;
            }
            "IFCCENTERLINEPROFILEDEF" => {
                let pts = a.get(2).and_then(|v| v.as_ref_id()).map(|cid| self.curve2(c, cid)).unwrap_or_default();
                let t = self.f(&a, 3);
                if pts.len() >= 2 && t > 0.0 {
                    let left = offset_polyline(&pts, t / 2.0);
                    let mut right = offset_polyline(&pts, -t / 2.0);
                    right.reverse();
                    let mut outer = left;
                    outer.extend(right);
                    prof.polys.push(Poly2 { outer, holes: vec![] });
                    prof.normalize();
                }
                return prof;
            }
            "IFCDERIVEDPROFILEDEF" | "IFCMIRROREDPROFILEDEF" => {
                let parent = a.get(2).and_then(|v| v.as_ref_id()).map(|p| self.profile(c, p, depth + 1)).unwrap_or_default();
                let m = a.get(3).and_then(|v| v.as_ref_id()).map(|o| self.cto(o)).unwrap_or(DMat4::IDENTITY);
                let m = if ty == "IFCMIRROREDPROFILEDEF" { DMat4::from_scale(DVec3::new(-1.0, 1.0, 1.0)) * m } else { m };
                return parent.transformed(&m);
            }
            "IFCCOMPOSITEPROFILEDEF" => {
                for p in a.get(2).map(|v| v.ref_list()).unwrap_or_default() {
                    let sub = self.profile(c, p, depth + 1);
                    prof.polys.extend(sub.polys);
                    prof.open.extend(sub.open);
                }
                return prof;
            }
            _ => {}
        }
        prof
    }

    /// 2D curve -> closed or open point list (projected to XY).
    pub fn curve2(&self, c: &mut Cache, id: u32) -> Vec<DVec2> {
        let mut pts: Vec<DVec2> = self.curve3(c, id, 0).into_iter().map(|p| DVec2::new(p.x, p.y)).collect();
        dedup_ring2(&mut pts, 1e-9);
        pts
    }

    /// Sample a curve into points.
    pub fn curve3(&self, c: &mut Cache, id: u32, depth: u32) -> Vec<DVec3> {
        if depth > 32 {
            return vec![];
        }
        let Some(ty) = self.doc.type_name(id) else { return vec![] };
        let ty = ty.to_string();
        let Some(a) = self.doc.args(id) else { return vec![] };
        match ty.as_str() {
            "IFCPOLYLINE" => a.first().map(|v| v.ref_list()).unwrap_or_default().into_iter().filter_map(|p| self.point(c, p)).collect(),
            "IFCINDEXEDPOLYCURVE" => {
                let pts = a.first().and_then(|v| v.as_ref_id()).map(|l| self.point_list(l)).unwrap_or_default();
                match a.get(1) {
                    Some(Value::List(segs)) if !segs.is_empty() => {
                        let mut out: Vec<DVec3> = Vec::new();
                        for s in segs {
                            if let Value::Typed(t, inner) = s {
                                let idx: Vec<usize> = inner.as_list().map(|l| l.iter().filter_map(|v| v.as_i64()).map(|i| (i.max(1) - 1) as usize).collect()).unwrap_or_default();
                                if t == "IFCARCINDEX" && idx.len() == 3 {
                                    if let (Some(&p0), Some(&p1), Some(&p2)) = (pts.get(idx[0]), pts.get(idx[1]), pts.get(idx[2])) {
                                        let arc = self.arc3(p0, p1, p2);
                                        push_skip_dup(&mut out, &arc);
                                    }
                                } else {
                                    let seg: Vec<DVec3> = idx.iter().filter_map(|&i| pts.get(i).copied()).collect();
                                    push_skip_dup(&mut out, &seg);
                                }
                            }
                        }
                        out
                    }
                    _ => pts,
                }
            }
            "IFCCOMPOSITECURVE" | "IFCCOMPOSITECURVEONSURFACE" | "IFCGRADIENTCURVE" | "IFCSEGMENTEDREFERENCECURVE" => {
                let mut out: Vec<DVec3> = Vec::new();
                for seg in a.first().map(|v| v.ref_list()).unwrap_or_default() {
                    let Some(sa) = self.doc.args(seg) else { continue };
                    let st = self.doc.type_name(seg).unwrap_or("");
                    if st == "IFCCOMPOSITECURVESEGMENT" || st == "IFCREPARAMETRISEDCOMPOSITECURVESEGMENT" {
                        let same = sa.get(1).and_then(|v| v.as_enum()) != Some("F");
                        let Some(parent) = sa.get(2).and_then(|v| v.as_ref_id()) else { continue };
                        let mut p = self.curve3(c, parent, depth + 1);
                        if !same {
                            p.reverse();
                        }
                        push_skip_dup(&mut out, &p);
                    }
                }
                out
            }
            "IFCTRIMMEDCURVE" => self.trimmed(c, &a, depth),
            "IFCCIRCLE" => {
                let m = a.first().and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let r = self.f(&a, 1);
                let n = self.segments_for_radius(r);
                let mut v: Vec<DVec3> = (0..n).map(|i| {
                    let t = TAU * i as f64 / n as f64;
                    m.transform_point3(DVec3::new(r * t.cos(), r * t.sin(), 0.0))
                })
                .collect();
                if let Some(f) = v.first().copied() {
                    v.push(f);
                }
                v
            }
            "IFCELLIPSE" => {
                let m = a.first().and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let (ra, rb) = (self.f(&a, 1), self.f(&a, 2));
                let n = self.segments_for_radius(ra.max(rb));
                let mut v: Vec<DVec3> = (0..n).map(|i| {
                    let t = TAU * i as f64 / n as f64;
                    m.transform_point3(DVec3::new(ra * t.cos(), rb * t.sin(), 0.0))
                })
                .collect();
                if let Some(f) = v.first().copied() {
                    v.push(f);
                }
                v
            }
            "IFCBSPLINECURVEWITHKNOTS" | "IFCRATIONALBSPLINECURVEWITHKNOTS" => self.bspline_curve(c, &ty, &a),
            "IFCOFFSETCURVE2D" => {
                let base = a.first().and_then(|v| v.as_ref_id()).map(|b| self.curve3(c, b, depth + 1)).unwrap_or_default();
                let d = self.f(&a, 1);
                let b2: Vec<DVec2> = base.iter().map(|p| DVec2::new(p.x, p.y)).collect();
                offset_polyline(&b2, d).into_iter().map(|p| DVec3::new(p.x, p.y, 0.0)).collect()
            }
            _ => vec![],
        }
    }

    fn arc3(&self, p0: DVec3, p1: DVec3, p2: DVec3) -> Vec<DVec3> {
        // circle through 3 points
        let a = p1 - p0;
        let b = p2 - p0;
        let n = a.cross(b);
        let nl2 = n.length_squared();
        if nl2 < 1e-24 {
            return vec![p0, p2];
        }
        let center = p0 + (b.length_squared() * n.cross(a) + a.length_squared() * b.cross(n)) / (2.0 * nl2);
        let r = (p0 - center).length();
        let nz = n.normalize();
        let u = (p0 - center).normalize();
        let v = nz.cross(u);
        let ang = |p: DVec3| {
            let d = p - center;
            d.dot(v).atan2(d.dot(u))
        };
        let mut a2 = ang(p2);
        if a2 <= 0.0 {
            a2 += TAU;
        }
        let steps = ((self.segments_for_radius(r) as f64) * a2 / TAU).ceil().max(2.0) as usize;
        (0..=steps).map(|i| {
            let t = a2 * i as f64 / steps as f64;
            center + (u * t.cos() + v * t.sin()) * r
        })
        .collect()
    }

    fn trimmed(&self, c: &mut Cache, a: &[Value], depth: u32) -> Vec<DVec3> {
        let Some(basis) = a.first().and_then(|v| v.as_ref_id()) else { return vec![] };
        let bty = self.doc.type_name(basis).unwrap_or("").to_string();
        let sense = a.get(3).and_then(|v| v.as_enum()) != Some("F");
        let trim = |v: Option<&Value>| -> (Option<f64>, Option<DVec3>) {
            let mut par = None;
            let mut pt = None;
            if let Some(Value::List(l)) = v {
                for x in l {
                    match x {
                        Value::Ref(r) => pt = self.point_nc(*r),
                        Value::Typed(t, inner) if t == "IFCPARAMETERVALUE" => par = inner.as_f64(),
                        Value::Real(f) => par = Some(*f),
                        _ => {}
                    }
                }
            }
            (par, pt)
        };
        let (p1, c1) = trim(a.get(1));
        let (p2, c2) = trim(a.get(2));
        let ba = self.doc.args(basis).unwrap_or_default();
        match bty.as_str() {
            "IFCCIRCLE" | "IFCELLIPSE" => {
                let m = ba.first().and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let (ra, rb) = if bty == "IFCCIRCLE" { (self.f(&ba, 1), self.f(&ba, 1)) } else { (self.f(&ba, 1), self.f(&ba, 2)) };
                let inv = m.inverse();
                let angle_of = |p: DVec3| {
                    let l = inv.transform_point3(p);
                    (l.y / rb.max(1e-12)).atan2(l.x / ra.max(1e-12))
                };
                let to_rad = |x: f64| x * self.angle_unit;
                let t1 = match (c1, p1) {
                    (Some(p), _) => angle_of(p),
                    (None, Some(x)) => to_rad(x),
                    _ => 0.0,
                };
                let t2 = match (c2, p2) {
                    (Some(p), _) => angle_of(p),
                    (None, Some(x)) => to_rad(x),
                    _ => TAU,
                };
                let mut d = t2 - t1;
                if sense {
                    while d <= 0.0 {
                        d += TAU;
                    }
                    while d > TAU + 1e-9 {
                        d -= TAU;
                    }
                } else {
                    while d >= 0.0 {
                        d -= TAU;
                    }
                    while d < -TAU - 1e-9 {
                        d += TAU;
                    }
                }
                let steps = ((self.segments_for_radius(ra.max(rb)) as f64) * d.abs() / TAU).ceil().max(2.0) as usize;
                (0..=steps).map(|i| {
                    let t = t1 + d * i as f64 / steps as f64;
                    m.transform_point3(DVec3::new(ra * t.cos(), rb * t.sin(), 0.0))
                })
                .collect()
            }
            "IFCLINE" => {
                let origin = ba.first().and_then(|v| v.as_ref_id()).and_then(|p| self.point(c, p)).unwrap_or(DVec3::ZERO);
                let dir = ba.get(1).and_then(|v| v.as_ref_id()).map(|v| self.vector(v)).unwrap_or(DVec3::X);
                let s = c1.unwrap_or_else(|| origin + dir * p1.unwrap_or(0.0));
                let e = c2.unwrap_or_else(|| origin + dir * p2.unwrap_or(1.0));
                if sense {
                    vec![s, e]
                } else {
                    vec![s, e]
                }
            }
            "IFCPOLYLINE" => {
                let pts = self.curve3(c, basis, depth + 1);
                match (p1, p2) {
                    (Some(a1), Some(a2)) if pts.len() >= 2 => {
                        let eval = |t: f64| {
                            let t = t.clamp(0.0, (pts.len() - 1) as f64);
                            let i = (t.floor() as usize).min(pts.len() - 2);
                            let f = t - i as f64;
                            pts[i].lerp(pts[i + 1], f)
                        };
                        let (lo, hi) = if a1 <= a2 { (a1, a2) } else { (a2, a1) };
                        let mut out = vec![eval(lo)];
                        for k in (lo.floor() as usize + 1)..=(hi.ceil() as usize).saturating_sub(1) {
                            if (k as f64) > lo && (k as f64) < hi {
                                out.push(pts[k]);
                            }
                        }
                        out.push(eval(hi));
                        if a1 > a2 {
                            out.reverse();
                        }
                        out
                    }
                    _ => {
                        let mut p = pts;
                        if let (Some(s), Some(e)) = (c1, c2) {
                            if !p.is_empty() {
                                p[0] = s;
                                let l = p.len() - 1;
                                p[l] = e;
                            }
                        }
                        p
                    }
                }
            }
            _ => {
                let mut p = self.curve3(c, basis, depth + 1);
                if !sense {
                    p.reverse();
                }
                p
            }
        }
    }

    fn bspline_curve(&self, c: &mut Cache, ty: &str, a: &[Value]) -> Vec<DVec3> {
        let degree = a.first().and_then(|v| v.as_i64()).unwrap_or(1).max(1) as usize;
        let cps: Vec<DVec3> = a.get(1).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter_map(|p| self.point(c, p)).collect();
        let mults: Vec<usize> = a.get(5).and_then(|v| v.as_list().map(|l| l.iter().filter_map(|x| x.as_i64()).map(|x| x as usize).collect())).unwrap_or_default();
        let knots_u: Vec<f64> = a.get(6).and_then(|v| v.as_list().map(|l| l.iter().filter_map(|x| x.as_f64()).collect())).unwrap_or_default();
        let weights: Vec<f64> = if ty == "IFCRATIONALBSPLINECURVEWITHKNOTS" { a.get(8).and_then(|v| v.as_list().map(|l| l.iter().filter_map(|x| x.as_f64()).collect())).unwrap_or_default() } else { vec![] };
        let mut knots = Vec::new();
        for (k, m) in knots_u.iter().zip(mults.iter()) {
            for _ in 0..*m {
                knots.push(*k);
            }
        }
        if cps.len() < 2 || knots.len() != cps.len() + degree + 1 {
            return cps;
        }
        let t0 = knots[degree];
        let t1 = knots[knots.len() - degree - 1];
        let n = (cps.len() * 8).clamp(8, 256);
        (0..=n).map(|i| {
            let t = t0 + (t1 - t0) * i as f64 / n as f64;
            de_boor(degree, &knots, &cps, &weights, t)
        })
        .collect()
    }
}

/// B-spline point evaluation (rational if weights given).
pub fn de_boor(p: usize, knots: &[f64], cps: &[DVec3], w: &[f64], t: f64) -> DVec3 {
    let n = cps.len();
    let mut k = p;
    while k < n - 1 && t >= knots[k + 1] {
        k += 1;
    }
    let rational = w.len() == n;
    let mut d: Vec<(DVec3, f64)> = (0..=p).map(|j| {
        let i = (j + k).saturating_sub(p).min(n - 1);
        let wi = if rational { w[i] } else { 1.0 };
        (cps[i] * wi, wi)
    })
    .collect();
    for r in 1..=p {
        for j in (r..=p).rev() {
            let i = j + k - p;
            let denom = knots[i + p + 1 - r] - knots[i];
            let alpha = if denom.abs() < 1e-14 { 0.0 } else { (t - knots[i]) / denom };
            let (a, aw) = d[j - 1];
            let (b, bw) = d[j];
            d[j] = (a * (1.0 - alpha) + b * alpha, aw * (1.0 - alpha) + bw * alpha);
        }
    }
    let (pt, wt) = d[p];
    if wt.abs() > 1e-14 {
        pt / wt
    } else {
        pt
    }
}

fn push_skip_dup(out: &mut Vec<DVec3>, seg: &[DVec3]) {
    for (i, p) in seg.iter().enumerate() {
        if i == 0 {
            if let Some(l) = out.last() {
                if l.distance_squared(*p) < 1e-18 {
                    continue;
                }
            }
        }
        out.push(*p);
    }
}

/// Offset an open polyline by `d` to the left (negative = right).
pub fn offset_polyline(pts: &[DVec2], d: f64) -> Vec<DVec2> {
    let n = pts.len();
    if n < 2 {
        return pts.to_vec();
    }
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let prev = if i > 0 { Some((pts[i] - pts[i - 1]).normalize_or_zero()) } else { None };
        let next = if i + 1 < n { Some((pts[i + 1] - pts[i]).normalize_or_zero()) } else { None };
        let nrm = |t: DVec2| DVec2::new(-t.y, t.x);
        let off = match (prev, next) {
            (Some(a), Some(b)) => {
                let m = (nrm(a) + nrm(b)).normalize_or_zero();
                let cos = m.dot(nrm(a)).max(0.2);
                m * (d / cos)
            }
            (Some(a), None) => nrm(a) * d,
            (None, Some(b)) => nrm(b) * d,
            _ => DVec2::ZERO,
        };
        out.push(pts[i] + off);
    }
    out
}
