mod config;
mod reminders;
mod vault;

use chrono::{Local, TimeZone};
use config::Config;
use reminders::{Popup, Reminder, Store};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const QUICK_WIDTH: f64 = 640.0;
const POPUP_WIDTH: f64 = 380.0;
const POPUP_MARGIN: i32 = 16;

struct AppState {
    config: Config,
    config_path: PathBuf,
    vault: Option<PathBuf>,
    store: Mutex<Store>,
    pending: Mutex<Vec<Popup>>,
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

fn window(app: &AppHandle, label: &str) -> WebviewWindow {
    app.get_webview_window(label).expect("window is declared in tauri.conf.json")
}

fn show_quick(app: &AppHandle) {
    let w = window(app, "quick");
    if let Ok(Some(monitor)) = w.current_monitor().or_else(|_| w.primary_monitor()) {
        let area = monitor.work_area();
        let width = (QUICK_WIDTH * monitor.scale_factor()) as i32;
        let x = area.position.x + (area.size.width as i32 - width) / 2;
        let y = area.position.y + (area.size.height as f64 * 0.26) as i32;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit_to("quick", "quick-shown", ());
}

fn toggle_quick(app: &AppHandle) {
    let w = window(app, "quick");
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.hide();
    } else {
        show_quick(app);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    default_offsets: Vec<u32>,
    vault_name: Option<String>,
    inbox_folder: String,
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    Settings {
        default_offsets: state.config.default_offsets.clone(),
        vault_name: state
            .vault
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned()),
        inbox_folder: state.config.inbox_folder.clone(),
    }
}

#[tauri::command]
fn save_entry(
    state: tauri::State<AppState>,
    text: String,
    due: Option<i64>,
    offsets: Vec<u32>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Пустая заметка".into());
    }
    let vault = state
        .vault
        .as_ref()
        .ok_or("Хранилище Obsidian не найдено — укажите vaultPath в конфиге")?;
    let due_local = due.and_then(|ms| Local.timestamp_millis_opt(ms).single());
    vault::append_entry(vault, &state.config.inbox_folder, Local::now(), &text, due_local)
        .map_err(|e| format!("Не удалось записать в хранилище: {e}"))?;
    if let Some(due) = due {
        state.store.lock().unwrap().add(text, due, offsets, now_ms());
    }
    Ok(())
}

#[tauri::command]
fn list_reminders(state: tauri::State<AppState>) -> Vec<Reminder> {
    state.store.lock().unwrap().list()
}

#[tauri::command]
fn delete_reminder(state: tauri::State<AppState>, id: String) {
    state.store.lock().unwrap().remove(&id);
}

#[tauri::command]
fn snooze(app: AppHandle, state: tauri::State<AppState>, text: String, minutes: i64) {
    let due = now_ms() + minutes * 60_000;
    state.store.lock().unwrap().add(text, due, vec![], now_ms());
    let _ = app.emit_to("quick", "reminders-changed", ());
}

#[tauri::command]
fn hide_quick(app: AppHandle) {
    let _ = window(&app, "quick").hide();
}

#[tauri::command]
fn quick_resize(app: AppHandle, height: f64) {
    let _ = window(&app, "quick").set_size(LogicalSize::new(QUICK_WIDTH, height));
}

#[tauri::command]
fn popup_take_pending(state: tauri::State<AppState>) -> Vec<Popup> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

/// Sizes the popup to its cards and pins it to the top-right corner; height 0 hides it.
#[tauri::command]
fn popup_layout(app: AppHandle, height: f64) {
    let w = window(&app, "popup");
    if height <= 0.0 {
        let _ = w.hide();
        return;
    }
    let _ = w.set_size(LogicalSize::new(POPUP_WIDTH, height));
    if let Ok(Some(monitor)) = w.primary_monitor() {
        let area = monitor.work_area();
        let width = (POPUP_WIDTH * monitor.scale_factor()) as i32;
        let margin = (POPUP_MARGIN as f64 * monitor.scale_factor()) as i32;
        let x = area.position.x + area.size.width as i32 - width - margin;
        let _ = w.set_position(PhysicalPosition::new(x, area.position.y + margin));
    }
    let _ = w.show();
}

fn open_config_file(app: &AppHandle) {
    let path = app.state::<AppState>().config_path.to_string_lossy().into_owned();
    let _ = app.opener().open_path(path, None::<&str>);
}

#[tauri::command]
fn open_config(app: AppHandle) {
    open_config_file(&app);
}

fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        let state = app.state::<AppState>();
        let popups = state.store.lock().unwrap().tick(now_ms());
        if !popups.is_empty() {
            state.pending.lock().unwrap().extend(popups);
            let _ = app.emit_to("popup", "popup-ping", ());
            let _ = app.emit_to("quick", "reminders-changed", ());
        }
        std::thread::sleep(Duration::from_secs(5));
    });
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let new_note = MenuItem::with_id(app, "new", "Новая заметка", true, None::<&str>)?;
    let open_config = MenuItem::with_id(app, "config", "Открыть конфиг", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&new_note, &open_config, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Notifyer")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new" => show_quick(app),
            "config" => open_config_file(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_quick(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_quick(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let config_path = dir.join("config.json");
            let config = config::load_or_create(&config_path);
            let vault = config.vault_path.clone().or_else(config::detect_vault);

            if let Err(e) = app.global_shortcut().register(config.hotkey.as_str()) {
                eprintln!("failed to register hotkey {}: {e}", config.hotkey);
            }

            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                if !autostart.is_enabled().unwrap_or(false) {
                    let _ = autostart.enable();
                }
            }

            app.manage(AppState {
                config,
                config_path,
                vault,
                store: Mutex::new(Store::load(dir.join("reminders.json"))),
                pending: Mutex::new(vec![]),
            });
            setup_tray(app.handle())?;
            spawn_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_entry,
            list_reminders,
            delete_reminder,
            snooze,
            hide_quick,
            quick_resize,
            popup_take_pending,
            popup_layout,
            open_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
