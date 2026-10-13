/* global test, expect, jest, beforeEach, afterEach, require */
// components/VoiceCallModal.jsx — the help card on the call screen shows the
// user's OWN country's lines as the server sent them (safety.resources), for
// an HD call's transcript answer and for a classic turn alike: a US user sees
// 911 / 988, a Turkish-screen user in Germany sees Germany's lines — never
// Türkiye's ALO 183 by default. Run with:
//   CI=true npx craco test --watchAll=false src/components/VoiceCallModal
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/components/voice/MoonCanvas", () => function MoonCanvas() { return null; }, { virtual: true });
jest.mock("@/components/CrisisCard", () => jest.requireActual("./CrisisCard"), { virtual: true });
jest.mock("@/assets/luna-logo.webp", () => "luna-logo.webp", { virtual: true });
jest.mock("@/assets/luna-bg.jpg", () => "luna-bg.jpg", { virtual: true });
jest.mock("@/lib/spokenText", () => jest.requireActual("../lib/spokenText"), { virtual: true });
jest.mock("@/lib/haptics", () => ({ haptics: { tick() {}, error() {}, doubleTick() {} } }), { virtual: true });

const VoiceCallModal = require("./VoiceCallModal").default;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const US = [
  { label: "Acil yardım", label_en: "Emergency", labels: { tr: "Acil yardım", en: "Emergency" }, phone: "911" },
  { label: "988 Suicide & Crisis Lifeline", label_en: "988 Suicide & Crisis Lifeline", phone: "988" },
];
const DE = [
  { label: "Acil yardım", label_en: "Emergency", phone: "112" },
  { label: "TelefonSeelsorge", label_en: "TelefonSeelsorge", phone: "0800 111 0 111" },
];

let host;
let root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props) {
  act(() => {
    root.render(
      <VoiceCallModal
        lang="en" state="listening" capturing interim="" pendingText="" lastSent="" replyText=""
        speechProgress={() => 1} flareKey={0} onMainAction={() => {}} onTalkInstead={() => {}} onReplay={() => {}}
        onToggleHandsFree={() => {}} onClose={() => {}} {...props}
      />,
    );
  });
}

const phones = () => [...host.querySelectorAll("[data-testid^='crisis-call-']")].map((a) => a.textContent);

test("an HD call's help card shows the user's country's lines (US: 911 and 988)", () => {
  render({ realtime: true, realtimeSafety: { kind: "self_harm", resources: US } });
  expect(host.querySelector("[data-testid='crisis-call-911']")).not.toBeNull();
  expect(host.querySelector("[data-testid='crisis-call-988']")).not.toBeNull();
  expect(host.querySelector("[data-testid='crisis-directory']")).toBeNull();
  expect(host.textContent).not.toMatch(/183/);
});

test("a classic turn's help card too: a Turkish screen in Germany gets Germany's lines", () => {
  render({ lang: "tr", safety: { kind: "abuse", resources: DE } });
  expect(phones().join(" ")).toMatch(/112/);
  expect(phones().join(" ")).toMatch(/0800 111 0 111/);
  expect(host.textContent).not.toMatch(/ALO 183/);
});

test("no flagged message: no help card", () => {
  render({ realtime: true });
  expect(host.querySelector("[data-testid='crisis-card']")).toBeNull();
});
