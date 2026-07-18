import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const hookHarness = {
  effectCursor: 0,
  effects: [],
  refCursor: 0,
  refs: [],
  stateCursor: 0,
  states: [],
};
globalThis.__qaSpeechTestHarness = hookHarness;

const reactUrl = dataModule(`
  export function useCallback(callback) {
    return callback;
  }
  export function useEffect(effect) {
    const harness = globalThis.__qaSpeechTestHarness;
    const index = harness.effectCursor++;
    harness.effects[index] = effect;
  }
  export function useRef(initialValue) {
    const harness = globalThis.__qaSpeechTestHarness;
    const index = harness.refCursor++;
    if (!(index in harness.refs)) {
      harness.refs[index] = { current: initialValue };
    }
    return harness.refs[index];
  }
  export function useState(initialValue) {
    const harness = globalThis.__qaSpeechTestHarness;
    const index = harness.stateCursor++;
    if (!(index in harness.states)) {
      harness.states[index] =
        typeof initialValue === "function" ? initialValue() : initialValue;
    }
    return [harness.states[index], (nextValue) => {
      const currentValue = harness.states[index];
      harness.states[index] =
        typeof nextValue === "function" ? nextValue(currentValue) : nextValue;
    }];
  }
`);
const devLogUrl = dataModule(`
  export function devLog(...args) {
    globalThis.__qaSpeechBrowserHarness.devLogs.push(args);
  }
`);

async function transpileModule(relativePath, replacements = {}) {
  let source = await readFile(path.resolve(relativePath), "utf8");
  for (const [specifier, replacement] of Object.entries(replacements)) {
    source = source.replaceAll(specifier, replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return dataModule(transpiled);
}

const policyUrl = await transpileModule("lib/qa-speech/policy.ts");
const typesUrl = await transpileModule("lib/qa-speech/types.ts", {
  'from "react"': `from "${reactUrl}"`,
});
const voiceSelectionUrl = await transpileModule(
  "lib/qa-speech/voice-selection.ts",
);
const resourcesUrl = await transpileModule(
  "lib/qa-speech/use-speech-resources.ts",
  { 'from "react"': `from "${reactUrl}"` },
);
const controlsUrl = await transpileModule(
  "lib/qa-speech/use-speech-controls.ts",
  {
    'from "react"': `from "${reactUrl}"`,
    "./use-speech-resources": resourcesUrl,
  },
);
const judgeVoiceUrl = await transpileModule(
  "lib/qa-speech/use-judge-voice.ts",
  {
    'from "react"': `from "${reactUrl}"`,
    "@/lib/dev-log": devLogUrl,
    "./policy": policyUrl,
    "./voice-selection": voiceSelectionUrl,
    "./use-speech-resources": resourcesUrl,
  },
);
const dialogUrl = await transpileModule(
  "lib/qa-speech/use-question-dialog.ts",
  {
    'from "react"': `from "${reactUrl}"`,
    "@/lib/dev-log": devLogUrl,
    "./policy": policyUrl,
    "./types": typesUrl,
    "./use-speech-resources": resourcesUrl,
  },
);
const browserSpeechUrl = await transpileModule(
  "lib/qa-speech/use-browser-question-speech.ts",
  {
    'from "react"': `from "${reactUrl}"`,
    "@/lib/dev-log": devLogUrl,
    "./policy": policyUrl,
    "./types": typesUrl,
    "./use-speech-resources": resourcesUrl,
    "./voice-selection": voiceSelectionUrl,
  },
);
const tencentSpeechUrl = await transpileModule(
  "lib/qa-speech/use-tencent-question-speech.ts",
  {
    'from "react"': `from "${reactUrl}"`,
    "@/lib/dev-log": devLogUrl,
    "./policy": policyUrl,
    "./types": typesUrl,
    "./use-speech-resources": resourcesUrl,
  },
);
const speechRunUrl = await transpileModule(
  "lib/qa-speech/use-question-speech-run.ts",
  {
    'from "react"': `from "${reactUrl}"`,
    "./policy": policyUrl,
    "./types": typesUrl,
    "./use-speech-resources": resourcesUrl,
  },
);
const hookUrl = await transpileModule("lib/qa-speech/use-qa-speech.ts", {
  'from "react"': `from "${reactUrl}"`,
  "./use-browser-question-speech": browserSpeechUrl,
  "./use-judge-voice": judgeVoiceUrl,
  "./use-question-dialog": dialogUrl,
  "./use-question-speech-run": speechRunUrl,
  "./use-speech-controls": controlsUrl,
  "./use-speech-resources": resourcesUrl,
  "./use-tencent-question-speech": tencentSpeechUrl,
  "./types": typesUrl,
});
const speechUrl = await transpileModule("lib/use-qa-speech.ts", {
  "./qa-speech/policy": policyUrl,
  "./qa-speech/types": typesUrl,
  "./qa-speech/use-qa-speech": hookUrl,
});
const speechModule = await import(speechUrl);

const browserHarness = {
  audioInstances: [],
  audioPlay: async () => undefined,
  cancelCalls: 0,
  createdUrls: [],
  devLogs: [],
  fetchCalls: [],
  fetchImpl: async () => ({ ok: false }),
  localStorageWrites: [],
  nextTimerId: 1,
  revokedUrls: [],
  speakCalls: [],
  timers: new Map(),
  voices: [],
};
globalThis.__qaSpeechBrowserHarness = browserHarness;

class FakeSpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.rate = 1;
    this.pitch = 1;
    this.voice = null;
  }
}

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.playbackRate = 1;
    this.pauseCalls = 0;
    this.loadCalls = 0;
    this.removedAttributes = [];
    browserHarness.audioInstances.push(this);
  }

  pause() {
    this.pauseCalls += 1;
  }

  removeAttribute(name) {
    this.removedAttributes.push(name);
  }

  load() {
    this.loadCalls += 1;
  }

  play() {
    return browserHarness.audioPlay(this);
  }
}

function resetHookHarness() {
  hookHarness.effects = [];
  hookHarness.refs = [];
  hookHarness.states = [];
  resetRenderCursors();
}

function resetRenderCursors() {
  hookHarness.effectCursor = 0;
  hookHarness.refCursor = 0;
  hookHarness.stateCursor = 0;
}

function resetBrowserHarness() {
  browserHarness.audioInstances = [];
  browserHarness.audioPlay = async () => undefined;
  browserHarness.cancelCalls = 0;
  browserHarness.createdUrls = [];
  browserHarness.devLogs = [];
  browserHarness.fetchCalls = [];
  browserHarness.fetchImpl = async () => ({ ok: false });
  browserHarness.localStorageWrites = [];
  browserHarness.nextTimerId = 1;
  browserHarness.revokedUrls = [];
  browserHarness.speakCalls = [];
  browserHarness.timers = new Map();
  browserHarness.voices = [
    { default: true, lang: "zh-CN", name: "Microsoft Huihui" },
    { default: false, lang: "zh-CN", name: "Microsoft Xiaoyi Natural" },
  ];

  const speechSynthesis = {
    pending: false,
    speaking: false,
    addEventListener() {},
    removeEventListener() {},
    cancel() {
      browserHarness.cancelCalls += 1;
    },
    getVoices() {
      return browserHarness.voices;
    },
    resume() {},
    speak(utterance) {
      browserHarness.speakCalls.push(utterance);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout(timerId) {
        browserHarness.timers.delete(timerId);
      },
      setTimeout(callback, delay) {
        const timerId = browserHarness.nextTimerId++;
        browserHarness.timers.set(timerId, { callback, delay });
        return timerId;
      },
      speechSynthesis,
    },
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: FakeSpeechSynthesisUtterance,
  });
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: FakeAudio,
  });
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: {
      createObjectURL(blob) {
        const url = `blob:qa-speech-${browserHarness.createdUrls.length + 1}`;
        browserHarness.createdUrls.push({ blob, url });
        return url;
      },
      revokeObjectURL(url) {
        browserHarness.revokedUrls.push(url);
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem(key, value) {
        browserHarness.localStorageWrites.push([key, value]);
      },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (...args) => {
      browserHarness.fetchCalls.push(args);
      return browserHarness.fetchImpl(...args);
    },
  });
}

function createSpeechHook(overrides = {}) {
  resetHookHarness();
  const context = {
    beginCalls: 0,
    hasAutoEndedRef: { current: false },
    messages: [],
    revealedQuestionIds: [],
  };
  const options = {
    sessionId: "session-1",
    status: "IDLE",
    hasAutoEndedRef: context.hasAutoEndedRef,
    beginPreAnswerCountdown: () => {
      context.beginCalls += 1;
    },
    onMessageChange: (message) => {
      context.messages.push(message);
    },
    onQuestionTextRevealed: (questionId) => {
      context.revealedQuestionIds.push(questionId);
    },
    ...overrides,
  };

  return {
    context,
    render(renderOverrides = {}) {
      resetRenderCursors();
      return speechModule.useQaSpeech({ ...options, ...renderOverrides });
    },
  };
}

function runTimerWithDelay(delay) {
  const timerEntry = [...browserHarness.timers.entries()].find(
    ([, timer]) => timer.delay === delay,
  );
  assert.ok(timerEntry, `expected a ${delay}ms timer`);
  const [timerId, timer] = timerEntry;
  browserHarness.timers.delete(timerId);
  timer.callback();
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const question = {
  id: "question-1",
  orderIndex: 1,
  questionText: "请介绍项目",
  questionType: "GENERAL",
  source: "BASE",
  basis: null,
};

test("QA speech hook preserves playback, fallback and cleanup policies", async (t) => {
  const descriptors = Object.fromEntries(
    [
      "Audio",
      "fetch",
      "localStorage",
      "SpeechSynthesisUtterance",
      "URL",
      "window",
    ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );

  try {
    await t.test("unsupported speech reveals text and confirms the fallback", () => {
      resetBrowserHarness();
      Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
        configurable: true,
        value: undefined,
      });
      const hook = createSpeechHook();
      let result = hook.render();

      result.startQuestionSpeech(question);

      assert.equal(browserHarness.fetchCalls.length, 0);
      assert.equal(hookHarness.states[0].mode, "fallback");
      assert.deepEqual(hook.context.revealedQuestionIds, [question.id]);
      assert.equal(
        hook.context.messages.at(-1),
        speechModule.speechUnavailableMessage,
      );

      result = hook.render();
      result.confirmFallbackQuestionRead();

      assert.equal(hookHarness.states[0], null);
      assert.equal(hook.context.messages.at(-1), "");
      assert.equal(hook.context.beginCalls, 1);
    });

    await t.test("Tencent audio plays first and releases resources on end", async () => {
      resetBrowserHarness();
      const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
      browserHarness.fetchImpl = async () => ({
        ok: true,
        blob: async () => audioBlob,
      });
      const hook = createSpeechHook();
      const result = hook.render();

      result.startQuestionSpeech(question);
      await flushAsyncWork();

      assert.equal(
        browserHarness.fetchCalls[0][0],
        "/training/session-1/qa/questions/question-1/tts",
      );
      assert.equal(browserHarness.audioInstances.length, 1);
      const audio = browserHarness.audioInstances[0];
      assert.equal(audio.playbackRate, 1.1);
      assert.equal(audio.src, "blob:qa-speech-1");

      audio.onended();

      assert.equal(audio.pauseCalls, 1);
      assert.deepEqual(audio.removedAttributes, ["src"]);
      assert.equal(audio.loadCalls, 1);
      assert.deepEqual(browserHarness.revokedUrls, ["blob:qa-speech-1"]);
      assert.equal(hook.context.beginCalls, 1);
      assert.equal(hookHarness.states[0], null);
    });

    await t.test("failed Tencent request uses the preferred browser voice", async () => {
      resetBrowserHarness();
      const hook = createSpeechHook();
      const result = hook.render();

      result.startQuestionSpeech(question);
      await flushAsyncWork();

      assert.equal(browserHarness.speakCalls.length, 1);
      const utterance = browserHarness.speakCalls[0];
      assert.equal(utterance.text, question.questionText);
      assert.equal(utterance.voice.name, "Microsoft Xiaoyi Natural");
      assert.equal(utterance.lang, "zh-CN");
      assert.equal(utterance.rate, 1.15);
      assert.equal(utterance.pitch, 0.92);
      assert.deepEqual(browserHarness.localStorageWrites, [
        ["qa-preferred-voice", "Microsoft Xiaoyi Natural"],
      ]);

      utterance.onstart();
      utterance.onend();
      runTimerWithDelay(5000);

      assert.equal(hook.context.beginCalls, 1);
      assert.deepEqual(hook.context.revealedQuestionIds, []);
    });

    await t.test("recoverable browser errors retry once before text fallback", async () => {
      resetBrowserHarness();
      const hook = createSpeechHook();
      const result = hook.render();

      result.startQuestionSpeech(question);
      await flushAsyncWork();
      browserHarness.speakCalls[0].onerror({ error: "canceled" });
      runTimerWithDelay(180);

      assert.equal(browserHarness.speakCalls.length, 2);
      browserHarness.speakCalls[1].onerror({ error: "interrupted" });

      assert.equal(browserHarness.speakCalls.length, 2);
      assert.equal(hookHarness.states[0].mode, "fallback");
      assert.deepEqual(hook.context.revealedQuestionIds, [question.id]);
      assert.equal(
        hook.context.messages.at(-1),
        speechModule.speechUnavailableMessage,
      );
    });

    await t.test("browser speech that never starts falls back after its estimate", async () => {
      resetBrowserHarness();
      const hook = createSpeechHook();
      const result = hook.render();

      result.startQuestionSpeech(question);
      await flushAsyncWork();
      runTimerWithDelay(5000);

      assert.equal(hookHarness.states[0].mode, "fallback");
      assert.deepEqual(hook.context.revealedQuestionIds, [question.id]);
      assert.equal(hook.context.beginCalls, 0);
    });

    await t.test("a stale Tencent response cannot replace the current question", async () => {
      resetBrowserHarness();
      const pendingResponses = [];
      browserHarness.fetchImpl = (...args) =>
        new Promise((resolve) => pendingResponses.push({ args, resolve }));
      const hook = createSpeechHook();
      const result = hook.render();
      const nextQuestion = {
        ...question,
        id: "question-2",
        orderIndex: 2,
        questionText: "请说明市场规模",
      };

      result.startQuestionSpeech(question);
      result.startQuestionSpeech(nextQuestion);
      pendingResponses[0].resolve({
        ok: true,
        blob: async () => new Blob(["old audio"]),
      });
      await flushAsyncWork();

      assert.equal(browserHarness.audioInstances.length, 0);

      pendingResponses[1].resolve({
        ok: true,
        blob: async () => new Blob(["current audio"]),
      });
      await flushAsyncWork();

      assert.equal(browserHarness.audioInstances.length, 1);
      assert.equal(hookHarness.states[0].question.id, nextQuestion.id);
      result.cancelSpeech();
      result.clearSpeechTimer();
    });

    await t.test("cancellation clears Tencent audio, URL, timer and browser speech", async () => {
      resetBrowserHarness();
      browserHarness.fetchImpl = async () => ({
        ok: true,
        blob: async () => new Blob(["audio"]),
      });
      const hook = createSpeechHook();
      const result = hook.render();

      result.startQuestionSpeech(question);
      await flushAsyncWork();
      const audio = browserHarness.audioInstances[0];

      result.cancelSpeech();
      result.clearSpeechTimer();

      assert.equal(audio.pauseCalls, 1);
      assert.equal(audio.loadCalls, 1);
      assert.deepEqual(browserHarness.revokedUrls, ["blob:qa-speech-1"]);
      assert.equal(browserHarness.cancelCalls, 1);
      assert.equal(browserHarness.timers.size, 0);
    });

    await t.test("review dialogs close without starting the answer countdown", () => {
      resetBrowserHarness();
      const hook = createSpeechHook();
      let result = hook.render();
      result.setQuestionTextDialog({ question, mode: "review" });

      result = hook.render();
      result.confirmFallbackQuestionRead();

      assert.equal(hookHarness.states[0], null);
      assert.equal(hook.context.beginCalls, 0);
      assert.deepEqual(hook.context.messages, []);
    });
  } finally {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
    delete globalThis.__qaSpeechBrowserHarness;
    delete globalThis.__qaSpeechTestHarness;
  }
});
