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
    pub popup_seconds: u32,
    pub autostart: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "Ctrl+Alt+N".into(),
            vault_path: None,
            inbox_folder: "Входящие".into(),
            default_offsets: vec![60, 30, 5],
            popup_seconds: 15,
            autostart: true,
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
    let _ = save(path, &config);
    config
}

pub fn save(path: &Path, config: &Config) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(path, serde_json::to_string_pretty(config).unwrap())
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

/// Where Obsidian keeps its list of vaults.
fn obsidian_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let base = PathBuf::from(std::env::var_os("HOME")?).join("Library").join("Application Support");
    #[cfg(not(target_os = "macos"))]
    let base = PathBuf::from(std::env::var_os("APPDATA")?);
    Some(base.join("obsidian").join("obsidian.json"))
}

/// Picks the vault Obsidian has open, otherwise the most recently used one.
pub fn detect_vault() -> Option<PathBuf> {
    let raw = fs::read_to_string(obsidian_config_path()?).ok()?;
    let parsed: ObsidianConfig = serde_json::from_str(&raw).ok()?;
    parsed
        .vaults
        .into_values()
        .filter(|v| v.path.is_dir())
        .max_by_key(|v| (v.open, v.ts))
        .map(|v| v.path)
}

/// The configured vault if it still exists, otherwise the detected one.
pub fn resolve_vault(config: &Config) -> Option<PathBuf> {
    config.vault_path.clone().filter(|p| p.is_dir()).or_else(detect_vault)
}

pub fn looks_like_vault(path: &Path) -> bool {
    path.join(".obsidian").is_dir()
}
