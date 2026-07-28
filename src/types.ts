export type AssistantState =
  | "ready"
  | "listening"
  | "transcribing"
  | "capturing"
  | "thinking"
  | "streaming"
  | "answer";

export type ChatRole = "user" | "assistant";

export type ChatMessageStatus =
  | "pending"
  | "complete"
  | "stopped"
  | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  status?: ChatMessageStatus;
}

export interface ConversationMessage {
  role: ChatRole;
  content: string;
}

export interface ScreenContext {
  base64Png: string;
  capturedAt: string;
  displayLabel?: string;
}

export interface AskRequest {
  requestId: string;
  question: string;
  history: ConversationMessage[];
  screen?: ScreenContext;
  model: string;
}

export interface ModelStatus {
  available: boolean;
  model: string;
  message: string;
}

export interface VoiceStatus {
  available: boolean;
  modelName: string;
  message: string;
}

export interface VoiceDownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface MicrophoneDevice {
  id: string;
  label: string;
  isDefault: boolean;
}
