//! CPU side scene: product meshes grouped into GPU chunks plus per-object state.

use glam::{DVec3, Vec3};
use ifc_geom::ProductGeom;
use rustc_hash::{FxHashMap, FxHashSet};
use std::sync::Arc;

pub const CHUNK_VERTS: usize = 262_144;

pub mod flags {
    pub const HIDDEN: u32 = 1;
    pub const SELECTED: u32 = 2;
    pub const GHOST: u32 = 4;
    pub const HOVER: u32 = 8;
    pub const OVERRIDE: u32 = 16;
}

#[derive(Clone, Debug)]
pub struct SceneObject {
    pub id: u32,
    pub min: Vec3,
    pub max: Vec3,
    pub chunk: u32,
    pub tris: u32,
    pub geom: Option<Arc<ProductGeom>>,
}

#[derive(Default, Clone, Debug)]
pub struct ChunkCpu {
    pub objs: Vec<u32>,
    pub verts: usize,
}

#[derive(Default)]
pub struct Scene {
    pub objects: Vec<SceneObject>,
    pub index_of: FxHashMap<u32, u32>,
    pub chunks: Vec<ChunkCpu>,
    pub dirty_chunks: FxHashSet<u32>,
    /// Per object [flags, rgba override].
    pub state: Vec<[u32; 2]>,
    pub state_dirty: bool,
    pub origin: DVec3,
    pub bbox: Option<(Vec3, Vec3)>,
    pub total_tris: usize,
    pub revision: u64,
}

impl Scene {
    pub fn new(origin: DVec3) -> Scene {
        Scene { origin, ..Default::default() }
    }

    pub fn obj(&self, id: u32) -> Option<&SceneObject> {
        self.index_of.get(&id).map(|&i| &self.objects[i as usize])
    }

    pub fn has(&self, id: u32) -> bool {
        self.index_of.get(&id).map(|&i| self.objects[i as usize].geom.is_some()).unwrap_or(false)
    }

    fn open_chunk(&mut self, verts: usize) -> u32 {
        if let Some(last) = self.chunks.last() {
            if last.verts + verts <= CHUNK_VERTS || last.objs.is_empty() {
                return (self.chunks.len() - 1) as u32;
            }
        }
        self.chunks.push(ChunkCpu::default());
        (self.chunks.len() - 1) as u32
    }

    /// Add or replace a product mesh.
    pub fn upsert(&mut self, g: ProductGeom) {
        let verts = g.positions.len();
        let min = Vec3::from(g.min);
        let max = Vec3::from(g.max);
        let tris = g.tri_count() as u32;
        if let Some(&oi) = self.index_of.get(&g.id) {
            let old_chunk = self.objects[oi as usize].chunk;
            let old_verts = self.objects[oi as usize].geom.as_ref().map(|x| x.positions.len()).unwrap_or(0);
            self.total_tris -= self.objects[oi as usize].tris as usize;
            let c = &mut self.chunks[old_chunk as usize];
            c.objs.retain(|&o| o != oi);
            c.verts -= old_verts;
            self.dirty_chunks.insert(old_chunk);
            let chunk = self.open_chunk(verts);
            let o = &mut self.objects[oi as usize];
            o.min = min;
            o.max = max;
            o.chunk = chunk;
            o.tris = tris;
            o.geom = Some(Arc::new(g));
            self.chunks[chunk as usize].objs.push(oi);
            self.chunks[chunk as usize].verts += verts;
            self.dirty_chunks.insert(chunk);
        } else {
            let oi = self.objects.len() as u32;
            let chunk = self.open_chunk(verts);
            self.index_of.insert(g.id, oi);
            self.objects.push(SceneObject { id: g.id, min, max, chunk, tris, geom: Some(Arc::new(g)) });
            self.state.push([0, 0]);
            self.state_dirty = true;
            self.chunks[chunk as usize].objs.push(oi);
            self.chunks[chunk as usize].verts += verts;
            self.dirty_chunks.insert(chunk);
        }
        self.total_tris += tris as usize;
        self.bbox = Some(match self.bbox {
            Some((lo, hi)) => (lo.min(min), hi.max(max)),
            None => (min, max),
        });
        self.revision += 1;
    }

    /// Remove a product's geometry (object slot is kept, hidden).
    pub fn remove(&mut self, id: u32) {
        if let Some(&oi) = self.index_of.get(&id) {
            let o = &mut self.objects[oi as usize];
            if let Some(g) = o.geom.take() {
                let c = &mut self.chunks[o.chunk as usize];
                c.objs.retain(|&x| x != oi);
                c.verts -= g.positions.len();
                self.dirty_chunks.insert(o.chunk);
                self.total_tris -= o.tris as usize;
                o.tris = 0;
                self.revision += 1;
            }
        }
    }

    pub fn recompute_bbox(&mut self) {
        let mut bb: Option<(Vec3, Vec3)> = None;
        for o in &self.objects {
            if o.geom.is_some() {
                bb = Some(match bb {
                    Some((lo, hi)) => (lo.min(o.min), hi.max(o.max)),
                    None => (o.min, o.max),
                });
            }
        }
        self.bbox = bb;
    }

    pub fn set_flag(&mut self, oi: u32, flag: u32, on: bool) {
        let s = &mut self.state[oi as usize][0];
        let new = if on { *s | flag } else { *s & !flag };
        if new != *s {
            *s = new;
            self.state_dirty = true;
        }
    }

    pub fn clear_flag_all(&mut self, flag: u32) {
        for s in &mut self.state {
            if s[0] & flag != 0 {
                s[0] &= !flag;
                self.state_dirty = true;
            }
        }
    }

    pub fn set_override(&mut self, oi: u32, rgba: Option<[u8; 4]>) {
        let s = &mut self.state[oi as usize];
        match rgba {
            Some(c) => {
                s[0] |= flags::OVERRIDE;
                s[1] = u32::from_le_bytes(c);
            }
            None => {
                s[0] &= !flags::OVERRIDE;
                s[1] = 0;
            }
        }
        self.state_dirty = true;
    }

    pub fn is_hidden(&self, oi: u32) -> bool {
        self.state[oi as usize][0] & flags::HIDDEN != 0
    }

    /// Bounding box of a set of product ids.
    pub fn bbox_of(&self, ids: impl IntoIterator<Item = u32>) -> Option<(Vec3, Vec3)> {
        let mut bb: Option<(Vec3, Vec3)> = None;
        for id in ids {
            if let Some(o) = self.obj(id) {
                if o.geom.is_some() {
                    bb = Some(match bb {
                        Some((lo, hi)) => (lo.min(o.min), hi.max(o.max)),
                        None => (o.min, o.max),
                    });
                }
            }
        }
        bb
    }

    /// Bounding box of visible objects.
    pub fn visible_bbox(&self) -> Option<(Vec3, Vec3)> {
        let mut bb: Option<(Vec3, Vec3)> = None;
        for (i, o) in self.objects.iter().enumerate() {
            if o.geom.is_some() && self.state[i][0] & flags::HIDDEN == 0 {
                bb = Some(match bb {
                    Some((lo, hi)) => (lo.min(o.min), hi.max(o.max)),
                    None => (o.min, o.max),
                });
            }
        }
        bb.or(self.bbox)
    }

    /// Exact CPU ray cast against visible objects: (object index, distance, point).
    pub fn raycast(&self, origin: Vec3, dir: Vec3) -> Option<(u32, f32, Vec3)> {
        let inv = Vec3::new(1.0 / dir.x, 1.0 / dir.y, 1.0 / dir.z);
        let mut best: Option<(u32, f32, Vec3)> = None;
        for (i, o) in self.objects.iter().enumerate() {
            let Some(g) = &o.geom else { continue };
            if self.state[i][0] & flags::HIDDEN != 0 {
                continue;
            }
            // slab test
            let t1 = (o.min - origin) * inv;
            let t2 = (o.max - origin) * inv;
            let tmin = t1.min(t2).max_element();
            let tmax = t1.max(t2).min_element();
            if tmax < tmin.max(0.0) {
                continue;
            }
            if let Some((_, bd, _)) = best {
                if tmin > bd {
                    continue;
                }
            }
            for t in g.indices.chunks_exact(3) {
                let a = Vec3::from(g.positions[t[0] as usize]);
                let b = Vec3::from(g.positions[t[1] as usize]);
                let c = Vec3::from(g.positions[t[2] as usize]);
                if let Some(d) = ray_tri(origin, dir, a, b, c) {
                    if best.map(|x| d < x.1).unwrap_or(true) {
                        best = Some((i as u32, d, origin + dir * d));
                    }
                }
            }
        }
        best
    }
}

fn ray_tri(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3) -> Option<f32> {
    let e1 = b - a;
    let e2 = c - a;
    let p = d.cross(e2);
    let det = e1.dot(p);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = o - a;
    let u = s.dot(p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = d.dot(q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = e2.dot(q) * inv;
    if t > 1e-6 {
        Some(t)
    } else {
        None
    }
}
