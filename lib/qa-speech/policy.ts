export const speechUnavailableMessage =
  "题目语音播报暂不可用，已切换为文字提问。你的回答录音不受影响。";

export const recoverableSpeechErrorCodes = new Set([
  "canceled",
  "interrupted",
]);

export const tencentQuestionAudioPlaybackRate = 1.1;

export function estimateQuestionSpeechMs(text: string) {
  const chineseCharCount = Array.from(text.trim()).length;

  return Math.min(28000, Math.max(5000, chineseCharCount * 170));
}

export function isSpeechSynthesisSupported() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function buildMoveOn(
  hasMovedOnRef: { current: boolean },
  beginPreAnswerCountdown: () => void,
) {
  return () => {
    if (hasMovedOnRef.current) {
      return;
    }

    hasMovedOnRef.current = true;
    beginPreAnswerCountdown();
  };
}

export function chooseJudgeVoice(voices: SpeechSynthesisVoice[]) {
  if (voices.length === 0) return null;

  const normalizedVoices = voices.map((voice) => ({
    voice,
    name: voice.name.toLowerCase(),
    lang: voice.lang.toLowerCase(),
  }));

  const isHuihui = ({ name }: { name: string }) =>
    name.includes("huihui") || name.includes("慧慧");
  const preferredNameKeywords = [
    "xiaoyi",
    "晓伊",
    "yunyang",
    "云扬",
    "xiaoxiao",
    "晓晓",
    "yunxi",
    "云希",
    "natural",
    "自然",
  ];

  const findByName = (
    keywords: string[],
    predicate?: (voice: { lang: string; name: string }) => boolean,
  ) => {
    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());

    return normalizedVoices.find(
      ({ name, lang }) =>
        (!predicate || predicate({ lang, name })) &&
        normalizedKeywords.some((keyword) => name.includes(keyword)),
    )?.voice;
  };

  const zhCNVoices = normalizedVoices.filter(({ lang }) => lang === "zh-cn");
  const zhVoices = normalizedVoices.filter(({ lang }) => lang.startsWith("zh-"));
  const nonHuihuiZhCNVoices = zhCNVoices.filter((voice) => !isHuihui(voice));
  const nonHuihuiZhVoices = zhVoices.filter((voice) => !isHuihui(voice));

  return (
    findByName(preferredNameKeywords, ({ lang }) => lang === "zh-cn") ??
    nonHuihuiZhCNVoices.find(({ voice }) => voice.default)?.voice ??
    nonHuihuiZhCNVoices[0]?.voice ??
    findByName(preferredNameKeywords, ({ lang }) => lang.startsWith("zh-")) ??
    nonHuihuiZhVoices.find(({ voice }) => voice.default)?.voice ??
    nonHuihuiZhVoices[0]?.voice ??
    findByName(preferredNameKeywords) ??
    findByName(["huihui", "慧慧"]) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}
