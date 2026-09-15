use std::{env, fs, path::PathBuf};

fn main() {
    const TOKEN_KEY: &str = "IFCNATIVE_UPDATE_SAS_TOKEN";
    let env_file = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../.env");
    println!("cargo:rerun-if-changed={}", env_file.display());
    println!("cargo:rerun-if-env-changed={TOKEN_KEY}");

    // Keep secrets out of cargo:rustc-env output and tracked source files.
    // Process environment takes precedence for builds outside this workstation.
    let token = match env::var(TOKEN_KEY) {
        Ok(token) => token,
        Err(env::VarError::NotPresent) => {
            let mut token = String::new();
            match dotenvy::from_path_iter(&env_file) {
                Ok(entries) => {
                    for entry in entries {
                        let (key, value) = entry
                            .unwrap_or_else(|_| panic!("editor/.env konnte nicht gelesen werden."));
                        if key == TOKEN_KEY {
                            token = value;
                        }
                    }
                }
                Err(dotenvy::Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => panic!("editor/.env konnte nicht gelesen werden."),
            }
            token
        }
        Err(_) => panic!("IFCNATIVE_UPDATE_SAS_TOKEN enthält ungültigen Text."),
    };
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    fs::write(out.join("update-sas-token.txt"), token.trim())
        .expect("Update-Token konnte nicht für den Build vorbereitet werden.");
    const SENTRY_KEY: &str = "IFCNATIVE_SENTRY_DSN";
    println!("cargo:rerun-if-env-changed={SENTRY_KEY}");
    let dsn = env::var(SENTRY_KEY).ok().unwrap_or_else(|| {
        dotenvy::from_path_iter(&env_file)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .find(|(key, _)| key == SENTRY_KEY)
            .map(|(_, value)| value)
            .unwrap_or_default()
    });
    fs::write(out.join("sentry-dsn.txt"), dsn.trim())
        .expect("Sentry-Konfiguration konnte nicht für den Build vorbereitet werden.");
    tauri_build::build()
}
