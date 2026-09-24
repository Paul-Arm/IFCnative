//! Schema validation over IFC files: `cargo run --release --example validate -- a.ifc b.ifc …`
fn main() {
    for p in std::env::args().skip(1) {
        let doc = match ifc_doc::Document::open(std::path::Path::new(&p), &|_, _| {}) {
            Ok(d) => d,
            Err(e) => {
                println!("{p}: {e}");
                continue;
            }
        };
        let t0 = std::time::Instant::now();
        let g = ifc_doc::validate::validate(&doc, 3);
        println!("{} ({} entities, {:.0} ms)", std::path::Path::new(&p).file_name().unwrap().to_string_lossy(), doc.live_count(), t0.elapsed().as_secs_f64() * 1000.0);
        for x in g {
            println!("  {:?} ×{}: {}", x.kind, x.total, x.samples.iter().map(|i| format!("#{} {}", i.id, i.message)).collect::<Vec<_>>().join(" | "));
        }
    }
}
