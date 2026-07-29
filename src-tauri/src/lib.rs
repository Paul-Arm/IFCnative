use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};

/// Unique labels for popup windows opened via window.open (panel pop-outs).
static POPUP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
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
