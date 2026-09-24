//! Clash detection between product meshes (broadphase grid + exact triangle tests).

use crate::engine::ProductGeom;
use glam::Vec3;
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Clone, Debug)]
pub struct Clash {
    pub a: u32,
    pub b: u32,
    /// Approximate clash location (scene coordinates).
    pub point: Vec3,
    /// Hard (penetration) or clearance (distance below tolerance).
    pub hard: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct ClashOptions {
    /// Tolerance in metres: touching within this distance is not a clash.
    pub tolerance: f32,
    /// Clearance mode: report objects closer than `clearance` (without penetration).
    pub clearance: f32,
}

impl Default for ClashOptions {
    fn default() -> Self {
        ClashOptions { tolerance: 0.002, clearance: 0.0 }
    }
}

fn aabb_overlap(a: &ProductGeom, b: &ProductGeom, pad: f32) -> bool {
    (0..3).all(|k| a.min[k] - pad <= b.max[k] && b.min[k] - pad <= a.max[k])
}

/// Segment (p,q) vs triangle strict interior intersection.
fn seg_tri(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3, eps: f32) -> Option<Vec3> {
    let d = q - p;
    let e1 = b - a;
    let e2 = c - a;
    let h = d.cross(e2);
    let det = e1.dot(h);
    if det.abs() < 1e-12 {
        return None; // parallel / coplanar: treated as touching
    }
    let f = 1.0 / det;
    let s = p - a;
    let u = f * s.dot(h);
    let qv = s.cross(e1);
    let v = f * d.dot(qv);
    let t = f * e2.dot(qv);
    // strict: away from triangle border and segment ends
    let len = d.length().max(1e-9);
    let te = eps / len;
    let tri_scale = e1.length().max(e2.length()).max(1e-9);
    let be = eps / tri_scale;
    if u > be && v > be && u + v < 1.0 - be && t > te && t < 1.0 - te {
        Some(p + d * t)
    } else {
        None
    }
}

fn tri(g: &ProductGeom, i: usize) -> [Vec3; 3] {
    let t = &g.indices[i * 3..i * 3 + 3];
    [Vec3::from(g.positions[t[0] as usize]), Vec3::from(g.positions[t[1] as usize]), Vec3::from(g.positions[t[2] as usize])]
}

fn tri_box(t: &[Vec3; 3]) -> (Vec3, Vec3) {
    (t[0].min(t[1]).min(t[2]), t[0].max(t[1]).max(t[2]))
}

/// Exact penetration test between two meshes; returns a contact point.
pub fn meshes_intersect(a: &ProductGeom, b: &ProductGeom, eps: f32) -> Option<Vec3> {
    let lo = Vec3::from(a.min).max(Vec3::from(b.min)) - Vec3::splat(eps);
    let hi = Vec3::from(a.max).min(Vec3::from(b.max)) + Vec3::splat(eps);
    let in_box = |t: &[Vec3; 3]| {
        let (tl, th) = tri_box(t);
        tl.cmple(hi).all() && th.cmpge(lo).all()
    };
    let ta: Vec<[Vec3; 3]> = (0..a.tri_count()).map(|i| tri(a, i)).filter(in_box).collect();
    if ta.is_empty() {
        return None;
    }
    let tb: Vec<[Vec3; 3]> = (0..b.tri_count()).map(|i| tri(b, i)).filter(in_box).collect();
    if tb.is_empty() {
        return None;
    }
    if ta.len().saturating_mul(tb.len()) > 25_000_000 {
        // extremely dense pair: fall back to box overlap
        return Some((lo + hi) * 0.5);
    }
    let boxes_b: Vec<(Vec3, Vec3)> = tb.iter().map(tri_box).collect();
    for t1 in &ta {
        let (l1, h1) = tri_box(t1);
        for (j, t2) in tb.iter().enumerate() {
            let (l2, h2) = boxes_b[j];
            if l1.cmpgt(h2).any() || l2.cmpgt(h1).any() {
                continue;
            }
            for (p, q) in [(t1[0], t1[1]), (t1[1], t1[2]), (t1[2], t1[0])] {
                if let Some(x) = seg_tri(p, q, t2[0], t2[1], t2[2], eps) {
                    return Some(x);
                }
            }
            for (p, q) in [(t2[0], t2[1]), (t2[1], t2[2]), (t2[2], t2[0])] {
                if let Some(x) = seg_tri(p, q, t1[0], t1[1], t1[2], eps) {
                    return Some(x);
                }
            }
        }
    }
    None
}

/// Detect clashes between set A and set B (may be the same set). `ignore` holds pairs to skip.
pub fn detect(a: &[&ProductGeom], b: &[&ProductGeom], opts: ClashOptions, ignore: &FxHashSet<(u32, u32)>) -> Vec<Clash> {
    // uniform grid over B
    let pad = opts.clearance.max(opts.tolerance);
    let mut cell = 2.0f32;
    if let Some(avg) = (!b.is_empty()).then(|| b.iter().map(|g| (Vec3::from(g.max) - Vec3::from(g.min)).max_element()).sum::<f32>() / b.len() as f32) {
        cell = avg.clamp(0.25, 50.0) * 1.5;
    }
    let key = |p: Vec3| -> (i32, i32, i32) { ((p.x / cell).floor() as i32, (p.y / cell).floor() as i32, (p.z / cell).floor() as i32) };
    let mut grid: FxHashMap<(i32, i32, i32), Vec<u32>> = FxHashMap::default();
    for (i, g) in b.iter().enumerate() {
        let (l, h) = (key(Vec3::from(g.min) - Vec3::splat(pad)), key(Vec3::from(g.max) + Vec3::splat(pad)));
        let span = ((h.0 - l.0 + 1) as i64) * ((h.1 - l.1 + 1) as i64) * ((h.2 - l.2 + 1) as i64);
        if span > 4096 {
            // huge object: put into a coarse "global" bucket
            grid.entry((i32::MIN, 0, 0)).or_default().push(i as u32);
            continue;
        }
        for x in l.0..=h.0 {
            for y in l.1..=h.1 {
                for z in l.2..=h.2 {
                    grid.entry((x, y, z)).or_default().push(i as u32);
                }
            }
        }
    }
    let global: Vec<u32> = grid.get(&(i32::MIN, 0, 0)).cloned().unwrap_or_default();
    let same_set = std::ptr::eq(a.as_ptr(), b.as_ptr()) && a.len() == b.len();
    a.par_iter()
        .flat_map_iter(|ga| {
            let (l, h) = (key(Vec3::from(ga.min) - Vec3::splat(pad)), key(Vec3::from(ga.max) + Vec3::splat(pad)));
            let mut cands: FxHashSet<u32> = global.iter().copied().collect();
            let span = ((h.0 - l.0 + 1) as i64) * ((h.1 - l.1 + 1) as i64) * ((h.2 - l.2 + 1) as i64);
            if span <= 4096 {
                for x in l.0..=h.0 {
                    for y in l.1..=h.1 {
                        for z in l.2..=h.2 {
                            if let Some(v) = grid.get(&(x, y, z)) {
                                cands.extend(v.iter().copied());
                            }
                        }
                    }
                }
            } else {
                cands.extend(0..b.len() as u32);
            }
            let mut out = Vec::new();
            for j in cands {
                let gb = b[j as usize];
                if gb.id == ga.id || (same_set && gb.id < ga.id) {
                    continue;
                }
                let pair = if ga.id < gb.id { (ga.id, gb.id) } else { (gb.id, ga.id) };
                if ignore.contains(&pair) || !aabb_overlap(ga, gb, pad) {
                    continue;
                }
                if let Some(p) = meshes_intersect(ga, gb, opts.tolerance) {
                    out.push(Clash { a: ga.id, b: gb.id, point: p, hard: true });
                } else if opts.clearance > 0.0 {
                    // clearance: closest vertex distance approximation
                    let mut best = f32::MAX;
                    let mut bp = Vec3::ZERO;
                    for pa in ga.positions.iter().step_by((ga.positions.len() / 200).max(1)) {
                        let pa = Vec3::from(*pa);
                        for pb in gb.positions.iter().step_by((gb.positions.len() / 200).max(1)) {
                            let d = pa.distance(Vec3::from(*pb));
                            if d < best {
                                best = d;
                                bp = (pa + Vec3::from(*pb)) * 0.5;
                            }
                        }
                    }
                    if best < opts.clearance {
                        out.push(Clash { a: ga.id, b: gb.id, point: bp, hard: false });
                    }
                }
            }
            out
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cube(id: u32, o: Vec3, s: f32) -> ProductGeom {
        let m = crate::mesh::box_mesh(o.as_dvec3(), (o + Vec3::splat(s)).as_dvec3());
        let mut g = ProductGeom { id, min: o.to_array(), max: (o + Vec3::splat(s)).to_array(), ..Default::default() };
        g.positions = m.pos.iter().map(|p| [p.x as f32, p.y as f32, p.z as f32]).collect();
        g.colors = vec![[255; 4]; g.positions.len()];
        g.indices = m.idx.clone();
        g
    }

    #[test]
    fn clash_and_touch() {
        let a = cube(1, Vec3::ZERO, 1.0);
        let b = cube(2, Vec3::new(0.31, 0.43, 0.47), 1.0);
        let c = cube(3, Vec3::new(1.0, 0.0, 0.0), 1.0); // touches a
        assert!(meshes_intersect(&a, &b, 0.001).is_some());
        assert!(meshes_intersect(&a, &c, 0.001).is_none());
        let all = [&a, &b, &c];
        let r = detect(&all, &all, ClashOptions::default(), &FxHashSet::default());
        let pairs: Vec<(u32, u32)> = r.iter().map(|c| (c.a.min(c.b), c.a.max(c.b))).collect();
        assert!(pairs.contains(&(1, 2)));
        assert!(!pairs.contains(&(1, 3)));
    }
}
