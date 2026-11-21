//! macOS specifics Tauri does not cover: the notch, the island window level, window shadows.
//!
//! The glass itself is Tauri's window effects (see `mac_window_config` in lib.rs). AppKit
//! objects are main-thread only; `notch` hops there, the rest is called from it.

use crate::Notch;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
use std::sync::mpsc;
use tauri::{AppHandle, WebviewWindow};

/// Runs `f` on the main thread and waits for its result.
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(MainThreadMarker) -> T + Send + 'static) -> Option<T> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Some(f(mtm));
    }
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("run_on_main_thread runs on the main thread");
        let _ = tx.send(f(mtm));
    })
    .ok()?;
    rx.recv().ok()
}

/// The notch of the main screen (the one with the menu bar), where the islands are shown.
pub fn notch(app: &AppHandle) -> Option<Notch> {
    on_main(app, |mtm| {
        // The notch, `safeAreaInsets` and the auxiliary areas all arrived with macOS 12.
        if !objc2::available!(macos = 12.0) {
            return None;
        }
        let screen = NSScreen::screens(mtm).firstObject()?;
        let height = screen.safeAreaInsets().top;
        if height <= 0.0 {
            return None;
        }
        // The menu bar parts left and right of the notch; what is between them is the notch.
        let width = screen.frame().size.width
            - screen.auxiliaryTopLeftArea().size.width
            - screen.auxiliaryTopRightArea().size.width;
        Some(Notch { width, height })
    })
    .flatten()
}

fn ns_window(window: &WebviewWindow) -> Option<&NSWindow> {
    let ptr = window.ns_window().ok()?;
    // SAFETY: Tauri hands out the window's live NSWindow; it outlives the borrow of `window`.
    unsafe { ptr.cast::<NSWindow>().as_ref() }
}

/// Puts the island window above the menu bar, on every Space and over full-screen apps,
/// and keeps it on screen when the app hides (see `release_focus`). Main thread only.
pub fn raise_popup(window: &WebviewWindow) {
    let Some(w) = ns_window(window) else { return };
    w.setLevel(NSStatusWindowLevel);
    w.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    w.setCanHide(false);
}

/// A transparent window keeps the shadow of its previous size until told to redraw it.
/// Main thread only.
pub fn invalidate_shadow(window: &WebviewWindow) {
    if let Some(w) = ns_window(window) {
        w.invalidateShadow();
    }
}
