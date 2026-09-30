import { useEffect, useRef } from "react";
import { createMoonScene } from "@/components/voice/moonScene";
import { readLevel } from "@/lib/voiceAudio";

// Full-screen canvas behind the call UI. The moon is centred on `stageRef`
// (the empty flex area the layout reserves for it), so text and controls
// never overlap it on any screen size.
//   flareKey  any change blooms the moon once (your words were sent)
//   exiting   true → moonset (~450 ms); unmount after it
export default function MoonCanvas({ state, analyser, activityKey, stageRef, flareKey, exiting }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scene = createMoonScene(canvas, { reducedMotion: reduced });
    sceneRef.current = scene;

    const place = () => {
      scene.resize();
      const stage = stageRef.current;
      if (!stage) return;
      const c = canvas.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      scene.setAnchor(
        s.left - c.left + s.width / 2,
        s.top - c.top + s.height / 2,
        Math.min(s.width * 0.33, s.height * 0.36)
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(canvas);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => {
      ro.disconnect();
      scene.destroy();
      sceneRef.current = null;
    };
  }, [stageRef]);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (!analyser) {
      sceneRef.current?.setLevelSource(null);
      return;
    }
    const buffer = new Uint8Array(analyser.fftSize);
    sceneRef.current?.setLevelSource(() => readLevel(analyser, buffer));
  }, [analyser]);

  // Every new recognised word makes the corona swell while you talk.
  useEffect(() => {
    if (activityKey) sceneRef.current?.pulse();
  }, [activityKey]);

  // Only a change flares — not the value the call opened with.
  const lastFlareKey = useRef(flareKey);
  useEffect(() => {
    if (flareKey === lastFlareKey.current) return;
    lastFlareKey.current = flareKey;
    sceneRef.current?.flare();
  }, [flareKey]);

  useEffect(() => {
    if (exiting) sceneRef.current?.exit();
  }, [exiting]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
