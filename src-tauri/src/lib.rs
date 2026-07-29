use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use tauri::{ipc::Response, webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};

/// Unique labels for popup windows opened via window.open (panel pop-outs).
static POPUP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn validated_ifc_path(path: &Path) -> Result<PathBuf, String> {
    let is_ifc = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ifc"));
    if !is_ifc {
        return Err("Nur .ifc-Dateien können über die Desktop-Integration geöffnet werden.".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("IFC-Datei konnte nicht gefunden werden: {error}"))?;
    if !canonical.is_file() {
        return Err("Der übergebene IFC-Pfad ist keine Datei.".into());
    }
    Ok(canonical)
}

#[tauri::command]
fn startup_ifc_paths() -> Vec<String> {
    let mut paths = Vec::new();
    for argument in env::args_os().skip(1) {
        if let Ok(path) = validated_ifc_path(Path::new(&argument)) {
            let value = path.to_string_lossy().into_owned();
            if !paths.contains(&value) {
                paths.push(value);
            }
        }
    }
    paths
}

#[tauri::command]
fn read_ifc_file(path: String) -> Result<Response, String> {
    let path = validated_ifc_path(Path::new(&path))?;
    let bytes = fs::read(&path)
        .map_err(|error| format!("IFC-Datei konnte nicht gelesen werden: {error}"))?;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::validated_ifc_path;
    use std::{env, fs, process};

    #[test]
    fn desktop_open_accepts_an_existing_ifc_file_case_insensitively() {
        let path = env::temp_dir().join(format!("ifcnative-desktop-open-{}.IFC", process::id()));
        fs::write(&path, b"ISO-10303-21;END-ISO-10303-21;").expect("create test IFC");
        let validated = validated_ifc_path(&path).expect("validate test IFC");
        assert!(validated.is_file());
        fs::remove_file(path).expect("remove test IFC");
    }

    #[test]
    fn desktop_open_rejects_non_ifc_paths_before_reading() {
        let path = env::temp_dir().join("ifcnative-desktop-open.txt");
        let error = validated_ifc_path(&path).expect_err("reject non-IFC path");
        assert!(error.contains(".ifc-Dateien"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![startup_ifc_paths, read_ifc_file])
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("IFCnative")
                .inner_size(1440.0, 940.0)
                .min_inner_size(1024.0, 720.0)
                .center()
                // Keep HTML5 drag & drop working (react-mosaic panel drag):
                // the native drag-drop handler would swallow those events.
                .disable_drag_drop_handler()
                // Allow window.open so panel pop-outs become real OS windows
                // (same JS context, React portals render into them directly).
                .on_new_window(move |_url, features| {
                    let n = POPUP_COUNTER.fetch_add(1, Ordering::Relaxed);
                    let label = format!("popout-{n}");
                    let builder = WebviewWindowBuilder::new(
                        &handle,
                        &label,
                        WebviewUrl::External("about:blank".parse().unwrap()),
                    )
                    .window_features(features)
                    .title("IFCnative")
                    .disable_drag_drop_handler()
                    .on_document_title_changed(|window, title| {
                        let _ = window.set_title(&title);
                    });
                    match builder.build() {
                        Ok(window) => NewWindowResponse::Create { window },
                        Err(_) => NewWindowResponse::Allow,
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run IFCnative");
}
