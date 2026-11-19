use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub hotkey: String,
    /// `null` means "detect from Obsidian's own settings".
    pub vault_path: Option<PathBuf>,
    pub inbox_folder: String,
    /// Minutes before the event when a heads-up popup is shown.
    pub default_offsets: Vec<u32>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "Ctrl+Alt+N".into(),
            vault_path: None,
            inbox_folder: "Входящие".into(),
            default_offsets: vec![60, 30, 5],
        }
    }
}

/// Reads the config, writing the defaults first if the file does not exist yet.
pub fn load_or_create(path: &Path) -> Config {
    if let Ok(raw) = fs::read_to_string(path) {
        // Notepad may save with a BOM, which serde_json rejects.
        return serde_json::from_str(raw.trim_start_matches('\u{feff}')).unwrap_or_else(|e| {
            eprintln!("config.json is invalid, using defaults: {e}");
            Config::default()
        });
    }
    let config = Config::default();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(path, serde_json::to_string_pretty(&config).unwrap());
    config
}

#[derive(Deserialize)]
struct ObsidianVault {
    path: PathBuf,
    #[serde(default)]
    ts: u64,
    #[serde(default)]
    open: bool,
}

#[derive(Deserialize)]
struct ObsidianConfig {
    vaults: std::collections::HashMap<String, ObsidianVault>,
}

/// Picks the vault Obsidian has open, otherwise the most recently used one.
pub fn detect_vault() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let raw = fs::read_to_string(Path::new(&appdata).join("obsidian").join("obsidian.json")).ok()?;
    let parsed: ObsidianConfig = serde_json::from_str(&raw).ok()?;
    parsed
        .vaults
        .into_values()
        .filter(|v| v.path.is_dir())
        .max_by_key(|v| (v.open, v.ts))
        .map(|v| v.path)
}
