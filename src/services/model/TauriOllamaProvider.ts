import { Channel, invoke } from "@tauri-apps/api/core";
import type { AskRequest, ModelStatus } from "../../types";
import type { ModelProvider } from "./ModelProvider";

export class TauriOllamaProvider implements ModelProvider {
  readonly id = "tauri-ollama";

  async getStatus(model: string): Promise<ModelStatus> {
    return invoke<ModelStatus>("get_ollama_status", { model });
  }

  async streamAnswer(
    request: AskRequest,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("The request was cancelled.", "AbortError");
    }

    const onTokenChannel = new Channel<string>();
    onTokenChannel.onmessage = (token) => {
      if (!signal?.aborted) onToken(token);
    };

    await invoke<void>("ask_ollama", {
      request,
      onToken: onTokenChannel,
    });
  }
}
