# Oz Windows Test Checklist

Use this checklist from the `oz-ai` folder in VS Code.

## 1. Confirm the local model

```powershell
ollama list
```

The list should include `qwen3-vl:8b`. If it does not:

```powershell
ollama pull qwen3-vl:8b
```

## 2. Install project dependencies

```powershell
npm install
```

If PowerShell blocks `npm.ps1`, use `npm.cmd install` for this command and
`npm.cmd run tauri dev` below.

## 3. Confirm native voice build tools

Open **Visual Studio Installer → Modify → Individual components** and confirm
**C++ CMake tools for Windows** is installed. The existing **Desktop development
with C++** workload and Windows SDK are still required.

## 4. Start the desktop app

```powershell
npm run tauri dev
```

The first native build can take several minutes while Cargo downloads and
compiles the Rust dependencies.

## 5. Set up local voice

1. Select **Set up · 142 MB** inside Oz.
2. Confirm the progress indicator advances.
3. Confirm the setup row disappears and a **Voice** menu appears in the footer.
4. Open **Voice** and confirm the intended microphone is selected.

The model download is verified before installation. If it is interrupted, press
**Set up** again.

## 6. Test text-only mode

1. Turn the **Screen** toggle off.
2. Ask: `Reply with exactly: Oz text mode works.`
3. Confirm the response streams into the overlay.

## 7. Test push-to-talk

1. Turn the **Screen** toggle off for the first microphone test.
2. Hold the microphone button.
3. Say: `Reply with exactly: Oz voice mode works.`
4. Release the button.
5. Confirm Oz shows **Transcribing locally**, inserts the transcription, and
   automatically submits it.
6. Open **Voice**, enable spoken answers, and repeat the test.
7. Confirm Windows reads the completed response aloud.

## 8. Test screen-aware voice mode

1. Put a clearly recognizable window on the monitor you want to test.
2. Put the mouse pointer on that monitor.
3. Turn the **Screen** toggle on.
4. Hold the microphone and say: `Summarize what is on my screen.`
5. Release and confirm the sequence is:
   **Transcribing → Capturing screen → Thinking → Answering**.

## 9. Test typed screen-aware mode

1. Put a clearly recognizable window on the monitor you want to test.
2. Put the mouse pointer on that monitor.
3. Turn the **Screen** toggle on.
4. Ask: `Summarize what is on my screen.`
5. Confirm Oz briefly hides, reappears, and answers using visible details.

## 10. Test desktop controls

- Press `Ctrl + Shift + Space` to hide and reopen Oz.
- Use the tray menu to toggle screen context.
- Confirm the green privacy dot changes when screen context is toggled.

## Acceptance criteria

- Oz starts without a Rust panic or frontend error.
- The footer reports `qwen3-vl:8b is ready`.
- Text-only questions receive a streamed local answer.
- The voice model installs through Oz and passes its integrity check.
- The selected microphone records only while the button is held.
- Voice is transcribed locally and automatically submitted.
- No audio file appears in the project, Documents, Music, or Pictures folders.
- Screen-aware questions cause one capture only.
- The Oz window is absent from its own screenshot.
- No screenshot file appears in the project or Pictures folders.

If a test fails, copy the complete VS Code terminal error and note which
checklist step failed. For black captures in a game, retry in borderless-windowed
mode; exclusive fullscreen and protected video can prevent ordinary capture.
