//! One open document with its scene, selection and view state.

use crate::viewer::camera::Camera;
use crate::viewer::scene::{flags, Scene};
use crossbeam_channel::{Receiver, Sender};
use glam::{DVec3, Vec3, Vec4};
use ifc_doc::model::SpatialTree;
use ifc_doc::{tflags, Document};
use ifc_geom::{Engine, GeomOptions, ProductGeom};
use rustc_hash::{FxHashMap, FxHashSet};
use std::path::PathBuf;
use std::sync::Arc;

pub enum LoadMsg {
    Progress(f32, String),
    Doc(Arc<Document>, DVec3, usize),
    Geoms(Vec<ProductGeom>),
    Done(f64),
    Error(String),
}

pub struct Loading {
    pub rx: Receiver<LoadMsg>,
    pub progress: f32,
    pub message: String,
    pub total_products: usize,
    pub meshed: usize,
    pub started: std::time::Instant,
    pub geometry_done: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ColorMode {
    Ifc,
    ByClass,
    ByStorey,
    ByProperty { pset: String, prop: String },
    ByMaterial,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum MeasureMode {
    #[default]
    Distance,
    Chain,
    Area,
    Angle,
}

#[derive(Clone, Debug)]
pub struct MeasureShape {
    pub mode: MeasureMode,
    pub pts: Vec<Vec3>,
}

impl MeasureShape {
    /// Total length (chain) or perimeter (area).
    pub fn length(&self) -> f32 {
        let mut l: f32 = self.pts.windows(2).map(|w| w[0].distance(w[1])).sum();
        if self.mode == MeasureMode::Area && self.pts.len() > 2 {
            l += self.pts[self.pts.len() - 1].distance(self.pts[0]);
        }
        l
    }
    /// Polygon area (Newell), m².
    pub fn area(&self) -> f32 {
        let n = self.pts.len();
        let mut v = Vec3::ZERO;
        for i in 0..n {
            let (a, b) = (self.pts[i], self.pts[(i + 1) % n]);
            v += a.cross(b);
        }
        v.length() * 0.5
    }
    /// Angle at the middle point, degrees.
    pub fn angle(&self) -> f32 {
        if self.pts.len() < 3 {
            return 0.0;
        }
        let (a, b) = (self.pts[0] - self.pts[1], self.pts[2] - self.pts[1]);
        a.angle_between(b).to_degrees()
    }
    pub fn summary(&self) -> String {
        match self.mode {
            MeasureMode::Distance | MeasureMode::Chain => format!("Länge {:.3} m ({} Segmente)", self.length(), self.pts.len().saturating_sub(1)),
            MeasureMode::Area => format!("Fläche {:.3} m² · Umfang {:.3} m", self.area(), self.length()),
            MeasureMode::Angle => format!("Winkel {:.2}°", self.angle()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Measure {
    pub active: bool,
    pub mode: MeasureMode,
    pub points: Vec<Vec3>,
    pub results: Vec<(Vec3, Vec3)>,
    pub shapes: Vec<MeasureShape>,
}

impl Measure {
    /// Finish the current chain/area; returns a status text.
    pub fn finish(&mut self) -> Option<String> {
        let need = match self.mode {
            MeasureMode::Area => 3,
            _ => 2,
        };
        if matches!(self.mode, MeasureMode::Chain | MeasureMode::Area) && self.points.len() >= need {
            let sh = MeasureShape { mode: self.mode, pts: std::mem::take(&mut self.points) };
            let t = sh.summary();
            self.shapes.push(sh);
            return Some(t);
        }
        self.points.clear();
        None
    }
}

#[derive(Clone, Debug)]
pub struct SectionPlane {
    pub normal: Vec3,
    pub point: Vec3,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Select,
    Measure,
    Section,
    BoxSelect,
    PickCoords,
    Move,
    Rotate,
}

pub struct Session {
    pub uid: u64,
    pub path: Option<PathBuf>,
    pub doc: Arc<Document>,
    pub scene: Scene,
    pub camera: Camera,
    pub tree: SpatialTree,
    pub selection: Vec<u32>,
    pub hidden: FxHashSet<u32>,
    pub class_hidden: FxHashSet<String>,
    pub isolated: Option<FxHashSet<u32>>,
    pub loading: Option<Loading>,
    pub geom_opts: GeomOptions,
    pub styles: Option<ifc_geom::style::StyleMap>,
    pub expanded: FxHashSet<u32>,
    pub scroll_tree_to: Option<u32>,
    pub color_mode: ColorMode,
    pub legend: Vec<(String, [u8; 4], usize)>,
    pub measure: Measure,
    pub sections: Vec<SectionPlane>,
    pub tool: Tool,
    pub xray: bool,
    pub status: String,
    pub last_error: Option<String>,
    pub needs_fit: bool,
    pub view_dirty: bool,
    pub nav_back: Vec<u32>,
    pub nav_fwd: Vec<u32>,
    pub hover_obj: Option<u32>,
    pub pending_remesh_all: bool,
    /// Active floor plan: (storey id, cut height above storey in m).
    pub plan: Option<(u32, f32)>,
    pub plan_saved_camera: Option<Camera>,
    pub meta_pending: bool,
    /// Suggested file name for "Save" of a new document.
    pub pending_new_name: Option<String>,
    /// Last picked coordinate (scene coords) for the coordinate tool.
    pub picked_coord: Option<Vec3>,
    /// Gizmo drag state: accumulated world delta (m) and rotation (deg).
    pub gizmo_drag: Option<(u8, Vec3, f32)>,
}

static NEXT_UID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

impl Session {
    pub fn empty(doc: Document) -> Session {
        let path = doc.path.clone();
        let tree = SpatialTree::build(&doc);
        let mut expanded = FxHashSet::default();
        for r in &tree.roots {
            expanded.insert(*r);
            for (c, _) in tree.children_of(*r) {
                expanded.insert(*c);
                for (g, _) in tree.children_of(*c) {
                    expanded.insert(*g);
                }
            }
        }
        Session {
            uid: NEXT_UID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            path,
            doc: Arc::new(doc),
            scene: Scene::new(DVec3::ZERO),
            camera: Camera::default(),
            tree,
            selection: Vec::new(),
            hidden: FxHashSet::default(),
            class_hidden: ["IFCSPACE".to_string()].into_iter().collect(),
            isolated: None,
            loading: None,
            geom_opts: GeomOptions::default(),
            styles: None,
            expanded,
            scroll_tree_to: None,
            color_mode: ColorMode::Ifc,
            legend: Vec::new(),
            measure: Measure::default(),
            sections: Vec::new(),
            tool: Tool::Select,
            xray: false,
            status: String::new(),
            last_error: None,
            needs_fit: true,
            view_dirty: true,
            nav_back: Vec::new(),
            nav_fwd: Vec::new(),
            hover_obj: None,
            pending_remesh_all: false,
            plan: None,
            plan_saved_camera: None,
            meta_pending: false,
            pending_new_name: None,
            picked_coord: None,
            gizmo_drag: None,
        }
    }

    /// Start loading a file in the background.
    pub fn open(path: PathBuf, opts: GeomOptions, ctx: egui::Context) -> Session {
        let (tx, rx) = crossbeam_channel::unbounded();
        let mut s = Session::empty(Document::new_empty(ifc_doc::SchemaId::Ifc4));
        s.path = Some(path.clone());
        s.geom_opts = opts.clone();
        s.loading = Some(Loading { rx, progress: 0.0, message: "Wird geöffnet …".into(), total_products: 0, meshed: 0, started: std::time::Instant::now(), geometry_done: false });
        std::thread::Builder::new()
            .name("ifc-loader".into())
            .stack_size(64 << 20)
            .spawn(move || load_thread(path, opts, tx, ctx))
            .expect("thread");
        s
    }

    pub fn title(&self) -> String {
        let name = self.path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Unbenannt".into());
        if self.doc.is_dirty() {
            format!("{name} •")
        } else {
            name
        }
    }

    pub fn is_loading(&self) -> bool {
        self.loading.as_ref().map(|l| !l.geometry_done).unwrap_or(false)
    }

    /// Mutable document access (only once background loading released it).
    pub fn doc_mut(&mut self) -> Option<&mut Document> {
        Arc::get_mut(&mut self.doc)
    }

    /// Process loader messages (time bounded). Returns true if something changed.
    pub fn poll_loading(&mut self, budget: std::time::Duration) -> bool {
        let Some(l) = self.loading.as_mut() else { return false };
        let t0 = std::time::Instant::now();
        let mut changed = false;
        let mut finished = false;
        loop {
            if t0.elapsed() > budget {
                break;
            }
            match l.rx.try_recv() {
                Ok(LoadMsg::Progress(p, m)) => {
                    l.progress = p;
                    l.message = m;
                    changed = true;
                }
                Ok(LoadMsg::Doc(doc, origin, total)) => {
                    let path = self.path.clone();
                    self.tree = SpatialTree::build(&doc);
                    self.expanded.clear();
                    for r in self.tree.roots.clone() {
                        self.expanded.insert(r);
                        for (c, _) in self.tree.children_of(r).to_vec() {
                            self.expanded.insert(c);
                            for (g, _) in self.tree.children_of(c).to_vec() {
                                self.expanded.insert(g);
                            }
                        }
                    }
                    self.doc = doc;
                    self.path = path;
                    self.meta_pending = true;
                    self.scene = Scene::new(origin);
                    l.total_products = total;
                    l.message = format!("Geometrie wird erzeugt (0/{total}) …");
                    changed = true;
                }
                Ok(LoadMsg::Geoms(batch)) => {
                    l.meshed += batch.len();
                    for g in batch {
                        self.scene.upsert(g);
                    }
                    l.progress = 0.3 + 0.7 * (l.meshed as f32 / l.total_products.max(1) as f32);
                    l.message = format!("Geometrie wird erzeugt ({}/{}) …", l.meshed, l.total_products);
                    self.view_dirty = true;
                    changed = true;
                }
                Ok(LoadMsg::Done(ms)) => {
                    l.geometry_done = true;
                    self.status = format!("Geladen in {:.2} s – {} Entities, {} Objekte mit Geometrie, {} Dreiecke", ms / 1000.0, self.doc.len(), self.scene.objects.len(), fmt_count(self.scene.total_tris));
                    finished = true;
                    changed = true;
                    break;
                }
                Ok(LoadMsg::Error(e)) => {
                    self.last_error = Some(e.clone());
                    self.status = format!("Fehler: {e}");
                    finished = true;
                    changed = true;
                    break;
                }
                Err(_) => break,
            }
        }
        if changed {
            self.apply_visibility();
            if self.needs_fit && self.scene.bbox.is_some() && self.loading.as_ref().map(|l| l.meshed > 0).unwrap_or(false) {
                if let Some((lo, hi)) = self.scene.robust_visible_bbox() {
                    self.camera.fit(lo, hi);
                }
                if finished {
                    self.needs_fit = false;
                }
            }
        }
        if finished {
            // keep the Loading struct until the loader thread dropped its Arc
            if let Some(l) = self.loading.as_mut() {
                l.geometry_done = true;
            }
        }
        if self.loading.as_ref().map(|l| l.geometry_done).unwrap_or(false) && Arc::strong_count(&self.doc) == 1 {
            self.loading = None;
            self.recolor();
        }
        changed
    }

    // ---------------------------------------------------------------- visibility

    /// Recompute per-object flags from selection / hidden / isolation / class filters.
    pub fn apply_visibility(&mut self) {
        let sel: FxHashSet<u32> = self.selection.iter().copied().collect();
        let n = self.scene.objects.len();
        let doc = &self.doc;
        // per type index: hidden by class filter
        let type_hidden: Vec<bool> = doc.types.iter().map(|t| self.class_hidden.contains(&t.name)).collect();
        let any_hidden = !self.hidden.is_empty();
        for i in 0..n {
            let id = self.scene.objects[i].id;
            let th = doc.type_idx_of(id).map(|t| type_hidden[t as usize]).unwrap_or(false);
            let is_sel = !sel.is_empty() && sel.contains(&id);
            let user_hidden = any_hidden && self.hidden.contains(&id);
            let mut hidden = user_hidden || th;
            if let Some(iso) = &self.isolated {
                if !iso.contains(&id) {
                    hidden = true;
                }
            }
            if is_sel && th && !user_hidden {
                hidden = false;
            }
            let mut f = self.scene.state[i][0] & flags::OVERRIDE;
            if hidden {
                f |= flags::HIDDEN;
            }
            if is_sel {
                f |= flags::SELECTED;
            } else if self.xray {
                f |= flags::GHOST;
            }
            if self.scene.state[i][0] != f {
                self.scene.state[i][0] = f;
                self.scene.state_dirty = true;
            }
        }
        self.view_dirty = true;
    }

    pub fn select(&mut self, ids: Vec<u32>, additive: bool) {
        if let Some(&p) = self.selection.first() {
            if !additive && ids.first() != Some(&p) {
                self.nav_back.push(p);
                self.nav_fwd.clear();
            }
        }
        if additive {
            for id in ids {
                if let Some(pos) = self.selection.iter().position(|&x| x == id) {
                    self.selection.remove(pos);
                } else {
                    self.selection.insert(0, id);
                }
            }
        } else {
            self.selection = ids;
        }
        if let Some(&p) = self.selection.first() {
            self.scroll_tree_to = Some(p);
            for a in self.tree.path_to(p) {
                if a != p {
                    self.expanded.insert(a);
                }
            }
        }
        self.apply_visibility();
    }

    pub fn hide(&mut self, ids: &[u32]) {
        for &id in ids {
            for d in self.tree.subtree(id) {
                self.hidden.insert(d);
            }
        }
        self.apply_visibility();
    }

    pub fn isolate(&mut self, ids: &[u32]) {
        let mut set = FxHashSet::default();
        for &id in ids {
            for d in self.tree.subtree(id) {
                set.insert(d);
            }
        }
        self.isolated = Some(set);
        self.apply_visibility();
    }

    pub fn show_all(&mut self) {
        self.hidden.clear();
        self.isolated = None;
        self.apply_visibility();
    }

    pub fn fit_selection(&mut self) {
        let mut ids: Vec<u32> = Vec::new();
        for &s in &self.selection {
            ids.extend(self.tree.subtree(s));
        }
        let bb = if ids.is_empty() { self.scene.robust_visible_bbox() } else { self.scene.bbox_of(ids) };
        if let Some((lo, hi)) = bb {
            self.camera.fit(lo, hi);
            self.view_dirty = true;
        }
    }

    pub fn fit_all(&mut self) {
        if let Some((lo, hi)) = self.scene.robust_visible_bbox() {
            self.camera.fit(lo, hi);
            self.view_dirty = true;
        }
    }

    // ---------------------------------------------------------------- coloring

    pub fn recolor(&mut self) {
        let doc = self.doc.clone();
        self.legend.clear();
        let n = self.scene.objects.len();
        let mut counts: FxHashMap<String, (usize, [u8; 4])> = FxHashMap::default();
        let key_of = |id: u32| -> Option<String> {
            match &self.color_mode {
                ColorMode::Ifc => None,
                ColorMode::ByClass => doc.type_camel(id).map(|s| s.to_string()),
                ColorMode::ByStorey => Some(self.tree.storey_of(&doc, id).map(|s| ifc_doc::model::label(&doc, s)).unwrap_or_else(|| "(ohne Geschoss)".into())),
                ColorMode::ByMaterial => Some(ifc_doc::model::materials_of(&doc, id).first().and_then(|m| m.layers.first().map(|l| l.material_name.clone())).unwrap_or_else(|| "(ohne Material)".into())),
                ColorMode::ByProperty { pset, prop } => {
                    let v = ifc_doc::model::psets_of(&doc, id).into_iter().filter(|p| p.name == *pset).flat_map(|p| p.props).find(|p| p.name == *prop).map(|p| p.value.display());
                    Some(v.unwrap_or_else(|| "(kein Wert)".into()))
                }
            }
        };
        for i in 0..n {
            let id = self.scene.objects[i].id;
            match key_of(id) {
                None => {
                    self.scene.set_override(i as u32, None);
                }
                Some(k) => {
                    let c = counts.entry(k.clone()).or_insert_with(|| (0, palette_color(&k)));
                    c.0 += 1;
                    let col = c.1;
                    self.scene.set_override(i as u32, Some(col));
                }
            }
        }
        let mut legend: Vec<(String, [u8; 4], usize)> = counts.into_iter().map(|(k, (c, col))| (k, col, c)).collect();
        legend.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
        self.legend = legend;
        self.view_dirty = true;
    }

    pub fn clip_planes(&self) -> Vec<Vec4> {
        let mut v: Vec<Vec4> = self.sections.iter().filter(|s| s.enabled).map(|s| {
            let n = s.normal.normalize_or(Vec3::Z);
            Vec4::new(n.x, n.y, n.z, -n.dot(s.point))
        })
        .collect();
        if let Some((st, cut)) = self.plan {
            if let Some(z) = self.storey_elevation(st) {
                v.push(Vec4::new(0.0, 0.0, 1.0, -(z + cut)));
            }
        }
        v
    }

    /// Storey elevation in scene coordinates (placement based, falls back to element bbox).
    pub fn storey_elevation(&self, storey: u32) -> Option<f32> {
        let doc = &self.doc;
        let unit = ifc_doc::model::length_unit(doc).0;
        let e = Engine::with_parts(doc, self.geom_opts.clone(), self.scene.origin, Default::default());
        if let Some(pl) = doc.arg(storey, 5).and_then(|v| v.as_ref_id()) {
            let m = e.placement(&mut ifc_geom::Cache::default(), pl, 0);
            return Some((m.w_axis.z * unit - self.scene.origin.z) as f32);
        }
        self.scene.bbox_of(self.tree.subtree(storey)).map(|(lo, _)| lo.z)
    }

    /// Show a storey as floor plan: isolate, cut above the storey, top orthographic view.
    pub fn enter_plan(&mut self, storey: u32, cut: f32) {
        if self.plan.is_none() {
            self.plan_saved_camera = Some(self.camera.clone());
        }
        self.plan = Some((storey, cut));
        self.isolate(&[storey]);
        self.camera.set_preset(crate::viewer::camera::ViewPreset::Top);
        self.camera.ortho = true;
        if let Some((lo, hi)) = self.scene.bbox_of(self.tree.subtree(storey)) {
            self.camera.fit(lo, hi);
        }
        self.view_dirty = true;
    }

    pub fn exit_plan(&mut self) {
        self.plan = None;
        if let Some(c) = self.plan_saved_camera.take() {
            self.camera = c;
        }
        self.isolated = None;
        self.apply_visibility();
    }

    // ---------------------------------------------------------------- edits

    /// Run an edit as one named undo step; re-meshes affected products afterwards.
    pub fn edit<R>(&mut self, label: &str, f: impl FnOnce(&mut Document) -> anyhow::Result<R>) -> Option<R> {
        let Some(doc) = Arc::get_mut(&mut self.doc) else {
            self.status = "Bearbeitung gesperrt – Geometrie wird noch geladen".into();
            return None;
        };
        doc.begin(label);
        match f(doc) {
            Ok(r) => {
                doc.commit();
                self.status = format!("{label} ✓");
                self.after_edit();
                Some(r)
            }
            Err(e) => {
                doc.rollback();
                self.last_error = Some(e.to_string());
                self.status = format!("Fehler bei „{label}“: {e}");
                self.after_edit();
                None
            }
        }
    }

    /// Replace the section planes by a box around the selection (margin in m).
    pub fn section_box_selection(&mut self, margin: f32) -> bool {
        let ids: Vec<u32> = self.selection.iter().flat_map(|&id| self.tree.subtree(id)).collect();
        let Some((lo, hi)) = self.scene.bbox_of(ids) else { return false };
        let (lo, hi) = (lo - Vec3::splat(margin), hi + Vec3::splat(margin));
        self.sections = vec![
            SectionPlane { normal: Vec3::X, point: hi, enabled: true },
            SectionPlane { normal: -Vec3::X, point: lo, enabled: true },
            SectionPlane { normal: Vec3::Y, point: hi, enabled: true },
            SectionPlane { normal: -Vec3::Y, point: lo, enabled: true },
            SectionPlane { normal: Vec3::Z, point: hi, enabled: true },
            SectionPlane { normal: -Vec3::Z, point: lo, enabled: true },
        ];
        self.fit_selection();
        self.view_dirty = true;
        true
    }

    /// Capture the current view (camera, sections, visibility, selection).
    pub fn capture_view(&self, name: &str) -> crate::settings::SavedView {
        let o = self.scene.origin;
        let t = self.camera.target.as_dvec3() + o;
        let guids = |ids: &mut dyn Iterator<Item = u32>| -> Vec<String> { ids.filter_map(|id| self.doc.guid_of(id)).take(50_000).collect() };
        let (visibility, isolated) = match &self.isolated {
            Some(set) => (guids(&mut set.iter().copied().filter(|&id| self.doc.has_flag(id, tflags::PRODUCT))), true),
            None => (guids(&mut self.hidden.iter().copied().filter(|&id| self.doc.has_flag(id, tflags::PRODUCT))), false),
        };
        crate::settings::SavedView {
            name: name.to_string(),
            created: chrono::Utc::now().timestamp(),
            target_world: [t.x, t.y, t.z],
            yaw: self.camera.yaw,
            pitch: self.camera.pitch,
            dist: self.camera.dist,
            ortho: self.camera.ortho,
            sections: self.sections.iter().map(|sp| (sp.normal.to_array(), { let p = sp.point.as_dvec3() + o; [p.x, p.y, p.z] }, sp.enabled)).collect(),
            visibility,
            isolated,
            selection: guids(&mut self.selection.iter().copied()),
            xray: self.xray,
        }
    }

    /// Restore a saved view.
    pub fn restore_view(&mut self, v: &crate::settings::SavedView) {
        let o = self.scene.origin;
        self.camera.target = (glam::DVec3::from_array(v.target_world) - o).as_vec3();
        self.camera.yaw = v.yaw;
        self.camera.pitch = v.pitch;
        self.camera.dist = v.dist;
        self.camera.ortho = v.ortho;
        self.sections = v.sections.iter().map(|(n, p, e)| SectionPlane { normal: Vec3::from_array(*n), point: (glam::DVec3::from_array(*p) - o).as_vec3(), enabled: *e }).collect();
        let index = ifc_doc::model::guid_index(&self.doc);
        let ids: FxHashSet<u32> = v.visibility.iter().filter_map(|g| index.get(g).copied()).collect();
        if v.isolated {
            let mut set = FxHashSet::default();
            for id in ids {
                set.extend(self.tree.subtree(id));
            }
            self.isolated = Some(set);
            self.hidden.clear();
        } else {
            self.isolated = None;
            self.hidden = ids;
        }
        self.xray = v.xray;
        let sel: Vec<u32> = v.selection.iter().filter_map(|g| index.get(g).copied()).collect();
        self.select(sel, false);
        self.apply_visibility();
        self.view_dirty = true;
    }

    /// Products to colour for the current selection: spatial elements expand to
    /// their contents, elements stand for themselves.
    pub fn paint_targets(&self) -> Vec<u32> {
        let mut out = Vec::new();
        for &id in &self.selection {
            if self.doc.has_flag(id, tflags::SPATIAL) || self.doc.has_flag(id, tflags::PROJECT) {
                out.extend(self.tree.subtree(id).into_iter().filter(|&x| self.doc.has_flag(x, tflags::PRODUCT)));
            } else if self.doc.has_flag(id, tflags::PRODUCT) {
                out.push(id);
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// Call after any document modification: rebuild tree and re-mesh affected products.
    pub fn after_edit(&mut self) {
        let Some(doc) = Arc::get_mut(&mut self.doc) else { return };
        let changed = doc.take_changed_ids();
        let doc = &self.doc;
        self.tree = SpatialTree::build(doc);
        self.selection.retain(|&id| doc.exists(id));
        if changed.is_empty() {
            return;
        }
        let style_change = changed.iter().any(|&id| {
            let t = doc.type_name(id).unwrap_or("");
            t.contains("STYLE") || t.contains("COLOUR") || t == "IFCMATERIALDEFINITIONREPRESENTATION"
        });
        if style_change || self.styles.is_none() {
            self.styles = Some(ifc_geom::style::StyleMap::build(doc));
        }
        let (products, too_many) = affected_products(doc, &changed);
        let mut remove = Vec::new();
        for &id in &changed {
            if !doc.exists(id) && self.scene.index_of.contains_key(&id) {
                remove.push(id);
            }
        }
        for id in remove {
            self.scene.remove(id);
        }
        let engine = Engine::with_parts(doc, self.geom_opts.clone(), self.scene.origin, self.styles.clone().unwrap_or_default());
        let targets: Vec<u32> = if too_many { engine.product_ids() } else { products.into_iter().filter(|&p| doc.exists(p)).collect() };
        let meshed = engine.mesh_ids(&targets);
        let got: FxHashSet<u32> = meshed.iter().map(|g| g.id).collect();
        for id in &targets {
            if !got.contains(id) {
                self.scene.remove(*id);
            }
        }
        for g in meshed {
            self.scene.upsert(g);
        }
        self.scene.recompute_bbox();
        self.apply_visibility();
        if self.color_mode != ColorMode::Ifc {
            self.recolor();
        }
        self.view_dirty = true;
    }

    /// Re-mesh everything (e.g. after changing geometry settings).
    pub fn remesh_all(&mut self) {
        let doc = &self.doc;
        let engine = Engine::with_parts(doc, self.geom_opts.clone(), self.scene.origin, ifc_geom::style::StyleMap::build(doc));
        let ids = engine.product_ids();
        let meshed = engine.mesh_ids(&ids);
        let keep = self.scene.origin;
        self.scene = Scene::new(keep);
        for g in meshed {
            self.scene.upsert(g);
        }
        self.apply_visibility();
        self.recolor();
    }
}

fn affected_products(doc: &Document, changed: &[u32]) -> (FxHashSet<u32>, bool) {
    let mut out = FxHashSet::default();
    let mut visited = FxHashSet::default();
    let mut stack: Vec<u32> = changed.to_vec();
    while let Some(id) = stack.pop() {
        if !visited.insert(id) {
            continue;
        }
        if visited.len() > 400_000 {
            return (out, true);
        }
        if !doc.exists(id) {
            continue;
        }
        let f = doc.type_flags(id);
        if f & tflags::PRODUCT != 0 {
            out.insert(id);
            if f & tflags::OPENING != 0 {
                for rel in doc.referencing_with_type(id, "IFCRELVOIDSELEMENT") {
                    if let Some(h) = doc.arg(rel, 4).and_then(|v| v.as_ref_id()) {
                        out.insert(h);
                    }
                }
            }
            continue;
        }
        match doc.type_name(id).unwrap_or("") {
            "IFCRELVOIDSELEMENT" => {
                if let Some(h) = doc.arg(id, 4).and_then(|v| v.as_ref_id()) {
                    out.insert(h);
                }
                continue;
            }
            "IFCSTYLEDITEM" => {
                if let Some(i) = doc.arg(id, 0).and_then(|v| v.as_ref_id()) {
                    stack.push(i);
                }
            }
            "IFCMATERIALDEFINITIONREPRESENTATION" => {
                // material colour changed → everything using the material
                if let Some(m) = doc.arg(id, 3).and_then(|v| v.as_ref_id()) {
                    stack.push(m);
                }
                continue;
            }
            "IFCRELASSOCIATESMATERIAL" | "IFCRELDEFINESBYTYPE" => {
                for o in doc.arg(id, 4).map(|v| v.ref_list()).unwrap_or_default() {
                    stack.push(o);
                }
                continue;
            }
            t if t.starts_with("IFCREL") => continue,
            _ => {}
        }
        stack.extend(doc.referencing(id));
    }
    (out, false)
}

fn load_thread(path: PathBuf, opts: GeomOptions, tx: Sender<LoadMsg>, ctx: egui::Context) {
    let t0 = std::time::Instant::now();
    let txp = tx.clone();
    let ctxp = ctx.clone();
    let progress = move |p: f32, m: &str| {
        let _ = txp.send(LoadMsg::Progress(p * 0.3, m.to_string()));
        ctxp.request_repaint();
    };
    let doc = match Document::open(&path, &progress) {
        Ok(d) => Arc::new(d),
        Err(e) => {
            let _ = tx.send(LoadMsg::Error(e.to_string()));
            ctx.request_repaint();
            return;
        }
    };
    {
        let engine = Engine::new(&doc, opts);
        let ids = engine.product_ids();
        let _ = tx.send(LoadMsg::Doc(doc.clone(), engine.origin, ids.len()));
        ctx.request_repaint();
        let txg = tx.clone();
        let ctxg = ctx.clone();
        engine.mesh_all(&ids, move |batch| {
            let _ = txg.send(LoadMsg::Geoms(batch));
            ctxg.request_repaint();
        });
    }
    drop(doc);
    let _ = tx.send(LoadMsg::Done(t0.elapsed().as_secs_f64() * 1000.0));
    ctx.request_repaint();
}

pub fn fmt_count(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    out
}

/// Stable distinct color for a legend key.
pub fn palette_color(key: &str) -> [u8; 4] {
    let mut h: u64 = 1469598103934665603;
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    let hue = (h % 360) as f32;
    let sat = 0.55 + ((h >> 12) % 30) as f32 / 100.0;
    let val = 0.75 + ((h >> 20) % 20) as f32 / 100.0;
    let c = egui::ecolor::Hsva::new(hue / 360.0, sat, val, 1.0);
    let rgb = c.to_srgb();
    [rgb[0], rgb[1], rgb[2], 255]
}
