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
  ChatMessage,
  ConversationMessage,
  MicrophoneDevice,
  VoiceDownloadProgress,
  VoiceStatus,
} from "./types";

const appWindow = getCurrentWindow();
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

function createMessageId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function cancelledError() {
  return new DOMException("The request was cancelled.", "AbortError");
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  );
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledError());
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);

    function cancel() {
      window.clearTimeout(timeout);
      reject(cancelledError());
    }

    signal.addEventListener("abort", cancel, { once: true });
  });
}

function pendingLabel(state: AssistantState) {
  switch (state) {
    case "capturing":
      return "Reading this screen…";
    case "thinking":
      return "Working on it…";
    case "streaming":
      return "Answering…";
    default:
      return "Preparing…";
  }
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
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

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const copiedResetTimeoutRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const startRecordingPromiseRef = useRef<Promise<void> | null>(null);

  const demoMode = !tauriRuntime;
  const generating =
    state === "capturing" || state === "thinking" || state === "streaming";
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

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 92)}px`;
  }, [question]);

  useEffect(() => {
    if (messages.length === 0 && state === "ready") return;

    conversationEndRef.current?.scrollIntoView({
      behavior: state === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, state]);

  useEffect(() => {
    if (!generating) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      stopGenerating();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [generating]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      if (copiedResetTimeoutRef.current != null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
    },
    [],
  );

  function updateMessage(
    messageId: string,
    patch: Partial<ChatMessage>,
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      ),
    );
  }

  function appendAssistantMessage(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: createMessageId(),
        role: "assistant",
        content,
        status: "error",
      },
    ]);
  }

  function buildHistory(source: ChatMessage[]) {
    return source
      .filter((message) => {
        if (!message.content.trim()) return false;
        if (message.role === "user") return true;
        return message.status === "complete";
      })
      .map<ConversationMessage>(({ role, content }) => ({ role, content }));
  }

  async function runAssistantResponse(
    prompt: string,
    history: ConversationMessage[],
    assistantMessageId: string,
  ) {
    const controller = new AbortController();
    const requestId = createMessageId();
    abortControllerRef.current = controller;
    activeAssistantMessageIdRef.current = assistantMessageId;
    speechSynthesizer.cancel();

    let completedAnswer = "";

    try {
      if (demoMode) {
        if (screenEnabled) {
          setState("capturing");
          await abortableDelay(520, controller.signal);
        }

        setState("thinking");
        await abortableDelay(740, controller.signal);
        completedAnswer = DEMO_RESPONSE;
        updateMessage(assistantMessageId, {
          content: completedAnswer,
          status: "complete",
        });
      } else {
        if (!modelAvailable) throw new Error(status);

        let screen;
        if (screenEnabled) {
          if (!captureProvider) {
            throw new Error("Native screen capture is unavailable.");
          }

          setState("capturing");
          screen = await captureProvider.captureActiveDisplay();
          if (controller.signal.aborted) throw cancelledError();
        }

        setState("thinking");
        let receivedToken = false;

        await provider.streamAnswer(
          {
            requestId,
            question: prompt,
            model: MODEL,
            screen,
            history,
          },
          (token) => {
            if (
              controller.signal.aborted ||
              activeAssistantMessageIdRef.current !== assistantMessageId
            ) {
              return;
            }

            receivedToken = true;
            completedAnswer += token;
            setState("streaming");
            updateMessage(assistantMessageId, {
              content: completedAnswer,
              status: "pending",
            });
          },
          controller.signal,
        );

        if (controller.signal.aborted) throw cancelledError();

        if (!receivedToken) {
          completedAnswer =
            "Oz completed the request but did not return a text response.";
        }

        updateMessage(assistantMessageId, {
          content: completedAnswer,
          status: "complete",
        });
      }

      if (activeAssistantMessageIdRef.current === assistantMessageId) {
        setState("answer");
      }
      if (spokenAnswers && completedAnswer) {
        speechSynthesizer.speak(completedAnswer);
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        updateMessage(assistantMessageId, {
          content: completedAnswer || "Response stopped.",
          status: "stopped",
        });
      } else {
        updateMessage(assistantMessageId, {
          content: errorMessage(error, "Oz could not complete the request."),
          status: "error",
        });
      }

      if (activeAssistantMessageIdRef.current === assistantMessageId) {
        setState("answer");
      }
    } finally {
      if (activeAssistantMessageIdRef.current === assistantMessageId) {
        activeAssistantMessageIdRef.current = null;
        abortControllerRef.current = null;
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }

  async function ask(prompt: string, allowWhileBusy = false) {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt || (busy && !allowWhileBusy)) return;

    const history = buildHistory(messages);
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmedPrompt,
    };
    const assistantMessageId = createMessageId();

    setQuestion("");
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        status: "pending",
      },
    ]);

    await runAssistantResponse(trimmedPrompt, history, assistantMessageId);
  }

  async function retryMessage(messageId: string) {
    if (busy) return;

    const assistantIndex = messages.findIndex(
      (message) => message.id === messageId && message.role === "assistant",
    );
    const userIndex = assistantIndex - 1;
    const userMessage = messages[userIndex];

    if (
      assistantIndex < 1 ||
      !userMessage ||
      userMessage.role !== "user"
    ) {
      return;
    }

    const history = buildHistory(messages.slice(0, userIndex));
    setMessages((current) =>
      current.slice(0, assistantIndex + 1).map((message, index) =>
        index === assistantIndex
          ? { ...message, content: "", status: "pending" }
          : message,
      ),
    );

    await runAssistantResponse(userMessage.content, history, messageId);
  }

  async function copyMessage(messageId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);

      if (copiedResetTimeoutRef.current != null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }

      copiedResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId(null);
        copiedResetTimeoutRef.current = null;
      }, 1_600);
    } catch (error) {
      console.error("Oz could not copy the response.", error);
    }
  }

  function stopGenerating() {
    const assistantMessageId = activeAssistantMessageIdRef.current;
    const controller = abortControllerRef.current;
    if (!assistantMessageId || !controller || controller.signal.aborted) return;

    speechSynthesizer.cancel();
    controller.abort();
    updateMessage(assistantMessageId, {
      status: "stopped",
    });
    setState("answer");
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
      appendAssistantMessage(
        errorMessage(error, "Oz could not start the microphone."),
      );
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
      if (!transcript) {
        throw new Error("Oz did not hear any speech.");
      }
      await ask(transcript, true);
    } catch (error) {
      appendAssistantMessage(
        errorMessage(error, "Oz could not transcribe the recording."),
      );
      setState("answer");
    }
  }

  function reset() {
    abortControllerRef.current?.abort();
    speechSynthesizer.cancel();
    setQuestion("");
    setMessages([]);
    setCopiedMessageId(null);
    setState("ready");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function minimizeWindow() {
    if (tauriRuntime) await appWindow.minimize();
  }

  async function closeWindow() {
    if (tauriRuntime) await appWindow.close();
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

  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const stateLabel = {
    ready: "Ready",
    listening: "Listening",
    transcribing: "Transcribing locally",
    capturing: "Capturing screen",
    thinking: "Thinking locally",
    streaming: "Answering locally",
    answer:
      latestAssistant?.status === "stopped"
        ? "Response stopped"
        : latestAssistant?.status === "error"
          ? "Needs attention"
          : "Response ready",
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
            {messages.length > 0 && (
              <button
                type="button"
                className="icon-button"
                aria-label="Start a new conversation"
                title="New conversation"
                onClick={reset}
                disabled={busy}
              >
                <span>＋</span>
              </button>
            )}

            <span
              className={`privacy-dot${state === "listening" ? " is-listening" : screenEnabled ? " is-on" : ""}`}
              title={state === "listening" ? "Microphone active" : "Screen context"}
            />

            <button
              type="button"
              className="icon-button"
              aria-label="Minimize"
              onClick={minimizeWindow}
            >
              <span>—</span>
            </button>

            <button
              type="button"
              className="icon-button"
              aria-label="Close Oz"
              onClick={closeWindow}
            >
              <span>×</span>
            </button>
          </div>
        </header>

        <div className="content">
          {messages.length === 0 && state === "ready" && (
            <div className="welcome">
              <p className="eyebrow">SCREEN-AWARE ASSISTANT</p>
              <h2>What are you looking at?</h2>
              <p className="lede">
                Type a question or hold the microphone to speak. Screen and
                voice processing stay on this computer.
              </p>
              <div className="suggestions">
                <button
                  type="button"
                  onClick={() => void ask("What is causing this error?")}
                >
                  Explain this error
                </button>
                <button
                  type="button"
                  onClick={() => void ask("Summarize what is on my screen.")}
                >
                  Summarize my screen
                </button>
                <button
                  type="button"
                  onClick={() => void ask("What should I do next here?")}
                >
                  Suggest the next step
                </button>
              </div>
            </div>
          )}

          {messages.length === 0 &&
            (state === "listening" || state === "transcribing") && (
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

          {messages.length > 0 && (
            <div className="conversation">
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isPending =
                  message.role === "assistant" &&
                  !message.content &&
                  isLastMessage &&
                  busy;

                return (
                  <article
                    key={message.id}
                    className={`message-row message-row--${message.role}`}
                  >
                    <span className="message-author">
                      {message.role === "user" ? "YOU" : "OZ"}
                    </span>
                    <div
                      className={`message-bubble${
                        message.status === "error"
                          ? " message-bubble--error"
                          : message.status === "stopped"
                            ? " message-bubble--stopped"
                            : ""
                      }`}
                    >
                      {isPending ? (
                        <div className="message-pending">
                          <span className="message-pending__dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>{pendingLabel(state)}</span>
                        </div>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>

                    {message.role === "assistant" &&
                      message.content &&
                      !(isLastMessage && busy) && (
                        <div className="message-actions">
                          {message.status === "stopped" && (
                            <span className="message-result message-result--stopped">
                              Stopped
                            </span>
                          )}
                          {message.status === "error" && (
                            <span className="message-result message-result--error">
                              Error
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void copyMessage(message.id, message.content)
                            }
                          >
                            {copiedMessageId === message.id ? "Copied" : "Copy"}
                          </button>
                          {isLastMessage && (
                            <button
                              type="button"
                              onClick={() => void retryMessage(message.id)}
                              disabled={busy}
                            >
                              ↻ Retry
                            </button>
                          )}
                        </div>
                      )}
                  </article>
                );
              })}
              <div ref={conversationEndRef} />
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

            <textarea
              ref={inputRef}
              rows={1}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
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

            {generating ? (
              <button
                type="button"
                className="send-button stop-button"
                aria-label="Stop generating"
                title="Stop generating (Esc)"
                onClick={stopGenerating}
              >
                <span aria-hidden="true" />
              </button>
            ) : (
              <button
                className="send-button"
                disabled={!question.trim() || busy}
                aria-label="Ask Oz"
              >
                ↑
              </button>
            )}
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
