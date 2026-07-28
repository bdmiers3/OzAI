import type { AskRequest, ModelStatus } from "../../types";
import type { ModelProvider } from "./ModelProvider";

interface OllamaStreamChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";

  constructor(private readonly baseUrl = "http://127.0.0.1:11434") {}

  async getStatus(model: string): Promise<ModelStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

      const payload = (await response.json()) as {
        models?: Array<{ name: string }>;
      };
      const available = payload.models?.some(
        ({ name }) => name === model || name.startsWith(`${model}:`),
      );

      return {
        available: Boolean(available),
        model,
        message: available
          ? `${model} is ready`
          : `Ollama is running, but ${model} is not installed`,
      };
    } catch {
      return {
        available: false,
        model,
        message: "Ollama is not connected",
      };
    }
  }

  async streamAnswer(
    request: AskRequest,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: request.model,
        stream: true,
        think: false,
        messages: [
          {
            role: "system",
            content:
              "You are Oz, a concise desktop assistant. Use the supplied screenshot when relevant. Never claim to see details that are not visible. When explaining an interface, give clear, actionable steps.",
          },
          ...request.history.map(({ role, content }) => ({ role, content })),
          {
            role: "user",
            content: request.question,
            images: request.screen ? [request.screen.base64Png] : undefined,
          },
        ],
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as OllamaStreamChunk;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) onToken(chunk.message.content);
      }
    }
  }
}
