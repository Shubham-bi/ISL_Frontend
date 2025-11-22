export function speak(text, lang = "en-IN") {
  if (!text || typeof text !== "string") return;

  const utter = new SpeechSynthesisUtterance(text);

  utter.lang = lang;      // "en-IN" or "hi-IN"
  utter.rate = 1;         // speed
  utter.pitch = 1;        // voice pitch
  utter.volume = 1;       // full volume

  // (Optional) choose a specific voice
  // const voices = speechSynthesis.getVoices();
  // utter.voice = voices.find(v => v.lang === "en-IN") || voices[0];

  speechSynthesis.speak(utter);
}
