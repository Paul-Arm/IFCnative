//! Telemetry is best-effort. A bounded worker handles errors and update metrics.
use regex::Regex;
use sentry::{
    protocol::{Event, Exception, User},
    Client, ClientOptions, Envelope, Transport,
};
use serde::Deserialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const DSN: &str = include_str!(concat!(env!("OUT_DIR"), "/sentry-dsn.txt"));
const QUEUE_SIZE: usize = 16;
const MAX_TEXT: usize = 8_192;

enum Report {
    Error(ErrorReport),
    Update(crate::update_telemetry::UpdateReport),
    Flush(SyncSender<()>),
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReport {
    pub message: String,
    #[serde(default)]
    pub stack: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub ifc_names: Vec<String>,
}

#[derive(Clone)]
pub struct Telemetry {
    sender: Option<SyncSender<Report>>,
    online: Arc<AtomicBool>,
    ifc_names: Arc<Mutex<Vec<String>>>,
    update_checked: Arc<AtomicBool>,
}

impl Telemetry {
    pub fn start() -> Self {
        let mut service = Self {
            sender: None,
            // The WebView supplies its initial status before reports are accepted.
            online: Arc::new(AtomicBool::new(false)),
            ifc_names: Arc::new(Mutex::new(Vec::new())),
            update_checked: Arc::new(AtomicBool::new(false)),
        };
        let Ok(dsn) = DSN.trim().parse::<sentry::types::Dsn>() else {
            return service;
        };
        if dsn.scheme().to_string() != "https" {
            return service;
        }
        let (sender, receiver) = mpsc::sync_channel::<Report>(QUEUE_SIZE);
        let online = service.online.clone();
        let started = std::thread::Builder::new()
            .name("ifcnative-telemetry".into())
            .spawn(move || {
                let Ok(http) = reqwest::blocking::Client::builder()
                    .connect_timeout(Duration::from_secs(2))
                    .timeout(Duration::from_secs(4))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                else {
                    return;
                };
                let transport = Arc::new(WorkerTransport {
                    http,
                    endpoint: dsn.envelope_api_url().to_string(),
                    auth: dsn.to_auth(Some("ifcnative-rust")).to_string(),
                    online: online.clone(),
                    retry_after: Mutex::new(None),
                });
                let mut options = ClientOptions::default();
                options.dsn = Some(dsn);
                options.release = Some(format!("ifcnative@{}", env!("CARGO_PKG_VERSION")).into());
                options.environment = Some(
                    if cfg!(debug_assertions) {
                        "development"
                    } else {
                        "production"
                    }
                    .into(),
                );
                options.default_integrations = false;
                options.send_default_pii = false;
                options.auto_session_tracking = false;
                options.max_breadcrumbs = 0;
                options.transport = Some(Arc::new(transport));
                let client = Client::from(options);
                let username = std::env::var("USERNAME")
                    .or_else(|_| std::env::var("USER"))
                    .ok();
                while let Ok(report) = receiver.recv() {
                    if let Report::Flush(done) = report {
                        client.flush(Some(Duration::from_secs(4)));
                        let _ = done.try_send(());
                        continue;
                    }
                    if !online.load(Ordering::Relaxed) {
                        continue;
                    }
                    match report {
                        Report::Error(report) => {
                            client.capture_event(event_from_report(report, username.clone()), None);
                        }
                        Report::Update(report) => {
                            client.capture_metric(
                                report.metric(username.clone()),
                                &sentry::Scope::default(),
                            );
                            client.flush(Some(Duration::from_secs(4)));
                        }
                        Report::Flush(_) => unreachable!(),
                    }
                }
            });
        if started.is_ok() {
            service.sender = Some(sender);
        }
        if service.sender.is_some() {
            let panic_service = service.clone();
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                // Never wait for telemetry during a panic; preserve the normal panic hook.
                panic_service.report(ErrorReport {
                    message: info.to_string(),
                    source: "rust.panic".into(),
                    ..Default::default()
                });
                previous(info);
            }));
        }
        service
    }

    fn report(&self, mut report: ErrorReport) {
        if !self.online.load(Ordering::Relaxed) {
            return;
        }
        let Some(sender) = &self.sender else {
            return;
        };
        report.message = report.message.chars().take(MAX_TEXT).collect();
        report.stack = report.stack.chars().take(MAX_TEXT).collect();
        report.source = report.source.chars().take(80).collect();
        report.ifc_names = self
            .ifc_names
            .try_lock()
            .map(|names| names.clone())
            .unwrap_or_default();
        let _ = sender.try_send(Report::Error(report));
    }

    pub fn report_update(&self, report: crate::update_telemetry::UpdateReport) {
        if self.online.load(Ordering::Relaxed) {
            if let Some(sender) = &self.sender {
                let _ = sender.try_send(Report::Update(report));
            }
        }
    }

    /// Called only by the updater's native exit hook, never by ordinary app exit.
    pub fn flush_before_update_exit(&self) {
        let Some(sender) = &self.sender else { return };
        let (done, receiver) = mpsc::sync_channel(1);
        if sender.try_send(Report::Flush(done)).is_ok() {
            let _ = receiver.recv_timeout(Duration::from_secs(5));
        }
    }
}

#[tauri::command]
pub async fn telemetry_context(
    state: tauri::State<'_, Telemetry>,
    app: tauri::AppHandle,
    online: bool,
    ifc_names: Vec<String>,
) -> Result<(), ()> {
    state.online.store(online, Ordering::Relaxed);
    if let Ok(mut names) = state.ifc_names.lock() {
        *names = ifc_names
            .into_iter()
            .take(32)
            .map(|name| file_name(&name))
            .collect();
    }
    if online && !state.update_checked.swap(true, Ordering::Relaxed) {
        let telemetry = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Some(report) = crate::update_telemetry::take_completed(&app) {
                telemetry.report_update(report);
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn telemetry_error(
    state: tauri::State<'_, Telemetry>,
    report: ErrorReport,
) -> Result<(), ()> {
    state.report(report);
    Ok(())
}

fn file_name(value: &str) -> String {
    value
        .split(['\\', '/'])
        .next_back()
        .unwrap_or("")
        .chars()
        .take(240)
        .collect()
}

fn scrub(value: &str) -> String {
    static URL: OnceLock<Regex> = OnceLock::new();
    static PATH: OnceLock<Regex> = OnceLock::new();
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    static BEARER: OnceLock<Regex> = OnceLock::new();
    static STEP: OnceLock<Regex> = OnceLock::new();
    if value.contains("ISO-10303-21")
        || STEP
            .get_or_init(|| Regex::new(r"#\d+\s*=\s*IFC").unwrap())
            .is_match(value)
    {
        return "[IFC content removed]".into();
    }
    let value: String = value.chars().take(MAX_TEXT).collect();
    let value = URL
        .get_or_init(|| Regex::new(r#"(?i)(?:https?|file)://[^\s<>"']+"#).unwrap())
        .replace_all(&value, "[url]");
    let value = PATH
        .get_or_init(|| Regex::new(r#"(?i)(?:[a-z]:[\\/]|\\\\)[^\r\n<>"']+"#).unwrap())
        .replace_all(&value, "[path]");
    let value = TOKEN.get_or_init(|| Regex::new(r#"(?i)(?:sig|token|password|authorization|secret|api[_-]?key|sas)["']?\s*[:=]\s*(?:Bearer\s+)?["']?[^\s&,;]+"#).unwrap())
        .replace_all(&value, "[credential]");
    BEARER
        .get_or_init(|| Regex::new(r"(?i)Bearer\s+[A-Za-z0-9._~+/\-]+=*").unwrap())
        .replace_all(&value, "[credential]")
        .into_owned()
}

fn event_from_report(report: ErrorReport, username: Option<String>) -> Event<'static> {
    let source = match report.source.as_str() {
        "react" | "javascript" | "unhandledrejection" | "rust.panic" => report.source,
        _ => "application".into(),
    };
    let mut event = Event {
        level: sentry::Level::Error,
        platform: if source == "rust.panic" {
            "native"
        } else {
            "javascript"
        }
        .into(),
        user: Some(User {
            username,
            ..Default::default()
        }),
        exception: vec![Exception {
            ty: source.clone(),
            value: Some(scrub(&report.message)),
            ..Default::default()
        }]
        .into(),
        ..Default::default()
    };
    event.tags.insert("source".into(), source);
    event
        .tags
        .insert("app_version".into(), env!("CARGO_PKG_VERSION").into());
    event
        .extra
        .insert("stack".into(), scrub(&report.stack).into());
    event.extra.insert(
        "open_ifc".into(),
        serde_json::json!(report
            .ifc_names
            .into_iter()
            .take(32)
            .map(|name| scrub(&file_name(&name)))
            .collect::<Vec<_>>()),
    );
    event
}

/// Synchronous only on the dedicated telemetry worker, never called by a UI/IPC thread.
struct WorkerTransport {
    http: reqwest::blocking::Client,
    endpoint: String,
    auth: String,
    online: Arc<AtomicBool>,
    retry_after: Mutex<Option<Instant>>,
}

impl Transport for WorkerTransport {
    fn send_envelope(&self, envelope: Envelope) {
        if !self.online.load(Ordering::Relaxed) {
            return;
        }
        let Ok(mut retry_after) = self.retry_after.lock() else {
            return;
        };
        if retry_after.is_some_and(|until| Instant::now() < until) {
            return;
        }
        let mut body = Vec::new();
        if envelope.to_writer(&mut body).is_err() {
            return;
        }
        let result = self
            .http
            .post(&self.endpoint)
            .header("X-Sentry-Auth", &self.auth)
            .header("Content-Type", "application/x-sentry-envelope")
            .body(body)
            .send();
        match result {
            Ok(response) if response.status().is_success() => {
                *retry_after = None;
            }
            Ok(response) => {
                // Respect server rate limits; other failures also open the circuit.
                let seconds = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(60)
                    .clamp(60, 3_600);
                *retry_after = Some(Instant::now() + Duration::from_secs(seconds));
            }
            Err(_) => {
                *retry_after = Some(Instant::now() + Duration::from_secs(60));
            }
        }
        // Dropped reports are not persisted, retried or shown as application errors.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_urls_tokens_paths_and_ifc_payloads() {
        assert_eq!(
            scrub("Failed https://blob.example/a?sig=SECRET"),
            "Failed [url]"
        );
        assert!(!scrub(r"file C:\Users\person\secret.ifc").contains("person"));
        assert!(!scrub("token=SECRET sig=OTHER").contains("SECRET"));
        assert!(!scrub("Authorization: Bearer SECRET").contains("SECRET"));
        assert!(!scrub(r#"{"token":"SECRET"}"#).contains("SECRET"));
        assert_eq!(
            scrub("Failed parsing #12=IFCWALL('private data')"),
            "[IFC content removed]"
        );
    }
    #[test]
    fn event_has_user_version_and_only_file_names() {
        let event = event_from_report(
            ErrorReport {
                message: "Oops".into(),
                ifc_names: vec![r"C:\private\model.ifc".into()],
                ..Default::default()
            },
            Some("pc-user".into()),
        );
        assert_eq!(event.user.unwrap().username.as_deref(), Some("pc-user"));
        assert_eq!(event.tags["app_version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(event.extra["open_ifc"], serde_json::json!(["model.ifc"]));
    }
    #[test]
    fn offline_and_full_queue_never_block() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let state = Telemetry {
            sender: Some(sender),
            online: Arc::new(AtomicBool::new(false)),
            ifc_names: Arc::new(Mutex::new(vec![])),
            update_checked: Arc::new(AtomicBool::new(false)),
        };
        state.report(ErrorReport::default());
        assert!(receiver.try_recv().is_err());
        state.online.store(true, Ordering::Relaxed);
        state.report(ErrorReport::default());
        state.report(ErrorReport::default());
        assert!(receiver.try_recv().is_ok());
        assert!(receiver.try_recv().is_err());
    }
    #[test]
    fn updates_use_metric_envelopes_with_user_and_versions_not_error_events() {
        #[derive(Clone)]
        struct Capture(Arc<Mutex<Vec<Envelope>>>);
        impl Transport for Capture {
            fn send_envelope(&self, envelope: Envelope) {
                self.0.lock().unwrap().push(envelope);
            }
        }
        let envelopes = Arc::new(Mutex::new(Vec::new()));
        let transport = Arc::new(Capture(envelopes.clone()));
        let mut options = ClientOptions::default();
        options.dsn = Some("https://public@example.test/1".parse().unwrap());
        options.default_integrations = false;
        options.send_default_pii = false;
        options.transport = Some(Arc::new(transport));
        let client = Client::from(options);
        for status in ["install_started", "completed", "install_failed"] {
            let report = crate::update_telemetry::UpdateReport::new(
                "1.4.14".into(),
                "1.4.15".into(),
                status,
            );
            client.capture_metric(
                report.metric(Some("pc-user".into())),
                &sentry::Scope::default(),
            );
        }
        assert!(client.flush(Some(Duration::from_secs(1))));
        let envelopes = envelopes.lock().unwrap();
        assert_eq!(envelopes.len(), 1);
        let mut bytes = Vec::new();
        envelopes[0].to_writer(&mut bytes).unwrap();
        let body = String::from_utf8(bytes).unwrap();
        let lines: Vec<_> = body.lines().collect();
        let header: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(header["type"], "trace_metric");
        let payload: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
        let items = payload["items"].as_array().unwrap();
        assert_eq!(items.len(), 3);
        for (item, status) in items
            .iter()
            .zip(["install_started", "completed", "install_failed"])
        {
            assert_eq!(item["name"], "editor.update");
            assert_eq!(item["value"], 1.0);
            assert_eq!(item["attributes"]["update.status"]["value"], status);
            assert_eq!(item["attributes"]["update.from_version"]["value"], "1.4.14");
            assert_eq!(item["attributes"]["update.to_version"]["value"], "1.4.15");
            assert_eq!(item["attributes"]["user.username"]["value"], "pc-user");
        }
        assert!(!body.contains("exception"));
        assert!(!body.contains("open_ifc"));
    }

    #[test]
    fn update_metrics_respect_offline_and_queue_limits() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let state = Telemetry {
            sender: Some(sender),
            online: Arc::new(AtomicBool::new(false)),
            ifc_names: Arc::new(Mutex::new(vec![])),
            update_checked: Arc::new(AtomicBool::new(false)),
        };
        let report =
            crate::update_telemetry::UpdateReport::new("1".into(), "2".into(), "completed");
        state.report_update(report.clone());
        assert!(receiver.try_recv().is_err());
        state.online.store(true, Ordering::Relaxed);
        state.report_update(report.clone());
        state.report_update(report);
        assert!(matches!(receiver.try_recv(), Ok(Report::Update(_))));
        assert!(receiver.try_recv().is_err());
    }
    #[test]
    fn failed_transport_opens_circuit_and_offline_never_connects() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let transport = WorkerTransport {
            http: reqwest::blocking::Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(200))
                .build()
                .unwrap(),
            endpoint: format!("http://{address}/envelope"),
            auth: "test".into(),
            online: Arc::new(AtomicBool::new(false)),
            retry_after: Mutex::new(None),
        };
        transport.send_envelope(Envelope::new());
        assert!(listener.accept().is_err());
        drop(listener);
        transport.online.store(true, Ordering::Relaxed);
        transport.send_envelope(Envelope::new());
        let retry = *transport.retry_after.lock().unwrap();
        assert!(retry.is_some_and(|until| until > Instant::now()));
        transport.send_envelope(Envelope::new());
        assert_eq!(*transport.retry_after.lock().unwrap(), retry);
    }
}
