import type { AskRequest, ModelStatus } from "../../types";

export interface ModelProvider {
  readonly id: string;
  getStatus(model: string): Promise<ModelStatus>;
  streamAnswer(
    request: AskRequest,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
