import { invoke } from "@tauri-apps/api/core";
import type { ScreenContext } from "../../types";
import type { ScreenCaptureProvider } from "./ScreenCaptureProvider";

export class TauriScreenCaptureProvider implements ScreenCaptureProvider {
  readonly id = "tauri-windows";

  async captureActiveDisplay(): Promise<ScreenContext> {
    return invoke<ScreenContext>("capture_active_display");
  }
}
