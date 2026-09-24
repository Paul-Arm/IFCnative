//! Per-product triangle counts with/without opening cuts.
use ifc_doc::Document;
use ifc_geom::{Cache, Engine, GeomOptions};
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let doc = Document::open(std::path::Path::new(&path), &|_, _| {}).unwrap();
    let e1 = Engine::new(&doc, GeomOptions::default());
    let e2 = Engine::new(&doc, GeomOptions { cut_openings: false, ..Default::default() });
    let mut c = Cache::default();
    for id in e1.product_ids() {
        let a = e1.mesh_product(&mut c, id).map(|g| g.tri_count()).unwrap_or(0);
        let b = e2.mesh_product(&mut c, id).map(|g| g.tri_count()).unwrap_or(0);
        let reps: Vec<String> = doc.arg(id, 6).and_then(|v| v.as_ref_id()).map(|p| e1.body_representations(p).iter().map(|r| format!("{:?}", doc.arg(*r, 2).map(|v| v.display()))).collect()).unwrap_or_default();
        println!("#{id} {} {:?}: cut={a} nocut={b} openings={:?} reps={:?}", doc.type_camel(id).unwrap_or(""), doc.name_of(id), e1.openings_of(id), reps);
    }
}
