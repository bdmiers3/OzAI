# Oz

Oz is a local-first, screen-aware desktop assistant. This repository contains
version 0.2: a React overlay, local Ollama/Qwen3-VL integration, one-shot screen
capture, local Whisper push-to-talk, optional Windows system speech, native
Tauri shell configuration, tray privacy controls, and a global shortcut.

## Current checkpoint

- The overlay UI is interactive and can run in browser preview mode.
- The Windows desktop build captures the display containing the mouse pointer.
- Oz hides its own overlay before capture and never saves the screenshot.
- Ollama requests and streamed answers are proxied through the native Rust layer.
- Holding the microphone button records audio in memory and transcribes it
  locally with Whisper `base.en`.
- Releasing the microphone automatically submits the transcription.
- Spoken answers are optional, off by default, and use an installed Windows
  system voice.
- The user can choose a microphone in the **Voice** menu.
- The tray and interface both provide screen-context on/off controls.
- `Ctrl + Shift + Space` hides or reopens Oz.

## Run the interface

```powershell
npm install
npm run dev
```

Open `http://localhost:1420`. This is a UI-only browser preview; native capture
is available only in the desktop app.

## Run as a Windows desktop app

Install the current Windows prerequisites from the Tauri documentation:

- Microsoft C++ Build Tools with “Desktop development with C++”
- “C++ CMake tools for Windows” in the Visual Studio Installer
- WebView2 (included with Windows 11)
- Rust using `rustup`

Then:

```powershell
npm install
npm run tauri dev
```

## Local model

Install Ollama for Windows, then:

```powershell
ollama pull qwen3-vl:8b
```

The Ollama Windows app normally starts its local service automatically. If it is
not running, open Ollama from the Start menu.

## Local voice

The first time the desktop app starts, select **Set up · 142 MB**. Oz downloads
the official Whisper.cpp `base.en` model, verifies its published SHA-1 checksum,
and stores it in Oz's local app-data folder.

No separate Python, cloud speech API, or Whisper installation is required.
Microphone recordings stay in memory and are discarded immediately after local
transcription. The maximum push-to-talk recording is 30 seconds.

## Project map

- `src/` — React overlay and replaceable service interfaces
- `src-tauri/` — native window, tray, shortcut, capture, and Ollama proxy
- `docs/PRODUCT_SPEC_V0.2.md` — current prototype scope
- `docs/ARCHITECTURE.md` — provider boundaries and platform strategy
- `docs/WINDOWS_TEST_CHECKLIST.md` — exact first-run acceptance test

## Test the complete loop

1. Start Ollama and confirm `qwen3-vl:8b` is installed.
2. Run `npm run tauri dev`.
3. Put the mouse pointer on the display you want Oz to inspect.
4. Ask “Summarize what is on my screen.”
5. Oz hides briefly, captures one frame, reappears, and streams the local answer.

To test voice, hold the microphone button, say “Summarize what is on my
screen,” and release it. The browser build does not exercise Rust screen capture
or microphone recording.
