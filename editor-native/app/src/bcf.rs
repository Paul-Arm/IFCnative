//! BCF 2.1 export (issues with camera viewpoint, selected components and snapshot).

use crate::viewer::camera::Camera;
use glam::{DVec3, Vec3};
use std::io::Write;

#[derive(Clone, Debug)]
pub struct Topic {
    pub title: String,
    pub description: String,
    pub components: Vec<String>,
    pub camera: Option<Camera>,
    pub origin: DVec3,
    pub snapshot_png: Option<Vec<u8>>,
    pub status: String,
    pub topic_type: String,
}

fn uuid() -> String {
    let g = ifc_doc::guid::new_guid();
    ifc_doc::guid::to_uuid_string(&g).unwrap_or_default()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn v3(tag: &str, v: DVec3) -> String {
    format!("<{tag}><X>{:.6}</X><Y>{:.6}</Y><Z>{:.6}</Z></{tag}>", v.x, v.y, v.z)
}

fn viewpoint_xml(t: &Topic, vp_guid: &str) -> String {
    let mut s = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    s.push_str(&format!("<VisualizationInfo Guid=\"{vp_guid}\">\n<Components>\n"));
    if !t.components.is_empty() {
        s.push_str("<Selection>\n");
        for g in &t.components {
            s.push_str(&format!("<Component IfcGuid=\"{}\"/>\n", esc(g)));
        }
        s.push_str("</Selection>\n");
    }
    s.push_str("<Visibility DefaultVisibility=\"true\"/>\n</Components>\n");
    if let Some(c) = &t.camera {
        let eye = c.eye().as_dvec3() + t.origin;
        let dir = (-c.dir()).as_dvec3().normalize();
        let right = dir.cross(DVec3::Z).normalize_or(DVec3::X);
        let up = right.cross(dir).normalize_or(DVec3::Z);
        if c.ortho {
            let h = 2.0 * c.dist as f64 * (c.fov_y as f64 * 0.5).tan();
            s.push_str(&format!("<OrthogonalCamera>{}{}{}<ViewToWorldScale>{:.6}</ViewToWorldScale></OrthogonalCamera>\n", v3("CameraViewPoint", eye), v3("CameraDirection", dir), v3("CameraUpVector", up), h));
        } else {
            s.push_str(&format!("<PerspectiveCamera>{}{}{}<FieldOfView>{:.3}</FieldOfView></PerspectiveCamera>\n", v3("CameraViewPoint", eye), v3("CameraDirection", dir), v3("CameraUpVector", up), c.fov_y.to_degrees()));
        }
    }
    s.push_str("</VisualizationInfo>\n");
    s
}

pub fn write_bcf(path: &std::path::Path, project_name: &str, topics: &[Topic]) -> anyhow::Result<()> {
    let file = std::fs::File::create(path)?;
    let mut z = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    z.start_file("bcf.version", opts)?;
    z.write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Version VersionId=\"2.1\"><DetailedVersion>2.1</DetailedVersion></Version>\n")?;
    z.start_file("project.bcfp", opts)?;
    z.write_all(format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ProjectExtension><Project ProjectId=\"{}\"><Name>{}</Name></Project></ProjectExtension>\n", uuid(), esc(project_name)).as_bytes())?;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    for t in topics {
        let tg = uuid();
        let vg = uuid();
        let mut markup = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Markup>\n");
        markup.push_str(&format!(
            "<Topic Guid=\"{tg}\" TopicType=\"{}\" TopicStatus=\"{}\">\n<Title>{}</Title>\n<CreationDate>{now}</CreationDate>\n<CreationAuthor>IFCnative</CreationAuthor>\n<Description>{}</Description>\n</Topic>\n",
            esc(&t.topic_type),
            esc(&t.status),
            esc(&t.title),
            esc(&t.description)
        ));
        markup.push_str(&format!("<Viewpoints Guid=\"{vg}\"><Viewpoint>viewpoint.bcfv</Viewpoint>{}</Viewpoints>\n", if t.snapshot_png.is_some() { "<Snapshot>snapshot.png</Snapshot>" } else { "" }));
        markup.push_str("</Markup>\n");
        z.start_file(format!("{tg}/markup.bcf"), opts)?;
        z.write_all(markup.as_bytes())?;
        z.start_file(format!("{tg}/viewpoint.bcfv"), opts)?;
        z.write_all(viewpoint_xml(t, &vg).as_bytes())?;
        if let Some(png) = &t.snapshot_png {
            z.start_file(format!("{tg}/snapshot.png"), opts)?;
            z.write_all(png)?;
        }
    }
    z.finish()?;
    Ok(())
}

/// Encode RGBA pixels as PNG bytes.
pub fn png_bytes(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(&mut out);
    use image::ImageEncoder;
    enc.write_image(rgba, w, h, image::ExtendedColorType::Rgba8).ok()?;
    Some(out)
}

#[allow(dead_code)]
fn _unused(_: Vec3) {}

// ---------------------------------------------------------------- import

use ifc_doc::ids::{parse_xml, Elem};

#[derive(Clone, Debug, Default)]
pub struct Comment {
    pub date: String,
    pub author: String,
    pub text: String,
}

#[derive(Clone, Debug, Default)]
pub struct Viewpoint {
    pub eye: Option<DVec3>,
    pub dir: Option<DVec3>,
    pub ortho: bool,
    pub view_scale: Option<f64>,
    pub selection: Vec<String>,
    pub default_visible: bool,
    pub exceptions: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ImportedTopic {
    pub guid: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub topic_type: String,
    pub author: String,
    pub date: String,
    pub assigned: String,
    pub priority: String,
    pub due: String,
    pub comments: Vec<Comment>,
    pub viewpoint: Option<Viewpoint>,
    pub snapshot: Option<Vec<u8>>,
}

fn find<'a>(e: &'a Elem, name: &str) -> Option<&'a Elem> {
    if e.name == name {
        return Some(e);
    }
    e.children.iter().find_map(|c| find(c, name))
}

fn find_all<'a>(e: &'a Elem, name: &str, out: &mut Vec<&'a Elem>) {
    if e.name == name {
        out.push(e);
    }
    for c in &e.children {
        find_all(c, name, out);
    }
}

fn text(e: &Elem, name: &str) -> String {
    e.child(name).map(|c| c.text.trim().to_string()).unwrap_or_default()
}

fn vec3(e: Option<&Elem>) -> Option<DVec3> {
    let e = e?;
    let g = |n: &str| e.child(n).and_then(|c| c.text.trim().parse::<f64>().ok());
    Some(DVec3::new(g("X")?, g("Y")?, g("Z")?))
}

fn parse_viewpoint(xml: &str) -> Option<Viewpoint> {
    let root = parse_xml(xml).ok()?;
    let mut vp = Viewpoint { default_visible: true, ..Default::default() };
    if let Some(sel) = find(&root, "Selection") {
        vp.selection = sel.all("Component").filter_map(|c| c.attr("IfcGuid").map(|s| s.to_string())).collect();
    }
    if let Some(vis) = find(&root, "Visibility") {
        vp.default_visible = vis.attr("DefaultVisibility").map(|v| v != "false").unwrap_or(true);
        if let Some(ex) = vis.child("Exceptions") {
            vp.exceptions = ex.all("Component").filter_map(|c| c.attr("IfcGuid").map(|s| s.to_string())).collect();
        }
    }
    let cam = find(&root, "PerspectiveCamera").map(|c| (c, false)).or_else(|| find(&root, "OrthogonalCamera").map(|c| (c, true)));
    if let Some((c, ortho)) = cam {
        vp.eye = vec3(c.child("CameraViewPoint"));
        vp.dir = vec3(c.child("CameraDirection"));
        vp.ortho = ortho;
        vp.view_scale = c.child("ViewToWorldScale").and_then(|x| x.text.trim().parse().ok());
    }
    Some(vp)
}

/// Read a BCF 2.x/3.0 archive.
pub fn read_bcf(path: &std::path::Path) -> anyhow::Result<Vec<ImportedTopic>> {
    use std::io::Read;
    let mut z = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    let mut files: std::collections::HashMap<String, Vec<u8>> = Default::default();
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        if f.is_dir() {
            continue;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        files.insert(f.name().replace('\\', "/"), buf);
    }
    let mut topics = Vec::new();
    let mut markups: Vec<&String> = files.keys().filter(|k| k.ends_with("markup.bcf")).collect();
    markups.sort();
    for m in markups {
        let dir = m.rsplit_once('/').map(|x| x.0.to_string()).unwrap_or_default();
        let Ok(root) = parse_xml(&String::from_utf8_lossy(&files[m])) else { continue };
        let Some(t) = find(&root, "Topic") else { continue };
        let mut it = ImportedTopic {
            guid: t.attr("Guid").unwrap_or("").to_string(),
            title: text(t, "Title"),
            description: text(t, "Description"),
            status: t.attr("TopicStatus").unwrap_or("").to_string(),
            topic_type: t.attr("TopicType").unwrap_or("").to_string(),
            author: text(t, "CreationAuthor"),
            date: text(t, "CreationDate"),
            assigned: text(t, "AssignedTo"),
            priority: text(t, "Priority"),
            due: text(t, "DueDate"),
            ..Default::default()
        };
        let mut cs = Vec::new();
        find_all(&root, "Comment", &mut cs);
        for c in cs {
            // BCF 2.1: <Comment><Date/><Author/><Comment>text</Comment>; skip the inner text node element
            if c.child("Author").is_none() && c.child("Date").is_none() {
                continue;
            }
            it.comments.push(Comment { date: text(c, "Date"), author: text(c, "Author"), text: text(c, "Comment") });
        }
        // first viewpoint (+ snapshot)
        let mut vps = Vec::new();
        find_all(&root, "Viewpoints", &mut vps);
        find_all(&root, "ViewPoint", &mut vps);
        let (vp_file, snap_file) = vps.first().map(|v| (text(v, "Viewpoint"), text(v, "Snapshot"))).unwrap_or_default();
        let join = |f: &str| if dir.is_empty() { f.to_string() } else { format!("{dir}/{f}") };
        let vp_path = if vp_file.is_empty() { join("viewpoint.bcfv") } else { join(&vp_file) };
        if let Some(b) = files.get(&vp_path).or_else(|| files.iter().find(|(k, _)| k.starts_with(&dir) && k.ends_with(".bcfv")).map(|x| x.1)) {
            it.viewpoint = parse_viewpoint(&String::from_utf8_lossy(b));
        }
        let snap_path = if snap_file.is_empty() { join("snapshot.png") } else { join(&snap_file) };
        it.snapshot = files.get(&snap_path).cloned().or_else(|| files.iter().find(|(k, _)| k.starts_with(&dir) && (k.ends_with(".png") || k.ends_with(".jpg"))).map(|x| x.1.clone()));
        topics.push(it);
    }
    Ok(topics)
}

/// Apply a viewpoint: camera, selection and visibility (GlobalIds).
pub fn apply_viewpoint(s: &mut crate::session::Session, vp: &Viewpoint) -> (usize, usize) {
    let index = ifc_doc::model::guid_index(&s.doc);
    let sel: Vec<u32> = vp.selection.iter().filter_map(|g| index.get(g).copied()).collect();
    let ex: rustc_hash::FxHashSet<u32> = vp.exceptions.iter().filter_map(|g| index.get(g).copied()).collect();
    if vp.default_visible {
        s.isolated = None;
        s.hidden = ex;
    } else if !ex.is_empty() {
        let mut set = rustc_hash::FxHashSet::default();
        for id in ex {
            set.extend(s.tree.subtree(id));
        }
        s.isolated = Some(set);
        s.hidden.clear();
    }
    let found = sel.len();
    s.select(sel, false);
    if let (Some(eye), Some(dir)) = (vp.eye, vp.dir) {
        let dir = dir.normalize_or(DVec3::NEG_Y);
        let back = -dir; // camera dir() points from target to eye
        let eye_scene = (eye - s.scene.origin).as_vec3();
        let dist = if vp.ortho {
            vp.view_scale.map(|h| (h / (2.0 * (s.camera.fov_y as f64 * 0.5).tan())) as f32).unwrap_or(20.0)
        } else {
            // distance to the selection (or scene) centre along the view ray
            let center = s.scene.bbox_of(s.selection.iter().copied()).or(s.scene.bbox).map(|(a, b)| (a + b) * 0.5);
            center.map(|c| (c - eye_scene).dot(dir.as_vec3()).max(1.0)).unwrap_or(10.0)
        };
        s.camera.yaw = back.y.atan2(back.x) as f32;
        s.camera.pitch = back.z.clamp(-1.0, 1.0).asin() as f32;
        s.camera.dist = dist;
        s.camera.ortho = vp.ortho;
        s.camera.target = eye_scene + dir.as_vec3() * dist;
    }
    s.apply_visibility();
    s.view_dirty = true;
    (found, vp.selection.len())
}

/// Convert an imported topic back for export (keeps camera/selection/snapshot).
pub fn to_export(t: &ImportedTopic, s: &crate::session::Session) -> Topic {
    let camera = t.viewpoint.as_ref().and_then(|vp| {
        let (eye, dir) = (vp.eye?, vp.dir?.normalize_or(DVec3::NEG_Y));
        let back = -dir;
        let dist = 10.0f32;
        Some(Camera { target: (eye - s.scene.origin).as_vec3() + dir.as_vec3() * dist, yaw: back.y.atan2(back.x) as f32, pitch: back.z.clamp(-1.0, 1.0).asin() as f32, dist, ortho: vp.ortho, ..Default::default() })
    });
    Topic {
        title: t.title.clone(),
        description: t.description.clone(),
        components: t.viewpoint.as_ref().map(|v| v.selection.clone()).unwrap_or_default(),
        camera,
        origin: s.scene.origin,
        snapshot_png: t.snapshot.clone(),
        status: if t.status.is_empty() { "Open".into() } else { t.status.clone() },
        topic_type: if t.topic_type.is_empty() { "Issue".into() } else { t.topic_type.clone() },
    }
}
