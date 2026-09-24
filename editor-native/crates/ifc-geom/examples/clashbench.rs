use ifc_doc::Document;
use ifc_geom::{clash, Engine, GeomOptions};
fn main() {
    for path in std::env::args().skip(1) {
        let doc = Document::open(std::path::Path::new(&path), &|_, _| {}).unwrap();
        let e = Engine::new(&doc, GeomOptions::default());
        let ids: Vec<u32> = e.product_ids().into_iter().filter(|&i| doc.type_name(i) != Some("IFCSPACE")).collect();
        let geoms = e.mesh_ids(&ids);
        let refs: Vec<&ifc_geom::ProductGeom> = geoms.iter().collect();
        let t = std::time::Instant::now();
        let r = clash::detect(&refs, &refs, Default::default(), &Default::default());
        println!("{}: {} objects, {} clashes in {:?}", std::path::Path::new(&path).file_name().unwrap().to_string_lossy(), refs.len(), r.len(), t.elapsed());
        for c in r.iter().take(5) {
            println!("   {} {:?} <-> {} {:?}", doc.type_camel(c.a).unwrap_or(""), doc.name_of(c.a), doc.type_camel(c.b).unwrap_or(""), doc.name_of(c.b));
        }
    }
}
