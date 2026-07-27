import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OzMark } from "./components/OzMark";
import { TauriScreenCaptureProvider } from "./services/capture/TauriScreenCaptureProvider";
import { OllamaProvider } from "./services/model/OllamaProvider";
import { TauriOllamaProvider } from "./services/model/TauriOllamaProvider";
import { SystemSpeechSynthesizer } from "./services/speech/SystemSpeechSynthesizer";
import { TauriWhisperRecognizer } from "./services/speech/TauriWhisperRecognizer";
import type {
  AssistantState,
  MicrophoneDevice,
  VoiceDownloadProgress,
  VoiceStatus,
} from "./types";

const MODEL = "qwen3-vl:8b";
const DEMO_RESPONSE =
  "This browser preview demonstrates the Oz interface. Run “npm run tauri dev” to use native screen capture, local push-to-talk, and Qwen3-VL.";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" />
    </svg>
  );
}

export default function App() {
  const tauriRuntime = isTauriRuntime();
  const provider = useMemo(
    () => (tauriRuntime ? new TauriOllamaProvider() : new OllamaProvider()),
    [tauriRuntime],
  );
  const captureProvider = useMemo(
    () => (tauriRuntime ? new TauriScreenCaptureProvider() : null),
    [tauriRuntime],
  );
  const speechRecognizer = useMemo(
    () => (tauriRuntime ? new TauriWhisperRecognizer() : null),
    [tauriRuntime],
  );
  const speechSynthesizer = useMemo(() => new SystemSpeechSynthesizer(), []);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<AssistantState>("ready");
  const [status, setStatus] = useState("Checking local model…");
  const [modelAvailable, setModelAvailable] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    available: false,
    modelName: "Whisper base.en",
    message: "Checking local voice…",
  });
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState(
    () => window.localStorage.getItem("oz.microphone") ?? "",
  );
  const [spokenAnswers, setSpokenAnswers] = useState(
    () => window.localStorage.getItem("oz.spokenAnswers") === "true",
  );
  const [voiceDownloading, setVoiceDownloading] = useState(false);
  const [voiceDownloadProgress, setVoiceDownloadProgress] =
    useState<VoiceDownloadProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recordingRef = useRef(false);
  const startRecordingPromiseRef = useRef<Promise<void> | null>(null);
  const demoMode = !tauriRuntime;
  const busy =
    state === "listening" ||
    state === "transcribing" ||
    state === "capturing" ||
    state === "thinking" ||
    state === "streaming";

  useEffect(() => {
    provider
      .getStatus(MODEL)
      .then((result) => {
        setStatus(result.message);
        setModelAvailable(result.available);
      })
      .catch((error) => {
        setStatus(errorMessage(error, "Oz could not check the local model."));
        setModelAvailable(false);
      });
  }, [provider]);

  useEffect(() => {
    if (!speechRecognizer) return;

    speechRecognizer
      .getStatus()
      .then(setVoiceStatus)
      .catch((error) =>
        setVoiceStatus({
          available: false,
          modelName: "Whisper base.en",
          message: errorMessage(error, "Oz could not check local voice."),
        }),
      );
    speechRecognizer
      .listMicrophones()
      .then((devices) => {
        setMicrophones(devices);
        setSelectedMicrophone((current) => {
          if (devices.some((device) => device.id === current)) return current;
          return devices.find((device) => device.isDefault)?.id ?? devices[0]?.id ?? "";
        });
      })
      .catch(() => setMicrophones([]));
  }, [speechRecognizer]);

  useEffect(() => {
    if (!tauriRuntime) return;

    invoke<boolean>("get_screen_context_enabled")
      .then(setScreenEnabled)
      .catch(() => setScreenEnabled(false));
    const unlisten = listen<boolean>("screen-context-enabled", (event) => {
      setScreenEnabled(event.payload);
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [tauriRuntime]);

  useEffect(() => {
    window.localStorage.setItem("oz.spokenAnswers", String(spokenAnswers));
    if (!spokenAnswers) speechSynthesizer.cancel();
  }, [spokenAnswers, speechSynthesizer]);

  useEffect(() => {
    if (selectedMicrophone) {
      window.localStorage.setItem("oz.microphone", selectedMicrophone);
    }
  }, [selectedMicrophone]);

  async function ask(prompt: string) {
    try {
      setAnswer("");
      speechSynthesizer.cancel();
      let completedAnswer = "";

      if (demoMode) {
        if (screenEnabled) {
          setState("capturing");
          await new Promise((resolve) => window.setTimeout(resolve, 520));
        }
        setState("thinking");
        await new Promise((resolve) => window.setTimeout(resolve, 740));
        completedAnswer = DEMO_RESPONSE;
        setAnswer(completedAnswer);
      } else {
        if (!modelAvailable) throw new Error(status);

        let screen;
        if (screenEnabled) {
          if (!captureProvider) {
            throw new Error("Native screen capture is unavailable.");
          }
          setState("capturing");
          screen = await captureProvider.captureActiveDisplay();
        }

        setState("thinking");
        let receivedToken = false;
        await provider.streamAnswer(
          { question: prompt, model: MODEL, screen },
          (token) => {
            receivedToken = true;
            completedAnswer += token;
            setState("streaming");
            setAnswer((current) => current + token);
          },
        );
        if (!receivedToken) {
          completedAnswer =
            "Oz completed the request but did not return a text response.";
          setAnswer(completedAnswer);
        }
      }

      setState("answer");
      if (spokenAnswers) speechSynthesizer.speak(completedAnswer);
    } catch (error) {
      setAnswer(errorMessage(error, "Oz could not complete the request."));
      setState("answer");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || busy) return;
    await ask(prompt);
  }

  async function downloadVoiceModel() {
    if (!speechRecognizer || voiceDownloading) return;
    setVoiceDownloading(true);
    setVoiceDownloadProgress(null);
    setVoiceStatus((current) => ({
      ...current,
      message: "Downloading local voice model…",
    }));
    try {
      const installed = await speechRecognizer.downloadModel(
        setVoiceDownloadProgress,
      );
      setVoiceStatus(installed);
    } catch (error) {
      setVoiceStatus({
        available: false,
        modelName: "Whisper base.en",
        message: errorMessage(error, "The voice model could not be installed."),
      });
    } finally {
      setVoiceDownloading(false);
    }
  }

  async function startListening() {
    if (!speechRecognizer || !voiceStatus.available || busy) return;
    speechSynthesizer.cancel();
    setAnswer("");
    setState("listening");
    recordingRef.current = true;
    const startPromise = speechRecognizer.startRecording(
      selectedMicrophone || undefined,
    );
    startRecordingPromiseRef.current = startPromise;
    try {
      await startPromise;
    } catch (error) {
      recordingRef.current = false;
      setAnswer(errorMessage(error, "Oz could not start the microphone."));
      setState("answer");
    } finally {
      if (startRecordingPromiseRef.current === startPromise) {
        startRecordingPromiseRef.current = null;
      }
    }
  }

  async function finishListening() {
    if (!speechRecognizer || !recordingRef.current) return;
    const pendingStart = startRecordingPromiseRef.current;
    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        return;
      }
    }
    recordingRef.current = false;
    setState("transcribing");
    try {
      const transcript = (await speechRecognizer.stopAndTranscribe()).trim();
      setQuestion(transcript);
      await ask(transcript);
    } catch (error) {
      setAnswer(errorMessage(error, "Oz could not transcribe the recording."));
      setState("answer");
    }
  }

  function reset() {
    speechSynthesizer.cancel();
    setQuestion("");
    setAnswer("");
    setState("ready");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function minimizeWindow() {
    if (tauriRuntime) await getCurrentWindow().minimize();
  }

  async function hideWindow() {
    if (tauriRuntime) await getCurrentWindow().hide();
  }

  async function toggleScreenContext() {
    const enabled = !screenEnabled;
    setScreenEnabled(enabled);
    if (tauriRuntime) {
      try {
        await invoke("set_screen_context_enabled", { enabled });
      } catch {
        setScreenEnabled(!enabled);
      }
    }
  }

  const stateLabel = {
    ready: "Ready",
    listening: "Listening",
    transcribing: "Transcribing locally",
    capturing: "Capturing screen",
    thinking: "Thinking locally",
    streaming: "Answering locally",
    answer: "Response ready",
  }[state];

  const processingCopy = {
    listening: {
      title: "I’m listening",
      detail: "Keep holding the microphone button while you speak.",
    },
    transcribing: {
      title: "Transcribing locally",
      detail: "Whisper is turning your recording into text on this computer.",
    },
    capturing: {
      title: "Reading this screen",
      detail: "A single screenshot is being captured.",
    },
    thinking: {
      title: "Working on it",
      detail: "Qwen3-VL is preparing a local response.",
    },
  } as const;

  const setupProgress = voiceDownloadProgress?.percent != null
    ? `${voiceDownloadProgress.percent}%`
    : voiceDownloadProgress
      ? `${Math.round(voiceDownloadProgress.receivedBytes / 1_048_576)} MB`
      : null;

  return (
    <main className="app-shell">
      <section className="assistant-card" aria-live="polite">
        <header className="topbar" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <OzMark active={busy} />
            <div>
              <h1>Oz</h1>
              <p>{stateLabel}</p>
            </div>
          </div>

          <div className="window-actions">
            <span
              className={`privacy-dot${state === "listening" ? " is-listening" : screenEnabled ? " is-on" : ""}`}
              title={state === "listening" ? "Microphone active" : "Screen context"}
            />
            <button
              className="icon-button"
              aria-label="Minimize"
              onClick={minimizeWindow}
            >
              <span>—</span>
            </button>
            <button className="icon-button" aria-label="Hide Oz" onClick={hideWindow}>
              <span>×</span>
            </button>
          </div>
        </header>

        <div className="content">
          {state === "ready" && (
            <div className="welcome">
              <p className="eyebrow">SCREEN-AWARE ASSISTANT</p>
              <h2>What are you looking at?</h2>
              <p className="lede">
                Type a question or hold the microphone to speak. Screen and
                voice processing stay on this computer.
              </p>
              <div className="suggestions">
                <button onClick={() => setQuestion("What is causing this error?")}>
                  Explain this error
                </button>
                <button onClick={() => setQuestion("Summarize what is on my screen.")}>
                  Summarize my screen
                </button>
                <button onClick={() => setQuestion("What should I do next here?")}>
                  Suggest the next step
                </button>
              </div>
            </div>
          )}

          {(state === "listening" ||
            state === "transcribing" ||
            state === "capturing" ||
            state === "thinking") && (
            <div className={`processing processing--${state}`}>
              <OzMark active />
              <div className="pulse-line">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <h2>{processingCopy[state].title}</h2>
              <p>{processingCopy[state].detail}</p>
            </div>
          )}

          {(state === "streaming" || state === "answer") && (
            <div className="response">
              <p className="eyebrow">OZ</p>
              <p>{answer}</p>
              {state === "answer" && (
                <button className="new-question" onClick={reset}>
                  Ask another question
                </button>
              )}
            </div>
          )}
        </div>

        <div className="composer-zone">
          {tauriRuntime && !voiceStatus.available && (
            <div className={`voice-setup${voiceDownloading ? " is-busy" : ""}`}>
              <div>
                <strong>Local push-to-talk</strong>
                <span>
                  {voiceDownloading
                    ? `Installing Whisper${setupProgress ? ` · ${setupProgress}` : ""}`
                    : voiceStatus.message}
                </span>
              </div>
              <button
                type="button"
                onClick={downloadVoiceModel}
                disabled={voiceDownloading}
              >
                {voiceDownloading ? "Installing…" : "Set up · 142 MB"}
              </button>
            </div>
          )}

          <form className="composer" onSubmit={submit}>
            <button
              type="button"
              className={`mic-button${state === "listening" ? " is-listening" : ""}`}
              disabled={!voiceStatus.available || (busy && state !== "listening")}
              aria-label="Hold to talk"
              title={
                voiceStatus.available
                  ? "Hold to talk"
                  : "Set up local voice to use push-to-talk"
              }
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                void startListening();
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                void finishListening();
              }}
              onPointerCancel={() => void finishListening()}
              onKeyDown={(event) => {
                if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                  event.preventDefault();
                  void startListening();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  void finishListening();
                }
              }}
            >
              <MicrophoneIcon />
            </button>
            <input
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                state === "listening"
                  ? "Listening… release to send"
                  : "Ask about what’s on your screen…"
              }
              aria-label="Question for Oz"
              disabled={busy}
            />
            <button
              type="button"
              className={`context-toggle${screenEnabled ? " is-on" : ""}`}
              aria-pressed={screenEnabled}
              onClick={toggleScreenContext}
              disabled={busy}
            >
              <span className="screen-icon">▣</span>
              Screen
            </button>
            <button
              className="send-button"
              disabled={!question.trim() || busy}
              aria-label="Ask Oz"
            >
              ↑
            </button>
          </form>
        </div>

        <footer>
          <span
            className={`status-dot${!demoMode && modelAvailable ? " is-connected" : ""}`}
          />
          <span>{demoMode ? "Browser preview" : status}</span>
          {tauriRuntime && voiceStatus.available && (
            <details className="voice-settings">
              <summary>Voice</summary>
              <div className="voice-settings__panel">
                <label>
                  Microphone
                  <select
                    value={selectedMicrophone}
                    onChange={(event) => setSelectedMicrophone(event.target.value)}
                  >
                    {microphones.map((microphone) => (
                      <option key={microphone.id} value={microphone.id}>
                        {microphone.label}
                        {microphone.isDefault ? " (Default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="spoken-toggle">
                  <input
                    type="checkbox"
                    checked={spokenAnswers}
                    disabled={!speechSynthesizer.available}
                    onChange={(event) => setSpokenAnswers(event.target.checked)}
                  />
                  Speak answers with the Windows system voice
                </label>
                <p>Audio is held in memory and transcribed locally.</p>
              </div>
            </details>
          )}
          <span className="shortcut">Ctrl&nbsp; Shift&nbsp; Space</span>
        </footer>
      </section>
    </main>
  );
}
