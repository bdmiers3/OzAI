import type { SpeechSynthesizer } from "./SpeechSynthesizer";

export class SystemSpeechSynthesizer implements SpeechSynthesizer {
  readonly available =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  speak(text: string) {
    if (!this.available || !text.trim()) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const localEnglishVoice =
      voices.find((voice) => voice.localService && voice.lang.startsWith("en")) ??
      voices.find((voice) => voice.lang.startsWith("en"));

    if (localEnglishVoice) utterance.voice = localEnglishVoice;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  cancel() {
    if (this.available) window.speechSynthesis.cancel();
  }
}
