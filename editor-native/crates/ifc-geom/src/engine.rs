//! Geometry engine: turns IFC products into triangle meshes.

use crate::csg::{self, BoolOp};
use crate::mesh::{add_polygon3, box_mesh, dedup_ring3, Mesh};
use crate::profile::{circle_pts, de_boor, Profile};
use crate::style::{default_color, StyleMap};
use glam::{DMat4, DVec2, DVec3};
use ifc_doc::{model, tflags, Document, Value};
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use std::f64::consts::TAU;
use std::sync::Arc;

pub type Color = [f32; 4];

#[derive(Clone, Debug)]
pub struct GeomOptions {
    pub cut_openings: bool,
    pub include_openings: bool,
    pub include_spaces: bool,
    pub min_circle_segments: usize,
    pub max_circle_segments: usize,
}

impl Default for GeomOptions {
    fn default() -> Self {
        GeomOptions { cut_openings: true, include_openings: false, include_spaces: true, min_circle_segments: 10, max_circle_segments: 48 }
    }
}

/// A local mesh with an optional explicit color.
#[derive(Clone, Debug, Default)]
pub struct Part {
    pub color: Option<Color>,
    pub mesh: Mesh,
}

/// Final per-product render mesh in scene coordinates (metres, origin shifted).
#[derive(Clone, Debug, Default)]
pub struct ProductGeom {
    pub id: u32,
    pub positions: Vec<[f32; 3]>,
    pub colors: Vec<[u8; 4]>,
    pub indices: Vec<u32>,
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub transparent: bool,
}

impl ProductGeom {
    pub fn tri_count(&self) -> usize {
        self.indices.len() / 3
    }
}

#[derive(Default)]
pub struct Cache {
    pub placements: FxHashMap<u32, DMat4>,
    pub points: FxHashMap<u32, DVec3>,
    pub profiles: FxHashMap<u32, Profile>,
    pub maps: FxHashMap<u32, Arc<Vec<Part>>>,
}

pub struct Engine<'a> {
    pub doc: &'a Document,
    /// File length unit -> metres.
    pub unit: f64,
    /// Plane angle unit -> radians.
    pub angle_unit: f64,
    /// Scene origin in metres (subtracted from world coordinates).
    pub origin: DVec3,
    pub opts: GeomOptions,
    pub styles: StyleMap,
    /// Tolerance in file units.
    pub eps: f64,
}

impl<'a> Engine<'a> {
    pub fn new(doc: &'a Document, opts: GeomOptions) -> Engine<'a> {
        let unit = model::length_unit(doc).0;
        let angle_unit = model::unit_of_type(doc, "PLANEANGLEUNIT").map(|u| u.0).unwrap_or(1.0);
        let styles = StyleMap::build(doc);
        let mut e = Engine { doc, unit, angle_unit, origin: DVec3::ZERO, opts, styles, eps: 1e-6 / unit.max(1e-12) };
        e.origin = e.compute_origin();
        e
    }

    /// Engine with a fixed origin and precomputed styles (for incremental updates).
    pub fn with_parts(doc: &'a Document, opts: GeomOptions, origin: DVec3, styles: StyleMap) -> Engine<'a> {
        let unit = model::length_unit(doc).0;
        let angle_unit = model::unit_of_type(doc, "PLANEANGLEUNIT").map(|u| u.0).unwrap_or(1.0);
        Engine { doc, unit, angle_unit, origin, opts, styles, eps: 1e-6 / unit.max(1e-12) }
    }

    fn compute_origin(&self) -> DVec3 {
        let ids = self.product_ids();
        let mut c = Cache::default();
        let mut lo = DVec3::splat(f64::MAX);
        let mut hi = DVec3::splat(f64::MIN);
        let mut n = 0;
        for &id in ids.iter().step_by((ids.len() / 2000).max(1)) {
            if let Some(p) = self.doc.arg(id, 5).and_then(|v| v.as_ref_id()) {
                let m = self.placement(&mut c, p, 0);
                let t = m.w_axis.truncate() * self.unit;
                if t.is_finite() {
                    lo = lo.min(t);
                    hi = hi.max(t);
                    n += 1;
                }
            }
        }
        if n == 0 {
            return DVec3::ZERO;
        }
        let center = (lo + hi) * 0.5;
        if center.length() < 1000.0 {
            DVec3::ZERO
        } else {
            (center / 10.0).round() * 10.0
        }
    }

    /// Products that carry a shape representation.
    pub fn product_ids(&self) -> Vec<u32> {
        let doc = self.doc;
        let mut out: Vec<u32> = doc
            .ids_with_flag(tflags::PRODUCT)
            .into_par_iter()
            .filter(|&id| {
                let f = doc.type_flags(id);
                if f & tflags::OPENING != 0 && !self.opts.include_openings {
                    return false;
                }
                let t = doc.type_name(id).unwrap_or("");
                if t == "IFCSPACE" && !self.opts.include_spaces {
                    return false;
                }
                if matches!(t, "IFCGRID" | "IFCANNOTATION" | "IFCALIGNMENT") {
                    return false;
                }
                doc.arg(id, 6).and_then(|v| v.as_ref_id()).is_some()
            })
            .collect();
        out.sort_unstable();
        out
    }

    // ------------------------------------------------------------ primitives

    pub fn point_nc(&self, id: u32) -> Option<DVec3> {
        let raw = self.doc.raw_args(id)?;
        let mut nums = [0.0f64; 3];
        let n = scan_numbers(raw, &mut nums);
        if n == 0 {
            return None;
        }
        Some(DVec3::new(nums[0], nums[1], if n > 2 { nums[2] } else { 0.0 }))
    }

    pub fn point(&self, c: &mut Cache, id: u32) -> Option<DVec3> {
        if let Some(p) = c.points.get(&id) {
            return Some(*p);
        }
        let p = self.point_nc(id)?;
        c.points.insert(id, p);
        Some(p)
    }

    pub fn direction(&self, id: u32) -> Option<DVec3> {
        self.point_nc(id)
    }

    /// IfcVector -> direction * magnitude.
    pub fn vector(&self, id: u32) -> DVec3 {
        let Some(a) = self.doc.args(id) else { return DVec3::X };
        let d = a.first().and_then(|v| v.as_ref_id()).and_then(|d| self.direction(d)).unwrap_or(DVec3::X).normalize_or(DVec3::X);
        d * a.get(1).and_then(|v| v.as_f64()).unwrap_or(1.0)
    }

    /// IfcCartesianPointList2D/3D coordinates.
    pub fn point_list(&self, id: u32) -> Vec<DVec3> {
        let Some(raw) = self.doc.raw_args(id) else { return vec![] };
        let dim = if self.doc.type_name(id) == Some("IFCCARTESIANPOINTLIST2D") { 2 } else { 3 };
        // first argument is the nested coordinate list; stop before a possible TagList
        let list_end = first_arg_end(raw);
        let mut nums = Vec::new();
        scan_all_numbers(&raw[..list_end], &mut nums);
        nums.chunks_exact(dim).map(|c| if dim == 2 { DVec3::new(c[0], c[1], 0.0) } else { DVec3::new(c[0], c[1], c[2]) }).collect()
    }

    pub fn axis2(&self, id: u32) -> DMat4 {
        let Some(t) = self.doc.type_name(id) else { return DMat4::IDENTITY };
        let Some(a) = self.doc.args(id) else { return DMat4::IDENTITY };
        let loc = a.first().and_then(|v| v.as_ref_id()).and_then(|p| self.point_nc(p)).unwrap_or(DVec3::ZERO);
        match t {
            "IFCAXIS2PLACEMENT3D" => {
                let z = a.get(1).and_then(|v| v.as_ref_id()).and_then(|d| self.direction(d)).unwrap_or(DVec3::Z);
                let x = a.get(2).and_then(|v| v.as_ref_id()).and_then(|d| self.direction(d)).unwrap_or(DVec3::X);
                make_axes(loc, z, x)
            }
            "IFCAXIS2PLACEMENT2D" => {
                let x = a.get(1).and_then(|v| v.as_ref_id()).and_then(|d| self.direction(d)).unwrap_or(DVec3::X);
                let x = DVec3::new(x.x, x.y, 0.0).normalize_or(DVec3::X);
                let y = DVec3::new(-x.y, x.x, 0.0);
                DMat4::from_cols(x.extend(0.0), y.extend(0.0), DVec3::Z.extend(0.0), loc.extend(1.0))
            }
            "IFCAXIS1PLACEMENT" => {
                let z = a.get(1).and_then(|v| v.as_ref_id()).and_then(|d| self.direction(d)).unwrap_or(DVec3::Z);
                make_axes(loc, z, DVec3::X)
            }
            _ => DMat4::IDENTITY,
        }
    }

    pub fn placement(&self, c: &mut Cache, id: u32, depth: u32) -> DMat4 {
        if let Some(m) = c.placements.get(&id) {
            return *m;
        }
        if depth > 64 {
            return DMat4::IDENTITY;
        }
        let m = match self.doc.type_name(id) {
            Some("IFCLOCALPLACEMENT") => {
                let a = self.doc.args(id).unwrap_or_default();
                let parent = a.first().and_then(|v| v.as_ref_id()).map(|p| self.placement(c, p, depth + 1)).unwrap_or(DMat4::IDENTITY);
                let local = a.get(1).and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                parent * local
            }
            Some("IFCAXIS2PLACEMENT3D") | Some("IFCAXIS2PLACEMENT2D") => self.axis2(id),
            _ => DMat4::IDENTITY,
        };
        c.placements.insert(id, m);
        m
    }

    /// IfcCartesianTransformationOperator (2D/3D, uniform/non-uniform).
    pub fn cto(&self, id: u32) -> DMat4 {
        let Some(t) = self.doc.type_name(id) else { return DMat4::IDENTITY };
        let t = t.to_string();
        let Some(a) = self.doc.args(id) else { return DMat4::IDENTITY };
        let dir = |i: usize| a.get(i).and_then(|v| v.as_ref_id()).and_then(|d| self.direction(d));
        let origin = a.get(2).and_then(|v| v.as_ref_id()).and_then(|p| self.point_nc(p)).unwrap_or(DVec3::ZERO);
        let s = a.get(3).and_then(|v| v.as_f64()).unwrap_or(1.0);
        if t.contains("2D") {
            let x = dir(0).map(|d| DVec3::new(d.x, d.y, 0.0)).unwrap_or(DVec3::X).normalize_or(DVec3::X);
            let y = dir(1).map(|d| DVec3::new(d.x, d.y, 0.0).normalize_or(DVec3::Y)).unwrap_or(DVec3::new(-x.y, x.x, 0.0));
            let s2 = if t.ends_with("NONUNIFORM") { a.get(4).and_then(|v| v.as_f64()).unwrap_or(s) } else { s };
            return DMat4::from_cols((x * s).extend(0.0), (y * s2).extend(0.0), DVec3::Z.extend(0.0), origin.extend(1.0));
        }
        let z = dir(4).unwrap_or(DVec3::Z).normalize_or(DVec3::Z);
        let x0 = dir(0).unwrap_or(if z.x.abs() < 0.99 { DVec3::X } else { DVec3::Y });
        let x = (x0 - z * x0.dot(z)).normalize_or(DVec3::X);
        let y0 = dir(1).unwrap_or(z.cross(x));
        let y = (y0 - z * y0.dot(z) - x * y0.dot(x)).normalize_or(z.cross(x));
        let (s2, s3) = if t.ends_with("NONUNIFORM") { (a.get(5).and_then(|v| v.as_f64()).unwrap_or(s), a.get(6).and_then(|v| v.as_f64()).unwrap_or(s)) } else { (s, s) };
        DMat4::from_cols((x * s).extend(0.0), (y * s2).extend(0.0), (z * s3).extend(0.0), origin.extend(1.0))
    }

    // ------------------------------------------------------------ products

    /// World matrix of a product (file units).
    pub fn product_matrix(&self, c: &mut Cache, id: u32) -> DMat4 {
        self.doc.arg(id, 5).and_then(|v| v.as_ref_id()).map(|p| self.placement(c, p, 0)).unwrap_or(DMat4::IDENTITY)
    }

    /// Choose body representations of a product definition shape.
    pub fn body_representations(&self, pds: u32) -> Vec<u32> {
        let reps = self.doc.arg(pds, 2).map(|v| v.ref_list()).unwrap_or_default();
        let mut best: Vec<(i32, u32)> = Vec::new();
        let mut boxes = Vec::new();
        for r in reps {
            let a = self.doc.args(r).unwrap_or_default();
            let ident = a.get(1).and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase();
            let rtype = a.get(2).and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase();
            if matches!(rtype.as_str(), "curve2d" | "annotation2d" | "geometriccurveset" | "point" | "curve3d" | "curve" | "pointcloud" | "annotation" | "texture") {
                continue;
            }
            let score = match ident.as_str() {
                "body" => 10,
                "facetation" | "mesh" => 8,
                "body-fallback" | "body-fallback-model" => 5,
                "box" => {
                    boxes.push(r);
                    continue;
                }
                "axis" | "footprint" | "annotation" | "profile" | "clearance" | "lighting" | "plan" | "cog" | "surface" | "reference" => continue,
                "" => 3,
                _ => 2,
            };
            best.push((score, r));
        }
        if best.is_empty() {
            return boxes;
        }
        let top = best.iter().map(|b| b.0).max().unwrap();
        best.into_iter().filter(|b| b.0 == top).map(|b| b.1).collect()
    }

    fn repr_items(&self, rep: u32) -> Vec<u32> {
        self.doc.arg(rep, 3).map(|v| v.ref_list()).unwrap_or_default()
    }

    /// Local parts (product coordinates, file units) of a product.
    pub fn product_parts(&self, c: &mut Cache, id: u32) -> Vec<Part> {
        let Some(pds) = self.doc.arg(id, 6).and_then(|v| v.as_ref_id()) else { return vec![] };
        let mut parts = Vec::new();
        for rep in self.body_representations(pds) {
            for item in self.repr_items(rep) {
                self.item_parts(c, item, None, &DMat4::IDENTITY, &mut parts, 0);
            }
        }
        parts.retain(|p| !p.mesh.is_empty() && p.mesh.is_finite());
        parts
    }

    /// Mesh one product into scene coordinates.
    pub fn mesh_product(&self, c: &mut Cache, id: u32) -> Option<ProductGeom> {
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.mesh_product_inner(c, id)));
        res.ok().flatten()
    }

    fn mesh_product_inner(&self, c: &mut Cache, id: u32) -> Option<ProductGeom> {
        let mut parts = self.product_parts(c, id);
        if parts.is_empty() {
            return None;
        }
        let world = self.product_matrix(c, id);
        if self.opts.cut_openings {
            let openings = self.openings_of(id);
            if !openings.is_empty() {
                let inv = world.inverse();
                let mut cutters: Vec<Mesh> = Vec::new();
                for o in openings {
                    let ow = self.product_matrix(c, o);
                    let rel = inv * ow;
                    for p in self.product_parts(c, o) {
                        cutters.push(p.mesh.transformed(&rel));
                    }
                }
                for part in &mut parts {
                    for cut in &cutters {
                        if let Some(r) = csg::boolean(&part.mesh, cut, BoolOp::Difference, self.eps * 10.0) {
                            part.mesh = r;
                        }
                    }
                }
            }
        }
        let fallback = self.product_color(id);
        let m = DMat4::from_translation(-self.origin) * DMat4::from_scale(DVec3::splat(self.unit)) * world;
        Some(self.finish(id, &parts, fallback, &m))
    }

    fn finish(&self, id: u32, parts: &[Part], fallback: Color, m: &DMat4) -> ProductGeom {
        let mut g = ProductGeom { id, min: [f32::MAX; 3], max: [f32::MIN; 3], ..Default::default() };
        let flip = m.determinant() < 0.0;
        let mut map: FxHashMap<([u32; 3], [u8; 4]), u32> = FxHashMap::default();
        for part in parts {
            let col = part.color.unwrap_or(fallback);
            let rgba = [(col[0].clamp(0.0, 1.0) * 255.0) as u8, (col[1].clamp(0.0, 1.0) * 255.0) as u8, (col[2].clamp(0.0, 1.0) * 255.0) as u8, (col[3].clamp(0.0, 1.0) * 255.0) as u8];
            if rgba[3] < 250 {
                g.transparent = true;
            }
            let local: Vec<u32> = part
                .mesh
                .pos
                .iter()
                .map(|p| {
                    let w = m.transform_point3(*p);
                    let f = [w.x as f32, w.y as f32, w.z as f32];
                    let key = ([f[0].to_bits(), f[1].to_bits(), f[2].to_bits()], rgba);
                    *map.entry(key).or_insert_with(|| {
                        g.positions.push(f);
                        g.colors.push(rgba);
                        for k in 0..3 {
                            g.min[k] = g.min[k].min(f[k]);
                            g.max[k] = g.max[k].max(f[k]);
                        }
                        (g.positions.len() - 1) as u32
                    })
                })
                .collect();
            for t in part.mesh.idx.chunks_exact(3) {
                let (a, b, cc) = (local[t[0] as usize], local[t[1] as usize], local[t[2] as usize]);
                if a == b || b == cc || a == cc {
                    continue;
                }
                if flip {
                    g.indices.extend_from_slice(&[a, cc, b]);
                } else {
                    g.indices.extend_from_slice(&[a, b, cc]);
                }
            }
        }
        g
    }

    pub fn openings_of(&self, id: u32) -> Vec<u32> {
        let mut out = Vec::new();
        for rel in self.doc.referencing_with_type(id, "IFCRELVOIDSELEMENT") {
            if let Some(a) = self.doc.args(rel) {
                if a.get(4).and_then(|v| v.as_ref_id()) == Some(id) {
                    if let Some(o) = a.get(5).and_then(|v| v.as_ref_id()) {
                        out.push(o);
                    }
                }
            }
        }
        out
    }

    /// Fallback color: material style or class default.
    pub fn product_color(&self, id: u32) -> Color {
        if let Some(c) = self.styles.material_color_of(self.doc, id) {
            return c;
        }
        default_color(self.doc.type_name(id).unwrap_or(""))
    }

    // ------------------------------------------------------------ items

    pub fn item_parts(&self, c: &mut Cache, item: u32, inherited: Option<Color>, m: &DMat4, out: &mut Vec<Part>, depth: u32) {
        if depth > 24 {
            return;
        }
        let color = self.styles.item_color(item).or(inherited);
        let Some(ty) = self.doc.type_name(item) else { return };
        match ty {
            "IFCMAPPEDITEM" => {
                let a = self.doc.args(item).unwrap_or_default();
                let Some(src) = a.first().and_then(|v| v.as_ref_id()) else { return };
                let target = a.get(1).and_then(|v| v.as_ref_id()).map(|t| self.cto(t)).unwrap_or(DMat4::IDENTITY);
                let mapped = self.mapped_parts(c, src, depth);
                let mm = *m * target;
                for p in mapped.iter() {
                    out.push(Part { color: p.color.or(color), mesh: p.mesh.transformed(&mm) });
                }
            }
            _ => {
                if let Some(mut mesh) = self.solid(c, item, depth) {
                    if *m != DMat4::IDENTITY {
                        mesh.transform(m);
                    }
                    out.push(Part { color, mesh });
                } else if ty == "IFCSHELLBASEDSURFACEMODEL" || ty == "IFCFACEBASEDSURFACEMODEL" || ty == "IFCGEOMETRICSET" {
                    // handled in solid(); nothing else
                }
            }
        }
    }

    fn mapped_parts(&self, c: &mut Cache, map: u32, depth: u32) -> Arc<Vec<Part>> {
        if let Some(p) = c.maps.get(&map) {
            return p.clone();
        }
        let a = self.doc.args(map).unwrap_or_default();
        let origin = a.first().and_then(|v| v.as_ref_id()).map(|o| match self.doc.type_name(o) {
            Some(t) if t.starts_with("IFCCARTESIANTRANSFORMATIONOPERATOR") => self.cto(o),
            _ => self.axis2(o),
        });
        let origin = origin.unwrap_or(DMat4::IDENTITY);
        let mut parts = Vec::new();
        if let Some(rep) = a.get(1).and_then(|v| v.as_ref_id()) {
            for item in self.repr_items(rep) {
                self.item_parts(c, item, None, &origin, &mut parts, depth + 1);
            }
        }
        let arc = Arc::new(parts);
        c.maps.insert(map, arc.clone());
        arc
    }

    /// Solid / surface item -> mesh (item coordinates).
    pub fn solid(&self, c: &mut Cache, item: u32, depth: u32) -> Option<Mesh> {
        if depth > 24 {
            return None;
        }
        let ty = self.doc.type_name(item)?.to_string();
        let a = self.doc.args(item)?;
        let refid = |i: usize| a.get(i).and_then(|v| v.as_ref_id());
        let mesh = match ty.as_str() {
            "IFCEXTRUDEDAREASOLID" | "IFCEXTRUDEDAREASOLIDTAPERED" => {
                let prof = self.profile(c, refid(0)?, 0);
                let pos = refid(1).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let dir = refid(2).and_then(|d| self.direction(d)).unwrap_or(DVec3::Z).normalize_or(DVec3::Z);
                let depth_v = self.f(&a, 3);
                let mut m = extrude(&prof, dir * depth_v);
                m.transform(&pos);
                m
            }
            "IFCREVOLVEDAREASOLID" | "IFCREVOLVEDAREASOLIDTAPERED" => {
                let prof = self.profile(c, refid(0)?, 0);
                let pos = refid(1).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let axis = refid(2).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let angle = self.f(&a, 3) * self.angle_unit;
                let angle = if angle.abs() > TAU + 1e-6 { angle.to_radians() / self.angle_unit.max(1e-12) * self.angle_unit } else { angle };
                let ax_o = axis.w_axis.truncate();
                let ax_d = axis.z_axis.truncate().normalize_or(DVec3::Y);
                let n = ((self.opts.max_circle_segments as f64) * angle.abs() / TAU).ceil().max(3.0) as usize;
                let mut m = revolve(&prof, ax_o, ax_d, angle, n);
                m.transform(&pos);
                m
            }
            "IFCSWEPTDISKSOLID" | "IFCSWEPTDISKSOLIDPOLYGONAL" => {
                let path = self.curve3(c, refid(0)?, 0);
                let r = self.f(&a, 1);
                let seg = self.segments_for_radius(r).min(24);
                let ring = circle_pts(DVec2::ZERO, r, seg);
                sweep(&path, &[ring], DVec3::Z, true)
            }
            "IFCFIXEDREFERENCESWEPTAREASOLID" | "IFCSURFACECURVESWEPTAREASOLID" | "IFCDIRECTRIXCURVESWEPTAREASOLID" => {
                let prof = self.profile(c, refid(0)?, 0);
                let pos = refid(1).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let path = self.curve3(c, refid(2)?, 0);
                let reference = if ty == "IFCFIXEDREFERENCESWEPTAREASOLID" { refid(5).and_then(|d| self.direction(d)).unwrap_or(DVec3::Z) } else { DVec3::Z };
                let mut m = Mesh::default();
                for poly in &prof.polys {
                    let mut rings = vec![poly.outer.clone()];
                    rings.extend(poly.holes.iter().cloned());
                    m.append(&sweep(&path, &rings, reference, false));
                }
                m.transform(&pos);
                m
            }
            "IFCFACETEDBREP" | "IFCFACETEDBREPWITHVOIDS" | "IFCADVANCEDBREP" | "IFCADVANCEDBREPWITHVOIDS" => {
                let mut m = Mesh::default();
                if let Some(shell) = refid(0) {
                    self.shell(c, shell, &mut m);
                }
                m
            }
            "IFCSHELLBASEDSURFACEMODEL" | "IFCFACEBASEDSURFACEMODEL" => {
                let mut m = Mesh::default();
                for s in a.first().map(|v| v.ref_list()).unwrap_or_default() {
                    self.shell(c, s, &mut m);
                }
                m
            }
            "IFCCLOSEDSHELL" | "IFCOPENSHELL" | "IFCCONNECTEDFACESET" => {
                let mut m = Mesh::default();
                self.shell(c, item, &mut m);
                m
            }
            "IFCTRIANGULATEDFACESET" | "IFCTRIANGULATEDIRREGULARNETWORK" => self.tri_face_set(item, &ty, &a)?,
            "IFCPOLYGONALFACESET" => self.poly_face_set(item, &ty, &a)?,
            "IFCBOOLEANRESULT" | "IFCBOOLEANCLIPPINGRESULT" => {
                let op = match a.first().and_then(|v| v.as_enum()) {
                    Some("UNION") => BoolOp::Union,
                    Some("INTERSECTION") => BoolOp::Intersection,
                    _ => BoolOp::Difference,
                };
                let first = self.solid(c, refid(1)?, depth + 1)?;
                let second_id = refid(2)?;
                self.apply_boolean(c, first, second_id, op, depth)
            }
            "IFCCSGSOLID" => self.solid(c, refid(0)?, depth + 1)?,
            "IFCBLOCK" => {
                let pos = refid(0).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let mut m = box_mesh(DVec3::ZERO, DVec3::new(self.f(&a, 1), self.f(&a, 2), self.f(&a, 3)));
                m.transform(&pos);
                m
            }
            "IFCRECTANGULARPYRAMID" => {
                let pos = refid(0).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let (x, y, h) = (self.f(&a, 1), self.f(&a, 2), self.f(&a, 3));
                let base = [DVec3::ZERO, DVec3::new(x, 0.0, 0.0), DVec3::new(x, y, 0.0), DVec3::new(0.0, y, 0.0)];
                let apex = DVec3::new(x / 2.0, y / 2.0, h);
                let mut m = Mesh::default();
                m.push_tri(base[0], base[2], base[1]);
                m.push_tri(base[0], base[3], base[2]);
                for i in 0..4 {
                    m.push_tri(base[i], base[(i + 1) % 4], apex);
                }
                m.transform(&pos);
                m
            }
            "IFCRIGHTCIRCULARCYLINDER" => {
                let pos = refid(0).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let (h, r) = (self.f(&a, 1), self.f(&a, 2));
                let prof = Profile { polys: vec![crate::profile::Poly2 { outer: circle_pts(DVec2::ZERO, r, self.segments_for_radius(r)), holes: vec![] }], open: vec![] };
                let mut m = extrude(&prof, DVec3::new(0.0, 0.0, h));
                m.transform(&pos);
                m
            }
            "IFCRIGHTCIRCULARCONE" => {
                let pos = refid(0).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let (h, r) = (self.f(&a, 1), self.f(&a, 2));
                let ring = circle_pts(DVec2::ZERO, r, self.segments_for_radius(r));
                let apex = DVec3::new(0.0, 0.0, h);
                let mut m = Mesh::default();
                let n = ring.len();
                for i in 0..n {
                    let p = ring[i].extend(0.0);
                    let q = ring[(i + 1) % n].extend(0.0);
                    m.push_tri(p, q, apex);
                    m.push_tri(q, p, DVec3::ZERO);
                }
                m.transform(&pos);
                m
            }
            "IFCSPHERE" => {
                let pos = refid(0).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let r = self.f(&a, 1);
                let mut m = sphere(r, self.segments_for_radius(r));
                m.transform(&pos);
                m
            }
            "IFCBOUNDINGBOX" => {
                let corner = refid(0).and_then(|p| self.point_nc(p)).unwrap_or(DVec3::ZERO);
                box_mesh(corner, corner + DVec3::new(self.f(&a, 1), self.f(&a, 2), self.f(&a, 3)))
            }
            "IFCHALFSPACESOLID" | "IFCBOXEDHALFSPACE" | "IFCPOLYGONALBOUNDEDHALFSPACE" => return None,
            _ => return None,
        };
        if mesh.is_empty() {
            None
        } else {
            Some(mesh)
        }
    }

    fn apply_boolean(&self, c: &mut Cache, first: Mesh, second_id: u32, op: BoolOp, depth: u32) -> Mesh {
        let st = self.doc.type_name(second_id).unwrap_or("").to_string();
        let sa = self.doc.args(second_id).unwrap_or_default();
        let eps = self.eps * 10.0;
        match st.as_str() {
            "IFCHALFSPACESOLID" | "IFCBOXEDHALFSPACE" | "IFCPOLYGONALBOUNDEDHALFSPACE" => {
                let Some(plane) = sa.first().and_then(|v| v.as_ref_id()) else { return first };
                let pm = self.doc.arg(plane, 0).and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                let n = pm.z_axis.truncate().normalize_or(DVec3::Z);
                let p0 = pm.w_axis.truncate();
                let agreement = sa.get(1).and_then(|v| v.as_enum()) != Some("F");
                // material side: agreement -> below plane (n·x < n·p0)
                let (mn, mw) = if agreement { (n, n.dot(p0)) } else { (-n, -n.dot(p0)) };
                if st == "IFCPOLYGONALBOUNDEDHALFSPACE" {
                    let pos = sa.get(2).and_then(|v| v.as_ref_id()).map(|p| self.axis2(p)).unwrap_or(DMat4::IDENTITY);
                    let boundary = sa.get(3).and_then(|v| v.as_ref_id()).map(|b| self.curve2(c, b)).unwrap_or_default();
                    if boundary.len() < 3 {
                        return first;
                    }
                    let Some((lo, hi)) = first.bbox() else { return first };
                    let big = (hi - lo).length() * 4.0 + 1.0;
                    let mut prof = Profile { polys: vec![crate::profile::Poly2 { outer: boundary, holes: vec![] }], open: vec![] };
                    prof.normalize();
                    let mut prism = extrude(&prof, DVec3::new(0.0, 0.0, 2.0 * big));
                    prism.transform(&(pos * DMat4::from_translation(DVec3::new(0.0, 0.0, -big))));
                    let material = csg::clip_by_plane(&prism, mn, mw, eps);
                    return csg::boolean(&first, &material, op, eps).unwrap_or(first);
                }
                match op {
                    BoolOp::Difference => csg::clip_by_plane(&first, -mn, -mw, eps),
                    BoolOp::Intersection => csg::clip_by_plane(&first, mn, mw, eps),
                    BoolOp::Union => first,
                }
            }
            _ => match self.solid(c, second_id, depth + 1) {
                Some(second) => csg::boolean(&first, &second, op, eps).unwrap_or(first),
                None => first,
            },
        }
    }

    fn shell(&self, c: &mut Cache, shell: u32, m: &mut Mesh) {
        let faces = self.doc.arg(shell, 0).map(|v| v.ref_list()).unwrap_or_default();
        for f in faces {
            self.face(c, f, m);
        }
    }

    fn face(&self, c: &mut Cache, face: u32, m: &mut Mesh) {
        let Some(bounds) = self.doc.arg(face, 0).map(|v| v.ref_list()) else { return };
        let mut outer: Option<Vec<DVec3>> = None;
        let mut holes: Vec<Vec<DVec3>> = Vec::new();
        for b in bounds {
            let bt = self.doc.type_name(b).unwrap_or("").to_string();
            let ba = self.doc.args(b).unwrap_or_default();
            let Some(lp) = ba.first().and_then(|v| v.as_ref_id()) else { continue };
            let orient = ba.get(1).and_then(|v| v.as_enum()) != Some("F");
            let mut ring = self.loop_points(c, lp);
            dedup_ring3(&mut ring, self.eps);
            if ring.len() < 3 {
                continue;
            }
            if !orient {
                ring.reverse();
            }
            if bt == "IFCFACEOUTERBOUND" && outer.is_none() {
                outer = Some(ring);
            } else {
                holes.push(ring);
            }
        }
        let outer = match outer {
            Some(o) => o,
            None => {
                if holes.is_empty() {
                    return;
                }
                // pick the largest ring as outer
                let (i, _) = holes.iter().enumerate().max_by(|a, b| crate::mesh::newell(a.1).length().partial_cmp(&crate::mesh::newell(b.1).length()).unwrap_or(std::cmp::Ordering::Equal)).unwrap();
                holes.swap_remove(i)
            }
        };
        if holes.is_empty() && outer.len() == 3 {
            m.push_tri(outer[0], outer[1], outer[2]);
            return;
        }
        // advanced faces with a curved surface: tessellate the surface grid
        if self.doc.type_name(face) == Some("IFCADVANCEDFACE") {
            if let Some(surf) = self.doc.arg(face, 1).and_then(|v| v.as_ref_id()) {
                let st = self.doc.type_name(surf).unwrap_or("");
                if st.starts_with("IFCBSPLINESURFACE") || st.starts_with("IFCRATIONALBSPLINESURFACE") {
                    if let Some(g) = self.bspline_surface(c, surf) {
                        m.append(&g);
                        return;
                    }
                }
            }
        }
        add_polygon3(m, &outer, &holes);
    }

    fn loop_points(&self, c: &mut Cache, lp: u32) -> Vec<DVec3> {
        match self.doc.type_name(lp) {
            Some("IFCPOLYLOOP") => self.doc.arg(lp, 0).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter_map(|p| self.point(c, p)).collect(),
            Some("IFCEDGELOOP") => {
                let mut out: Vec<DVec3> = Vec::new();
                for oe in self.doc.arg(lp, 0).map(|v| v.ref_list()).unwrap_or_default() {
                    let a = self.doc.args(oe).unwrap_or_default();
                    let (edge, orient) = if self.doc.type_name(oe) == Some("IFCORIENTEDEDGE") { (a.get(2).and_then(|v| v.as_ref_id()), a.get(3).and_then(|v| v.as_enum()) != Some("F")) } else { (Some(oe), true) };
                    let Some(edge) = edge else { continue };
                    let mut pts = self.edge_points(c, edge);
                    if !orient {
                        pts.reverse();
                    }
                    if !pts.is_empty() {
                        pts.pop(); // end point is the start of the next edge
                    }
                    out.extend(pts);
                }
                out
            }
            _ => vec![],
        }
    }

    fn edge_points(&self, c: &mut Cache, edge: u32) -> Vec<DVec3> {
        let a = self.doc.args(edge).unwrap_or_default();
        let vp = |i: usize| a.get(i).and_then(|v| v.as_ref_id()).and_then(|v| self.doc.arg(v, 0)).and_then(|p| p.as_ref_id()).and_then(|p| self.point_nc(p));
        let s = vp(0);
        let e = vp(1);
        let same = a.get(3).and_then(|v| v.as_enum()) != Some("F");
        let geom = a.get(2).and_then(|v| v.as_ref_id());
        let (Some(s), Some(e)) = (s, e) else { return vec![] };
        let Some(g) = geom else { return vec![s, e] };
        let gt = self.doc.type_name(g).unwrap_or("");
        if gt == "IFCLINE" || gt == "IFCPOLYLINE" && self.doc.arg(g, 0).map(|v| v.ref_list().len()).unwrap_or(0) <= 2 {
            return vec![s, e];
        }
        let mut pts = self.curve3(c, g, 0);
        if pts.len() < 2 {
            return vec![s, e];
        }
        if !same {
            pts.reverse();
        }
        // trim the sampled curve between the vertices
        let closest = |q: DVec3, pts: &[DVec3]| pts.iter().enumerate().min_by(|a, b| a.1.distance_squared(q).partial_cmp(&b.1.distance_squared(q)).unwrap()).map(|x| x.0).unwrap_or(0);
        let i0 = closest(s, &pts);
        let i1 = closest(e, &pts);
        let mut out = vec![s];
        if i0 < i1 {
            out.extend_from_slice(&pts[i0 + 1..i1]);
        } else if i0 > i1 {
            // closed curve wrap-around
            let closed = pts.first().unwrap().distance(*pts.last().unwrap()) < self.eps * 100.0;
            if closed {
                out.extend_from_slice(&pts[i0 + 1..]);
                out.extend_from_slice(&pts[1..i1]);
            }
        }
        out.push(e);
        out
    }

    fn bspline_surface(&self, c: &mut Cache, surf: u32) -> Option<Mesh> {
        let a = self.doc.args(surf)?;
        let t = self.doc.type_name(surf)?;
        let (ud, vd) = (a.first()?.as_i64()? as usize, a.get(1)?.as_i64()? as usize);
        let rows: Vec<Vec<DVec3>> = a.get(2)?.as_list()?.iter().map(|row| row.ref_list().into_iter().filter_map(|p| self.point(c, p)).collect()).collect();
        if rows.is_empty() || rows[0].is_empty() {
            return None;
        }
        let expand = |mi: usize, ki: usize| -> Vec<f64> {
            let m: Vec<i64> = a.get(mi).and_then(|v| v.as_list().map(|l| l.iter().filter_map(|x| x.as_i64()).collect())).unwrap_or_default();
            let k: Vec<f64> = a.get(ki).and_then(|v| v.as_list().map(|l| l.iter().filter_map(|x| x.as_f64()).collect())).unwrap_or_default();
            let mut out = Vec::new();
            for (kv, mv) in k.iter().zip(m.iter()) {
                for _ in 0..*mv {
                    out.push(*kv);
                }
            }
            out
        };
        let uk = expand(7, 9);
        let vk = expand(8, 10);
        let nu = rows.len();
        let nv = rows[0].len();
        if uk.len() != nu + ud + 1 || vk.len() != nv + vd + 1 || rows.iter().any(|r| r.len() != nv) {
            return None;
        }
        let weights: Option<Vec<Vec<f64>>> = if t.starts_with("IFCRATIONAL") { a.get(12).and_then(|v| v.as_list().map(|l| l.iter().map(|r| r.as_list().map(|x| x.iter().filter_map(|y| y.as_f64()).collect()).unwrap_or_default()).collect())) } else { None };
        let su = (nu * 4).clamp(4, 48);
        let sv = (nv * 4).clamp(4, 48);
        let (u0, u1) = (uk[ud], uk[uk.len() - ud - 1]);
        let (v0, v1) = (vk[vd], vk[vk.len() - vd - 1]);
        let mut grid = Vec::with_capacity((su + 1) * (sv + 1));
        for i in 0..=su {
            let u = u0 + (u1 - u0) * i as f64 / su as f64;
            // evaluate each column along v, then along u
            let col: Vec<DVec3> = (0..nv).map(|j| {
                let cps: Vec<DVec3> = (0..nu).map(|k| rows[k][j]).collect();
                let w: Vec<f64> = weights.as_ref().map(|w| (0..nu).map(|k| w.get(k).and_then(|r| r.get(j)).copied().unwrap_or(1.0)).collect()).unwrap_or_default();
                de_boor(ud, &uk, &cps, &w, u)
            })
            .collect();
            for jv in 0..=sv {
                let v = v0 + (v1 - v0) * jv as f64 / sv as f64;
                grid.push(de_boor(vd, &vk, &col, &[], v));
            }
        }
        let mut m = Mesh { pos: grid, idx: vec![] };
        let w = (sv + 1) as u32;
        for i in 0..su as u32 {
            for j in 0..sv as u32 {
                let (p00, p01, p10, p11) = (i * w + j, i * w + j + 1, (i + 1) * w + j, (i + 1) * w + j + 1);
                m.idx.extend_from_slice(&[p00, p10, p11, p00, p11, p01]);
            }
        }
        Some(m)
    }

    fn tri_face_set(&self, item: u32, ty: &str, a: &[Value]) -> Option<Mesh> {
        let s = self.doc.schema();
        let ci = s.attr_index(ty, "Coordinates").unwrap_or(0);
        let ii = s.attr_index(ty, "CoordIndex").unwrap_or(3);
        let pi = s.attr_index(ty, "PnIndex");
        let coords = self.point_list(a.get(ci)?.as_ref_id()?);
        let raw = self.doc.raw_args(item)?;
        let _ = raw;
        let mut idx = Vec::new();
        collect_ints(a.get(ii)?, &mut idx);
        let pn: Vec<i64> = pi.and_then(|i| a.get(i)).map(|v| {
            let mut o = Vec::new();
            collect_ints(v, &mut o);
            o
        })
        .unwrap_or_default();
        let resolve = |i: i64| -> Option<u32> {
            let i = if pn.is_empty() { i } else { *pn.get((i - 1).max(0) as usize)? };
            let k = (i - 1).max(0) as usize;
            if k < coords.len() {
                Some(k as u32)
            } else {
                None
            }
        };
        let mut m = Mesh { pos: coords.clone(), idx: Vec::with_capacity(idx.len()) };
        for t in idx.chunks_exact(3) {
            if let (Some(x), Some(y), Some(z)) = (resolve(t[0]), resolve(t[1]), resolve(t[2])) {
                m.idx.extend_from_slice(&[x, y, z]);
            }
        }
        Some(m)
    }

    fn poly_face_set(&self, _item: u32, ty: &str, a: &[Value]) -> Option<Mesh> {
        let s = self.doc.schema();
        let ci = s.attr_index(ty, "Coordinates").unwrap_or(0);
        let fi = s.attr_index(ty, "Faces").unwrap_or(2);
        let pi = s.attr_index(ty, "PnIndex");
        let coords = self.point_list(a.get(ci)?.as_ref_id()?);
        let pn: Vec<i64> = pi.and_then(|i| a.get(i)).map(|v| {
            let mut o = Vec::new();
            collect_ints(v, &mut o);
            o
        })
        .unwrap_or_default();
        let pt = |i: i64| -> Option<DVec3> {
            let i = if pn.is_empty() { i } else { *pn.get((i - 1).max(0) as usize)? };
            coords.get((i - 1).max(0) as usize).copied()
        };
        let mut m = Mesh::default();
        for f in a.get(fi)?.ref_list() {
            let fa = self.doc.args(f).unwrap_or_default();
            let mut outer_i = Vec::new();
            if let Some(v) = fa.first() {
                collect_ints(v, &mut outer_i);
            }
            let outer: Vec<DVec3> = outer_i.iter().filter_map(|&i| pt(i)).collect();
            let mut holes = Vec::new();
            if let Some(Value::List(inner)) = fa.get(1) {
                for h in inner {
                    let mut hi = Vec::new();
                    collect_ints(h, &mut hi);
                    holes.push(hi.iter().filter_map(|&i| pt(i)).collect::<Vec<_>>());
                }
            }
            if holes.is_empty() && outer.len() == 3 {
                m.push_tri(outer[0], outer[1], outer[2]);
            } else {
                add_polygon3(&mut m, &outer, &holes);
            }
        }
        Some(m)
    }

    // ------------------------------------------------------------ batch

    /// Mesh products in parallel, reporting batches through `on_batch`.
    pub fn mesh_all(&self, ids: &[u32], on_batch: impl Fn(Vec<ProductGeom>) + Sync + Send) {
        let batch = 64;
        ids.par_chunks(batch).for_each_init(Cache::default, |cache, chunk| {
            // bound per-thread cache growth for huge models
            if cache.points.len() > 2_000_000 {
                cache.points.clear();
            }
            let out: Vec<ProductGeom> = chunk.iter().filter_map(|&id| self.mesh_product(cache, id)).collect();
            if !out.is_empty() {
                on_batch(out);
            }
        });
    }

    /// Mesh a set of products (synchronous, used after edits).
    pub fn mesh_ids(&self, ids: &[u32]) -> Vec<ProductGeom> {
        ids.par_iter().map_init(Cache::default, |c, &id| self.mesh_product(c, id)).flatten().collect()
    }
}

pub fn make_axes(loc: DVec3, z: DVec3, xref: DVec3) -> DMat4 {
    let z = z.normalize_or(DVec3::Z);
    let mut x = xref - z * xref.dot(z);
    if x.length_squared() < 1e-12 {
        let alt = if z.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        x = alt - z * alt.dot(z);
    }
    let x = x.normalize();
    let y = z.cross(x);
    DMat4::from_cols(x.extend(0.0), y.extend(0.0), z.extend(0.0), loc.extend(1.0))
}

/// Extrude profile areas along vector `d`.
pub fn extrude(prof: &Profile, d: DVec3) -> Mesh {
    let mut m = Mesh::default();
    for poly in &prof.polys {
        let rings: Vec<&Vec<DVec2>> = std::iter::once(&poly.outer).chain(poly.holes.iter()).collect();
        // caps
        let tris = crate::mesh::triangulate2(&poly.outer, &poly.holes);
        let flat: Vec<DVec3> = rings.iter().flat_map(|r| r.iter().map(|p| DVec3::new(p.x, p.y, 0.0))).collect();
        let base = m.pos.len() as u32;
        m.pos.extend(flat.iter().copied());
        let top = m.pos.len() as u32;
        m.pos.extend(flat.iter().map(|p| *p + d));
        for t in tris.chunks_exact(3) {
            m.idx.extend_from_slice(&[base + t[0], base + t[2], base + t[1]]);
            m.idx.extend_from_slice(&[top + t[0], top + t[1], top + t[2]]);
        }
        // sides
        for r in rings {
            let n = r.len();
            for i in 0..n {
                let a = DVec3::new(r[i].x, r[i].y, 0.0);
                let b = DVec3::new(r[(i + 1) % n].x, r[(i + 1) % n].y, 0.0);
                let s = m.pos.len() as u32;
                m.pos.extend_from_slice(&[a, b, b + d, a + d]);
                m.idx.extend_from_slice(&[s, s + 1, s + 2, s, s + 2, s + 3]);
            }
        }
    }
    for o in &prof.open {
        for w in o.windows(2) {
            let a = DVec3::new(w[0].x, w[0].y, 0.0);
            let b = DVec3::new(w[1].x, w[1].y, 0.0);
            let s = m.pos.len() as u32;
            m.pos.extend_from_slice(&[a, b, b + d, a + d]);
            m.idx.extend_from_slice(&[s, s + 1, s + 2, s, s + 2, s + 3]);
            // back side so open surfaces render from both sides
            m.idx.extend_from_slice(&[s, s + 2, s + 1, s, s + 3, s + 2]);
        }
    }
    if d.z < 0.0 {
        m.flip();
    }
    m
}

/// Revolve profile around an axis (in profile space) by `angle`.
pub fn revolve(prof: &Profile, ax_o: DVec3, ax_d: DVec3, angle: f64, steps: usize) -> Mesh {
    let mut m = Mesh::default();
    let rot = |p: DVec3, t: f64| -> DVec3 {
        let q = glam::DQuat::from_axis_angle(ax_d, t);
        ax_o + q * (p - ax_o)
    };
    let full = (angle.abs() - TAU).abs() < 1e-6;
    for poly in &prof.polys {
        let rings: Vec<&Vec<DVec2>> = std::iter::once(&poly.outer).chain(poly.holes.iter()).collect();
        for r in &rings {
            let n = r.len();
            for i in 0..n {
                let a = DVec3::new(r[i].x, r[i].y, 0.0);
                let b = DVec3::new(r[(i + 1) % n].x, r[(i + 1) % n].y, 0.0);
                for s in 0..steps {
                    let t0 = angle * s as f64 / steps as f64;
                    let t1 = angle * (s + 1) as f64 / steps as f64;
                    let (a0, b0, a1, b1) = (rot(a, t0), rot(b, t0), rot(a, t1), rot(b, t1));
                    m.push_tri(a0, a1, b1);
                    m.push_tri(a0, b1, b0);
                }
            }
        }
        if !full {
            let tris = crate::mesh::triangulate2(&poly.outer, &poly.holes);
            let flat: Vec<DVec3> = rings.iter().flat_map(|r| r.iter().map(|p| DVec3::new(p.x, p.y, 0.0))).collect();
            let s0 = m.pos.len() as u32;
            m.pos.extend(flat.iter().copied());
            let s1 = m.pos.len() as u32;
            m.pos.extend(flat.iter().map(|p| rot(*p, angle)));
            for t in tris.chunks_exact(3) {
                m.idx.extend_from_slice(&[s0 + t[0], s0 + t[1], s0 + t[2]]);
                m.idx.extend_from_slice(&[s1 + t[0], s1 + t[2], s1 + t[1]]);
            }
        }
    }
    if m.signed_volume() < 0.0 {
        m.flip();
    }
    m
}

/// Sweep closed 2D rings along a 3D path (rotation minimising frames).
pub fn sweep(path: &[DVec3], rings: &[Vec<DVec2>], reference: DVec3, cap: bool) -> Mesh {
    let mut m = Mesh::default();
    let mut path: Vec<DVec3> = path.to_vec();
    path.dedup_by(|a, b| a.distance_squared(*b) < 1e-18);
    if path.len() < 2 || rings.is_empty() {
        return m;
    }
    let n = path.len();
    let tangents: Vec<DVec3> = (0..n)
        .map(|i| {
            let t = if i == 0 { path[1] - path[0] } else if i == n - 1 { path[n - 1] - path[n - 2] } else { (path[i + 1] - path[i]).normalize_or_zero() + (path[i] - path[i - 1]).normalize_or_zero() };
            t.normalize_or(DVec3::Z)
        })
        .collect();
    // initial frame
    let t0 = tangents[0];
    let mut x = reference - t0 * reference.dot(t0);
    if x.length_squared() < 1e-12 {
        let alt = if t0.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        x = alt - t0 * alt.dot(t0);
    }
    let mut x = x.normalize();
    let mut frames = Vec::with_capacity(n);
    for i in 0..n {
        if i > 0 {
            // parallel transport
            let prev = tangents[i - 1];
            let cur = tangents[i];
            let axis = prev.cross(cur);
            if axis.length_squared() > 1e-14 {
                let ang = prev.dot(cur).clamp(-1.0, 1.0).acos();
                x = glam::DQuat::from_axis_angle(axis.normalize(), ang) * x;
            }
            x = (x - cur * x.dot(cur)).normalize_or(x);
        }
        let t = tangents[i];
        let y = t.cross(x);
        frames.push((x, y));
    }
    for ring in rings {
        let rn = ring.len();
        if rn < 2 {
            continue;
        }
        let base = m.pos.len() as u32;
        for i in 0..n {
            let (fx, fy) = frames[i];
            for p in ring {
                m.pos.push(path[i] + fx * p.x + fy * p.y);
            }
        }
        for i in 0..n as u32 - 1 {
            for j in 0..rn as u32 {
                let j2 = (j + 1) % rn as u32;
                let a = base + i * rn as u32 + j;
                let b = base + i * rn as u32 + j2;
                let c = base + (i + 1) * rn as u32 + j;
                let d = base + (i + 1) * rn as u32 + j2;
                m.idx.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }
    }
    if cap || rings.len() == 1 {
        let outer = &rings[0];
        let holes: Vec<Vec<DVec2>> = rings[1..].to_vec();
        let tris = crate::mesh::triangulate2(outer, &holes);
        for (end, flip) in [(0usize, true), (n - 1, false)] {
            let (fx, fy) = frames[end];
            let s = m.pos.len() as u32;
            for r in rings {
                for p in r {
                    m.pos.push(path[end] + fx * p.x + fy * p.y);
                }
            }
            for t in tris.chunks_exact(3) {
                if flip {
                    m.idx.extend_from_slice(&[s + t[0], s + t[2], s + t[1]]);
                } else {
                    m.idx.extend_from_slice(&[s + t[0], s + t[1], s + t[2]]);
                }
            }
        }
    }
    if m.signed_volume() < 0.0 {
        m.flip();
    }
    m
}

fn sphere(r: f64, seg: usize) -> Mesh {
    let mut m = Mesh::default();
    let rings = (seg / 2).max(4);
    for i in 0..=rings {
        let phi = std::f64::consts::PI * i as f64 / rings as f64;
        for j in 0..seg {
            let th = TAU * j as f64 / seg as f64;
            m.pos.push(DVec3::new(r * phi.sin() * th.cos(), r * phi.sin() * th.sin(), r * phi.cos()));
        }
    }
    let s = seg as u32;
    for i in 0..rings as u32 {
        for j in 0..s {
            let a = i * s + j;
            let b = i * s + (j + 1) % s;
            let c = (i + 1) * s + j;
            let d = (i + 1) * s + (j + 1) % s;
            m.idx.extend_from_slice(&[a, c, d, a, d, b]);
        }
    }
    m
}

fn collect_ints(v: &Value, out: &mut Vec<i64>) {
    match v {
        Value::Int(i) => out.push(*i),
        Value::Real(f) => out.push(*f as i64),
        Value::List(l) => l.iter().for_each(|x| collect_ints(x, out)),
        Value::Typed(_, x) => collect_ints(x, out),
        _ => {}
    }
}

/// Parse up to `out.len()` numbers from raw text (skips refs and strings).
fn scan_numbers(b: &[u8], out: &mut [f64]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < b.len() && n < out.len() {
        let c = b[i];
        if c == b'#' {
            i += 1;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
        } else if c.is_ascii_digit() || c == b'-' || c == b'+' || c == b'.' {
            let s = i;
            i += 1;
            while i < b.len() && (b[i].is_ascii_digit() || matches!(b[i], b'.' | b'E' | b'e' | b'-' | b'+')) {
                i += 1;
            }
            if let Some(v) = std::str::from_utf8(&b[s..i]).ok().and_then(ifc_doc::step::parse_real) {
                out[n] = v;
                n += 1;
            }
        } else {
            i += 1;
        }
    }
    n
}

fn scan_all_numbers(b: &[u8], out: &mut Vec<f64>) {
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'#' {
            i += 1;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
        } else if c == b'\'' {
            i += 1;
            while i < b.len() && b[i] != b'\'' {
                i += 1;
            }
            i += 1;
        } else if c.is_ascii_digit() || c == b'-' || c == b'+' || c == b'.' {
            let s = i;
            i += 1;
            while i < b.len() && (b[i].is_ascii_digit() || matches!(b[i], b'.' | b'E' | b'e' | b'-' | b'+')) {
                i += 1;
            }
            if let Some(v) = std::str::from_utf8(&b[s..i]).ok().and_then(ifc_doc::step::parse_real) {
                out.push(v);
            }
        } else {
            i += 1;
        }
    }
}

/// End offset of the first top-level argument in raw argument text.
fn first_arg_end(b: &[u8]) -> usize {
    let mut depth = 0i32;
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b'\'' => {
                i += 1;
                while i < b.len() && b[i] != b'\'' {
                    i += 1;
                }
            }
            b',' if depth == 0 => return i,
            _ => {}
        }
        i += 1;
    }
    b.len()
}
