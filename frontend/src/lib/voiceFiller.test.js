/* global test, expect, jest, beforeEach, describe, require */
// lib/voiceFiller.js — her "hmm" clips come only in the voice she speaks
// with: picked from public/voice/fillers/manifest.json (made by
// backend/scripts/generate_filler_clips.py) for the current voice; no
// manifest, a placeholder one or no clips in her voice = no filler. Run with:
//   CI=true npx craco test --watchAll=false src/lib/voiceFiller

// The app's "@/" alias is webpack's, not Jest's (see hooks/useVoiceCall.test.js).
jest.mock("@/lib/voiceAudio", () => {
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    decodeAudioData(data, ok) { const b = { duration: 0.5 }; if (ok) ok(b); return Promise.resolve(b); },
    createGain() {
      return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    },
    createBufferSource() {
      return { buffer: null, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} };
    },
  };
  return { voiceContext: () => ctx, contextAlwaysAudible: () => true };
}, { virtual: true });

const settle = () => new Promise((r) => setTimeout(r, 20));

const MANIFEST = {
  version: 2,
  voice: "marin",
  clips: { tr: ["tr-1.mp3", "tr-2.mp3"], en: ["en-1.mp3"] },
  voices: {
    marin: { tr: ["tr-1.mp3", "tr-2.mp3"], en: ["en-1.mp3"] },
    coral: { tr: ["coral/tr-1.mp3"] },
  },
};

let fetched;
let manifest;
function serve() {
  fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).endsWith("manifest.json")) {
      return manifest === undefined ? { ok: false, status: 404 } : { ok: true, json: async () => manifest };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
}

let mod;
beforeEach(() => {
  jest.resetModules(); // a fresh module: its manifest and decoded clips are per page session
  manifest = MANIFEST;
  serve();
  mod = require("./voiceFiller");
});

describe("fillerClipsFor", () => {
  test("the default voice's clips when her voice is unknown or is that voice", () => {
    expect(mod.fillerClipsFor(MANIFEST, null, "tr")).toEqual(["tr-1.mp3", "tr-2.mp3"]);
    expect(mod.fillerClipsFor(MANIFEST, "marin", "en")).toEqual(["en-1.mp3"]);
  });

  test("another voice's own clips, and none for a voice without any", () => {
    expect(mod.fillerClipsFor(MANIFEST, "coral", "tr")).toEqual(["coral/tr-1.mp3"]);
    expect(mod.fillerClipsFor(MANIFEST, "coral", "en")).toEqual([]);
    expect(mod.fillerClipsFor(MANIFEST, "sage", "tr")).toEqual([]);
  });

  test("no manifest, a placeholder or unsafe paths: nothing", () => {
    expect(mod.fillerClipsFor(null, null, "tr")).toEqual([]);
    expect(mod.fillerClipsFor({ version: 2, voice: null, clips: {}, voices: {} }, null, "tr")).toEqual([]);
    const bad = { voice: "marin", clips: { tr: ["../secret.mp3", "a/b/c.mp3", "x.wav", 7, "ok-1.mp3", "https://x/y.mp3"] } };
    expect(mod.fillerClipsFor(bad, null, "tr")).toEqual(["ok-1.mp3"]);
    const many = { voice: "marin", clips: { tr: Array.from({ length: 20 }, (_, i) => `tr-${i}.mp3`) } };
    expect(mod.fillerClipsFor(many, null, "tr")).toHaveLength(8);
  });
});

describe("preloading in her voice", () => {
  test("unknown voice: the default voice's clips are loaded and can play", async () => {
    mod.preloadFillers("tr");
    await settle();
    expect(fetched).toEqual(["/voice/fillers/manifest.json", "/voice/fillers/tr-1.mp3", "/voice/fillers/tr-2.mp3"]);
    const filler = mod.createVoiceFiller();
    expect(filler.ready("tr")).toBe(true);
    expect(filler.play("tr")).toBe(true);
    filler.stop();
  });

  test("a voice with its own clips gets those", async () => {
    mod.setFillerVoice("coral");
    mod.preloadFillers("tr");
    await settle();
    expect(fetched).toEqual(["/voice/fillers/manifest.json", "/voice/fillers/coral/tr-1.mp3"]);
    expect(mod.createVoiceFiller().ready("tr")).toBe(true);
  });

  test("a voice without clips: no filler at all, never another voice's", async () => {
    mod.setFillerVoice("sage");
    mod.preloadFillers("tr");
    await settle();
    expect(fetched).toEqual(["/voice/fillers/manifest.json"]);
    const filler = mod.createVoiceFiller();
    expect(filler.ready("tr")).toBe(false);
    expect(filler.play("tr")).toBe(false);
  });

  test("the voice changing: the clips of the new voice are what count", async () => {
    mod.preloadFillers("tr");
    await settle();
    const filler = mod.createVoiceFiller();
    expect(filler.ready("tr")).toBe(true);
    mod.setFillerVoice("sage");
    expect(filler.ready("tr")).toBe(false);
    mod.setFillerVoice("marin");
    mod.preloadFillers("tr");
    await settle();
    expect(filler.ready("tr")).toBe(true);
  });

  test("no manifest (old deployment) or the placeholder: no filler", async () => {
    manifest = undefined;
    mod.preloadFillers("tr");
    await settle();
    expect(mod.createVoiceFiller().ready("tr")).toBe(false);
    jest.resetModules();
    manifest = { version: 2, voice: null, clips: {}, voices: {} };
    serve();
    mod = require("./voiceFiller");
    mod.preloadFillers("tr");
    await settle();
    expect(mod.createVoiceFiller().ready("tr")).toBe(false);
    expect(fetched).toEqual(["/voice/fillers/manifest.json"]);
  });

  test("a voice name that isn't one is ignored", () => {
    mod.setFillerVoice("../../x");
    mod.setFillerVoice(42);
    expect(mod.fillerClipsFor(MANIFEST, null, "tr")).toEqual(["tr-1.mp3", "tr-2.mp3"]);
  });
});
