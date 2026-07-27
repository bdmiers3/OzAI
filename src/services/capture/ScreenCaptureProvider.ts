import type { ScreenContext } from "../../types";

export interface ScreenCaptureProvider {
  readonly id: string;
  captureActiveDisplay(): Promise<ScreenContext>;
}
