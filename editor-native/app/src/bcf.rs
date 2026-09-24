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
