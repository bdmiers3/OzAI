import { useEffect } from "react";
import type { MicrophoneDevice } from "../types";
import type { OzTheme } from "../services/settings/settingsStore";

interface SettingsDrawerProps {
  open: boolean;
  disabled: boolean;
  tauriRuntime: boolean;
  model: string;
  theme: OzTheme;
  alwaysOnTop: boolean;
  launchAtStartup: boolean;
  rememberWindowPosition: boolean;
  globalShortcut: string;
  screenEnabled: boolean;
  microphones: MicrophoneDevice[];
  selectedMicrophone: string;
  voiceAvailable: boolean;
  spokenAnswers: boolean;
  speechAvailable: boolean;
  notice: string | null;
  hasConversationData: boolean;
  onClose: () => void;
  onModelChange: (model: string) => void;
  onThemeChange: (theme: OzTheme) => void;
  onAlwaysOnTopChange: (enabled: boolean) => void;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  onRememberWindowPositionChange: (enabled: boolean) => void;
  onGlobalShortcutChange: (shortcut: string) => void;
  onScreenEnabledChange: (enabled: boolean) => void;
  onMicrophoneChange: (microphoneId: string) => void;
  onSpokenAnswersChange: (enabled: boolean) => void;
  onExportData: () => void;
  onClearHistory: () => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`settings-toggle${checked ? " is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function SettingsDrawer({
  open,
  disabled,
  tauriRuntime,
  model,
  theme,
  alwaysOnTop,
  launchAtStartup,
  rememberWindowPosition,
  globalShortcut,
  screenEnabled,
  microphones,
  selectedMicrophone,
  voiceAvailable,
  spokenAnswers,
  speechAvailable,
  notice,
  hasConversationData,
  onClose,
  onModelChange,
  onThemeChange,
  onAlwaysOnTopChange,
  onLaunchAtStartupChange,
  onRememberWindowPositionChange,
  onGlobalShortcutChange,
  onScreenEnabledChange,
  onMicrophoneChange,
  onSpokenAnswersChange,
  onExportData,
  onClearHistory,
}: SettingsDrawerProps) {
  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-layer" role="presentation">
      <button
        type="button"
        className="settings-backdrop"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside className="settings-drawer" aria-label="Oz settings">
        <div className="settings-drawer__header">
          <div>
            <span>PREFERENCES</span>
            <h2>Settings</h2>
          </div>
          <button
            type="button"
            className="settings-icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="settings-scroll">
          <section className="settings-section">
            <h3>General</h3>
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <strong>Launch at startup</strong>
                  <span>Open Oz automatically after signing in.</span>
                </div>
                <Toggle
                  checked={launchAtStartup}
                  disabled={!tauriRuntime || disabled}
                  onChange={onLaunchAtStartupChange}
                />
              </div>
              <div className="settings-row">
                <div>
                  <strong>Always on top</strong>
                  <span>Keep the Oz window above other apps.</span>
                </div>
                <Toggle
                  checked={alwaysOnTop}
                  disabled={!tauriRuntime || disabled}
                  onChange={onAlwaysOnTopChange}
                />
              </div>
              <div className="settings-row">
                <div>
                  <strong>Remember window position</strong>
                  <span>Restore Oz where you last moved it.</span>
                </div>
                <Toggle
                  checked={rememberWindowPosition}
                  disabled={!tauriRuntime || disabled}
                  onChange={onRememberWindowPositionChange}
                />
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3>Appearance</h3>
            <label className="settings-field">
              <span>Theme</span>
              <select
                value={theme}
                disabled={disabled}
                onChange={(event) => onThemeChange(event.target.value as OzTheme)}
              >
                <option value="oz">Oz dark</option>
                <option value="midnight">Midnight</option>
                <option value="graphite">Graphite</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3>AI</h3>
            <label className="settings-field">
              <span>Local model</span>
              <select
                value={model}
                disabled={disabled}
                onChange={(event) => onModelChange(event.target.value)}
              >
                <option value="qwen3-vl:2b">Qwen3-VL 2B · fastest</option>
                <option value="qwen3-vl:4b">Qwen3-VL 4B · balanced</option>
                <option value="qwen3-vl:8b">Qwen3-VL 8B · best quality</option>
              </select>
              <small>The selected model must already be installed in Ollama.</small>
            </label>
          </section>

          <section className="settings-section">
            <h3>Screen and voice</h3>
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <strong>Screen context by default</strong>
                  <span>Capture once only after you submit a prompt.</span>
                </div>
                <Toggle
                  checked={screenEnabled}
                  disabled={disabled}
                  onChange={onScreenEnabledChange}
                />
              </div>
              <div className="settings-field settings-field--inside">
                <span>Microphone</span>
                <select
                  value={selectedMicrophone}
                  disabled={!voiceAvailable || disabled}
                  onChange={(event) => onMicrophoneChange(event.target.value)}
                >
                  {microphones.length === 0 && (
                    <option value="">Default microphone</option>
                  )}
                  {microphones.map((microphone) => (
                    <option key={microphone.id} value={microphone.id}>
                      {microphone.label}
                      {microphone.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Speak answers</strong>
                  <span>Use the installed Windows system voice.</span>
                </div>
                <Toggle
                  checked={spokenAnswers}
                  disabled={!speechAvailable || disabled}
                  onChange={onSpokenAnswersChange}
                />
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3>Shortcut</h3>
            <label className="settings-field">
              <span>Show or hide Oz</span>
              <select
                value={globalShortcut}
                disabled={!tauriRuntime || disabled}
                onChange={(event) => onGlobalShortcutChange(event.target.value)}
              >
                <option value="CommandOrControl+Shift+Space">
                  Ctrl + Shift + Space
                </option>
                <option value="CommandOrControl+Alt+Space">
                  Ctrl + Alt + Space
                </option>
                <option value="Alt+Shift+Space">Alt + Shift + Space</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3>Data and privacy</h3>
            <div className="settings-data-actions">
              <button
                type="button"
                onClick={onExportData}
                disabled={!hasConversationData || disabled}
              >
                Export conversations
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={onClearHistory}
                disabled={!hasConversationData || disabled}
              >
                Clear conversation history
              </button>
            </div>
            <p className="settings-privacy-note">
              Conversation history and preferences stay in Oz’s local app storage.
              Screenshots and microphone recordings are not added to the export.
            </p>
          </section>
        </div>

        <div className="settings-drawer__footer">
          <span className={`settings-runtime-dot${tauriRuntime ? " is-native" : ""}`} />
          {notice ?? (tauriRuntime ? "Desktop settings are active" : "Browser preview")}
        </div>
      </aside>
    </div>
  );
}
