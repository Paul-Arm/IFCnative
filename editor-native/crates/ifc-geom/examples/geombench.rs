//! `cargo run --release --example geombench -- file.ifc...`
use ifc_doc::Document;
use ifc_geom::{Engine, GeomOptions};
use std::sync::atomic::{AtomicUsize, Ordering};

fn main() {
    for path in std::env::args().skip(1) {
        let t = std::time::Instant::now();
        let doc = Document::open(std::path::Path::new(&path), &|_, _| {}).unwrap();
        let tl = t.elapsed();
        let t2 = std::time::Instant::now();
        let eng = Engine::new(&doc, GeomOptions::default());
        let ids = eng.product_ids();
        let tris = AtomicUsize::new(0);
        let meshed = AtomicUsize::new(0);
        eng.mesh_all(&ids, |batch| {
            meshed.fetch_add(batch.len(), Ordering::Relaxed);
            tris.fetch_add(batch.iter().map(|g| g.tri_count()).sum::<usize>(), Ordering::Relaxed);
        });
        println!(
            "{}: load {:.0} ms, geometry {:.0} ms, products {}/{} meshed, {} tris, unit {}, origin {:?}",
            std::path::Path::new(&path).file_name().unwrap().to_string_lossy(),
            tl.as_secs_f64() * 1000.0,
            t2.elapsed().as_secs_f64() * 1000.0,
            meshed.load(Ordering::Relaxed),
            ids.len(),
            tris.load(Ordering::Relaxed),
            eng.unit,
            eng.origin
        );
        if std::env::var("MISSING").is_ok() {
            let got: std::collections::HashSet<u32> = eng.mesh_ids(&ids).into_iter().map(|g| g.id).collect();
            for id in ids.iter().filter(|i| !got.contains(i)).take(10) {
                println!("   missing #{id} {}", doc.type_camel(*id).unwrap_or("?"));
            }
        }
    }
}
