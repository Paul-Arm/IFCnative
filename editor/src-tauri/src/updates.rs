//! Update URLs and the read-only SAS are compiled into the desktop app.
//! The webview never supplies URLs, keys, installer paths or installer bytes.
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{async_runtime::Mutex, ipc::Channel, AppHandle, Manager, State, Url, WebviewWindow};
use tauri_plugin_http::reqwest;
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

const CONFIG_ERROR: &str = "Updates sind noch nicht eingerichtet.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateChannel {
    base_url: String,
    #[serde(skip)]
    sas_token: String,
    public_key: String,
}

impl UpdateChannel {
    fn bundled() -> Result<Self, String> {
        let mut channel: Self = serde_json::from_str(include_str!("../../update-channel.json"))
            .map_err(|_| CONFIG_ERROR.to_string())?;
        channel.sas_token =
            include_str!(concat!(env!("OUT_DIR"), "/update-sas-token.txt")).to_string();
        Ok(channel)
    }

    fn base(&self) -> Result<Url, String> {
        let url = Url::parse(&format!("{}/", self.base_url.trim_end_matches('/')))
            .map_err(|_| CONFIG_ERROR.to_string())?;
        if url.scheme() != "https"
            || url.host_str() != Some("stifctool.blob.core.windows.net")
            || url.path() == "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(CONFIG_ERROR.into());
        }
        Ok(url)
    }

    fn authorize(&self, mut url: Url) -> Result<Url, String> {
        let base = self.base()?;
        if url.origin() != base.origin()
            || !url.path().starts_with(base.path())
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Die Update-Datei liegt außerhalb des Update-Speichers.".into());
        }
        let token = self.sas_token.trim().trim_start_matches('?');
        url.set_query(if token.is_empty() { None } else { Some(token) });
        url.set_fragment(None);
        Ok(url)
    }

    fn url(&self, path: &str) -> Result<Url, String> {
        self.authorize(
            self.base()?
                .join(path)
                .map_err(|_| CONFIG_ERROR.to_string())?,
        )
    }
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Updates sind nur im Hauptfenster verfügbar.".into());
    }
    Ok(())
}

#[derive(Default)]
pub struct UpdateState(Mutex<PendingUpdate>);

#[derive(Default)]
struct PendingUpdate {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    configured: bool,
}

#[tauri::command]
pub fn update_status(window: WebviewWindow, app: AppHandle) -> Result<UpdateStatus, String> {
    main_window(&window)?;
    let configured = UpdateChannel::bundled().is_ok_and(|c| {
        c.base().is_ok() && !c.public_key.trim().is_empty() && !c.sas_token.trim().is_empty()
    });
    Ok(UpdateStatus {
        current_version: app.package_info().version.to_string(),
        configured,
    })
}

#[derive(Serialize)]
pub struct AvailableUpdate {
    version: String,
    notes: String,
}

/// Classified check failure. `kind` is mapped to user text in the webview;
/// `message` is a generic fallback and never contains URLs or the SAS.
#[derive(Serialize)]
pub struct CheckError {
    kind: &'static str,
    message: &'static str,
}

impl CheckError {
    const fn new(kind: &'static str) -> Self {
        Self {
            kind,
            message: "Update-Suche fehlgeschlagen. Bitte später erneut versuchen.",
        }
    }
}

impl From<String> for CheckError {
    fn from(message: String) -> Self {
        Self::new(if message == CONFIG_ERROR {
            "config"
        } else {
            "invalid"
        })
    }
}

/// The updater swallows HTTP status codes (non-2xx becomes `ReleaseNotFound`).
/// One extra HEAD on failure tells an expired SAS (403) from a missing manifest (404).
async fn classify_manifest_failure(manifest: Url) -> &'static str {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return "unavailable";
    };
    match client.head(manifest).send().await {
        Ok(response) => match response.status().as_u16() {
            401 | 403 => "denied",
            404 => "missing",
            200..=299 => "invalid",
            _ => "unavailable",
        },
        Err(error) if error.is_connect() || error.is_timeout() || error.is_request() => "offline",
        Err(_) => "unavailable",
    }
}

#[tauri::command]
pub async fn check_editor_update(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, CheckError> {
    main_window(&window).map_err(|_| CheckError::new("unavailable"))?;
    let channel = UpdateChannel::bundled()?;
    if channel.public_key.trim().is_empty() || channel.sas_token.trim().is_empty() {
        return Err(CheckError::new("config"));
    }
    let mut pending = state.0.try_lock().map_err(|_| CheckError::new("busy"))?;
    let manifest = channel.url("latest.json")?;
    let exit_app = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            // Preserve Tauri's default cleanup and give the queued start metric a bounded flush.
            exit_app.cleanup_before_exit();
            exit_app
                .state::<crate::telemetry::Telemetry>()
                .flush_before_update_exit();
        })
        .pubkey(channel.public_key.clone())
        .endpoints(vec![manifest.clone()])
        .map_err(|_| CheckError::new("config"))?
        .timeout(Duration::from_secs(20))
        .header("Cache-Control", "no-cache")
        .map_err(|_| CheckError::new("config"))?
        .build()
        .map_err(|_| CheckError::new("config"))?;
    // Never return updater errors verbatim: they may include the SAS query.
    let update = match updater.check().await {
        Ok(update) => update,
        Err(UpdaterError::Reqwest(error)) if error.is_decode() => {
            return Err(CheckError::new("invalid"))
        }
        Err(UpdaterError::Reqwest(_)) => return Err(CheckError::new("offline")),
        Err(UpdaterError::Serialization(_)) => return Err(CheckError::new("invalid")),
        Err(UpdaterError::ReleaseNotFound) => {
            return Err(CheckError::new(classify_manifest_failure(manifest).await))
        }
        Err(_) => return Err(CheckError::new("unavailable")),
    };
    let mut update = match update {
        Some(update) => update,
        None => {
            *pending = PendingUpdate::default();
            return Ok(None);
        }
    };
    update.download_url = channel.authorize(update.download_url)?;
    update.timeout = Some(Duration::from_secs(15 * 60));
    let result = AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    };
    *pending = PendingUpdate {
        update: Some(update),
        bytes: None,
    };
    Ok(Some(result))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn download_editor_update(
    window: WebviewWindow,
    state: State<'_, UpdateState>,
    version: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    main_window(&window)?;
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "Ein Update-Vorgang läuft bereits.")?;
    let update = pending
        .update
        .as_ref()
        .filter(|u| u.version == version)
        .ok_or("Bitte erneut nach Updates suchen.")?;
    let mut downloaded = 0;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|_| "Download oder Signaturprüfung fehlgeschlagen. Bitte erneut versuchen.")?;
    pending.bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub async fn install_editor_update(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, UpdateState>,
    version: String,
) -> Result<(), String> {
    main_window(&window)?;
    let pending = state
        .0
        .try_lock()
        .map_err(|_| "Ein Update-Vorgang läuft bereits.")?;
    let update = pending
        .update
        .as_ref()
        .filter(|u| u.version == version)
        .ok_or("Bitte erneut nach Updates suchen.")?;
    let bytes = pending
        .bytes
        .as_ref()
        .ok_or("Das Update wurde noch nicht heruntergeladen und geprüft.")?;
    // Only bytes verified by Tauri's public-key signature check reach install().
    let from_version = app.package_info().version.to_string();
    let report = crate::update_telemetry::UpdateReport::new(
        from_version.clone(),
        update.version.clone(),
        "install_started",
    );
    crate::update_telemetry::record_install(&app, &report);
    let telemetry = app.state::<crate::telemetry::Telemetry>();
    telemetry.report_update(report);
    if update.install(bytes).is_err() {
        crate::update_telemetry::clear_install(&app);
        telemetry.report_update(crate::update_telemetry::UpdateReport::new(
            from_version,
            update.version.clone(),
            "install_failed",
        ));
        return Err("Die Installation konnte nicht gestartet werden.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn editor_patchnotes(
    window: WebviewWindow,
    version: String,
) -> Result<serde_json::Value, String> {
    main_window(&window)?;
    if version.is_empty()
        || version.len() > 80
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
    {
        return Err("Ungültige Patchnotes-Version.".into());
    }
    let channel = UpdateChannel::bundled()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Patchnotes sind nicht erreichbar.")?;
    let mut response = client
        .get(channel.url(&format!("patchnotes/{version}.json"))?)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|_| "Patchnotes sind nicht erreichbar.")?
        .error_for_status()
        .map_err(|_| "Patchnotes sind noch nicht verfügbar.")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Patchnotes konnten nicht geladen werden.")?
    {
        if bytes.len() + chunk.len() > 256 * 1024 {
            return Err("Patchnotes-Datei ist zu groß.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Patchnotes-Datei ist ungültig.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn channel() -> UpdateChannel {
        UpdateChannel {
            base_url: "https://stifctool.blob.core.windows.net/editor".into(),
            sas_token: "?sp=r&sig=a%2Bb%3D".into(),
            public_key: "test".into(),
        }
    }
    #[test]
    fn sas_is_attached_to_manifest_notes_and_installer_without_reencoding() {
        let c = channel();
        for path in [
            "latest.json",
            "patchnotes/1.4.12.json",
            "releases/1.4.12/setup.exe",
        ] {
            assert_eq!(c.url(path).unwrap().query(), Some("sp=r&sig=a%2Bb%3D"));
        }
    }
    #[test]
    fn rejects_foreign_hosts_containers_and_path_escape_before_attaching_token() {
        let c = channel();
        for url in [
            "http://stifctool.blob.core.windows.net/editor/a.exe",
            "https://example.com/editor/a.exe",
            "https://stifctool.blob.core.windows.net/editor-other/a.exe",
            "https://stifctool.blob.core.windows.net/editor/../private/a.exe",
        ] {
            assert!(c.authorize(Url::parse(url).unwrap()).is_err());
        }
    }
    #[test]
    fn requires_container_and_removes_server_supplied_token() {
        let mut c = channel();
        assert!(!c
            .authorize(
                Url::parse("https://stifctool.blob.core.windows.net/editor/a.exe?sig=wrong")
                    .unwrap()
            )
            .unwrap()
            .as_str()
            .contains("wrong"));
        c.base_url = "https://stifctool.blob.core.windows.net/".into();
        assert!(c.base().is_err());
    }
}
