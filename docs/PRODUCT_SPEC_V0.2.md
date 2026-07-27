# Oz Product Specification — Version 0.2

## Product promise

Oz is a private, local-first Windows assistant that can answer a question about
the user’s current screen without requiring a cloud account or continuously
recording the display.

## First successful experience

1. Oz runs in the Windows system tray.
2. The user presses `Ctrl + Shift + Space`.
3. A compact, always-on-top overlay appears.
4. The user types a question or holds the microphone button to speak.
5. Voice input is transcribed locally and automatically submitted.
6. Oz captures one approved screenshot of the active display.
7. Qwen3-VL processes the screenshot and question through Ollama locally.
8. The answer streams into the overlay and can optionally be read aloud.
9. The screenshot and microphone recording are released from memory.

## Included in 0.2

- Windows 11 desktop application
- Global keyboard shortcut
- System tray controls
- Typed questions
- Hold-to-talk microphone input
- Local Whisper `base.en` transcription
- In-app, checksum-verified voice-model setup
- Microphone selection
- Optional Windows system voice for answers
- One-time, on-demand screen capture
- Local Ollama model connection
- Streaming model responses
- Screen context on/off control
- Clear capture and processing indicators
- No accounts, paid APIs, telemetry, or cloud storage
- Maximum 30-second microphone recording

## Explicitly deferred

- Wake phrase and always-listening microphone
- Continuous screen scanning
- Gameplay replay buffer and clipping
- VS Code extension
- Cloud model providers
- macOS support
- Accounts, billing, licensing, and automatic updates
- Celebrity or fictional-character voice imitation

## Voice policy

Future voice features will use only original voices, appropriately licensed
voices, or user-provided voices with verified authorization. Oz will not market
or ship voices designed to imitate a specific celebrity or protected character.

## Privacy defaults

- Capture happens only after an explicit activation.
- Microphone capture happens only while the user holds the voice button.
- Screen context is visibly enabled or disabled.
- A visible indicator is shown during screen or microphone capture.
- Screenshots are not written to disk by default.
- Microphone recordings remain in memory and are discarded after transcription.
- Spoken responses are disabled by default.
- Conversation history is off by default.
- No telemetry is included in the prototype.
- The tray menu provides a master disable control.

## Commercial constraints

Every production dependency, model, font, icon, sound, and voice must have a
recorded license. A public release will also require code signing, signed
updates, a privacy policy, clean-machine testing, accessible onboarding, and
hardware-based model selection.
