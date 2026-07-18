import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const harness = {
  createKeyCalls: [],
  effects: [],
  fetchCalls: [],
  states: [],
  updates: [],
  createUploadIdempotencyKey(prefix) {
    this.createKeyCalls.push(prefix);
    return "pitch-recording-test-key-0001";
  },
  async fetch(...args) {
    this.fetchCalls.push(args);
    throw new Error("fetch test double is not configured");
  },
};
globalThis.__pitchRecordingTestHarness = harness;

const reactUrl = dataModule(`
  export function useCallback(callback) {
    return callback;
  }
  export function useEffect(effect) {
    globalThis.__pitchRecordingTestHarness.effects.push(effect);
  }
  export function useRef(initialValue) {
    return { current: initialValue };
  }
  export function useState(initialValue) {
    const harness = globalThis.__pitchRecordingTestHarness;
    const index = harness.states.length;
    let value = typeof initialValue === "function" ? initialValue() : initialValue;
    harness.states.push(value);
    return [value, (nextValue) => {
      value = typeof nextValue === "function" ? nextValue(value) : nextValue;
      harness.states[index] = value;
      harness.updates.push({ index, value });
    }];
  }
`);
const audioInputUrl = dataModule(`
  export const PREFERRED_DEVICE_KEY = "preferred-audio-input-device";
`);
const uploadIdempotencyUrl = dataModule(`
  export function createUploadIdempotencyKey(prefix) {
    return globalThis.__pitchRecordingTestHarness.createUploadIdempotencyKey(prefix);
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

const typesUrl = await transpileModule("lib/pitch-recording/types.ts");
const mediaPolicyUrl = await transpileModule(
  "lib/pitch-recording/media-policy.ts",
  { "@/lib/use-audio-input": audioInputUrl },
);
const stateUrl = await transpileModule(
  "lib/pitch-recording/use-recording-state.ts",
  {
    react: reactUrl,
    "./types": typesUrl,
  },
);
const resourcesUrl = await transpileModule(
  "lib/pitch-recording/use-recording-resources.ts",
  { react: reactUrl },
);
const uploadUrl = await transpileModule(
  "lib/pitch-recording/use-recording-upload.ts",
  {
    react: reactUrl,
    "@/lib/client-upload-idempotency": uploadIdempotencyUrl,
    "./media-policy": mediaPolicyUrl,
    "./use-recording-resources": resourcesUrl,
    "./use-recording-state": stateUrl,
    "./types": typesUrl,
  },
);
const streamUrl = await transpileModule(
  "lib/pitch-recording/use-recording-stream.ts",
  {
    react: reactUrl,
    "./media-policy": mediaPolicyUrl,
    "./use-recording-resources": resourcesUrl,
    "./use-recording-state": stateUrl,
  },
);
const mediaRecorderUrl = await transpileModule(
  "lib/pitch-recording/use-media-recorder.ts",
  {
    react: reactUrl,
    "./media-policy": mediaPolicyUrl,
    "./use-recording-resources": resourcesUrl,
    "./use-recording-state": stateUrl,
  },
);
const mediaUrl = await transpileModule(
  "lib/pitch-recording/use-recording-media.ts",
  {
    react: reactUrl,
    "./use-media-recorder": mediaRecorderUrl,
    "./use-recording-stream": streamUrl,
    "./use-recording-resources": resourcesUrl,
    "./use-recording-state": stateUrl,
  },
);
const preferenceUrl = await transpileModule(
  "lib/pitch-recording/use-recording-preference.ts",
  {
    react: reactUrl,
    "./use-recording-resources": resourcesUrl,
    "./use-recording-state": stateUrl,
    "./types": typesUrl,
  },
);
const hookUrl = await transpileModule(
  "lib/pitch-recording/use-pitch-recording.ts",
  {
    react: reactUrl,
    "./use-recording-media": mediaUrl,
    "./use-recording-preference": preferenceUrl,
    "./use-recording-resources": resourcesUrl,
    "./use-recording-state": stateUrl,
    "./use-recording-upload": uploadUrl,
    "./types": typesUrl,
  },
);
const facadeUrl = await transpileModule("lib/use-pitch-recording.ts", {
  "./pitch-recording/use-pitch-recording": hookUrl,
  "./pitch-recording/types": typesUrl,
});
const recordingModule = await import(facadeUrl);

function resetHarness() {
  harness.createKeyCalls = [];
  harness.effects = [];
  harness.fetchCalls = [];
  harness.states = [];
  harness.updates = [];
  harness.createUploadIdempotencyKey = function (prefix) {
    this.createKeyCalls.push(prefix);
    return "pitch-recording-test-key-0001";
  };
  harness.fetch = async function (...args) {
    this.fetchCalls.push(args);
    throw new Error("fetch test double is not configured");
  };
}

function renderRecordingHook(overrides = {}) {
  resetHarness();
  return recordingModule.usePitchRecording({
    sessionId: "session-1",
    initialStatus: "CREATED",
    initialRecording: null,
    autoStartRecordingOnMount: false,
    isPitching: false,
    isGuardResolved: false,
    ...overrides,
  });
}

function createLiveStream() {
  const tracks = [
    {
      readyState: "live",
      stopCalls: 0,
      stop() {
        this.stopCalls += 1;
      },
    },
  ];
  return {
    tracks,
    stream: {
      getAudioTracks: () => tracks,
      getTracks: () => tracks,
    },
  };
}

class FakeMediaRecorder {
  static instances = [];

  static isTypeSupported(mimeType) {
    return mimeType === "audio/mp4";
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType ?? "";
    this.state = "inactive";
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = "recording";
  }

  requestData() {
    this.ondataavailable?.({
      data: new Blob(["recorded audio"], {
        type: this.mimeType || "audio/webm",
      }),
    });
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

test("pitch recording hook preserves browser and upload policies", async (t) => {
  const descriptors = {
    fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    MediaRecorder: Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  };

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (...args) => harness.fetch(...args),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: { getItem: () => null },
      setTimeout: (callback) => {
        callback();
        return 1;
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null },
  });

  try {
    await t.test("initial recording state retains saved and undecided contracts", () => {
      let result = renderRecordingHook();
      assert.equal(result.recordingStatus, "UNDECIDED");
      assert.equal(result.recordingMessage, "");
      assert.equal(result.showRecordingPrepDialog, true);

      result = renderRecordingHook({
        initialStatus: "PITCHING",
        initialRecording: {
          id: "recording-1",
          phase: "PITCH",
          status: "READY",
          fileName: "pitch.webm",
          mimeType: "audio/webm",
          sizeBytes: 10,
          durationSec: 1,
          startedAt: null,
          endedAt: null,
          playbackUrl: "/recording-1",
          transcript: null,
        },
      });
      assert.equal(result.recordingStatus, "SAVED");
      assert.equal(result.recordingMessage, "录音已保存。");
      assert.equal(result.recordingId, "recording-1");
      assert.equal(result.recordingPlaybackUrl, "/recording-1");
      assert.equal(result.showRecordingPrepDialog, false);
    });

    await t.test("microphone preparation honors the preferred live device", async () => {
      const { stream, tracks } = createLiveStream();
      const constraints = [];
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          mediaDevices: {
            async getUserMedia(value) {
              constraints.push(value);
              return stream;
            },
          },
        },
      });
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem(key) {
            assert.equal(key, "preferred-audio-input-device");
            return "microphone-1";
          },
        },
      });
      const result = renderRecordingHook();

      await result.prepareRecording();
      await result.prepareRecording();

      assert.deepEqual(constraints, [
        { audio: { deviceId: { exact: "microphone-1" } } },
      ]);
      assert.equal(harness.states[0], "READY_TO_RECORD");
      assert.equal(harness.states[1], "麦克风已就绪，本轮将录音。");
      assert.equal(harness.states[4], false);
      result.stopMediaStream();
      assert.equal(tracks[0].stopCalls, 1);
    });

    await t.test("unsupported recording fails closed without requesting media", async () => {
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {},
      });
      const result = renderRecordingHook();

      await result.prepareRecording();

      assert.equal(harness.states[0], "UNSUPPORTED");
      assert.equal(
        harness.states[1],
        "当前浏览器不支持录音，本次仅记录路演操作。",
      );
      assert.equal(harness.states[6], false);
    });

    await t.test("raw upload keeps headers, duration and saved callback", async () => {
      const saved = [];
      const result = renderRecordingHook({
        onRecordingSaved: (recording) => saved.push(recording),
      });
      harness.fetch = async function (...args) {
        this.fetchCalls.push(args);
        return {
          ok: true,
          async json() {
            return {
              recording: {
                id: "saved-recording",
                playbackUrl: "/saved-recording",
                mimeType: "audio/mp4",
              },
            };
          },
        };
      };
      const blob = new Blob(["audio"], { type: "audio/mp4;codecs=mp4a.40.2" });
      const startedAt = new Date("2026-01-01T00:00:00.000Z");
      const endedAt = new Date("2026-01-01T00:00:01.600Z");

      const id = await result.uploadRecording(blob, startedAt, endedAt);

      assert.equal(id, "saved-recording");
      assert.equal(harness.fetchCalls.length, 1);
      const [url, request] = harness.fetchCalls[0];
      assert.equal(url, "/training/session-1/recordings");
      assert.equal(request.method, "POST");
      assert.equal(request.body, blob);
      assert.equal(request.headers["Content-Type"], "audio/mp4;codecs=mp4a.40.2");
      assert.equal(
        request.headers["Idempotency-Key"],
        "pitch-recording-test-key-0001",
      );
      assert.equal(request.headers["X-Recording-Upload"], "raw-v1");
      assert.equal(request.headers["X-Recording-Phase"], "PITCH");
      assert.equal(request.headers["X-Recording-Name"], "pitch-recording.m4a");
      assert.equal(request.headers["X-Recording-Duration-Sec"], "2");
      assert.equal(
        request.headers["X-Recording-Started-At"],
        startedAt.toISOString(),
      );
      assert.equal(request.headers["X-Recording-Ended-At"], endedAt.toISOString());
      assert.equal(harness.states[0], "SAVED");
      assert.equal(harness.states[2], "saved-recording");
      assert.equal(harness.states[3], "/saved-recording");
      assert.equal(saved.length, 1);
    });

    await t.test("failed uploads retain their idempotency key for retry", async () => {
      let attempt = 0;
      const result = renderRecordingHook();
      harness.fetch = async function (...args) {
        this.fetchCalls.push(args);
        attempt += 1;
        if (attempt === 1) {
          return {
            ok: false,
            async json() {
              return { error: "temporary upload failure" };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return {
              recording: {
                id: "retry-saved",
                playbackUrl: "/retry-saved",
                mimeType: "audio/wav",
              },
            };
          },
        };
      };
      const blob = new Blob(["audio"], { type: "audio/wav" });

      assert.equal(await result.uploadRecording(blob, null, new Date()), undefined);
      assert.equal(harness.states[0], "FAILED");
      assert.equal(harness.states[1], "temporary upload failure");
      assert.equal(await result.uploadRecording(blob, null, new Date()), "retry-saved");
      assert.equal(harness.createKeyCalls.length, 1);
      assert.equal(
        harness.fetchCalls[0][1].headers["Idempotency-Key"],
        harness.fetchCalls[1][1].headers["Idempotency-Key"],
      );
      assert.equal(harness.fetchCalls[1][1].headers["X-Recording-Name"], "pitch-recording.wav");
      assert.equal(
        "X-Recording-Started-At" in harness.fetchCalls[1][1].headers,
        false,
      );
    });

    await t.test("recording stop flushes chunks and uploads once", async () => {
      FakeMediaRecorder.instances = [];
      const { stream, tracks } = createLiveStream();
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          mediaDevices: { getUserMedia: async () => stream },
        },
      });
      const result = renderRecordingHook();
      harness.fetch = async function (...args) {
        this.fetchCalls.push(args);
        return {
          ok: true,
          async json() {
            return {
              recording: {
                id: "stopped-recording",
                playbackUrl: "/stopped-recording",
                mimeType: "audio/mp4",
              },
            };
          },
        };
      };

      await result.prepareRecording();
      await result.startRecording();
      assert.equal(result.isRecordingActive(), true);
      assert.equal(FakeMediaRecorder.instances[0].timeslice, 1000);
      assert.equal(FakeMediaRecorder.instances[0].options.mimeType, "audio/mp4");

      const savedId = await result.stopRecordingAndUpload();

      assert.equal(savedId, "stopped-recording");
      assert.equal(harness.fetchCalls.length, 1);
      assert.equal(tracks[0].stopCalls, 1);
      assert.equal(result.isRecordingActive(), false);
    });

    await t.test("auto-start preference defaults to opting out", () => {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          sessionStorage: {
            getItem(key) {
              assert.equal(key, "training:session-1:recordingPreference");
              return null;
            },
          },
          setTimeout(callback) {
            callback();
            return 1;
          },
        },
      });
      renderRecordingHook({
        autoStartRecordingOnMount: true,
        isPitching: true,
        isGuardResolved: true,
      });

      harness.effects[0]();

      assert.equal(harness.states[0], "OPTED_OUT");
      assert.equal(
        harness.states[1],
        "本轮未启用录音，仅记录翻页和用时。",
      );
    });

    await t.test("record preference prepares and starts automatically", async () => {
      FakeMediaRecorder.instances = [];
      const { stream, tracks } = createLiveStream();
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          mediaDevices: { getUserMedia: async () => stream },
        },
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          sessionStorage: { getItem: () => "record" },
          setTimeout,
        },
      });
      renderRecordingHook({
        autoStartRecordingOnMount: true,
        isPitching: true,
        isGuardResolved: true,
      });

      harness.effects[0]();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(harness.states[0], "RECORDING");
      assert.equal(FakeMediaRecorder.instances.length, 1);
      assert.equal(FakeMediaRecorder.instances[0].state, "recording");
      assert.equal(harness.createKeyCalls.length, 1);

      const cleanup = harness.effects[1]();
      cleanup();
      assert.equal(tracks[0].stopCalls, 1);
    });
  } finally {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
    delete globalThis.__pitchRecordingTestHarness;
  }
});
