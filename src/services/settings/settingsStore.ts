export type OzTheme = "oz" | "midnight" | "graphite";

export interface OzSettings {
  model: string;
  alwaysOnTop: boolean;
  rememberWindowPosition: boolean;
  theme: OzTheme;
  globalShortcut: string;
  screenEnabled: boolean;
  selectedMicrophone: string;
  spokenAnswers: boolean;
}

export interface SavedWindowPosition {
  x: number;
  y: number;
}

const SETTINGS_KEY = "oz.settings.v1";
const WINDOW_POSITION_KEY = "oz.windowPosition.v1";

const VALID_THEMES = new Set<OzTheme>(["oz", "midnight", "graphite"]);
const VALID_SHORTCUTS = new Set([
  "CommandOrControl+Shift+Space",
  "CommandOrControl+Alt+Space",
  "Alt+Shift+Space",
  "disabled",
]);

export const DEFAULT_OZ_SETTINGS: OzSettings = {
  model: "qwen3-vl:8b",
  alwaysOnTop: false,
  rememberWindowPosition: true,
  theme: "oz",
  globalShortcut: "CommandOrControl+Shift+Space",
  screenEnabled: true,
  selectedMicrophone: "",
  spokenAnswers: false,
};

function storageAvailable() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

export function loadOzSettings(): OzSettings {
  if (!storageAvailable()) return { ...DEFAULT_OZ_SETTINGS };

  const legacyMicrophone = window.localStorage.getItem("oz.microphone") ?? "";
  const legacySpokenAnswers =
    window.localStorage.getItem("oz.spokenAnswers") === "true";

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_OZ_SETTINGS,
        selectedMicrophone: legacyMicrophone,
        spokenAnswers: legacySpokenAnswers,
      };
    }

    const parsed = JSON.parse(raw) as Partial<OzSettings>;
    return {
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model.trim().slice(0, 120)
          : DEFAULT_OZ_SETTINGS.model,
      alwaysOnTop: parsed.alwaysOnTop === true,
      rememberWindowPosition: parsed.rememberWindowPosition !== false,
      theme:
        typeof parsed.theme === "string" &&
        VALID_THEMES.has(parsed.theme as OzTheme)
          ? (parsed.theme as OzTheme)
          : DEFAULT_OZ_SETTINGS.theme,
      globalShortcut:
        typeof parsed.globalShortcut === "string" &&
        VALID_SHORTCUTS.has(parsed.globalShortcut)
          ? parsed.globalShortcut
          : DEFAULT_OZ_SETTINGS.globalShortcut,
      screenEnabled: parsed.screenEnabled !== false,
      selectedMicrophone:
        typeof parsed.selectedMicrophone === "string"
          ? parsed.selectedMicrophone
          : legacyMicrophone,
      spokenAnswers:
        typeof parsed.spokenAnswers === "boolean"
          ? parsed.spokenAnswers
          : legacySpokenAnswers,
    };
  } catch (error) {
    console.warn("Oz could not load settings.", error);
    return {
      ...DEFAULT_OZ_SETTINGS,
      selectedMicrophone: legacyMicrophone,
      spokenAnswers: legacySpokenAnswers,
    };
  }
}

export function saveOzSettings(settings: OzSettings) {
  if (!storageAvailable()) return;

  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Oz could not save settings.", error);
  }
}

export function loadWindowPosition(): SavedWindowPosition | null {
  if (!storageAvailable()) return null;

  try {
    const raw = window.localStorage.getItem(WINDOW_POSITION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SavedWindowPosition>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;

    return { x: Number(parsed.x), y: Number(parsed.y) };
  } catch {
    return null;
  }
}

export function saveWindowPosition(position: SavedWindowPosition) {
  if (!storageAvailable()) return;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;

  try {
    window.localStorage.setItem(WINDOW_POSITION_KEY, JSON.stringify(position));
  } catch (error) {
    console.warn("Oz could not save the window position.", error);
  }
}
