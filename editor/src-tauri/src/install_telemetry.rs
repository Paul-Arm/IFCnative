//! Durable first-seen registration per local app data directory (Windows user profile).
use sentry::{
    protocol::{EnvelopeItem, ItemContainer},
    Envelope,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
struct Installation {
    id: String,
    first_version: String,
    first_seen_at: u64,
    reported: bool,
}

pub struct Registration {
    path: PathBuf,
    installation: Installation,
}

impl Registration {
    pub fn load(path: PathBuf, version: &str) -> io::Result<Self> {
        if !path.try_exists()? {
            let installation = Installation {
                id: sentry::types::random_uuid().to_string(),
                first_version: version.into(),
                first_seen_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                reported: false,
            };
            // Concurrent app launches must share one ID. Never overwrite another launch's record.
            let file = temporary_record(&path, &installation)?;
            match file.persist_noclobber(&path) {
                Ok(_) => {}
                Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.error),
            }
        }
        if fs::metadata(&path)?.len() > 2048 {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let installation = serde_json::from_slice(&fs::read(&path)?)?;
        Ok(Self { path, installation })
    }

    pub fn pending(&self) -> bool {
        !self.installation.reported
    }

    pub fn metric(&self, username: Option<String>) -> sentry::metrics::CounterMetric {
        let metric = sentry::metrics::counter("editor.install", 1)
            .attribute("install.status", "first_seen")
            .attribute("installation.id", self.installation.id.clone())
            .attribute(
                "installation.first_version",
                self.installation.first_version.clone(),
            )
            .attribute(
                "installation.first_seen_at",
                self.installation.first_seen_at,
            )
            .attribute("app_version", env!("CARGO_PKG_VERSION"))
            .attribute("platform", "desktop");
        match username {
            Some(username) => metric.attribute("user.username", username),
            None => metric,
        }
    }

    /// Only an HTTP success for the envelope containing this registration acknowledges it.
    pub fn acknowledge(&mut self, envelope: &Envelope) -> io::Result<()> {
        let included = envelope.items().any(|item| match item {
            EnvelopeItem::ItemContainer(ItemContainer::Metrics(metrics)) => {
                metrics.iter().any(|metric| {
                    metric.name == "editor.install"
                        && metric
                            .attributes
                            .get("installation.id")
                            .and_then(|id| id.0.as_str())
                            == Some(self.installation.id.as_str())
                })
            }
            _ => false,
        });
        if self.installation.reported || !included {
            return Ok(());
        }
        let mut reported = self.installation.clone();
        reported.reported = true;
        temporary_record(&self.path, &reported)?
            .persist(&self.path)
            .map_err(|error| error.error)?;
        self.installation = reported;
        Ok(())
    }
}

fn temporary_record(
    path: &Path,
    installation: &Installation,
) -> io::Result<tempfile::NamedTempFile> {
    let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(&serde_json::to_vec(installation)?)?;
    file.as_file().sync_all()?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registration_survives_relaunch_and_update_until_acknowledged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installation.json");
        let first = Registration::load(path.clone(), "1.4.16").unwrap();
        let later = Registration::load(path, "1.4.17").unwrap();
        assert!(later.pending());
        assert_eq!(first.installation.id, later.installation.id);
        assert_eq!(later.installation.first_version, "1.4.16");
        assert_eq!(
            first.installation.first_seen_at,
            later.installation.first_seen_at
        );
    }

    #[test]
    fn separate_profiles_have_distinct_ids_and_invalid_record_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let first = Registration::load(dir.path().join("one/installation.json"), "1.4.16").unwrap();
        let second =
            Registration::load(dir.path().join("two/installation.json"), "1.4.16").unwrap();
        assert_ne!(first.installation.id, second.installation.id);
        fs::write(&first.path, b"broken").unwrap();
        assert!(Registration::load(first.path.clone(), "1.4.16").is_err());
        assert_eq!(fs::read(&first.path).unwrap(), b"broken");
    }
}
