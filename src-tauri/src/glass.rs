//! Real Windows backdrop blur with arbitrary corner radius.
//!
//! DWM's own acrylic is clipped to ~8px corners. Instead we put Windows.UI.Composition
//! visuals with the host backdrop brush (the same blur the system uses) underneath the
//! transparent webview and clip them to anti-aliased rounded rectangles.
//!
//! Two modes:
//! - `fill`: one pane covering the client area minus a margin (room for a CSS shadow);
//! - `layers`: any number of panes laid out by the frontend (`layout`), animated with
//!   the same duration and easing as the CSS, so glass and content move together.
//!
//! Composition objects belong to the thread that created them, so everything here must
//! run on the main thread (use `AppHandle::run_on_main_thread` from commands).

use crate::GlassRect;
use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::{PhysicalSize, WebviewWindow, WindowEvent};
use windows::Foundation::TimeSpan;
use windows::System::DispatcherQueueController;
use windows::UI::Composition::Desktop::DesktopWindowTarget;
use windows::UI::Composition::{
    CompositionEasingFunction, CompositionRoundedRectangleGeometry, Compositor, ContainerVisual,
    SpriteVisual,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DWMWA_USE_HOSTBACKDROPBRUSH, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    DwmSetWindowAttribute,
};
use windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;
use windows::Win32::System::WinRT::{
    CreateDispatcherQueueController, DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT, DispatcherQueueOptions,
};
use windows::core::{BOOL, HSTRING, Interface, Result};
use windows_numerics::{Vector2, Vector3};

/// Keep in sync with `--glass-duration` / `--glass-ease` in base.css.
const DURATION: Duration = Duration::from_millis(380);
const EASE: (Vector2, Vector2) = (Vector2 { X: 0.32, Y: 0.72 }, Vector2 { X: 0.0, Y: 1.0 });
const POP_DURATION: Duration = Duration::from_millis(220);

struct Pane {
    visual: SpriteVisual,
    geometry: CompositionRoundedRectangleGeometry,
}

struct Surface {
    _target: DesktopWindowTarget,
    root: ContainerVisual,
    scale: f32,
    panes: HashMap<String, Pane>,
    /// Panes playing their exit animation; detached once it is over.
    dying: Vec<(SpriteVisual, Instant)>,
    /// Margin (physical px) for `fill` mode.
    fill_inset: Option<f32>,
}

thread_local! {
    static COMPOSITOR: RefCell<Option<(DispatcherQueueController, Compositor)>> = const { RefCell::new(None) };
    static SURFACES: RefCell<HashMap<String, Surface>> = RefCell::new(HashMap::new());
}

fn compositor() -> Result<Compositor> {
    COMPOSITOR.with(|cell| {
        if let Some((_, c)) = cell.borrow().as_ref() {
            return Ok(c.clone());
        }
        let options = DispatcherQueueOptions {
            dwSize: size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_NONE,
        };
        let controller = unsafe { CreateDispatcherQueueController(options)? };
        let compositor = Compositor::new()?;
        *cell.borrow_mut() = Some((controller, compositor.clone()));
        Ok(compositor)
    })
}

fn timespan(d: Duration) -> TimeSpan {
    TimeSpan { Duration: (d.as_micros() * 10) as i64 }
}

struct Animator {
    c: Compositor,
    ease: CompositionEasingFunction,
    duration: TimeSpan,
}

impl Animator {
    fn new(duration: Duration) -> Result<Self> {
        let c = compositor()?;
        let ease = c.CreateCubicBezierEasingFunction(EASE.0, EASE.1)?.cast()?;
        Ok(Self { c, ease, duration: timespan(duration) })
    }

    fn vec2(&self, target: &impl Interface, prop: &str, to: Vector2) -> Result<()> {
        let a = self.c.CreateVector2KeyFrameAnimation()?;
        a.InsertKeyFrameWithEasingFunction(1.0, to, &self.ease)?;
        a.SetDuration(self.duration)?;
        start(target, prop, &a.cast()?)
    }

    fn vec3(&self, target: &impl Interface, prop: &str, to: Vector3) -> Result<()> {
        let a = self.c.CreateVector3KeyFrameAnimation()?;
        a.InsertKeyFrameWithEasingFunction(1.0, to, &self.ease)?;
        a.SetDuration(self.duration)?;
        start(target, prop, &a.cast()?)
    }

    fn scalar(&self, target: &impl Interface, prop: &str, to: f32) -> Result<()> {
        let a = self.c.CreateScalarKeyFrameAnimation()?;
        a.InsertKeyFrameWithEasingFunction(1.0, to, &self.ease)?;
        a.SetDuration(self.duration)?;
        start(target, prop, &a.cast()?)
    }
}

fn start(
    target: &impl Interface,
    prop: &str,
    animation: &windows::UI::Composition::CompositionAnimation,
) -> Result<()> {
    let object: windows::UI::Composition::CompositionObject = target.cast()?;
    object.StartAnimation(&HSTRING::from(prop), animation)
}

fn new_pane(c: &Compositor, radius: f32) -> Result<Pane> {
    let visual = c.CreateSpriteVisual()?;
    visual.SetBrush(&c.CreateHostBackdropBrush()?)?;
    let geometry = c.CreateRoundedRectangleGeometry()?;
    geometry.SetCornerRadius(Vector2 { X: radius, Y: radius })?;
    visual.SetClip(&c.CreateGeometricClipWithGeometry(&geometry)?)?;
    Ok(Pane { visual, geometry })
}

fn prepare_window(window: &WebviewWindow) -> Result<(HWND, f32)> {
    let hwnd = HWND(window.hwnd().map_err(|_| windows::core::Error::empty())?.0);
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_HOSTBACKDROPBRUSH,
            &BOOL(1) as *const _ as _,
            size_of::<BOOL>() as u32,
        )?;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &DWMWCP_DONOTROUND as *const _ as _,
            size_of_val(&DWMWCP_DONOTROUND) as u32,
        )?;
    }
    Ok((hwnd, window.scale_factor().unwrap_or(1.0) as f32))
}

fn create_surface(window: &WebviewWindow, fill_inset: Option<f32>) -> Result<()> {
    let (hwnd, scale) = prepare_window(window)?;
    let c = compositor()?;
    let interop: ICompositorDesktopInterop = c.cast()?;
    let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
    let root = c.CreateContainerVisual()?;
    root.SetRelativeSizeAdjustment(Vector2 { X: 1.0, Y: 1.0 })?;
    target.SetRoot(&root)?;
    let surface = Surface {
        _target: target,
        root,
        scale,
        panes: HashMap::new(),
        dying: vec![],
        fill_inset: fill_inset.map(|i| i * scale),
    };
    SURFACES.with(|s| s.borrow_mut().insert(window.label().to_string(), surface));
    Ok(())
}

/// One glass pane filling the window minus `inset` (CSS px) on every side.
pub fn attach_fill(window: &WebviewWindow, radius: f64, inset: f64) -> Result<()> {
    create_surface(window, Some(inset as f32))?;
    let label = window.label().to_string();
    SURFACES.with(|s| -> Result<()> {
        let mut surfaces = s.borrow_mut();
        let surface = surfaces.get_mut(&label).unwrap();
        let pane = new_pane(&compositor()?, radius as f32 * surface.scale)?;
        let inset = surface.fill_inset.unwrap();
        pane.visual.SetOffset(Vector3 { X: inset, Y: inset, Z: 0.0 })?;
        surface.root.Children()?.InsertAtTop(&pane.visual)?;
        surface.panes.insert("fill".into(), pane);
        Ok(())
    })?;
    resize_fill(&label, window.inner_size().unwrap_or_default());

    window.on_window_event(move |event| {
        if let WindowEvent::Resized(size) = event {
            resize_fill(&label, *size);
        }
    });
    Ok(())
}

fn resize_fill(label: &str, size: PhysicalSize<u32>) {
    SURFACES.with(|s| {
        let surfaces = s.borrow();
        let Some(surface) = surfaces.get(label) else { return };
        let (Some(inset), Some(pane)) = (surface.fill_inset, surface.panes.get("fill")) else {
            return;
        };
        let w = (size.width as f32 - 2.0 * inset).max(0.0);
        let h = (size.height as f32 - 2.0 * inset).max(0.0);
        let _ = pane.geometry.SetSize(Vector2 { X: w, Y: h });
        let _ = pane.visual.SetSize(Vector2 { X: w, Y: h });
    });
}

/// Panes positioned by the frontend via `layout`.
pub fn attach_layers(window: &WebviewWindow) -> Result<()> {
    create_surface(window, None)
}

/// Scale-and-fade the whole surface in, matching the CSS `pop-in` keyframes.
pub fn pop_in(label: &str) {
    let _ = SURFACES.with(|s| -> Result<()> {
        let surfaces = s.borrow();
        let Some(surface) = surfaces.get(label) else { return Ok(()) };
        // The root is sized relatively, so take the centre from the fill pane.
        let (Some(inset), Some(pane)) = (surface.fill_inset, surface.panes.get("fill")) else {
            return Ok(());
        };
        let size = pane.visual.Size()?;
        surface.root.SetCenterPoint(Vector3 { X: inset + size.X / 2.0, Y: inset + size.Y / 2.0, Z: 0.0 })?;
        surface.root.SetScale(Vector3 { X: 0.96, Y: 0.96, Z: 1.0 })?;
        surface.root.SetOpacity(0.0)?;
        let anim = Animator::new(POP_DURATION)?;
        anim.vec3(&surface.root, "Scale", Vector3 { X: 1.0, Y: 1.0, Z: 1.0 })?;
        anim.scalar(&surface.root, "Opacity", 1.0)
    });
}

/// Moves panes to `rects`: new ones slide in from above, missing ones slide out.
pub fn layout(label: &str, rects: &[GlassRect]) {
    let result = SURFACES.with(|s| -> Result<()> {
        let mut surfaces = s.borrow_mut();
        let Some(surface) = surfaces.get_mut(label) else { return Ok(()) };
        let anim = Animator::new(DURATION)?;
        let scale = surface.scale;
        let children = surface.root.Children()?;

        surface.dying.retain(|(visual, since)| {
            let done = since.elapsed() > DURATION;
            if done {
                let _ = children.Remove(visual);
            }
            !done
        });

        let gone: Vec<String> =
            surface.panes.keys().filter(|id| !rects.iter().any(|r| &r.id == *id)).cloned().collect();
        for id in gone {
            let pane = surface.panes.remove(&id).unwrap();
            let offset = pane.visual.Offset()?;
            let size = pane.visual.Size()?;
            anim.vec3(&pane.visual, "Offset", Vector3 { X: offset.X, Y: -size.Y - 24.0, Z: 0.0 })?;
            anim.scalar(&pane.visual, "Opacity", 0.0)?;
            surface.dying.push((pane.visual, Instant::now()));
        }

        for r in rects {
            let offset = Vector3 { X: (r.x as f32) * scale, Y: (r.y as f32) * scale, Z: 0.0 };
            let size = Vector2 { X: (r.w as f32) * scale, Y: (r.h as f32) * scale };
            let radius = Vector2 { X: (r.radius as f32) * scale, Y: (r.radius as f32) * scale };
            match surface.panes.get(&r.id) {
                Some(pane) => {
                    anim.vec3(&pane.visual, "Offset", offset)?;
                    anim.vec2(&pane.visual, "Size", size)?;
                    anim.vec2(&pane.geometry, "Size", size)?;
                    anim.vec2(&pane.geometry, "CornerRadius", radius)?;
                }
                None => {
                    let pane = new_pane(&anim.c, radius.X)?;
                    pane.visual.SetSize(size)?;
                    pane.geometry.SetSize(size)?;
                    pane.visual.SetOffset(Vector3 { X: offset.X, Y: -size.Y - 24.0, Z: 0.0 })?;
                    pane.visual.SetOpacity(0.0)?;
                    children.InsertAtTop(&pane.visual)?;
                    anim.vec3(&pane.visual, "Offset", offset)?;
                    anim.scalar(&pane.visual, "Opacity", 1.0)?;
                    surface.panes.insert(r.id.clone(), pane);
                }
            }
        }
        Ok(())
    });
    if let Err(e) = result {
        eprintln!("glass layout failed: {e}");
    }
}
