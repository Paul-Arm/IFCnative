#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
fn main() -> eframe::Result<()> {
    if let Some(path) = std::env::args().nth(1) {
        let bytes = std::fs::read(&path).unwrap();
        let t = std::time::Instant::now();
        let r = ifc_lite_processing::process_geometry(&bytes);
        let tris: usize = r.meshes.iter().map(|m| m.indices.len() / 3).sum();
        println!("meshes={} tris={} frame={:?} in {:?}", r.meshes.len(), tris, r.frame, t.elapsed());
        return Ok(());
    }
    eframe::run_native("IFCnative", eframe::NativeOptions::default(), Box::new(|_cc| Ok(Box::new(App))))
}
struct App;
impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| { ui.label("hello"); });
    }
}
