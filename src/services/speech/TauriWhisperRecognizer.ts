import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  MicrophoneDevice,
  VoiceDownloadProgress,
  VoiceStatus,
} from "../../types";
import type { SpeechRecognizer } from "./SpeechRecognizer";

export class TauriWhisperRecognizer implements SpeechRecognizer {
  async getStatus(): Promise<VoiceStatus> {
    return invoke<VoiceStatus>("get_voice_status");
  }

  async listMicrophones(): Promise<MicrophoneDevice[]> {
    return invoke<MicrophoneDevice[]>("list_microphones");
  }

  async downloadModel(
    onProgress: (progress: VoiceDownloadProgress) => void,
  ): Promise<VoiceStatus> {
    const onProgressChannel = new Channel<VoiceDownloadProgress>();
    onProgressChannel.onmessage = onProgress;
    return invoke<VoiceStatus>("download_voice_model", {
      onProgress: onProgressChannel,
    });
  }

  async startRecording(deviceId?: string): Promise<void> {
    await invoke("start_voice_recording", { deviceId });
  }

  async stopAndTranscribe(): Promise<string> {
    return invoke<string>("stop_and_transcribe_voice");
  }
}
