//! Edit latency on a large file: set a property and rebuild the spatial tree.
fn main() {
    let p = std::env::args().nth(1).expect("path");
    let t0 = std::time::Instant::now();
    let mut doc = ifc_doc::Document::open(std::path::Path::new(&p), &|_, _| {}).unwrap();
    println!("open {:.0} ms", t0.elapsed().as_secs_f64() * 1000.0);
    let t = std::time::Instant::now();
    let tree = ifc_doc::model::SpatialTree::build(&doc);
    println!("tree {:.0} ms ({} parents)", t.elapsed().as_secs_f64() * 1000.0, tree.parent.len());
    let id = doc.ids_with_flag(ifc_doc::tflags::ELEMENT)[100];
    for i in 0..3 {
        let t = std::time::Instant::now();
        doc.begin("x");
        ifc_doc::ops::set_property(&mut doc, id, "Pset_Test", "A", ifc_doc::Value::Typed("IFCLABEL".into(), Box::new(ifc_doc::Value::Str(format!("v{i}")))), true).unwrap();
        doc.commit();
        let e = t.elapsed().as_secs_f64() * 1000.0;
        let t2 = std::time::Instant::now();
        let changed = doc.take_changed_ids();
        let _tree = ifc_doc::model::SpatialTree::build(&doc);
        println!("edit {e:.1} ms, changed {} ids, tree rebuild {:.0} ms", changed.len(), t2.elapsed().as_secs_f64() * 1000.0);
    }
    let t = std::time::Instant::now();
    let ix = ifc_doc::model::guid_index(&doc);
    println!("guid index {:.0} ms ({} entries)", t.elapsed().as_secs_f64() * 1000.0, ix.len());
}
