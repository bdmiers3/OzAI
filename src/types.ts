export type AssistantState =
  | "ready"
  | "listening"
  | "transcribing"
  | "capturing"
  | "thinking"
  | "streaming"
  | "answer";

export interface ScreenContext {
  base64Png: string;
  capturedAt: string;
  displayLabel?: string;
}

export interface AskRequest {
  question: string;
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
