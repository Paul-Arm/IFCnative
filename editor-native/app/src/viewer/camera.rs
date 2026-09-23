//! Orbit camera (Z-up) with perspective and orthographic projection (reversed Z).

use glam::{Mat4, Vec2, Vec3, Vec4};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Camera {
    pub target: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
    pub fov_y: f32,
    pub ortho: bool,
}

impl Default for Camera {
    fn default() -> Self {
        Camera { target: Vec3::ZERO, yaw: -2.2, pitch: 0.55, dist: 30.0, fov_y: 45f32.to_radians(), ortho: false }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewPreset {
    Top,
    Bottom,
    Front,
    Back,
    Left,
    Right,
    Iso,
}

impl Camera {
    pub fn dir(&self) -> Vec3 {
        Vec3::new(self.pitch.cos() * self.yaw.cos(), self.pitch.cos() * self.yaw.sin(), self.pitch.sin())
    }
    pub fn eye(&self) -> Vec3 {
        self.target + self.dir() * self.dist
    }
    pub fn view(&self) -> Mat4 {
        let up = if self.pitch.abs() > 1.5690 { Vec3::new(-self.yaw.cos(), -self.yaw.sin(), 0.0) * self.pitch.signum() } else { Vec3::Z };
        Mat4::look_at_rh(self.eye(), self.target, up)
    }
    pub fn near_far(&self) -> (f32, f32) {
        let near = (self.dist * 0.002).clamp(0.005, 5.0);
        (near, (self.dist * 50.0).max(near * 10.0) + 20_000.0)
    }
    pub fn proj(&self, aspect: f32) -> Mat4 {
        let (n, f) = self.near_far();
        if self.ortho {
            let h = self.dist * (self.fov_y * 0.5).tan();
            let w = h * aspect;
            // reversed Z orthographic: depth 1 at near, 0 at far
            let (l, r, b, t) = (-w, w, -h, h);
            let n = -f; // allow geometry behind the eye in ortho
            Mat4::from_cols(
                Vec4::new(2.0 / (r - l), 0.0, 0.0, 0.0),
                Vec4::new(0.0, 2.0 / (t - b), 0.0, 0.0),
                Vec4::new(0.0, 0.0, 1.0 / (f - n), 0.0),
                Vec4::new(-(r + l) / (r - l), -(t + b) / (t - b), f / (f - n), 1.0),
            )
        } else {
            Mat4::perspective_infinite_reverse_rh(self.fov_y, aspect, n)
        }
    }
    pub fn view_proj(&self, aspect: f32) -> Mat4 {
        self.proj(aspect) * self.view()
    }

    pub fn orbit(&mut self, dx: f32, dy: f32) {
        self.yaw -= dx * 0.008;
        self.pitch = (self.pitch + dy * 0.008).clamp(-1.5705, 1.5705);
    }

    /// Orbit around a pivot point, keeping it fixed on screen.
    pub fn orbit_around(&mut self, pivot: Vec3, dx: f32, dy: f32) {
        let eye = self.eye();
        let old_dir = self.dir();
        self.orbit(dx, dy);
        let rot = glam::Quat::from_rotation_arc(old_dir, self.dir());
        let new_eye = pivot + rot * (eye - pivot);
        self.target = new_eye - self.dir() * self.dist;
    }

    pub fn pan(&mut self, dx: f32, dy: f32, viewport_h: f32) {
        let scale = 2.0 * self.dist * (self.fov_y * 0.5).tan() / viewport_h.max(1.0);
        let fwd = -self.dir();
        let right = fwd.cross(Vec3::Z).normalize_or(Vec3::X);
        let up = right.cross(fwd).normalize_or(Vec3::Z);
        self.target += (-right * dx + up * dy) * scale;
    }

    /// Zoom by factor towards a world point (keeps the point under the cursor).
    pub fn zoom_towards(&mut self, factor: f32, point: Option<Vec3>) {
        let new_dist = (self.dist * factor).clamp(0.05, 1.0e6);
        if let Some(p) = point {
            let t = 1.0 - new_dist / self.dist;
            self.target += (p - self.target) * t;
        }
        self.dist = new_dist;
    }

    pub fn fit(&mut self, min: Vec3, max: Vec3) {
        if !min.is_finite() || !max.is_finite() || min.x > max.x {
            return;
        }
        let c = (min + max) * 0.5;
        let r = ((max - min).length() * 0.5).max(0.5);
        self.target = c;
        self.dist = r / (self.fov_y * 0.5).sin() * 1.05;
    }

    pub fn set_preset(&mut self, p: ViewPreset) {
        let (yaw, pitch) = match p {
            ViewPreset::Top => (-std::f32::consts::FRAC_PI_2, 1.5705),
            ViewPreset::Bottom => (-std::f32::consts::FRAC_PI_2, -1.5705),
            ViewPreset::Front => (-std::f32::consts::FRAC_PI_2, 0.0),
            ViewPreset::Back => (std::f32::consts::FRAC_PI_2, 0.0),
            ViewPreset::Left => (std::f32::consts::PI, 0.0),
            ViewPreset::Right => (0.0, 0.0),
            ViewPreset::Iso => (-2.2, 0.55),
        };
        self.yaw = yaw;
        self.pitch = pitch;
    }

    /// World ray through a pixel (pos in viewport pixels).
    pub fn ray(&self, pos: Vec2, size: Vec2) -> (Vec3, Vec3) {
        let ndc = Vec2::new(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0);
        let inv = self.view_proj(size.x / size.y.max(1.0)).inverse();
        let p0 = inv.project_point3(ndc.extend(1.0));
        let p1 = inv.project_point3(ndc.extend(0.1));
        let d = (p1 - p0).normalize_or(-self.dir());
        (p0, d)
    }

    /// Project a world point to viewport pixels; None if behind the camera.
    pub fn project(&self, p: Vec3, size: Vec2) -> Option<Vec2> {
        let clip = self.view_proj(size.x / size.y.max(1.0)) * p.extend(1.0);
        if clip.w <= 1e-6 {
            return None;
        }
        let ndc = clip.truncate() / clip.w;
        Some(Vec2::new((ndc.x + 1.0) * 0.5 * size.x, (1.0 - ndc.y) * 0.5 * size.y))
    }
}
