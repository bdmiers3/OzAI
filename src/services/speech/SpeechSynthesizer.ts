export interface SpeechSynthesizer {
  readonly available: boolean;
  speak(text: string): void;
  cancel(): void;
}
