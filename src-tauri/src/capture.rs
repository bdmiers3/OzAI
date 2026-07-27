use crate::ScreenContext;

#[cfg(target_os = "windows")]
pub fn capture_active_display() -> Result<ScreenContext, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use chrono::{SecondsFormat, Utc};
    use image::{DynamicImage, ImageFormat};
    use std::io::Cursor;
    use windows::Win32::{
        Foundation::POINT,
        UI::WindowsAndMessaging::GetCursorPos,
    };
    use xcap::Monitor;

    let monitor = {
        let mut point = POINT::default();
        let cursor_monitor = if unsafe { GetCursorPos(&mut point) }.is_ok() {
            Monitor::from_point(point.x, point.y).ok()
        } else {
            None
        };

        match cursor_monitor {
            Some(monitor) => monitor,
            None => Monitor::all()
                .map_err(|error| format!("Oz could not list your displays: {error}"))?
                .into_iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .ok_or_else(|| "Oz could not find a display to capture.".to_string())?,
        }
    };

    let display_label = monitor
        .friendly_name()
        .unwrap_or_else(|_| "Active display".to_string());
    let image = monitor
        .capture_image()
        .map_err(|error| format!("Oz could not capture {display_label}: {error}"))?;

    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| format!("Oz could not prepare the screenshot: {error}"))?;

    Ok(ScreenContext {
        base64_png: STANDARD.encode(png.into_inner()),
        captured_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        display_label,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn capture_active_display() -> Result<ScreenContext, String> {
    Err("Screen capture is currently available only in the Windows build.".to_string())
}
