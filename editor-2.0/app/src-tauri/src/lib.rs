// IFCnative Editor 2.0 — Tauri-Shell.
//
// Aufgaben der Shell (M0):
//  - Dateien aus Explorer-Doppelklick / "Öffnen mit" / Zweitinstanz an das
//    Frontend durchreichen (Single-Instance, Event `ifc://open-path`)
//  - Datei-IO (Modell lesen, Export über nativen Speichern-Dialog)
//  - Nativer ifc-lite-Fast-Path: `get_geometry` / `get_geometry_from_path`
//    über ifc-lite-processing (Rayon, kein WASM-Limit) im Format, das die
//    NativeBridge von @ifc-lite/geometry erwartet (camelCase).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Dateien, die ankamen, bevor das Frontend seinen Listener registriert hat
/// (Kaltstart per Doppelklick). Werden bei `frontend_ready` nachgeliefert.
struct PendingOpens(Mutex<Vec<PathBuf>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPathPayload {
    path: String,
    file_name: String,
}

fn is_model_file(path: &PathBuf) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref(),
        Some("ifc") | Some("ifczip") | Some("ifcx") | Some("ids") | Some("bcf") | Some("bcfzip")
    )
}

fn emit_open(app: &AppHandle, path: &PathBuf) {
    let payload = OpenPathPayload {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    let _ = app.emit("ifc://open-path", payload);
}

fn model_files_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1) // argv[0] = Programmpfad
        .map(PathBuf::from)
        .filter(is_model_file)
        .collect()
}

#[tauri::command]
fn frontend_ready(app: AppHandle, pending: State<PendingOpens>) {
    let drained: Vec<PathBuf> = pending.0.lock().unwrap().drain(..).collect();
    for path in drained {
        emit_open(&app, &path);
    }
}

#[tauri::command]
fn read_model_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Datei nicht lesbar: {e}"))
}

#[tauri::command]
async fn save_model_file(
    app: AppHandle,
    suggested_name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    let file = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("IFC-Modell", &["ifc"])
        .blocking_save_file();
    match file {
        Some(path) => {
            let path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))?;
            Ok(true)
        }
        None => Ok(false), // Nutzer hat abgebrochen
    }
}

/// Antwortformat der NativeBridge (@ifc-lite/geometry, camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGeometryResponse {
    meshes: Vec<NativeMesh>,
    total_vertices: u64,
    total_triangles: u64,
    coordinate_info: NativeCoordinateInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMesh {
    express_id: u32,
    ifc_type: String,
    positions: Vec<f32>,
    normals: Vec<f32>,
    indices: Vec<u32>,
    color: [f32; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCoordinateInfo {
    origin_shift: [f64; 3],
    is_geo_referenced: bool,
}

fn to_native_response(result: ifc_lite_processing::ProcessingResult) -> NativeGeometryResponse {
    let mut total_vertices: u64 = 0;
    let mut total_triangles: u64 = 0;
    let meshes = result
        .meshes
        .into_iter()
        .map(|m| {
            total_vertices += (m.positions.len() / 3) as u64;
            total_triangles += (m.indices.len() / 3) as u64;
            NativeMesh {
                express_id: m.express_id,
                ifc_type: m.ifc_type,
                positions: m.positions,
                normals: m.normals,
                indices: m.indices,
                color: m.color,
            }
        })
        .collect();
    NativeGeometryResponse {
        meshes,
        total_vertices,
        total_triangles,
        coordinate_info: NativeCoordinateInfo {
            origin_shift: [0.0, 0.0, 0.0],
            is_geo_referenced: false,
        },
    }
}

#[tauri::command]
async fn get_geometry(buffer: Vec<u8>) -> Result<NativeGeometryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = ifc_lite_processing::process_geometry(&buffer);
        Ok(to_native_response(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_geometry_from_path(path: String) -> Result<NativeGeometryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
        let result = ifc_lite_processing::process_geometry(&bytes);
        Ok(to_native_response(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Zweitinstanz (z. B. weiterer Explorer-Doppelklick): Dateien an
            // die laufende Instanz weiterreichen und Fenster fokussieren.
            for path in model_files_from_args(args) {
                emit_open(app, &path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(PendingOpens(Mutex::new(Vec::new())))
        .setup(|app| {
            // Kaltstart per Doppelklick: CLI-Argumente einsammeln; das
            // Frontend holt sie nach dem Laden über `frontend_ready` ab.
            let pending = model_files_from_args(std::env::args());
            *app.state::<PendingOpens>().0.lock().unwrap() = pending;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            read_model_file,
            save_model_file,
            get_geometry,
            get_geometry_from_path
        ])
        .run(tauri::generate_context!())
        .expect("Tauri-Start fehlgeschlagen");
}
