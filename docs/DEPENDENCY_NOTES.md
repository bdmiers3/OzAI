# Oz Prototype Dependency Notes

This file records the voice-related components introduced in version 0.2. It is
an engineering inventory, not legal advice. Exact licenses must be rechecked
before a public release.

| Component | Purpose | License noted upstream |
|---|---|---|
| CPAL | Cross-platform microphone capture | Apache-2.0 |
| whisper-rs | Rust bindings for Whisper.cpp | Unlicense |
| Whisper.cpp | Local speech-to-text runtime | MIT |
| Whisper `base.en` model | Local English transcription weights | MIT model repository |
| Windows system voices | Optional spoken answers | Supplied by the user's operating system |

The app downloads the model after consent instead of bundling it. The model
download is verified with the published SHA-1 value
`137c40403d78fd54d454da0f9bd998f78703390c`.

Oz does not include celebrity, fictional-character, or unauthorized imitation
voices. Future voice packs must be original, appropriately licensed, or
explicitly authorized.
