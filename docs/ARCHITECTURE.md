# Oz Architecture

The frontend depends on provider interfaces rather than operating-system or
model implementations directly.

```text
Overlay UI
├── ScreenCaptureProvider
│   ├── WindowsCaptureProvider (version 0.1)
│   └── MacCaptureProvider (future)
├── ModelProvider
    ├── OllamaProvider (version 0.1)
    └── CloudProvider (future)
├── SpeechRecognizer
│   ├── WhisperRecognizer (version 0.2)
│   └── AppleSpeechRecognizer (future option)
└── SpeechSynthesizer
    ├── WindowsSystemSpeech (version 0.2)
    └── LicensedVoiceProvider (future option)
```

## Boundaries

### ModelProvider

Checks model availability and streams answer tokens. The initial implementation
uses Ollama at `127.0.0.1:11434` with `qwen3-vl:8b`. The desktop provider calls
the Rust command layer, which owns the local HTTP request and streams tokens to
React through a Tauri channel. The browser provider exists only for UI preview.

### ScreenCaptureProvider

Returns an in-memory PNG and capture metadata. The Windows implementation uses
XCap to capture the display containing the mouse pointer, falls back to the
primary display, encodes the result in memory, and never writes it to disk. Oz
hides its own window before the frame is taken.

### SpeechRecognizer

Owns microphone discovery, push-to-talk recording, model setup, and local
transcription. CPAL captures the selected microphone into an in-memory mono
buffer. The native layer resamples it to 16 kHz and passes it to Whisper.cpp
through `whisper-rs`. No recording file is created.

The initial `base.en` model is downloaded only after explicit user approval,
verified against its published SHA-1 checksum, and stored in Oz's app-data
directory. The model is not bundled into the installer.

### SpeechSynthesizer

The initial implementation uses WebView2's speech synthesis support and prefers
an installed local English Windows voice. Spoken responses are off by default.
This boundary can later support appropriately licensed original voices without
changing the assistant flow.

### Desktop shell

Tauri owns the always-on-top window, tray menu, global shortcut, privacy state,
native capture, microphone recording, Whisper inference, and Ollama transport.
React owns the overlay presentation and interaction state.

## Platform strategy

Windows-specific capture stays behind the capture provider. CPAL and
Whisper.cpp are cross-platform, so most of the voice-input implementation can
transfer directly. A later macOS port replaces capture with ScreenCaptureKit
and system speech with an approved macOS implementation while retaining the
React UI, model provider, prompts, transcription model, state machine, and
settings model.
