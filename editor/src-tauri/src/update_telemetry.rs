//! A small install marker confirms an in-app update on the next launch.
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};
use tauri::Manager;

#[derive(Clone, Deserialize, Serialize)]
pub struct UpdateReport {
    from_version: String,
    to_version: String,
    #[serde(skip)]
    status: &'static str,
}

impl UpdateReport {
    pub fn new(from_version: String, to_version: String, status: &'static str) -> Self {
        Self {
            from_version,
            to_version,
            status,
        }
    }

    pub fn metric(self, username: Option<String>) -> sentry::metrics::CounterMetric {
        let metric = sentry::metrics::counter("editor.update", 1)
            .attribute("update.status", self.status)
            .attribute("update.from_version", self.from_version)
            .attribute("update.to_version", self.to_version)
            .attribute("app_version", env!("CARGO_PKG_VERSION"))
            .attribute("platform", "desktop");
        match username {
            Some(username) => metric.attribute("user.username", username),
            None => metric,
        }
    }
}

fn marker_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("pending-update.json"),
    )
}

pub fn record_install(app: &tauri::AppHandle, report: &UpdateReport) {
    if let Some(path) = marker_path(app) {
        let _ = write_marker(&path, report);
    }
}

fn write_marker(path: &Path, report: &UpdateReport) -> std::io::Result<()> {
    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(&serde_json::to_vec(report)?)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

pub fn clear_install(app: &tauri::AppHandle) {
    if let Some(path) = marker_path(app) {
        let _ = fs::remove_file(path);
    }
}

pub fn take_completed(app: &tauri::AppHandle) -> Option<UpdateReport> {
    take_marker(&marker_path(app)?, &app.package_info().version.to_string())
}

fn take_marker(path: &Path, current_version: &str) -> Option<UpdateReport> {
    if fs::metadata(path).ok()?.len() > 1024 {
        return None;
    }
    let mut report: UpdateReport = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if report.to_version != current_version || report.from_version == current_version {
        return None;
    }
    // Consume before enqueueing, so repeated launches/context messages do not double-count.
    fs::remove_file(path).ok()?;
    report.status = "completed";
    Some(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_requires_target_version_and_is_consumed_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pending-update.json");
        assert!(take_marker(&path, "1.4.15").is_none());
        let report = UpdateReport::new("1.4.14".into(), "1.4.15".into(), "install_started");
        write_marker(&path, &report).unwrap();
        assert!(take_marker(&path, "1.4.14").is_none());
        assert!(take_marker(&path, "1.4.16").is_none());
        let completed = take_marker(&path, "1.4.15").unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.from_version, "1.4.14");
        assert!(take_marker(&path, "1.4.15").is_none());
    }

    #[test]
    fn reinstall_and_invalid_markers_do_not_count_as_completed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pending-update.json");
        write_marker(
            &path,
            &UpdateReport::new("1.4.15".into(), "1.4.15".into(), "install_started"),
        )
        .unwrap();
        assert!(take_marker(&path, "1.4.15").is_none());
        fs::write(&path, b"invalid json").unwrap();
        assert!(take_marker(&path, "1.4.15").is_none());
        fs::write(&path, vec![b' '; 1025]).unwrap();
        assert!(take_marker(&path, "1.4.15").is_none());
    }
}
