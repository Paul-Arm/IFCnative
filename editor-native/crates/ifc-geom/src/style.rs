//! Presentation styles: item colors, material colors, class defaults.

use crate::engine::Color;
use ifc_doc::{model, Document, Value};
use rayon::prelude::*;
use rustc_hash::FxHashMap;

#[derive(Default, Clone)]
pub struct StyleMap {
    /// Representation item id -> color.
    pub items: FxHashMap<u32, Color>,
    /// Material id -> color.
    pub materials: FxHashMap<u32, Color>,
}

impl StyleMap {
    pub fn build(doc: &Document) -> StyleMap {
        let styled = doc.ids_of_type("IFCSTYLEDITEM");
        let pairs: Vec<(Option<u32>, u32, Color)> = styled
            .par_iter()
            .filter_map(|&sid| {
                let a = doc.args(sid)?;
                let item = a.first().and_then(|v| v.as_ref_id());
                let col = styles_color(doc, a.get(1)?)?;
                Some((item, sid, col))
            })
            .collect();
        let mut items = FxHashMap::default();
        let mut by_styled: FxHashMap<u32, Color> = FxHashMap::default();
        for (item, sid, col) in pairs {
            if let Some(i) = item {
                items.entry(i).or_insert(col);
            }
            by_styled.insert(sid, col);
        }
        // material definition representations
        let mut materials = FxHashMap::default();
        for mdr in doc.ids_of_type("IFCMATERIALDEFINITIONREPRESENTATION") {
            let Some(a) = doc.args(mdr) else { continue };
            let Some(mat) = a.get(3).and_then(|v| v.as_ref_id()) else { continue };
            'reps: for rep in a.get(2).map(|v| v.ref_list()).unwrap_or_default() {
                for it in doc.arg(rep, 3).map(|v| v.ref_list()).unwrap_or_default() {
                    if let Some(c) = by_styled.get(&it) {
                        materials.insert(mat, *c);
                        break 'reps;
                    }
                }
            }
        }
        StyleMap { items, materials }
    }

    pub fn item_color(&self, item: u32) -> Option<Color> {
        self.items.get(&item).copied()
    }

    /// Color from the material (first layer/constituent) of an object or its type.
    pub fn material_color_of(&self, doc: &Document, id: u32) -> Option<Color> {
        if self.materials.is_empty() {
            return None;
        }
        for mv in model::materials_of(doc, id) {
            for l in &mv.layers {
                if let Some(m) = l.material {
                    if let Some(c) = self.materials.get(&m) {
                        return Some(*c);
                    }
                }
            }
        }
        None
    }
}

fn styles_color(doc: &Document, styles: &Value) -> Option<Color> {
    for s in styles.ref_list() {
        if let Some(c) = style_color(doc, s, 0) {
            return Some(c);
        }
    }
    None
}

fn style_color(doc: &Document, s: u32, depth: u32) -> Option<Color> {
    if depth > 6 {
        return None;
    }
    match doc.type_name(s)? {
        "IFCPRESENTATIONSTYLEASSIGNMENT" => {
            for x in doc.arg(s, 0)?.ref_list() {
                if let Some(c) = style_color(doc, x, depth + 1) {
                    return Some(c);
                }
            }
            None
        }
        "IFCSURFACESTYLE" => {
            let mut best: Option<Color> = None;
            for x in doc.arg(s, 2)?.ref_list() {
                let t = doc.type_name(x).unwrap_or("");
                if t == "IFCSURFACESTYLERENDERING" || t == "IFCSURFACESTYLESHADING" {
                    let a = doc.args(x)?;
                    let rgb = a.first().and_then(|v| v.as_ref_id()).and_then(|c| colour_rgb(doc, c));
                    if let Some([r, g, b]) = rgb {
                        let transp = a.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0) as f32;
                        let c = [r, g, b, 1.0 - transp];
                        if t == "IFCSURFACESTYLERENDERING" || best.is_none() {
                            best = Some(c);
                        }
                    }
                }
            }
            best
        }
        _ => None,
    }
}

fn colour_rgb(doc: &Document, c: u32) -> Option<[f32; 3]> {
    if doc.type_name(c)? != "IFCCOLOURRGB" {
        return None;
    }
    let a = doc.args(c)?;
    Some([a.get(1)?.as_f64()? as f32, a.get(2)?.as_f64()? as f32, a.get(3)?.as_f64()? as f32])
}

/// Default display color per IFC class.
pub fn default_color(ty: &str) -> Color {
    let t = ty.trim_start_matches("IFC");
    let c: Color = match t {
        _ if t.starts_with("WALL") || t.starts_with("CURTAINWALL") => [0.86, 0.85, 0.82, 1.0],
        _ if t.starts_with("SLAB") => [0.72, 0.72, 0.72, 1.0],
        _ if t.starts_with("ROOF") => [0.70, 0.42, 0.33, 1.0],
        _ if t.starts_with("WINDOW") => [0.55, 0.75, 0.95, 0.45],
        _ if t.starts_with("DOOR") => [0.62, 0.46, 0.32, 1.0],
        _ if t.starts_with("COLUMN") || t.starts_with("BEAM") || t.starts_with("MEMBER") => [0.70, 0.71, 0.76, 1.0],
        _ if t.starts_with("PLATE") => [0.62, 0.78, 0.88, 0.6],
        _ if t.starts_with("STAIR") || t.starts_with("RAMP") => [0.66, 0.66, 0.62, 1.0],
        _ if t.starts_with("RAILING") => [0.45, 0.45, 0.48, 1.0],
        _ if t.starts_with("SPACE") => [0.35, 0.65, 0.90, 0.18],
        _ if t.starts_with("FURNISH") || t.starts_with("FURNITURE") => [0.80, 0.64, 0.44, 1.0],
        _ if t.starts_with("COVERING") => [0.88, 0.87, 0.80, 1.0],
        _ if t.starts_with("SITE") || t.starts_with("GEOGRAPHIC") => [0.52, 0.68, 0.42, 1.0],
        _ if t.starts_with("FOOTING") || t.starts_with("PILE") => [0.60, 0.58, 0.55, 1.0],
        _ if t.starts_with("REINFORC") || t.starts_with("TENDON") => [0.40, 0.30, 0.30, 1.0],
        _ if t.starts_with("OPENING") => [0.95, 0.35, 0.25, 0.3],
        _ if t.starts_with("PIPE") || t.starts_with("DUCT") || t.starts_with("FLOW") || t.starts_with("DISTRIBUTION") || t.contains("TERMINAL") || t.starts_with("VALVE") || t.starts_with("PUMP") || t.starts_with("FAN") => [0.55, 0.68, 0.80, 1.0],
        _ if t.starts_with("CABLE") || t.contains("ELECTRIC") || t.starts_with("LIGHT") || t.starts_with("OUTLET") || t.starts_with("SWITCH") => [0.85, 0.72, 0.30, 1.0],
        _ if t.starts_with("BRIDGE") || t.starts_with("ROAD") || t.starts_with("RAIL") || t.starts_with("PAVEMENT") || t.starts_with("COURSE") || t.starts_with("EARTHWORKS") => [0.62, 0.62, 0.60, 1.0],
        _ if t.starts_with("GEOTECHNIC") || t.starts_with("BOREHOLE") => [0.70, 0.55, 0.40, 1.0],
        _ if t.starts_with("BUILDINGELEMENTPROXY") || t.starts_with("PROXY") => [0.75, 0.75, 0.70, 1.0],
        _ => [0.78, 0.78, 0.78, 1.0],
    };
    c
}
