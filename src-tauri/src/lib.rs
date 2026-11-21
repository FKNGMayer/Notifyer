mod config;
#[cfg(windows)]
mod glass;
#[cfg(target_os = "macos")]
mod mac;
mod reminders;
mod vault;

use chrono::{Local, TimeZone};
use config::Config;
use reminders::{Popup, Reminder, Store};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Transparent margin around glass panels, leaves room for the CSS shadow (`--shadow-room`).
/// macOS has no CSS shadow (see `mac_window_config`), so there the window is exactly the panel.
const SHADOW_INSET: f64 = if cfg!(target_os = "macos") { 0.0 } else { 40.0 };
const QUICK_WIDTH: f64 = 640.0 + 2.0 * SHADOW_INSET;
/// Wide enough for the longest expanded island plus its shadow.
const POPUP_WIDTH: f64 = 760.0;
const SETTINGS_WIDTH: f64 = 560.0 + 2.0 * SHADOW_INSET;
const PANEL_RADIUS: f64 = 20.0;

struct AppState {
    config_path: PathBuf,
    config: Mutex<Config>,
    vault: Mutex<Option<PathBuf>>,
    store: Mutex<Store>,
    pending: Mutex<Vec<Popup>>,
    /// Island rectangles of the popup window, used for click-through hit testing.
    popup_rects: Mutex<Vec<GlassRect>>,
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

fn window(app: &AppHandle, label: &str) -> WebviewWindow {
    app.get_webview_window(label).expect("window is declared in tauri.conf.json")
}

#[cfg(windows)]
fn on_main(app: &AppHandle, f: impl FnOnce() + Send + 'static) {
    let _ = app.run_on_main_thread(f);
}

/// Activates the window and hands keyboard focus to its webview. Activation alone is not
/// enough when another process owned the foreground (e.g. a second launch with `--new`).
fn focus(w: &WebviewWindow) {
    let _ = w.set_focus();
    let _ = AsRef::<tauri::Webview>::as_ref(w).set_focus();
}

// ---------- quick window ----------

fn show_quick(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let w = window(app, "quick");
    if let Ok(Some(monitor)) = w.current_monitor().or_else(|_| w.primary_monitor()) {
        let area = monitor.work_area();
        let width = (QUICK_WIDTH * monitor.scale_factor()) as i32;
        let x = area.position.x + (area.size.width as i32 - width) / 2;
        let y = area.position.y + (area.size.height as f64 * 0.24) as i32;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    #[cfg(windows)]
    on_main(app, || glass::pop_in("quick"));
    let _ = w.show();
    focus(&w);
    let _ = w.emit_to("quick", "quick-shown", ());
}

fn toggle_quick(app: &AppHandle) {
    let w = window(app, "quick");
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        hide_panel(app, "quick");
    } else {
        show_quick(app);
    }
}

#[tauri::command]
fn hide_quick(app: AppHandle) {
    hide_panel(&app, "quick");
}

#[tauri::command]
fn quick_resize(app: AppHandle, height: f64) {
    resize_panel(&app, "quick", LogicalSize::new(QUICK_WIDTH, height));
}

fn resize_panel(app: &AppHandle, label: &str, size: LogicalSize<f64>) {
    let _ = window(app, label).set_size(size);
}

/// Hides the quick or settings window. On macOS the app hides too once neither is left:
/// that is what hands the keyboard back to the app the user came from.
fn hide_panel(app: &AppHandle, label: &str) {
    let _ = window(app, label).hide();
    release_focus(app.clone());
}

/// Also called after the user clicks an island, which activates the app on macOS.
#[tauri::command]
fn release_focus(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let visible = |label| window(&app, label).is_visible().unwrap_or(false);
        if !visible("quick") && !visible("settings") {
            // The island window stays: it is marked `canHide = false` in `mac::raise_popup`.
            let _ = app.hide();
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

// ---------- settings ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    hotkey: String,
    vault_path: Option<String>,
    vault_name: Option<String>,
    vault_auto: bool,
    vault_valid: bool,
    inbox_folder: String,
    default_offsets: Vec<u32>,
    popup_seconds: u32,
    autostart: bool,
}

fn settings_view(state: &AppState) -> SettingsView {
    let config = state.config.lock().unwrap();
    let vault = state.vault.lock().unwrap();
    SettingsView {
        hotkey: config.hotkey.clone(),
        vault_path: vault.as_ref().map(|p| p.to_string_lossy().into_owned()),
        vault_name: vault
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned()),
        vault_auto: config.vault_path.is_none(),
        vault_valid: vault.as_deref().is_some_and(config::looks_like_vault),
        inbox_folder: config.inbox_folder.clone(),
        default_offsets: config.default_offsets.clone(),
        popup_seconds: config.popup_seconds,
        autostart: config.autostart,
    }
}

/// Applies a change, persists it and tells every window.
fn update_config(app: &AppHandle, change: impl FnOnce(&mut Config)) -> Result<SettingsView, String> {
    let state = app.state::<AppState>();
    {
        let mut config = state.config.lock().unwrap();
        change(&mut config);
        config::save(&state.config_path, &config).map_err(|e| format!("Не удалось сохранить: {e}"))?;
        *state.vault.lock().unwrap() = config::resolve_vault(&config);
    }
    let _ = app.emit("settings-changed", ());
    Ok(settings_view(&state))
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> SettingsView {
    settings_view(&state)
}

#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<SettingsView, String> {
    let shortcuts = app.global_shortcut();
    let old = app.state::<AppState>().config.lock().unwrap().hotkey.clone();
    let _ = shortcuts.unregister_all();
    if let Err(e) = shortcuts.register(hotkey.as_str()) {
        let _ = shortcuts.register(old.as_str());
        return Err(format!("Сочетание {hotkey} занято или недопустимо ({e})"));
    }
    update_config(&app, |c| c.hotkey = hotkey)
}

/// Releases the global hotkey while the settings window records a new one.
#[tauri::command]
fn hotkey_recording(app: AppHandle, active: bool) {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    if !active {
        let hotkey = app.state::<AppState>().config.lock().unwrap().hotkey.clone();
        let _ = shortcuts.register(hotkey.as_str());
    }
}

#[tauri::command]
fn set_vault(app: AppHandle, path: Option<String>) -> Result<SettingsView, String> {
    let path = path.map(PathBuf::from);
    if path.as_ref().is_some_and(|p| !p.is_dir()) {
        return Err("Папка не найдена".into());
    }
    update_config(&app, |c| c.vault_path = path)
}

#[tauri::command]
fn set_inbox_folder(app: AppHandle, folder: String) -> Result<SettingsView, String> {
    let folder = folder.trim().trim_matches(['/', '\\']).to_string();
    if folder.is_empty() || folder.contains("..") {
        return Err("Некорректное имя папки".into());
    }
    update_config(&app, |c| c.inbox_folder = folder)
}

#[tauri::command]
fn set_default_offsets(app: AppHandle, mut offsets: Vec<u32>) -> Result<SettingsView, String> {
    offsets.retain(|m| *m > 0);
    offsets.sort_unstable_by(|a, b| b.cmp(a));
    offsets.dedup();
    update_config(&app, |c| c.default_offsets = offsets)
}

#[tauri::command]
fn set_popup_seconds(app: AppHandle, seconds: u32) -> Result<SettingsView, String> {
    update_config(&app, |c| c.popup_seconds = seconds.clamp(3, 600))
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<SettingsView, String> {
    apply_autostart(&app, enabled)?;
    update_config(&app, |c| c.autostart = enabled)
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    // Dev builds would register the debug binary; only the installed app touches the registry.
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let autostart = app.autolaunch();
    if autostart.is_enabled().unwrap_or(false) == enabled {
        return Ok(());
    }
    let result = if enabled { autostart.enable() } else { autostart.disable() };
    result.map_err(|e| format!("Не удалось изменить автозапуск: {e}"))
}

fn show_settings(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let _ = window(app, "quick").hide();
    let w = window(app, "settings");
    let _ = w.center();
    let _ = w.show();
    let _ = w.unminimize();
    focus(&w);
    let _ = w.emit_to("settings", "settings-shown", ());
    #[cfg(windows)]
    on_main(app, || glass::pop_in("settings"));
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

/// Keeps the settings window exactly as tall as its content.
#[tauri::command]
fn settings_resize(app: AppHandle, height: f64) {
    resize_panel(&app, "settings", LogicalSize::new(SETTINGS_WIDTH, height));
}

#[tauri::command]
fn hide_settings(app: AppHandle) {
    hide_panel(&app, "settings");
}

// ---------- notes & reminders ----------

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
        .lock()
        .unwrap()
        .clone()
        .ok_or("Хранилище Obsidian не найдено — выберите его в настройках")?;
    let folder = state.config.lock().unwrap().inbox_folder.clone();
    let due_local = due.and_then(|ms| Local.timestamp_millis_opt(ms).single());
    vault::append_entry(&vault, &folder, Local::now(), &text, due_local)
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

// ---------- popup ----------

#[tauri::command]
fn popup_take_pending(state: tauri::State<AppState>) -> Vec<Popup> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

/// Sizes the popup to its islands and pins it to the top centre (on macOS over the menu bar,
/// so the first island can grow out of the notch).
///
/// The popup window is shown once at startup and never hidden: showing a window activates
/// it, which would steal focus from the quick window mid-sentence. With no islands it is
/// one pixel tall and lets every click through.
#[tauri::command]
fn popup_layout(app: AppHandle, height: f64) {
    place_popup(&window(&app, "popup"), height.max(1.0));
}

fn place_popup(w: &WebviewWindow, height: f64) {
    let _ = w.set_size(LogicalSize::new(POPUP_WIDTH, height));
    if let Ok(Some(monitor)) = w.primary_monitor() {
        #[cfg(target_os = "macos")]
        let (origin, size) = (*monitor.position(), *monitor.size());
        #[cfg(not(target_os = "macos"))]
        let (origin, size) = (monitor.work_area().position, monitor.work_area().size);
        let width = (POPUP_WIDTH * monitor.scale_factor()) as i32;
        let x = origin.x + (size.width as i32 - width) / 2;
        let _ = w.set_position(PhysicalPosition::new(x, origin.y));
    }
}

/// The camera notch of the screen the islands are on, in CSS px.
#[derive(Serialize, Clone, Copy, Debug)]
pub struct Notch {
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
fn popup_notch(app: AppHandle) -> Option<Notch> {
    #[cfg(target_os = "macos")]
    return mac::notch(&app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

/// A glass pane in CSS pixels relative to the window's client area.
#[derive(Deserialize, Clone, Debug)]
pub struct GlassRect {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub radius: f64,
}

#[tauri::command]
fn glass_layout(app: AppHandle, window: WebviewWindow, rects: Vec<GlassRect>) {
    let label = window.label().to_string();
    if label == "popup" {
        *app.state::<AppState>().popup_rects.lock().unwrap() = rects.clone();
    }
    #[cfg(windows)]
    on_main(&app, move || glass::layout(&label, &rects));
}

/// The popup window is wide and transparent; only its islands should catch the mouse.
///
/// On macOS it also reports which island is under the cursor (`popup-hover`): the island
/// window never becomes key, and WKWebView gets no mouse moves in a window that is not.
fn spawn_popup_hit_testing(app: AppHandle) {
    std::thread::spawn(move || {
        let mut passthrough = true;
        let mut hovered: Option<String> = None;
        let mut report = |island: Option<String>| {
            if cfg!(target_os = "macos") && island != hovered {
                let _ = app.emit_to("popup", "popup-hover", &island);
            }
            hovered = island;
        };
        loop {
            let popup = window(&app, "popup");
            if app.state::<AppState>().popup_rects.lock().unwrap().is_empty() {
                if !passthrough {
                    passthrough = true;
                    let _ = popup.set_ignore_cursor_events(true);
                }
                report(None);
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }
            if let (Ok(cursor), Ok(origin), Ok(scale)) =
                (popup.cursor_position(), popup.inner_position(), popup.scale_factor())
            {
                let x = (cursor.x - origin.x as f64) / scale;
                let y = (cursor.y - origin.y as f64) / scale;
                let island = app
                    .state::<AppState>()
                    .popup_rects
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|r| x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
                    .map(|r| r.id.clone());
                let over_island = island.is_some();
                report(island);
                if over_island == passthrough {
                    passthrough = !over_island;
                    let _ = popup.set_ignore_cursor_events(passthrough);
                }
            }
            std::thread::sleep(Duration::from_millis(30));
        }
    });
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

// ---------- shell ----------

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let new_note = MenuItem::with_id(app, "new", "Новая заметка", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&new_note, &settings, &separator, &quit])?;

    // macOS: a monochrome template icon tinted by the menu bar, and the menu on click as usual there.
    #[cfg(target_os = "macos")]
    let tray = TrayIconBuilder::with_id("main")
        .icon(tauri::include_image!("icons/tray-template.png"))
        .icon_as_template(true)
        .show_menu_on_left_click(true);
    #[cfg(not(target_os = "macos"))]
    let tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .show_menu_on_left_click(false);

    tray.tooltip("Notifyer")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new" => show_quick(app),
            "settings" => show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "macos") {
                return;
            }
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

/// macOS draws the glass natively; Liquid Glass brings its own rim. No window shadow: for a
/// frameless window macOS outlines the rectangular frame, not the rounded glass. The island
/// window is never key, so it has to take the first click itself instead of spending it on
/// activation.
#[cfg(target_os = "macos")]
fn mac_window_config(mut config: tauri::utils::config::WindowConfig) -> tauri::utils::config::WindowConfig {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::{Effect, EffectState};
    if config.label == "popup" {
        config.accept_first_mouse = true;
        return config;
    }
    config.window_effects = Some(WindowEffectsConfig {
        // Liquid Glass on macOS 26+, the HUD material before it.
        effects: vec![Effect::LiquidGlassRegular, Effect::HudWindow],
        state: Some(EffectState::Active),
        radius: Some(PANEL_RADIUS),
        color: None,
        interactive: false,
    });
    config
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch is a remote control (scripts, Stream Deck):
        //   (no args)        open the quick window
        //   --new "text"     open it prefilled
        //   --add "text"     save right away, dates and reminders included, without any window
        //   --settings       open the settings
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let value_of = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
            if args.iter().any(|a| a == "--settings") {
                show_settings(app);
            } else if let Some(text) = value_of("--add") {
                let _ = app.emit_to("quick", "quick-add", text);
            } else {
                show_quick(app);
                if let Some(text) = value_of("--new") {
                    let _ = app.emit_to("quick", "quick-prefill", text);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
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
            // A menu bar app: no Dock icon (also `LSUIElement` in Info.plist).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let dir = app.path().app_config_dir()?;
            let config_path = dir.join("config.json");
            let config = config::load_or_create(&config_path);

            if let Err(e) = app.global_shortcut().register(config.hotkey.as_str()) {
                eprintln!("failed to register hotkey {}: {e}", config.hotkey);
            }
            if let Err(e) = apply_autostart(app.handle(), config.autostart) {
                eprintln!("{e}");
            }

            app.manage(AppState {
                vault: Mutex::new(config::resolve_vault(&config)),
                config: Mutex::new(config),
                config_path,
                store: Mutex::new(Store::load(dir.join("reminders.json"))),
                pending: Mutex::new(vec![]),
                popup_rects: Mutex::new(vec![]),
            });

            // Windows are created only now, once the state their commands rely on exists
            // (`"create": false` in tauri.conf.json); otherwise early invokes fail.
            for config in app.config().app.windows.clone() {
                #[cfg(target_os = "macos")]
                let config = mac_window_config(config);
                tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
            }

            let popup = window(app.handle(), "popup");
            #[cfg(target_os = "macos")]
            mac::raise_popup(&popup);
            let _ = popup.set_ignore_cursor_events(true);
            place_popup(&popup, 1.0);
            let _ = popup.show();

            let settings = window(app.handle(), "settings");
            let settings_handle = settings.clone();
            settings.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    hide_panel(settings_handle.app_handle(), "settings");
                }
            });

            #[cfg(windows)]
            {
                let handle = app.handle();
                for (label, result) in [
                    ("quick", glass::attach_fill(&window(handle, "quick"), PANEL_RADIUS, SHADOW_INSET)),
                    ("settings", glass::attach_fill(&settings, PANEL_RADIUS, SHADOW_INSET)),
                    ("popup", glass::attach_layers(&window(handle, "popup"))),
                ] {
                    if let Err(e) = result {
                        eprintln!("glass unavailable for {label}: {e}");
                    }
                }
            }
            spawn_popup_hit_testing(app.handle().clone());

            setup_tray(app.handle())?;
            spawn_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_hotkey,
            hotkey_recording,
            set_vault,
            set_inbox_folder,
            set_default_offsets,
            set_popup_seconds,
            set_autostart,
            open_settings,
            hide_settings,
            settings_resize,
            save_entry,
            list_reminders,
            delete_reminder,
            snooze,
            hide_quick,
            quick_resize,
            popup_take_pending,
            popup_layout,
            popup_notch,
            release_focus,
            glass_layout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
