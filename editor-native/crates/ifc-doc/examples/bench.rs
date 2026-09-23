//! Load/save benchmark: `cargo run --release --example bench -- <file.ifc>...`
use ifc_doc::Document;

fn main() {
    for path in std::env::args().skip(1) {
        let t = std::time::Instant::now();
        let doc = match Document::open(std::path::Path::new(&path), &|_, _| {}) {
            Ok(d) => d,
            Err(e) => {
                println!("{path}: FEHLER {e}");
                continue;
            }
        };
        let load = t.elapsed();
        let st = doc.load_stats.as_ref().unwrap();
        let t2 = std::time::Instant::now();
        let bytes = doc.to_bytes();
        let ser = t2.elapsed();
        let doc2 = Document::from_bytes(bytes, &|_, _| {}).unwrap();
        let mut same = doc.len() == doc2.len();
        for id in doc.all_ids().take(200_000) {
            if doc.raw_args(id) != doc2.raw_args(id) {
                same = false;
                println!("  mismatch #{id}");
                break;
            }
        }
        println!(
            "{}: {:.1} MB, {} entities, {} types, schema {:?}, load {:.0} ms (scan {:.0}, index {:.0}), save {:.0} ms, roundtrip {}, diag {}",
            std::path::Path::new(&path).file_name().unwrap().to_string_lossy(),
            st.bytes as f64 / 1e6,
            st.entities,
            doc.types.len(),
            doc.schema_id,
            load.as_secs_f64() * 1000.0,
            st.scan_ms,
            st.index_ms,
            ser.as_secs_f64() * 1000.0,
            if same { "OK" } else { "FEHLER" },
            doc.diagnostics.len()
        );
        for d in doc.diagnostics.iter().take(3) {
            println!("   - {:?} {}", d.severity, d.message);
        }
    }
}
