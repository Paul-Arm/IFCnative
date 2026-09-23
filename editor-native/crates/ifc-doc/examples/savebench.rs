use ifc_doc::Document;
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let doc = Document::open(std::path::Path::new(&path), &|_, _| {}).unwrap();
    for _ in 0..3 {
        let t = std::time::Instant::now();
        let b = doc.to_bytes();
        println!("to_bytes {} MB in {:?}", b.len() / 1_000_000, t.elapsed());
        let t = std::time::Instant::now();
        drop(b);
        println!("drop {:?}", t.elapsed());
    }
    let t = std::time::Instant::now();
    let n = doc.ids_of_type("IFCCARTESIANPOINT").len();
    println!("ids_of_type {n} {:?}", t.elapsed());
    let t = std::time::Instant::now();
    let mut c = 0; for id in doc.ids_of_type("IFCPOLYLINE").into_iter().take(100000) { c += doc.referencing(id).len(); }
    println!("referencing {c} {:?}", t.elapsed());
}
