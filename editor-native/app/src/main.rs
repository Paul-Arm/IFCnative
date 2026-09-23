#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
//! IFCnative – native IFC editor.

mod app;
mod icons;
mod panels;
mod session;
mod settings;
mod viewer;

use eframe::egui_wgpu;

#[derive(Default, Clone, Debug)]
pub struct CliArgs {
    pub files: Vec<std::path::PathBuf>,
    pub screenshot: Option<std::path::PathBuf>,
    pub view_screenshot: Option<std::path::PathBuf>,
    pub select: Option<u32>,
    pub xray: bool,
    pub color: Option<String>,
    pub tab: Option<String>,
    pub width: f32,
    pub height: f32,
    pub script: Vec<String>,
}

fn parse_args() -> CliArgs {
    let mut a = CliArgs { width: 1600.0, height: 960.0, ..Default::default() };
    let mut it = std::env::args().skip(1);
    while let Some(x) = it.next() {
        match x.as_str() {
            "--screenshot" => a.screenshot = it.next().map(Into::into),
            "--view-screenshot" => a.view_screenshot = it.next().map(Into::into),
            "--select" => a.select = it.next().and_then(|v| v.trim_start_matches('#').parse().ok()),
            "--xray" => a.xray = true,
            "--color" => a.color = it.next(),
            "--tab" => a.tab = it.next(),
            "--size" => {
                if let Some(v) = it.next() {
                    if let Some((w, h)) = v.split_once('x') {
                        a.width = w.parse().unwrap_or(1600.0);
                        a.height = h.parse().unwrap_or(960.0);
                    }
                }
            }
            "--do" => {
                if let Some(v) = it.next() {
                    a.script.push(v);
                }
            }
            _ if !x.starts_with("--") => a.files.push(x.into()),
            _ => {}
        }
    }
    a
}

fn main() -> eframe::Result<()> {
    let args = parse_args();
    let icon = image::load_from_memory(include_bytes!("../assets/icon.png")).ok().map(|img| {
        let img = img.to_rgba8();
        let (w, h) = img.dimensions();
        egui::IconData { rgba: img.into_raw(), width: w, height: h }
    });
    let mut viewport = egui::ViewportBuilder::default().with_title("IFCnative").with_inner_size([args.width, args.height]).with_min_inner_size([800.0, 500.0]).with_drag_and_drop(true);
    if let Some(i) = icon {
        viewport = viewport.with_icon(std::sync::Arc::new(i));
    }
    let wgpu_options = egui_wgpu::WgpuConfiguration { ..Default::default() };
    let options = eframe::NativeOptions { viewport, renderer: eframe::Renderer::Wgpu, wgpu_options, persist_window: true, ..Default::default() };
    eframe::run_native("IFCnative", options, Box::new(move |cc| Ok(Box::new(app::IfcApp::new(cc, args)))))
}
