export function getVoicesAfterChange(timeoutMs: number) {
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(window.speechSynthesis.getVoices());
    }, timeoutMs);

    function handler() {
      window.clearTimeout(timeout);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", handler, {
      once: true,
    });
  });
}

export async function getVoicesWithRetry(timeoutMs = 3000) {
  const startedAt = Date.now();
  let voices = window.speechSynthesis.getVoices();

  if (voices.length > 0) {
    return voices;
  }

  voices = await getVoicesAfterChange(Math.min(1200, timeoutMs));

  while (voices.length === 0 && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    voices = window.speechSynthesis.getVoices();
  }

  return voices;
}
