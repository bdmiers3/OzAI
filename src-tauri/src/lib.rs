mod capture;
mod ollama;
mod voice;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle,
    ipc::Channel,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenContext {
    base64_png: String,
    captured_at: String,
    display_label: String,
}

struct PrivacyState {
    screen_context_enabled: AtomicBool,
}

#[tauri::command]
async fn capture_active_display(
    window: WebviewWindow,
    privacy: State<'_, PrivacyState>,
) -> Result<ScreenContext, String> {
    if !privacy.screen_context_enabled.load(Ordering::Relaxed) {
        return Err("Screen context is disabled. Turn it on before asking Oz to look.".to_string());
    }

    window
        .hide()
        .map_err(|error| format!("Oz could not hide its overlay before capture: {error}"))?;

    let capture_result = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(160));
        capture::capture_active_display()
    })
    .await;

    let _ = window.show();
    let _ = window.set_focus();

    capture_result
        .map_err(|error| format!("The screen capture task stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn get_ollama_status(model: String) -> ollama::ModelStatus {
    ollama::get_status(model).await
}

#[tauri::command]
async fn ask_ollama(
    request: ollama::AskRequest,
    on_token: Channel<String>,
) -> Result<(), String> {
    ollama::stream_answer(request, on_token).await
}

#[tauri::command]
fn get_voice_status(app: AppHandle) -> voice::VoiceStatus {
    voice::get_status(&app)
}

#[tauri::command]
async fn download_voice_model(
    app: AppHandle,
    on_progress: Channel<voice::VoiceDownloadProgress>,
) -> Result<voice::VoiceStatus, String> {
    voice::download_model(app, on_progress).await
}

#[tauri::command]
fn list_microphones() -> Result<Vec<voice::MicrophoneDevice>, String> {
    voice::list_microphones()
}

#[tauri::command]
fn start_voice_recording(
    device_id: Option<String>,
    voice_state: State<'_, voice::VoiceState>,
) -> Result<(), String> {
    voice::start_recording(device_id, &voice_state)
}

#[tauri::command]
async fn stop_and_transcribe_voice(
    app: AppHandle,
    voice_state: State<'_, voice::VoiceState>,
) -> Result<String, String> {
    voice::stop_and_transcribe(app, &voice_state).await
}

#[tauri::command]
fn get_screen_context_enabled(privacy: State<'_, PrivacyState>) -> bool {
    privacy.screen_context_enabled.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_screen_context_enabled(enabled: bool, privacy: State<'_, PrivacyState>) -> bool {
    privacy
        .screen_context_enabled
        .store(enabled, Ordering::Relaxed);
    enabled
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(PrivacyState {
            screen_context_enabled: AtomicBool::new(true),
        })
        .manage(voice::VoiceState::default())
        .invoke_handler(tauri::generate_handler![
            capture_active_display,
            get_ollama_status,
            ask_ollama,
            get_voice_status,
            download_voice_model,
            list_microphones,
            start_voice_recording,
            stop_and_transcribe_voice,
            get_screen_context_enabled,
            set_screen_context_enabled
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Oz", true, None::<&str>)?;
            let disable =
                MenuItem::with_id(app, "disable", "Toggle screen context", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Oz", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &disable, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("app icon missing").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "disable" => {
                        let privacy = app.state::<PrivacyState>();
                        let enabled =
                            !privacy.screen_context_enabled.load(Ordering::Relaxed);
                        privacy
                            .screen_context_enabled
                            .store(enabled, Ordering::Relaxed);
                        let _ = app.emit("screen-context-enabled", enabled);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::Space,
            );
            app.global_shortcut().on_shortcut(shortcut, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let visible = window.is_visible().unwrap_or(false);
                        if visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Oz");
}
