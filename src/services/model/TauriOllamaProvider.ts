import { Channel, invoke } from "@tauri-apps/api/core";
import type { AskRequest, ModelStatus } from "../../types";
import type { ModelProvider } from "./ModelProvider";

function cancelledError() {
  return new DOMException("The request was cancelled.", "AbortError");
}

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
    if (signal?.aborted) throw cancelledError();

    const onTokenChannel = new Channel<string>();
    onTokenChannel.onmessage = (token) => {
      if (!signal?.aborted) onToken(token);
    };

    const cancelNativeRequest = () => {
      void invoke<boolean>("cancel_ollama_request", {
        requestId: request.requestId,
      }).catch(() => undefined);
    };

    signal?.addEventListener("abort", cancelNativeRequest, { once: true });

    try {
      await invoke<void>("ask_ollama", {
        request,
        onToken: onTokenChannel,
      });

      if (signal?.aborted) throw cancelledError();
    } catch (error) {
      if (
        signal?.aborted ||
        error === "REQUEST_CANCELLED" ||
        String(error).includes("REQUEST_CANCELLED")
      ) {
        throw cancelledError();
      }

      throw error;
    } finally {
      signal?.removeEventListener("abort", cancelNativeRequest);
    }
  }
}
