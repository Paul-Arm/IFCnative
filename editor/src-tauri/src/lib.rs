use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use std::io::Write;
use tauri::{ipc::Response, webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
mod telemetry;
mod update_telemetry;
mod updates;

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
async fn read_ifc_file(path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = validated_ifc_path(Path::new(&path))?;
        let bytes = fs::read(&path)
            .map_err(|error| format!("IFC-Datei konnte nicht gelesen werden: {error}"))?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_ifc_files(app: tauri::AppHandle, multiple: bool) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.dialog().file().add_filter("IFC", &["ifc"]);
        let selected = if multiple {
            picker.blocking_pick_files().unwrap_or_default()
        } else {
            picker.blocking_pick_file().into_iter().collect()
        };
        selected
            .into_iter()
            .map(|file| {
                let path = file.into_path().map_err(|error| error.to_string())?;
                validated_ifc_path(&path).map(|path| path.to_string_lossy().into_owned())
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

fn write_ifc_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Ungültiger Speicherpfad.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(contents).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_ifc_file(
    app: tauri::AppHandle,
    file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter("IFC", &["ifc"])
            .set_file_name(file_name)
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let mut path = selected.into_path().map_err(|e| e.to_string())?;
        if path.extension().is_none() {
            path.set_extension("ifc");
        }
        if !path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("ifc"))
        {
            return Err("Bitte eine Datei mit der Endung .ifc wählen.".into());
        }
        write_ifc_atomically(&path, contents.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{validated_ifc_path, write_ifc_atomically};
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

    #[test]
    fn save_replaces_complete_contents_and_preserves_original_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.ifc");
        fs::write(&path, b"old model").unwrap();
        write_ifc_atomically(&path, b"new model").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new model");
        assert!(write_ifc_atomically(&dir.path().join("missing/model.ifc"), b"lost").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"new model");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateState::default())
        .manage(telemetry::Telemetry::start())
        .invoke_handler(tauri::generate_handler![
            startup_ifc_paths,
            read_ifc_file,
            pick_ifc_files,
            save_ifc_file,
            telemetry::telemetry_context,
            telemetry::telemetry_error,
            updates::update_status,
            updates::check_editor_update,
            updates::download_editor_update,
            updates::install_editor_update,
            updates::editor_patchnotes
        ])
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
