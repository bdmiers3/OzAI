import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OzMark } from "./components/OzMark";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { TauriScreenCaptureProvider } from "./services/capture/TauriScreenCaptureProvider";
import { OllamaProvider } from "./services/model/OllamaProvider";
import { TauriOllamaProvider } from "./services/model/TauriOllamaProvider";
import { SystemSpeechSynthesizer } from "./services/speech/SystemSpeechSynthesizer";
import { TauriWhisperRecognizer } from "./services/speech/TauriWhisperRecognizer";
import {
  createConversationId,
  loadConversationState,
  saveActiveConversationId,
  saveConversations,
  upsertConversation,
} from "./services/conversations/conversationStore";
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

// ===== PHASE 4: STATUS AND ERROR PRESENTATION =====
type StatusTone = "ready" | "working" | "listening" | "warning" | "error";

interface FriendlyError {
  title: string;
  detail: string;
  hint: string;
}

function friendlyError(message: string): FriendlyError {
  const detail = message.trim() || "Oz could not complete the request.";
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("ollama is not connected") ||
    normalized.includes("could not reach ollama") ||
    normalized.includes("connection refused") ||
    normalized.includes("failed to connect")
  ) {
    return {
      title: "Ollama isn’t running",
      detail: "Oz couldn’t connect to the local AI service.",
      hint: "Open the Ollama app, wait a moment, then select Retry.",
    };
  }

  if (
    (normalized.includes("model") && normalized.includes("not installed")) ||
    normalized.includes("no local model is selected")
  ) {
    return {
      title: "Local model not installed",
      detail,
      hint: "Run “ollama pull qwen3-vl:8b” in a terminal, then select Check again.",
    };
  }

  if (
    normalized.includes("screen capture") ||
    normalized.includes("capture task") ||
    normalized.includes("could not hide its overlay") ||
    normalized.includes("screenshot")
  ) {
    return {
      title: "Screen capture failed",
      detail,
      hint: "Try again, or turn Screen off to send the prompt without a screenshot.",
    };
  }

  if (
    normalized.includes("microphone") ||
    normalized.includes("start the recording") ||
    normalized.includes("audio device")
  ) {
    return {
      title: "Microphone unavailable",
      detail,
      hint: "Check Windows microphone permission and the selected device in Voice settings.",
    };
  }

  if (
    normalized.includes("whisper") ||
    normalized.includes("transcrib") ||
    normalized.includes("did not hear any speech")
  ) {
    return {
      title: "Voice transcription failed",
      detail,
      hint: "Hold the microphone while speaking clearly, then release it to send.",
    };
  }

  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return {
      title: "The request timed out",
      detail,
      hint: "Retry the request. A shorter prompt or smaller screen image may finish faster.",
    };
  }

  if (
    normalized.includes("response stream stopped") ||
    normalized.includes("unreadable response")
  ) {
    return {
      title: "The local response was interrupted",
      detail,
      hint: "Retry the request. Restart Ollama if this continues.",
    };
  }

  if (
    normalized.includes("did not return a text response") ||
    normalized.includes("empty response")
  ) {
    return {
      title: "Oz returned an empty response",
      detail,
      hint: "Retry the request or rephrase the prompt.",
    };
  }

  return {
    title: "Oz couldn’t complete that",
    detail,
    hint: "Retry the request. If it happens again, check the terminal for more detail.",
  };
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
      return "Reading your screen…";
    case "thinking":
      return "Thinking locally…";
    case "streaming":
      return "Writing response…";
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
  const initialConversationState = useMemo(() => loadConversationState(), []);

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialConversationState.messages,
  );
  const [conversations, setConversations] = useState(
    initialConversationState.conversations,
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversationState.activeConversationId,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [state, setState] = useState<AssistantState>(() =>
    initialConversationState.messages.length > 0 ? "answer" : "ready",
  );
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
    state === "capturing" || state === "thinking" || state === "streaming";  const busy =
    state === "listening" ||
    state === "transcribing" ||
    state === "capturing" ||
    state === "thinking" ||
    state === "streaming";

  async function refreshModelStatus() {
    setStatus("Checking local model…");

    try {
      const result = await provider.getStatus(MODEL);
      setStatus(result.message);
      setModelAvailable(result.available);
      return result;
    } catch (error) {
      const message = errorMessage(error, "Oz could not check the local model.");
      setStatus(message);
      setModelAvailable(false);
      return {
        available: false,
        model: MODEL,
        message,
      };
    }
  }

  useEffect(() => {
    void refreshModelStatus();
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
    saveActiveConversationId(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId || messages.length === 0) return;

    const saveTimer = window.setTimeout(() => {
      setConversations((current) => {
        const next = upsertConversation(
          current,
          activeConversationId,
          messages,
        );
        if (next === current) return current;
        saveConversations(next);
        return next;
      });
    }, 180);

    return () => window.clearTimeout(saveTimer);
  }, [activeConversationId, messages]);

  useEffect(() => {
    function flushConversationHistory() {
      const next = upsertConversation(
        conversations,
        activeConversationId,
        messages,
      );
      saveConversations(next);
      saveActiveConversationId(activeConversationId);
    }

    window.addEventListener("pagehide", flushConversationHistory);
    return () =>
      window.removeEventListener("pagehide", flushConversationHistory);
  }, [activeConversationId, conversations, messages]);

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
      } else {        if (!modelAvailable) {
          const currentModelStatus = await refreshModelStatus();
          if (!currentModelStatus.available) {
            throw new Error(currentModelStatus.message);
          }
        }

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

        if (controller.signal.aborted) throw cancelledError();        if (!receivedToken) {
          throw new Error(
            "Oz completed the request but did not return a text response.",
          );
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
        });      } else {
        const failureMessage = errorMessage(
          error,
          "Oz could not complete the request.",
        );
        const normalizedFailure = failureMessage.toLowerCase();

        if (
          normalizedFailure.includes("ollama") ||
          normalizedFailure.includes("local model")
        ) {
          setModelAvailable(false);
          setStatus(failureMessage);
        }

        updateMessage(assistantMessageId, {
          content: failureMessage,
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

    if (!activeConversationId) {
      const conversationId = createConversationId();
      setActiveConversationId(conversationId);
      saveActiveConversationId(conversationId);
    }

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
    setActiveConversationId(null);
    saveActiveConversationId(null);
    setHistoryOpen(false);
    setCopiedMessageId(null);
    setState("ready");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openConversation(conversationId: string) {
    if (busy) return;

    const conversation = conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    if (!conversation) return;

    speechSynthesizer.cancel();
    setActiveConversationId(conversation.id);
    saveActiveConversationId(conversation.id);
    setMessages(conversation.messages.map((message) => ({ ...message })));
    setQuestion("");
    setCopiedMessageId(null);
    setState(conversation.messages.length > 0 ? "answer" : "ready");
    setHistoryOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function renameConversation(conversationId: string, title: string) {
    const normalizedTitle = title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!normalizedTitle) return;

    setConversations((current) => {
      const next = current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title: normalizedTitle,
              titleEdited: true,
            }
          : conversation,
      );
      saveConversations(next);
      return next;
    });
  }

  function deleteConversation(conversationId: string) {
    if (busy) return;

    const conversation = conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    if (!conversation) return;

    if (!window.confirm(`Delete “${conversation.title}”?`)) return;

    const next = conversations.filter(
      (candidate) => candidate.id !== conversationId,
    );
    setConversations(next);
    saveConversations(next);

    if (conversationId === activeConversationId) reset();
  }

  function clearConversationHistory() {
    if (busy || conversations.length === 0) return;
    if (!window.confirm("Delete all saved Oz conversations?")) return;

    setConversations([]);
    saveConversations([]);
    reset();
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
  }  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const latestError =
    latestAssistant?.status === "error"
      ? friendlyError(latestAssistant.content)
      : null;
  const headerStatus: {
    label: string;
    detail: string;
    tone: StatusTone;
  } = (() => {
    switch (state) {
      case "listening":
        return {
          label: "Listening",
          detail: "Release the microphone button to transcribe and send.",
          tone: "listening",
        };
      case "transcribing":
        return {
          label: "Transcribing locally",
          detail: "Whisper is processing the recording on this computer.",
          tone: "working",
        };
      case "capturing":
        return {
          label: "Reading screen",
          detail: "Oz is capturing the display under your cursor.",
          tone: "working",
        };
      case "thinking":
        return {
          label: "Thinking locally",
          detail: "The local model is preparing a response.",
          tone: "working",
        };
      case "streaming":
        return {
          label: "Answering locally",
          detail: "Oz is streaming the response from the local model.",
          tone: "working",
        };
      case "answer":
        if (latestAssistant?.status === "error") {
          return {
            label: latestError?.title ?? "Needs attention",
            detail: latestError?.hint ?? latestAssistant.content,
            tone: "error",
          };
        }
        if (latestAssistant?.status === "stopped") {
          return {
            label: "Response stopped",
            detail: "The partial response was kept. Select Retry to regenerate it.",
            tone: "warning",
          };
        }
        return {
          label: "Response ready",
          detail: "Oz finished the local response.",
          tone: "ready",
        };
      default:
        if (demoMode) {
          return {
            label: "Browser preview",
            detail: "Native capture and local voice require the Tauri desktop app.",
            tone: "warning",
          };
        }
        if (status.toLowerCase().includes("checking")) {
          return {
            label: "Checking local model",
            detail: status,
            tone: "working",
          };
        }
        if (!modelAvailable) {
          return {
            label: "Local model unavailable",
            detail: status,
            tone: "warning",
          };
        }
        return {
          label: "Ready",
          detail: status,
          tone: "ready",
        };
    }
  })();

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
            <div>              <h1>Oz</h1>
              <p
                className={`header-status header-status--${headerStatus.tone}`}
                title={headerStatus.detail}
              >
                <span className="header-status__dot" aria-hidden="true" />
                {headerStatus.label}
              </p>
            </div>
          </div>

          <div className="window-actions">
            <button
              type="button"
              className="icon-button history-trigger"
              aria-label="Open conversation history"
              title="Conversation history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 6h14M5 12h14M5 18h9" />
              </svg>
            </button>
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
        <HistoryDrawer
          open={historyOpen}
          conversations={conversations}
          activeConversationId={activeConversationId}
          disabled={busy}
          onClose={() => setHistoryOpen(false)}
          onNewConversation={reset}
          onOpenConversation={openConversation}
          onRenameConversation={renameConversation}
          onDeleteConversation={deleteConversation}
          onClearHistory={clearConversationHistory}
        />
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
                const isLastMessage = index === messages.length - 1;                const isPending =
                  message.role === "assistant" &&
                  !message.content &&
                  isLastMessage &&
                  busy;
                const errorDetails =
                  message.status === "error"
                    ? friendlyError(message.content)
                    : null;
                const canRetry =
                  isLastMessage &&
                  index > 0 &&
                  messages[index - 1]?.role === "user";
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
                        </div>                      ) : errorDetails ? (
                        <div className="message-error" role="alert">
                          <span className="message-error__icon" aria-hidden="true">
                            !
                          </span>
                          <div className="message-error__copy">
                            <strong>{errorDetails.title}</strong>
                            <p>{errorDetails.detail}</p>
                            <span>{errorDetails.hint}</span>
                          </div>
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
                          </button>                          {canRetry && (
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
              }}              placeholder={
                state === "listening"
                  ? "Listening… release to send"
                  : screenEnabled
                    ? "Ask about what’s on your screen…"
                    : "Ask Oz anything…"
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
        </div>        <footer>
          <span
            className={`status-dot${
              !demoMode && modelAvailable
                ? " is-connected"
                : status.toLowerCase().includes("checking")
                  ? " is-checking"
                  : " is-error"
            }`}
          />
          <span className="footer-status-text">
            {demoMode ? "Browser preview" : status}
          </span>
          {tauriRuntime && !modelAvailable && !busy && (
            <button
              type="button"
              className="status-recheck"
              onClick={() => void refreshModelStatus()}
            >
              Check again
            </button>
          )}

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
