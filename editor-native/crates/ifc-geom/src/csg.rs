//! Constructive solid geometry on triangle meshes using BSP trees
//! (after the classic csg.js algorithm), with an arena based iterative
//! implementation to avoid deep recursion.

use crate::mesh::Mesh;
use glam::DVec3;

const COPLANAR: u8 = 0;
const FRONT: u8 = 1;
const BACK: u8 = 2;
const SPANNING: u8 = 3;

#[derive(Clone, Copy, Debug)]
struct Plane {
    n: DVec3,
    w: f64,
}

impl Plane {
    fn from_points(a: DVec3, b: DVec3, c: DVec3) -> Option<Plane> {
        let n = (b - a).cross(c - a);
        let l = n.length();
        if l < 1e-14 || !l.is_finite() {
            return None;
        }
        let n = n / l;
        Some(Plane { n, w: n.dot(a) })
    }
    fn flip(&mut self) {
        self.n = -self.n;
        self.w = -self.w;
    }
}

#[derive(Clone, Debug)]
struct Poly {
    v: Vec<DVec3>,
    plane: Plane,
}

impl Poly {
    fn flip(&mut self) {
        self.v.reverse();
        self.plane.flip();
    }
}

fn split(plane: &Plane, p: &Poly, eps: f64, cf: &mut Vec<Poly>, cb: &mut Vec<Poly>, f: &mut Vec<Poly>, b: &mut Vec<Poly>) {
    let mut ptype = 0u8;
    let mut types: smallvec::SmallVec<[u8; 8]> = smallvec::SmallVec::new();
    for v in &p.v {
        let t = plane.n.dot(*v) - plane.w;
        let ty = if t < -eps { BACK } else if t > eps { FRONT } else { COPLANAR };
        ptype |= ty;
        types.push(ty);
    }
    match ptype {
        COPLANAR => {
            if plane.n.dot(p.plane.n) > 0.0 {
                cf.push(p.clone())
            } else {
                cb.push(p.clone())
            }
        }
        FRONT => f.push(p.clone()),
        BACK => b.push(p.clone()),
        _ => {
            let n = p.v.len();
            let mut fv = Vec::with_capacity(n + 1);
            let mut bv = Vec::with_capacity(n + 1);
            for i in 0..n {
                let j = (i + 1) % n;
                let (ti, tj) = (types[i], types[j]);
                let (vi, vj) = (p.v[i], p.v[j]);
                if ti != BACK {
                    fv.push(vi);
                }
                if ti != FRONT {
                    bv.push(vi);
                }
                if (ti | tj) == SPANNING {
                    let denom = plane.n.dot(vj - vi);
                    let t = if denom.abs() > 1e-300 { (plane.w - plane.n.dot(vi)) / denom } else { 0.5 };
                    let v = vi + (vj - vi) * t.clamp(0.0, 1.0);
                    fv.push(v);
                    bv.push(v);
                }
            }
            if fv.len() >= 3 {
                f.push(Poly { v: fv, plane: p.plane });
            }
            if bv.len() >= 3 {
                b.push(Poly { v: bv, plane: p.plane });
            }
        }
    }
}

#[derive(Default)]
struct Node {
    plane: Option<Plane>,
    front: Option<usize>,
    back: Option<usize>,
    polys: Vec<Poly>,
}

struct Bsp {
    nodes: Vec<Node>,
    eps: f64,
}

impl Bsp {
    fn new(polys: Vec<Poly>, eps: f64) -> Bsp {
        let mut b = Bsp { nodes: vec![Node::default()], eps };
        b.build(0, polys);
        b
    }

    fn build(&mut self, root: usize, polys: Vec<Poly>) {
        let mut stack = vec![(root, polys)];
        while let Some((ni, polys)) = stack.pop() {
            if polys.is_empty() {
                continue;
            }
            if self.nodes[ni].plane.is_none() {
                self.nodes[ni].plane = Some(polys[0].plane);
            }
            let plane = self.nodes[ni].plane.unwrap();
            let (mut f, mut b) = (Vec::new(), Vec::new());
            let mut cf = Vec::new();
            let mut cb = Vec::new();
            for p in &polys {
                split(&plane, p, self.eps, &mut cf, &mut cb, &mut f, &mut b);
            }
            self.nodes[ni].polys.extend(cf);
            self.nodes[ni].polys.extend(cb);
            if !f.is_empty() {
                let fi = match self.nodes[ni].front {
                    Some(x) => x,
                    None => {
                        self.nodes.push(Node::default());
                        let x = self.nodes.len() - 1;
                        self.nodes[ni].front = Some(x);
                        x
                    }
                };
                stack.push((fi, f));
            }
            if !b.is_empty() {
                let bi = match self.nodes[ni].back {
                    Some(x) => x,
                    None => {
                        self.nodes.push(Node::default());
                        let x = self.nodes.len() - 1;
                        self.nodes[ni].back = Some(x);
                        x
                    }
                };
                stack.push((bi, b));
            }
        }
    }

    fn invert(&mut self) {
        for n in &mut self.nodes {
            for p in &mut n.polys {
                p.flip();
            }
            if let Some(pl) = n.plane.as_mut() {
                pl.flip();
            }
            std::mem::swap(&mut n.front, &mut n.back);
        }
    }

    /// Remove all polygons that are inside this BSP.
    fn clip_polygons(&self, polys: Vec<Poly>) -> Vec<Poly> {
        let mut out = Vec::new();
        let mut stack = vec![(0usize, polys)];
        while let Some((ni, polys)) = stack.pop() {
            let node = &self.nodes[ni];
            let Some(plane) = node.plane else {
                out.extend(polys);
                continue;
            };
            let (mut f, mut b) = (Vec::new(), Vec::new());
            let mut cf = Vec::new();
            let mut cb = Vec::new();
            for p in &polys {
                split(&plane, p, self.eps, &mut cf, &mut cb, &mut f, &mut b);
            }
            f.extend(cf);
            b.extend(cb);
            match node.front {
                Some(fi) => stack.push((fi, f)),
                None => out.extend(f),
            }
            if let Some(bi) = node.back {
                stack.push((bi, b));
            } // else: back polygons are inside -> dropped
        }
        out
    }

    fn clip_to(&mut self, other: &Bsp) {
        for i in 0..self.nodes.len() {
            let polys = std::mem::take(&mut self.nodes[i].polys);
            self.nodes[i].polys = other.clip_polygons(polys);
        }
    }

    fn all_polygons(&self) -> Vec<Poly> {
        self.nodes.iter().flat_map(|n| n.polys.iter().cloned()).collect()
    }
}

fn to_polys(m: &Mesh) -> Vec<Poly> {
    let mut out = Vec::with_capacity(m.idx.len() / 3);
    for t in m.idx.chunks(3) {
        let (a, b, c) = (m.pos[t[0] as usize], m.pos[t[1] as usize], m.pos[t[2] as usize]);
        if let Some(plane) = Plane::from_points(a, b, c) {
            out.push(Poly { v: vec![a, b, c], plane });
        }
    }
    out
}

fn from_polys(polys: Vec<Poly>) -> Mesh {
    let mut m = Mesh::default();
    for p in polys {
        let base = m.pos.len() as u32;
        m.pos.extend_from_slice(&p.v);
        for i in 1..p.v.len() as u32 - 1 {
            m.idx.extend_from_slice(&[base, base + i, base + i + 1]);
        }
    }
    m
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoolOp {
    Union,
    Difference,
    Intersection,
}

/// Maximum polygon product for which a boolean is attempted.
pub const MAX_WORK: usize = 4_000_000;

fn bbox_overlap(a: &Mesh, b: &Mesh, eps: f64) -> bool {
    match (a.bbox(), b.bbox()) {
        (Some((alo, ahi)), Some((blo, bhi))) => alo.x <= bhi.x + eps && blo.x <= ahi.x + eps && alo.y <= bhi.y + eps && blo.y <= ahi.y + eps && alo.z <= bhi.z + eps && blo.z <= ahi.z + eps,
        _ => false,
    }
}

/// Boolean operation of two closed meshes. Returns `None` if skipped (too large / degenerate).
pub fn boolean(a: &Mesh, b: &Mesh, op: BoolOp, eps: f64) -> Option<Mesh> {
    if a.is_empty() {
        return match op {
            BoolOp::Union => Some(b.clone()),
            _ => Some(Mesh::default()),
        };
    }
    if b.is_empty() {
        return match op {
            BoolOp::Intersection => Some(Mesh::default()),
            _ => Some(a.clone()),
        };
    }
    if !bbox_overlap(a, b, eps) {
        return match op {
            BoolOp::Difference => Some(a.clone()),
            BoolOp::Intersection => Some(Mesh::default()),
            BoolOp::Union => {
                let mut m = a.clone();
                m.append(b);
                Some(m)
            }
        };
    }
    if a.tri_count().saturating_mul(b.tri_count()) > MAX_WORK {
        return None;
    }
    let mut ba = Bsp::new(to_polys(a), eps);
    let mut bb = Bsp::new(to_polys(b), eps);
    match op {
        BoolOp::Union => {
            ba.clip_to(&bb);
            bb.clip_to(&ba);
            bb.invert();
            bb.clip_to(&ba);
            bb.invert();
            let extra = bb.all_polygons();
            ba.build(0, extra);
            Some(from_polys(ba.all_polygons()))
        }
        BoolOp::Difference => {
            ba.invert();
            ba.clip_to(&bb);
            bb.clip_to(&ba);
            bb.invert();
            bb.clip_to(&ba);
            bb.invert();
            let extra = bb.all_polygons();
            ba.build(0, extra);
            ba.invert();
            Some(from_polys(ba.all_polygons()))
        }
        BoolOp::Intersection => {
            ba.invert();
            bb.clip_to(&ba);
            bb.invert();
            ba.clip_to(&bb);
            bb.clip_to(&ba);
            let extra = bb.all_polygons();
            ba.build(0, extra);
            ba.invert();
            Some(from_polys(ba.all_polygons()))
        }
    }
}

/// Clip a mesh by a plane, keeping the part on the side opposite to `normal`
/// (i.e. points p with n·p <= w), and cap the cut.
pub fn clip_by_plane(m: &Mesh, n: DVec3, w: f64, eps: f64) -> Mesh {
    // implemented as an intersection with a large box half-space
    let Some((lo, hi)) = m.bbox() else { return Mesh::default() };
    let size = (hi - lo).length().max(1.0) * 4.0;
    let center = (lo + hi) * 0.5;
    let n = n.normalize_or(DVec3::Z);
    let (u, v) = crate::mesh::plane_basis(n);
    // project center onto plane
    let c0 = center - n * (n.dot(center) - w);
    let corners = |d: f64| -> [DVec3; 4] { [c0 - u * size - v * size + n * d, c0 + u * size - v * size + n * d, c0 + u * size + v * size + n * d, c0 - u * size + v * size + n * d] };
    let top = corners(0.0);
    let bot = corners(-size * 2.0);
    let mut hs = Mesh::default();
    let quad = |m: &mut Mesh, a: DVec3, b: DVec3, c: DVec3, d: DVec3| {
        m.push_tri(a, b, c);
        m.push_tri(a, c, d);
    };
    quad(&mut hs, top[0], top[1], top[2], top[3]);
    quad(&mut hs, bot[3], bot[2], bot[1], bot[0]);
    for i in 0..4 {
        let j = (i + 1) % 4;
        quad(&mut hs, bot[i], bot[j], top[j], top[i]);
    }
    boolean(m, &hs, BoolOp::Intersection, eps).unwrap_or_else(|| m.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::box_mesh;

    #[test]
    fn difference_volume() {
        let a = box_mesh(DVec3::ZERO, DVec3::splat(2.0));
        let b = box_mesh(DVec3::new(0.5, -1.0, 0.5), DVec3::new(1.5, 3.0, 1.5));
        let r = boolean(&a, &b, BoolOp::Difference, 1e-6).unwrap();
        let v = r.signed_volume();
        assert!((v - (8.0 - 2.0)).abs() < 1e-6, "volume {v}");
        let i = boolean(&a, &b, BoolOp::Intersection, 1e-6).unwrap();
        assert!((i.signed_volume() - 2.0).abs() < 1e-6);
        let c = clip_by_plane(&a, DVec3::Z, 1.0, 1e-6);
        assert!((c.signed_volume() - 4.0).abs() < 1e-6, "{}", c.signed_volume());
    }
}
