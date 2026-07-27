import type {
  MicrophoneDevice,
  VoiceDownloadProgress,
  VoiceStatus,
} from "../../types";

export interface SpeechRecognizer {
  getStatus(): Promise<VoiceStatus>;
  listMicrophones(): Promise<MicrophoneDevice[]>;
  downloadModel(
    onProgress: (progress: VoiceDownloadProgress) => void,
  ): Promise<VoiceStatus>;
  startRecording(deviceId?: string): Promise<void>;
  stopAndTranscribe(): Promise<string>;
}
