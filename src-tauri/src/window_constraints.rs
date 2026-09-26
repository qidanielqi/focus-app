use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(windows)]
use tauri::Manager;

static MINIMUM_WIDTH: AtomicU32 = AtomicU32::new(420);

#[cfg(windows)]
fn revalidate_restored_width(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.is_minimized().map_err(|e| e.to_string())? || window.is_maximized().map_err(|e| e.to_string())? || window.is_fullscreen().map_err(|e| e.to_string())? { return Ok(()); }
    let minimum = MINIMUM_WIDTH.load(Ordering::Relaxed) as f64;
    let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    if size.width < minimum {
        window.set_size(tauri::LogicalSize::new(minimum, size.height)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
unsafe extern "system" fn minimum_size_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    _data: usize,
) -> isize {
    use windows_sys::Win32::{Foundation::RECT, UI::{HiDpi::GetDpiForWindow, Shell::DefSubclassProc, WindowsAndMessaging::{GetClientRect, GetWindowRect, MINMAXINFO, WM_GETMINMAXINFO}}};
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if message == WM_GETMINMAXINFO && lparam != 0 {
        let mut outer: RECT = std::mem::zeroed();
        let mut client: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut outer);
        GetClientRect(hwnd, &mut client);
        let frame = (outer.right - outer.left) - (client.right - client.left);
        let minimum = (MINIMUM_WIDTH.load(Ordering::Relaxed) as f64 * GetDpiForWindow(hwnd) as f64 / 96.0).ceil() as i32;
        (*(lparam as *mut MINMAXINFO)).ptMinTrackSize.x = minimum + frame.max(0);
    }
    result
}

pub fn install(_app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = _app.get_webview_window("main").ok_or("Main window unavailable")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        if unsafe { windows_sys::Win32::UI::Shell::SetWindowSubclass(hwnd.0 as _, Some(minimum_size_proc), 1, 0) } == 0 {
            return Err("Unable to install main window constraints".into());
        }
        let restored_window = window.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
                // Re-read native bounds after restore/Snap/DPI processing completes.
                // Resizing emits another event, which becomes a no-op at the minimum.
                let window = restored_window.clone();
                let dispatcher = window.clone();
                let _ = dispatcher.run_on_main_thread(move || { let _ = revalidate_restored_width(&window); });
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn set_main_minimum_width(window: tauri::WebviewWindow, width: u32) -> Result<(), String> {
    if window.label() != "main" || !matches!(width, 420 | 1040) { return Err("Invalid main window constraint".into()); }
    // Tao's Windows set_min_size calls set_inner_size, which restores a maximized
    // window. WM_GETMINMAXINFO changes only its resize constraint and retains bounds.
    MINIMUM_WIDTH.store(width, Ordering::Relaxed);
    #[cfg(not(windows))]
    window.set_min_size(Some(tauri::LogicalSize::new(width, 300))).map_err(|e| e.to_string())?;
    if !window.is_maximized().map_err(|e| e.to_string())? && !window.is_fullscreen().map_err(|e| e.to_string())? {
        let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
        if size.width < width as f64 {
            window.set_size(tauri::LogicalSize::new(width as f64, size.height)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
