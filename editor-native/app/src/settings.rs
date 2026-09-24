//! Persistent user settings (JSON in the user config directory).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub dark: bool,
    pub ui_scale: f32,
    pub selection_color: [u8; 4],
    pub bg_dark: [f32; 3],
    pub bg_light: [f32; 3],
    pub recent: Vec<PathBuf>,
    pub cut_openings: bool,
    pub hide_spaces: bool,
    pub orbit_around_pick: bool,
    pub invert_zoom: bool,
    pub snap_px: f32,
    pub max_circle_segments: usize,
    pub split_shared_psets: bool,
    pub autosave_minutes: u32,
    pub show_welcome: bool,
    pub show_edges: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            dark: true,
            ui_scale: 1.0,
            selection_color: [255, 170, 40, 255],
            bg_dark: [0.105, 0.115, 0.13],
            bg_light: [0.86, 0.88, 0.91],
            recent: Vec::new(),
            cut_openings: true,
            hide_spaces: true,
            orbit_around_pick: true,
            invert_zoom: false,
            snap_px: 12.0,
            max_circle_segments: 48,
            split_shared_psets: true,
            autosave_minutes: 5,
            show_welcome: true,
            show_edges: true,
        }
    }
}

impl Settings {
    pub fn dir() -> Option<PathBuf> {
        directories::ProjectDirs::from("de", "IFCnative", "IFCnative").map(|d| d.config_dir().to_path_buf())
    }

    pub fn load() -> Settings {
        Self::dir().and_then(|d| std::fs::read_to_string(d.join("settings.json")).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn save(&self) {
        if let Some(d) = Self::dir() {
            let _ = std::fs::create_dir_all(&d);
            if let Ok(t) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(d.join("settings.json"), t);
            }
        }
    }

    pub fn push_recent(&mut self, p: PathBuf) {
        self.recent.retain(|x| x != &p);
        self.recent.insert(0, p);
        self.recent.truncate(15);
    }

    pub fn background(&self, dark: bool) -> [f32; 3] {
        if dark {
            self.bg_dark
        } else {
            self.bg_light
        }
    }

    pub fn geom_options(&self) -> ifc_geom::GeomOptions {
        ifc_geom::GeomOptions { cut_openings: self.cut_openings, max_circle_segments: self.max_circle_segments.clamp(12, 128), ..Default::default() }
    }

    /// Directory for crash-recovery autosaves.
    pub fn recovery_dir() -> Option<PathBuf> {
        Self::dir().map(|d| d.join("recovery"))
    }
}
