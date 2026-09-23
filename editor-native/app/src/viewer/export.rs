//! Geometry export of the (visible) scene: Wavefront OBJ and binary glTF (GLB).

use crate::session::Session;
use crate::viewer::scene::flags;
use std::io::Write;

fn visible(s: &Session) -> Vec<(u32, std::sync::Arc<ifc_geom::ProductGeom>)> {
    s.scene.objects.iter().enumerate().filter(|(i, o)| o.geom.is_some() && s.scene.state[*i][0] & flags::HIDDEN == 0).map(|(_, o)| (o.id, o.geom.clone().unwrap())).collect()
}

pub fn write_obj(s: &Session, path: &std::path::Path) -> anyhow::Result<()> {
    let mut f = std::io::BufWriter::new(std::fs::File::create(path)?);
    writeln!(f, "# IFCnative export – origin offset {:.3} {:.3} {:.3}", s.scene.origin.x, s.scene.origin.y, s.scene.origin.z)?;
    let mut base = 1u32;
    for (id, g) in visible(s) {
        let name = ifc_doc::model::label(&s.doc, id).replace(char::is_whitespace, "_");
        writeln!(f, "o {}_{}", name, id)?;
        for p in &g.positions {
            writeln!(f, "v {} {} {}", p[0], p[2], -p[1])?;
        }
        for t in g.indices.chunks_exact(3) {
            writeln!(f, "f {} {} {}", t[0] + base, t[1] + base, t[2] + base)?;
        }
        base += g.positions.len() as u32;
    }
    Ok(())
}

/// GLB with one mesh/node per product, vertex colors, Y-up.
pub fn write_glb(s: &Session, path: &std::path::Path) -> anyhow::Result<()> {
    let objs = visible(s);
    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views = Vec::new();
    let mut accessors = Vec::new();
    let mut meshes = Vec::new();
    let mut nodes = Vec::new();
    let pad = |b: &mut Vec<u8>| {
        while b.len() % 4 != 0 {
            b.push(0);
        }
    };
    for (id, g) in &objs {
        if g.indices.is_empty() {
            continue;
        }
        // positions
        let off = bin.len();
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for p in &g.positions {
            let q = [p[0], p[2], -p[1]];
            for k in 0..3 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
            for v in q {
                bin.extend_from_slice(&v.to_le_bytes());
            }
        }
        buffer_views.push(serde_json::json!({"buffer":0,"byteOffset":off,"byteLength":bin.len()-off,"target":34962}));
        accessors.push(serde_json::json!({"bufferView":buffer_views.len()-1,"componentType":5126,"count":g.positions.len(),"type":"VEC3","min":lo,"max":hi}));
        let pos_acc = accessors.len() - 1;
        // colors
        let off = bin.len();
        for c in &g.colors {
            bin.extend_from_slice(c);
        }
        pad(&mut bin);
        buffer_views.push(serde_json::json!({"buffer":0,"byteOffset":off,"byteLength":g.colors.len()*4,"target":34962}));
        accessors.push(serde_json::json!({"bufferView":buffer_views.len()-1,"componentType":5121,"normalized":true,"count":g.colors.len(),"type":"VEC4"}));
        let col_acc = accessors.len() - 1;
        // indices
        let off = bin.len();
        for i in &g.indices {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        buffer_views.push(serde_json::json!({"buffer":0,"byteOffset":off,"byteLength":g.indices.len()*4,"target":34963}));
        accessors.push(serde_json::json!({"bufferView":buffer_views.len()-1,"componentType":5125,"count":g.indices.len(),"type":"SCALAR"}));
        let idx_acc = accessors.len() - 1;
        let transparent = g.transparent;
        meshes.push(serde_json::json!({"name": s.doc.guid_of(*id).unwrap_or_default(), "primitives":[{"attributes":{"POSITION":pos_acc,"COLOR_0":col_acc},"indices":idx_acc,"material": if transparent {1} else {0}}]}));
        nodes.push(serde_json::json!({"name": ifc_doc::model::label(&s.doc, *id), "mesh": meshes.len()-1, "extras": {"expressId": id, "ifcClass": s.doc.type_camel(*id).unwrap_or("")}}));
    }
    let json = serde_json::json!({
        "asset": {"version": "2.0", "generator": "IFCnative"},
        "scene": 0,
        "scenes": [{"nodes": (0..nodes.len()).collect::<Vec<_>>()}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": [
            {"name":"opaque","pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1],"metallicFactor":0.0,"roughnessFactor":0.9},"doubleSided":true},
            {"name":"transparent","alphaMode":"BLEND","pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1],"metallicFactor":0.0,"roughnessFactor":0.2},"doubleSided":true}
        ],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": bin.len()}],
    });
    let mut js = serde_json::to_vec(&json)?;
    while js.len() % 4 != 0 {
        js.push(b' ');
    }
    pad(&mut bin);
    let total = 12 + 8 + js.len() + 8 + bin.len();
    let mut f = std::io::BufWriter::new(std::fs::File::create(path)?);
    f.write_all(b"glTF")?;
    f.write_all(&2u32.to_le_bytes())?;
    f.write_all(&(total as u32).to_le_bytes())?;
    f.write_all(&(js.len() as u32).to_le_bytes())?;
    f.write_all(b"JSON")?;
    f.write_all(&js)?;
    f.write_all(&(bin.len() as u32).to_le_bytes())?;
    f.write_all(b"BIN\0")?;
    f.write_all(&bin)?;
    Ok(())
}
