// Test kit (not a test suite, never imported by the app): a fake
// AudioContext for lib/voiceAudio.js and lib/voicePlayer.js tests, and PCM
// test audio. Its clock only moves when a test calls advance(): every source
// that has finished by then reports its end.

export const RATE = 24000;

export class FakeContext {
  constructor() {
    FakeContext.last = this;
    this.sampleRate = 48000;
    this.reset();
  }

  reset() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = { kind: "speakers" };
    this.sources = [];
    this.analysers = [];
    this.listeners = [];
  }

  resume() {
    this.setState("running");
    return Promise.resolve();
  }

  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }

  createBufferSource() {
    const src = {
      buffer: null, onended: null, at: null, stopped: false, ended: false, output: null,
      connect(node) { src.output = node; },
      disconnect() {},
      start(at) { src.at = at; },
      stop() { src.stopped = true; },
    };
    this.sources.push(src);
    return src;
  }

  createAnalyser() {
    const a = { kind: "analyser", fftSize: 2048, smoothingTimeConstant: 0.8, connect() {}, disconnect() {} };
    this.analysers.push(a);
    return a;
  }

  createMediaElementSource(element) {
    return { kind: "element", element, connect() {}, disconnect() {} };
  }

  addEventListener(type, fn) {
    if (type === "statechange") this.listeners.push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.listeners.slice().forEach((f) => f());
  }

  // Blocks that were scheduled to be heard.
  played() {
    return this.sources.filter((s) => s.at !== null);
  }

  advance(to) {
    this.currentTime = to;
    this.sources.slice().forEach((src) => {
      if (src.at === null || src.stopped || src.ended) return;
      if (src.at + src.buffer.duration <= to + 1e-9) {
        src.ended = true;
        src.onended?.();
      }
    });
  }
}

// 16-bit little-endian bytes of these sample values.
export function pcm(values) {
  const bytes = new Uint8Array(values.length * 2);
  const v = new DataView(bytes.buffer);
  values.forEach((x, k) => v.setInt16(k * 2, x, true));
  return bytes;
}

// `seconds` of audio: a quiet ramp, or every sample `level` (to tell pieces apart).
export function audio(seconds, level = null) {
  return pcm(Array.from({ length: Math.round(seconds * RATE) }, (_, k) => (level === null ? (k % 2000) - 1000 : level)));
}

// The 16-bit value of a scheduled block's first sample.
export const firstValue = (src) => Math.round(src.buffer.getChannelData(0)[0] * 32768);
