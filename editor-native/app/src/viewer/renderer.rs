//! wgpu renderer: draws the scene into an offscreen texture shown by egui,
//! and renders an id/position buffer on demand for picking.

use super::camera::Camera;
use super::scene::Scene;
use bytemuck::{Pod, Zeroable};
use eframe::egui_wgpu::{self, wgpu};
use glam::{Vec3, Vec4};
use std::sync::Arc;

const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    pos: [f32; 3],
    color: [u8; 4],
    obj: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    cam_pos: [f32; 4],
    light_dir: [f32; 4],
    clip_planes: [[f32; 4]; 6],
    params: [u32; 4],
    ghost_color: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LayerUniform {
    offset: [f32; 4],
    /// x: layer id (encoded into pick ids), y: 1 = dimmed
    id: [u32; 4],
}

/// GPU data of one scene (the active document or a federated one).
struct GpuLayer {
    key: u64,
    used: bool,
    chunks: Vec<Option<GpuChunk>>,
    state_buf: wgpu::Buffer,
    state_cap: usize,
    layer_buf: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    uniform: [u32; 8],
}

struct GpuChunk {
    ibuf_edges: Option<wgpu::Buffer>,
    n_edges: u32,
    vbuf: wgpu::Buffer,
    ibuf_opaque: Option<wgpu::Buffer>,
    ibuf_trans: Option<wgpu::Buffer>,
    n_opaque: u32,
    n_trans: u32,
}

struct Targets {
    size: (u32, u32),
    msaa: u32,
    color_msaa: Option<wgpu::TextureView>,
    color: wgpu::Texture,
    color_view: wgpu::TextureView,
    depth: wgpu::TextureView,
    id_tex: wgpu::Texture,
    id_view: wgpu::TextureView,
    pos_tex: wgpu::Texture,
    pos_view: wgpu::TextureView,
    nrm_tex: wgpu::Texture,
    nrm_view: wgpu::TextureView,
    id_depth: wgpu::TextureView,
}

pub struct PickResult {
    /// Layer the object belongs to (0 = active document).
    pub layer: u32,
    pub obj: Option<u32>,
    pub pos: Option<Vec3>,
    pub normal: Option<Vec3>,
}

#[derive(Clone, Debug)]
pub struct RenderSettings {
    pub background: [f32; 3],
    pub selection_color: [u8; 4],
    pub xray: bool,
    pub clip_planes: Vec<Vec4>,
    pub hover_obj: Option<u32>,
    pub edges: bool,
    pub grid: bool,
    /// Grid fade distance (m).
    pub grid_fade: f32,
}

pub struct Renderer {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    egui_renderer: Arc<egui::mutex::RwLock<egui_wgpu::Renderer>>,
    pipe_opaque: wgpu::RenderPipeline,
    pipe_trans: wgpu::RenderPipeline,
    pipe_ghost: wgpu::RenderPipeline,
    pipe_id: wgpu::RenderPipeline,
    pipe_edge: wgpu::RenderPipeline,
    pipe_grid: wgpu::RenderPipeline,
    grid: Option<(wgpu::Buffer, u32)>,
    pub grid_key: Option<[i32; 5]>,
    bgl: wgpu::BindGroupLayout,
    globals: wgpu::Buffer,
    /// Bind group for layer-independent drawing (grid).
    bind_group: wgpu::BindGroup,
    layers: Vec<GpuLayer>,
    targets: Option<Targets>,
    pub texture_id: Option<egui::TextureId>,
    msaa: u32,
}

impl Renderer {
    pub fn new(rs: &egui_wgpu::RenderState) -> Renderer {
        let device = Arc::new(rs.device.clone());
        let queue = Arc::new(rs.queue.clone());
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("scene"), source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()) });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("scene-layout"), bind_group_layouts: &[Some(&bgl)], immediate_size: 0 });
        let msaa = {
            let f = rs.adapter.get_texture_format_features(COLOR_FORMAT);
            if f.flags.sample_count_supported(4) {
                4
            } else {
                1
            }
        };
        let vattrs = wgpu::vertex_attr_array![0 => Float32x3, 1 => Unorm8x4, 2 => Uint32];
        let vlayout = wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &vattrs };
        let make = |pass: f64, blend: Option<wgpu::BlendState>, depth_write: bool, label: &str| {
            let constants = [("PASS", pass)];
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&layout),
                vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), compilation_options: wgpu::PipelineCompilationOptions { constants: &constants, ..Default::default() }, buffers: &[Some(vlayout.clone())] },
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleList, cull_mode: None, ..Default::default() },
                depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH_FORMAT, depth_write_enabled: Some(depth_write), depth_compare: Some(wgpu::CompareFunction::GreaterEqual), stencil: Default::default(), bias: Default::default() }),
                multisample: wgpu::MultisampleState { count: msaa, mask: !0, alpha_to_coverage_enabled: false },
                fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs"), compilation_options: wgpu::PipelineCompilationOptions { constants: &constants, ..Default::default() }, targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend, write_mask: wgpu::ColorWrites::ALL })] }),
                multiview_mask: None,
                cache: None,
            })
        };
        let pipe_opaque = make(0.0, None, true, "opaque");
        let pipe_trans = make(1.0, Some(wgpu::BlendState::ALPHA_BLENDING), false, "transparent");
        let pipe_ghost = make(2.0, Some(wgpu::BlendState::ALPHA_BLENDING), false, "ghost");
        let pipe_edge = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("edges"),
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_edge"), compilation_options: Default::default(), buffers: &[Some(vlayout.clone())] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::LineList, cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH_FORMAT, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::GreaterEqual), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState { count: msaa, mask: !0, alpha_to_coverage_enabled: false },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs_edge"), compilation_options: Default::default(), targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })] }),
            multiview_mask: None,
            cache: None,
        });
        let pipe_grid = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("grid"),
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_grid"), compilation_options: Default::default(), buffers: &[Some(vlayout.clone())] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::LineList, cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH_FORMAT, depth_write_enabled: Some(false), depth_compare: Some(wgpu::CompareFunction::GreaterEqual), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState { count: msaa, mask: !0, alpha_to_coverage_enabled: false },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs_grid"), compilation_options: Default::default(), targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })] }),
            multiview_mask: None,
            cache: None,
        });
        let pipe_id = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("id"),
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[Some(vlayout.clone())] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleList, cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH_FORMAT, depth_write_enabled: Some(true), depth_compare: Some(wgpu::CompareFunction::GreaterEqual), stencil: Default::default(), bias: Default::default() }),
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_id"),
                compilation_options: Default::default(),
                targets: &[
                    Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::R32Uint, blend: None, write_mask: wgpu::ColorWrites::ALL }),
                    Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::Rgba32Float, blend: None, write_mask: wgpu::ColorWrites::ALL }),
                    Some(wgpu::ColorTargetState { format: wgpu::TextureFormat::Rgba16Float, blend: None, write_mask: wgpu::ColorWrites::ALL }),
                ],
            }),
            multiview_mask: None,
            cache: None,
        });
        let globals = device.create_buffer(&wgpu::BufferDescriptor { label: Some("globals"), size: std::mem::size_of::<Globals>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let base_state = device.create_buffer(&wgpu::BufferDescriptor { label: Some("obj-state-base"), size: 64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let base_layer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("layer-base"), size: std::mem::size_of::<LayerUniform>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let bind_group = Self::make_bg(&device, &bgl, &globals, &base_state, &base_layer);
        Renderer {
            device,
            queue,
            egui_renderer: rs.renderer.clone(),
            pipe_opaque,
            pipe_trans,
            pipe_ghost,
            pipe_id,
            pipe_edge,
            pipe_grid,
            grid: None,
            grid_key: None,
            bgl,
            globals,
            bind_group,
            layers: Vec::new(),
            targets: None,
            texture_id: None,
            msaa,
        }
    }

    fn make_bg(device: &wgpu::Device, bgl: &wgpu::BindGroupLayout, globals: &wgpu::Buffer, state: &wgpu::Buffer, layer: &wgpu::Buffer) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene-bg"),
            layout: bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: globals.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: state.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: layer.as_entire_binding() },
            ],
        })
    }

    /// Drop all GPU geometry (new document).
    pub fn clear(&mut self) {
        self.layers.clear();
        self.grid = None;
        self.grid_key = None;
    }

    /// Ground grid at height `z` covering [lo, hi] (scene coords), 1 m minor / 10 m major lines.
    pub fn set_grid(&mut self, lo: glam::Vec2, hi: glam::Vec2, z: f32, dark: bool) {
        let key = [lo.x.floor() as i32, lo.y.floor() as i32, hi.x.ceil() as i32, hi.y.ceil() as i32, (z * 100.0) as i32];
        if self.grid_key == Some(key) {
            return;
        }
        self.grid_key = Some(key);
        let ext = (hi - lo).max_element().max(10.0);
        let step = if ext > 2000.0 { 100.0 } else if ext > 200.0 { 10.0 } else { 1.0 };
        let pad = ext * 0.25;
        let (x0, x1) = (((lo.x - pad) / step).floor() * step, ((hi.x + pad) / step).ceil() * step);
        let (y0, y1) = (((lo.y - pad) / step).floor() * step, ((hi.y + pad) / step).ceil() * step);
        let mut v: Vec<Vertex> = Vec::new();
        let base = if dark { [150u8, 160, 175] } else { [90u8, 95, 105] };
        let mut add = |a: [f32; 3], b: [f32; 3], major: bool| {
            let col = [base[0], base[1], base[2], if major { 110 } else { 45 }];
            v.push(Vertex { pos: a, color: col, obj: 0 });
            v.push(Vertex { pos: b, color: col, obj: 0 });
        };
        let mut x = x0;
        let mut guard = 0;
        while x <= x1 + 1e-3 && guard < 4000 {
            add([x, y0, z], [x, y1, z], ((x / step).round() as i64) % 10 == 0);
            x += step;
            guard += 1;
        }
        let mut y = y0;
        while y <= y1 + 1e-3 && guard < 8000 {
            add([x0, y, z], [x1, y, z], ((y / step).round() as i64) % 10 == 0);
            y += step;
            guard += 1;
        }
        use wgpu::util::DeviceExt;
        let buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("grid"), contents: bytemuck::cast_slice(&v), usage: wgpu::BufferUsages::VERTEX });
        self.grid = Some((buf, v.len() as u32));
    }

    /// Start a frame: layers not synced until `end_layers` are dropped.
    pub fn begin_layers(&mut self) {
        for l in &mut self.layers {
            l.used = false;
        }
    }

    /// Drop layers that were not synced this frame; true if any was removed.
    pub fn end_layers(&mut self) -> bool {
        let n = self.layers.len();
        self.layers.retain(|l| l.used);
        n != self.layers.len()
    }

    /// Upload dirty chunks and object state of a scene into the layer `key`
    /// (drawn with `offset`, pick ids tagged with `id`). Returns true if anything changed.
    pub fn sync_layer(&mut self, key: u64, id: u8, scene: &mut Scene, offset: Vec3, dimmed: bool) -> bool {
        let mut changed = false;
        let li = match self.layers.iter().position(|l| l.key == key) {
            Some(i) => i,
            None => {
                let state_cap = (scene.state.len() * 2).max(1024);
                let state_buf = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("obj-state"), size: (state_cap * 8) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
                let layer_buf = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("layer"), size: std::mem::size_of::<LayerUniform>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
                let bind_group = Self::make_bg(&self.device, &self.bgl, &self.globals, &state_buf, &layer_buf);
                self.layers.push(GpuLayer { key, used: true, chunks: Vec::new(), state_buf, state_cap, layer_buf, bind_group, uniform: [u32::MAX; 8] });
                // fresh layer: upload everything
                for c in 0..scene.chunks.len() {
                    scene.dirty_chunks.insert(c as u32);
                }
                scene.state_dirty = true;
                changed = true;
                self.layers.len() - 1
            }
        };
        let device = self.device.clone();
        let queue = self.queue.clone();
        let layer = &mut self.layers[li];
        layer.used = true;
        let u = LayerUniform { offset: [offset.x, offset.y, offset.z, 0.0], id: [id as u32, dimmed as u32, 0, 0] };
        let key8: [u32; 8] = [offset.x.to_bits(), offset.y.to_bits(), offset.z.to_bits(), 0, id as u32, dimmed as u32, 0, 0];
        if layer.uniform != key8 {
            queue.write_buffer(&layer.layer_buf, 0, bytemuck::bytes_of(&u));
            layer.uniform = key8;
            changed = true;
        }
        if scene.state.len() > layer.state_cap {
            layer.state_cap = (scene.state.len() * 2).max(1024);
            layer.state_buf = device.create_buffer(&wgpu::BufferDescriptor { label: Some("obj-state"), size: (layer.state_cap * 8) as u64, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
            layer.bind_group = Self::make_bg(&device, &self.bgl, &self.globals, &layer.state_buf, &layer.layer_buf);
            scene.state_dirty = true;
        }
        if scene.state_dirty && !scene.state.is_empty() {
            queue.write_buffer(&layer.state_buf, 0, bytemuck::cast_slice(&scene.state));
            scene.state_dirty = false;
            changed = true;
        }
        if scene.dirty_chunks.is_empty() {
            return changed;
        }
        let dirty: Vec<u32> = scene.dirty_chunks.drain().collect();
        if layer.chunks.len() < scene.chunks.len() {
            layer.chunks.resize_with(scene.chunks.len(), || None);
        }
        for ci in dirty {
            let Some(c) = scene.chunks.get(ci as usize) else { continue };
            let mut verts: Vec<Vertex> = Vec::with_capacity(c.verts);
            let mut iop: Vec<u32> = Vec::new();
            let mut itr: Vec<u32> = Vec::new();
            let mut ied: Vec<u32> = Vec::new();
            for &oi in &c.objs {
                let Some(g) = &scene.objects[oi as usize].geom else { continue };
                let base = verts.len() as u32;
                for (p, col) in g.positions.iter().zip(g.colors.iter()) {
                    verts.push(Vertex { pos: *p, color: *col, obj: oi });
                }
                ied.extend(g.edges.iter().map(|e| base + e));
                for t in g.indices.chunks_exact(3) {
                    let transparent = g.colors[t[0] as usize][3] < 250;
                    let dst = if transparent { &mut itr } else { &mut iop };
                    dst.extend_from_slice(&[base + t[0], base + t[1], base + t[2]]);
                }
            }
            changed = true;
            if verts.is_empty() {
                layer.chunks[ci as usize] = None;
                continue;
            }
            use wgpu::util::DeviceExt;
            let vbuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("chunk-v"), contents: bytemuck::cast_slice(&verts), usage: wgpu::BufferUsages::VERTEX });
            let mk = |d: &[u32]| if d.is_empty() { None } else { Some(device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("chunk-i"), contents: bytemuck::cast_slice(d), usage: wgpu::BufferUsages::INDEX })) };
            layer.chunks[ci as usize] = Some(GpuChunk { vbuf, ibuf_opaque: mk(&iop), ibuf_trans: mk(&itr), ibuf_edges: mk(&ied), n_opaque: iop.len() as u32, n_trans: itr.len() as u32, n_edges: ied.len() as u32 });
        }
        changed
    }

    fn ensure_targets(&mut self, w: u32, h: u32) {
        let w = w.max(1);
        let h = h.max(1);
        if let Some(t) = &self.targets {
            if t.size == (w, h) && t.msaa == self.msaa {
                return;
            }
        }
        let tex = |label: &str, format: wgpu::TextureFormat, samples: u32, usage: wgpu::TextureUsages| {
            self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: samples,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let color = tex("color", COLOR_FORMAT, 1, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC);
        let color_view = color.create_view(&Default::default());
        let color_msaa = if self.msaa > 1 { Some(tex("color-msaa", COLOR_FORMAT, self.msaa, wgpu::TextureUsages::RENDER_ATTACHMENT).create_view(&Default::default())) } else { None };
        let depth = tex("depth", DEPTH_FORMAT, self.msaa, wgpu::TextureUsages::RENDER_ATTACHMENT).create_view(&Default::default());
        let id_tex = tex("id", wgpu::TextureFormat::R32Uint, 1, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
        let id_view = id_tex.create_view(&Default::default());
        let pos_tex = tex("pos", wgpu::TextureFormat::Rgba32Float, 1, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
        let pos_view = pos_tex.create_view(&Default::default());
        let nrm_tex = tex("nrm", wgpu::TextureFormat::Rgba16Float, 1, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
        let nrm_view = nrm_tex.create_view(&Default::default());
        let id_depth = tex("id-depth", DEPTH_FORMAT, 1, wgpu::TextureUsages::RENDER_ATTACHMENT).create_view(&Default::default());
        {
            let mut r = self.egui_renderer.write();
            match self.texture_id {
                Some(id) => r.update_egui_texture_from_wgpu_texture(&self.device, &color_view, wgpu::FilterMode::Linear, id),
                None => self.texture_id = Some(r.register_native_texture(&self.device, &color_view, wgpu::FilterMode::Linear)),
            }
        }
        self.targets = Some(Targets { size: (w, h), msaa: self.msaa, color_msaa, color, color_view, depth, id_tex, id_view, pos_tex, pos_view, nrm_tex, nrm_view, id_depth });
    }

    fn write_globals(&self, cam: &Camera, aspect: f32, s: &RenderSettings) {
        let vp = cam.view_proj(aspect);
        let eye = cam.eye();
        let mut planes = [[0f32; 4]; 6];
        for (i, p) in s.clip_planes.iter().take(6).enumerate() {
            planes[i] = p.to_array();
        }
        let g = Globals {
            view_proj: vp.to_cols_array_2d(),
            cam_pos: [eye.x, eye.y, eye.z, s.grid_fade],
            light_dir: Vec3::new(0.35, 0.55, 0.85).normalize().extend(0.0).to_array(),
            clip_planes: planes,
            params: [s.clip_planes.len().min(6) as u32, u32::from_le_bytes(s.selection_color), s.xray as u32, s.hover_obj.map(|o| o + 1).unwrap_or(0)],
            ghost_color: [0.55, 0.60, 0.68, 0.07],
        };
        self.queue.write_buffer(&self.globals, 0, bytemuck::bytes_of(&g));
    }

    /// Render the scene into the offscreen color texture.
    pub fn render(&mut self, w: u32, h: u32, cam: &Camera, s: &RenderSettings) {
        self.ensure_targets(w, h);
        let t = self.targets.as_ref().unwrap();
        self.write_globals(cam, w as f32 / h.max(1) as f32, s);
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("scene") });
        {
            let bg = s.background;
            let (view, resolve) = match &t.color_msaa {
                Some(m) => (m, Some(&t.color_view)),
                None => (&t.color_view, None),
            };
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: resolve,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: bg[0] as f64, g: bg[1] as f64, b: bg[2] as f64, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &t.depth, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(0.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipe_opaque);
            for l in &self.layers {
                pass.set_bind_group(0, &l.bind_group, &[]);
                for c in l.chunks.iter().flatten() {
                    if let Some(ib) = &c.ibuf_opaque {
                        pass.set_vertex_buffer(0, c.vbuf.slice(..));
                        pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(0..c.n_opaque, 0, 0..1);
                    }
                }
            }
            if let (true, Some((buf, n))) = (s.grid, &self.grid) {
                pass.set_bind_group(0, &self.bind_group, &[]);
                pass.set_pipeline(&self.pipe_grid);
                pass.set_vertex_buffer(0, buf.slice(..));
                pass.draw(0..*n, 0..1);
            }
            if s.edges {
                pass.set_pipeline(&self.pipe_edge);
                for l in &self.layers {
                    pass.set_bind_group(0, &l.bind_group, &[]);
                    for c in l.chunks.iter().flatten() {
                        if let Some(ib) = &c.ibuf_edges {
                            pass.set_vertex_buffer(0, c.vbuf.slice(..));
                            pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                            pass.draw_indexed(0..c.n_edges, 0, 0..1);
                        }
                    }
                }
            }
            pass.set_pipeline(&self.pipe_trans);
            for l in &self.layers {
                pass.set_bind_group(0, &l.bind_group, &[]);
                for c in l.chunks.iter().flatten() {
                    if let Some(ib) = &c.ibuf_trans {
                        pass.set_vertex_buffer(0, c.vbuf.slice(..));
                        pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(0..c.n_trans, 0, 0..1);
                    }
                }
            }
            if s.xray {
                pass.set_pipeline(&self.pipe_ghost);
                for l in &self.layers {
                    pass.set_bind_group(0, &l.bind_group, &[]);
                    for c in l.chunks.iter().flatten() {
                        pass.set_vertex_buffer(0, c.vbuf.slice(..));
                        if let Some(ib) = &c.ibuf_opaque {
                            pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                            pass.draw_indexed(0..c.n_opaque, 0, 0..1);
                        }
                        if let Some(ib) = &c.ibuf_trans {
                            pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                            pass.draw_indexed(0..c.n_trans, 0, 0..1);
                        }
                    }
                }
            }
        }
        self.queue.submit(Some(enc.finish()));
    }

    fn render_ids(&mut self, enc: &mut wgpu::CommandEncoder) {
        let t = self.targets.as_ref().unwrap();
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("id-pass"),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment { view: &t.id_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store } }),
                Some(wgpu::RenderPassColorAttachment { view: &t.pos_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store } }),
                Some(wgpu::RenderPassColorAttachment { view: &t.nrm_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store } }),
            ],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &t.id_depth, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(0.0), store: wgpu::StoreOp::Store }), stencil_ops: None }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipe_id);
        for l in &self.layers {
            pass.set_bind_group(0, &l.bind_group, &[]);
            for c in l.chunks.iter().flatten() {
                pass.set_vertex_buffer(0, c.vbuf.slice(..));
                if let Some(ib) = &c.ibuf_opaque {
                    pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..c.n_opaque, 0, 0..1);
                }
                if let Some(ib) = &c.ibuf_trans {
                    pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..c.n_trans, 0, 0..1);
                }
            }
        }
    }

    fn read_region(&self, tex: &wgpu::Texture, x: u32, y: u32, w: u32, h: u32, bpp: u32) -> Vec<u8> {
        let row = w * bpp;
        let padded = row.div_ceil(256) * 256;
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("readback"), size: (padded * h) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("readback") });
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: tex, mip_level: 0, origin: wgpu::Origin3d { x, y, z: 0 }, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit(Some(enc.finish()));
        let slice = buf.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
        let data = match slice.get_mapped_range() {
            Ok(v) => v.to_vec(),
            Err(_) => vec![0u8; (padded * h) as usize],
        };
        buf.unmap();
        let mut out = Vec::with_capacity((row * h) as usize);
        for r in 0..h {
            let s = (r * padded) as usize;
            out.extend_from_slice(&data[s..s + row as usize]);
        }
        out
    }

    /// Pick the object and world position under a pixel.
    pub fn pick(&mut self, w: u32, h: u32, cam: &Camera, s: &RenderSettings, px: u32, py: u32) -> PickResult {
        self.ensure_targets(w, h);
        self.write_globals(cam, w as f32 / h.max(1) as f32, s);
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pick") });
        self.render_ids(&mut enc);
        self.queue.submit(Some(enc.finish()));
        let t = self.targets.as_ref().unwrap();
        let (px, py) = (px.min(w - 1), py.min(h - 1));
        let id = self.read_region(&t.id_tex, px, py, 1, 1, 4);
        let pos = self.read_region(&t.pos_tex, px, py, 1, 1, 16);
        let nrm = self.read_region(&t.nrm_tex, px, py, 1, 1, 8);
        let idv = u32::from_le_bytes([id[0], id[1], id[2], id[3]]);
        let f = |b: &[u8], i: usize| f32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]);
        if idv == 0 {
            return PickResult { layer: 0, obj: None, pos: None, normal: None };
        }
        let (layer, obj) = decode_id(idv);
        PickResult { layer, obj: Some(obj), pos: Some(Vec3::new(f(&pos, 0), f(&pos, 1), f(&pos, 2))), normal: Some(Vec3::new(half(&nrm, 0), half(&nrm, 1), half(&nrm, 2))) }
    }

    /// All object indices of the active layer visible inside a pixel rectangle.
    pub fn pick_rect(&mut self, w: u32, h: u32, cam: &Camera, s: &RenderSettings, x0: u32, y0: u32, x1: u32, y1: u32) -> Vec<u32> {
        self.ensure_targets(w, h);
        self.write_globals(cam, w as f32 / h.max(1) as f32, s);
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pick-rect") });
        self.render_ids(&mut enc);
        self.queue.submit(Some(enc.finish()));
        let t = self.targets.as_ref().unwrap();
        let (x0, x1) = (x0.min(w - 1), x1.min(w - 1));
        let (y0, y1) = (y0.min(h - 1), y1.min(h - 1));
        if x1 <= x0 || y1 <= y0 {
            return vec![];
        }
        let data = self.read_region(&t.id_tex, x0, y0, x1 - x0, y1 - y0, 4);
        let mut set: rustc_hash::FxHashSet<u32> = Default::default();
        for c in data.chunks_exact(4) {
            let v = u32::from_le_bytes([c[0], c[1], c[2], c[3]]);
            if v > 0 {
                let (layer, obj) = decode_id(v);
                if layer == 0 {
                    set.insert(obj);
                }
            }
        }
        set.into_iter().collect()
    }

    /// Read back the last rendered color image (RGBA8, sRGB).
    pub fn read_color(&self) -> Option<(u32, u32, Vec<u8>)> {
        let t = self.targets.as_ref()?;
        let (w, h) = t.size;
        let data = self.read_region(&t.color, 0, 0, w, h, 4);
        Some((w, h, data))
    }
}

/// Pick id → (layer, object index): low 24 bits object index + 1, high 8 bits layer.
fn decode_id(v: u32) -> (u32, u32) {
    (v >> 24, (v & 0x00ff_ffff).saturating_sub(1))
}

fn half(b: &[u8], i: usize) -> f32 {
    let h = u16::from_le_bytes([b[i * 2], b[i * 2 + 1]]);
    let sign = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = ((h >> 10) & 0x1f) as i32;
    let frac = (h & 0x3ff) as f32;
    let v = if exp == 0 {
        frac / 1024.0 * 2f32.powi(-14)
    } else if exp == 31 {
        f32::INFINITY
    } else {
        (1.0 + frac / 1024.0) * 2f32.powi(exp - 15)
    };
    sign * v
}
