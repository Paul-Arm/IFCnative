//! Double precision triangle meshes used during geometry construction.

use glam::{DMat4, DVec2, DVec3};

#[derive(Clone, Default, Debug)]
pub struct Mesh {
    pub pos: Vec<DVec3>,
    pub idx: Vec<u32>,
}

impl Mesh {
    pub fn is_empty(&self) -> bool {
        self.idx.is_empty()
    }
    pub fn tri_count(&self) -> usize {
        self.idx.len() / 3
    }
    pub fn push_tri(&mut self, a: DVec3, b: DVec3, c: DVec3) {
        let n = self.pos.len() as u32;
        self.pos.extend_from_slice(&[a, b, c]);
        self.idx.extend_from_slice(&[n, n + 1, n + 2]);
    }
    pub fn append(&mut self, other: &Mesh) {
        let base = self.pos.len() as u32;
        self.pos.extend_from_slice(&other.pos);
        self.idx.extend(other.idx.iter().map(|i| i + base));
    }
    pub fn transform(&mut self, m: &DMat4) {
        let flip = m.determinant() < 0.0;
        for p in &mut self.pos {
            *p = m.transform_point3(*p);
        }
        if flip {
            for t in self.idx.chunks_mut(3) {
                t.swap(1, 2);
            }
        }
    }
    pub fn transformed(&self, m: &DMat4) -> Mesh {
        let mut c = self.clone();
        c.transform(m);
        c
    }
    pub fn bbox(&self) -> Option<(DVec3, DVec3)> {
        let mut it = self.idx.iter().map(|&i| self.pos[i as usize]);
        let first = it.next()?;
        let (mut lo, mut hi) = (first, first);
        for p in it {
            lo = lo.min(p);
            hi = hi.max(p);
        }
        Some((lo, hi))
    }
    pub fn flip(&mut self) {
        for t in self.idx.chunks_mut(3) {
            t.swap(1, 2);
        }
    }
    /// Signed volume (positive for outward oriented closed meshes).
    pub fn signed_volume(&self) -> f64 {
        let mut v = 0.0;
        for t in self.idx.chunks(3) {
            let (a, b, c) = (self.pos[t[0] as usize], self.pos[t[1] as usize], self.pos[t[2] as usize]);
            v += a.dot(b.cross(c));
        }
        v / 6.0
    }
    pub fn is_finite(&self) -> bool {
        self.pos.iter().all(|p| p.is_finite())
    }
}

/// Newell normal of a polygon (not normalised).
pub fn newell(poly: &[DVec3]) -> DVec3 {
    let mut n = DVec3::ZERO;
    let len = poly.len();
    for i in 0..len {
        let a = poly[i];
        let b = poly[(i + 1) % len];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    n
}

/// Orthonormal basis (u, v) of the plane with normal `n`.
pub fn plane_basis(n: DVec3) -> (DVec3, DVec3) {
    let n = n.normalize_or(DVec3::Z);
    let helper = if n.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
    let u = helper.cross(n).normalize();
    let v = n.cross(u);
    (u, v)
}

/// Signed area of a 2D polygon (positive = counter-clockwise).
pub fn area2(poly: &[DVec2]) -> f64 {
    let mut a = 0.0;
    let n = poly.len();
    for i in 0..n {
        let p = poly[i];
        let q = poly[(i + 1) % n];
        a += p.x * q.y - q.x * p.y;
    }
    a * 0.5
}

pub fn dedup_ring2(ring: &mut Vec<DVec2>, eps: f64) {
    ring.dedup_by(|a, b| a.distance_squared(*b) <= eps * eps);
    while ring.len() > 1 && ring[0].distance_squared(*ring.last().unwrap()) <= eps * eps {
        ring.pop();
    }
}

pub fn dedup_ring3(ring: &mut Vec<DVec3>, eps: f64) {
    ring.dedup_by(|a, b| a.distance_squared(*b) <= eps * eps);
    while ring.len() > 1 && ring[0].distance_squared(*ring.last().unwrap()) <= eps * eps {
        ring.pop();
    }
}

/// Triangulate a 2D polygon with holes. Returns indices into the concatenation outer+holes.
pub fn triangulate2(outer: &[DVec2], holes: &[Vec<DVec2>]) -> Vec<u32> {
    if outer.len() < 3 {
        return vec![];
    }
    if holes.is_empty() && outer.len() == 3 {
        return vec![0, 1, 2];
    }
    if holes.is_empty() && outer.len() == 4 && is_convex(outer) {
        return vec![0, 1, 2, 0, 2, 3];
    }
    let mut flat = Vec::with_capacity((outer.len() + holes.iter().map(|h| h.len()).sum::<usize>()) * 2);
    for p in outer {
        flat.push(p.x);
        flat.push(p.y);
    }
    let mut hole_idx = Vec::with_capacity(holes.len());
    let mut count = outer.len();
    for h in holes {
        if h.len() < 3 {
            continue;
        }
        hole_idx.push(count);
        for p in h {
            flat.push(p.x);
            flat.push(p.y);
        }
        count += h.len();
    }
    match earcutr::earcut(&flat, &hole_idx, 2) {
        Ok(v) => v.into_iter().map(|i| i as u32).collect(),
        Err(_) => vec![],
    }
}

fn is_convex(p: &[DVec2]) -> bool {
    let n = p.len();
    let mut sign = 0.0;
    for i in 0..n {
        let a = p[i];
        let b = p[(i + 1) % n];
        let c = p[(i + 2) % n];
        let cr = (b - a).perp_dot(c - b);
        if cr.abs() < 1e-12 {
            continue;
        }
        if sign == 0.0 {
            sign = cr.signum();
        } else if cr.signum() != sign {
            return false;
        }
    }
    true
}

/// Triangulate a planar 3D polygon with holes and append to mesh; output faces along `normal`.
pub fn add_polygon3(mesh: &mut Mesh, outer: &[DVec3], holes: &[Vec<DVec3>]) {
    if outer.len() < 3 {
        return;
    }
    let n = newell(outer);
    if n.length_squared() < 1e-30 {
        return;
    }
    let (u, v) = plane_basis(n);
    let o = outer[0];
    let to2 = |p: &DVec3| DVec2::new((*p - o).dot(u), (*p - o).dot(v));
    let outer2: Vec<DVec2> = outer.iter().map(to2).collect();
    let holes2: Vec<Vec<DVec2>> = holes.iter().filter(|h| h.len() >= 3).map(|h| h.iter().map(to2).collect()).collect();
    let tris = triangulate2(&outer2, &holes2);
    let base = mesh.pos.len() as u32;
    mesh.pos.extend_from_slice(outer);
    for h in holes.iter().filter(|h| h.len() >= 3) {
        mesh.pos.extend_from_slice(h);
    }
    // earcut output orientation follows the 2D ring orientation; enforce CCW w.r.t. n
    for t in tris.chunks(3) {
        let (a, b, c) = (t[0], t[1], t[2]);
        let pa = mesh.pos[(base + a) as usize];
        let pb = mesh.pos[(base + b) as usize];
        let pc = mesh.pos[(base + c) as usize];
        if (pb - pa).cross(pc - pa).dot(n) >= 0.0 {
            mesh.idx.extend_from_slice(&[base + a, base + b, base + c]);
        } else {
            mesh.idx.extend_from_slice(&[base + a, base + c, base + b]);
        }
    }
}

/// Unit box mesh [0,1]^3 scaled to size, outward oriented.
pub fn box_mesh(min: DVec3, max: DVec3) -> Mesh {
    let c = [
        DVec3::new(min.x, min.y, min.z),
        DVec3::new(max.x, min.y, min.z),
        DVec3::new(max.x, max.y, min.z),
        DVec3::new(min.x, max.y, min.z),
        DVec3::new(min.x, min.y, max.z),
        DVec3::new(max.x, min.y, max.z),
        DVec3::new(max.x, max.y, max.z),
        DVec3::new(min.x, max.y, max.z),
    ];
    let faces: [[usize; 4]; 6] = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    let mut m = Mesh::default();
    for f in faces {
        let base = m.pos.len() as u32;
        for i in f {
            m.pos.push(c[i]);
        }
        m.idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    m
}
