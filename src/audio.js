import backgroundUrl from "../medieval_background.mp3?url";
import fanfareUrl from "../tadaa.mp3?url";
import { toast } from "./dom.js";

const SOUND_KEY = "throneadvisor.sound";

export function createCourtAudio({ onChange }) {
  const music = new Audio(backgroundUrl);
  const cue = new Audio(fanfareUrl);
  music.loop = true;
  music.volume = 0.18;
  music.preload = "none";
  cue.volume = 0.75;
  cue.preload = "auto";
  let muted = false;
  try {
    muted = localStorage.getItem(SOUND_KEY) === "off";
  } catch (e) {
    console.warn("sound preference unavailable", e);
  }
  let activated = false;
  let preparing = null;
  let cueReady = false;
  let cueGeneration = 0;
  const reported = new Set();

  function report(media, error) {
    console.warn("court audio failed", error);
    if (!reported.has(media)) {
      toast(error?.name === "NotAllowedError"
        ? "Your browser blocked audio. Use the sound button to enable it."
        : "The court musicians couldn't load their music. Check your connection.", 5000);
      reported.add(media);
    }
  }

  async function play(media) {
    try {
      await media.play();
      return true;
    } catch (e) {
      // Pausing during a load (mute, dismiss or leave the tab) intentionally aborts playback.
      if (e?.name !== "AbortError") report(media, e);
      return false;
    }
  }

  music.addEventListener("error", () => report(music, music.error));
  cue.addEventListener("error", () => report(cue, cue.error));

  function prepareCue() {
    if (cueReady || preparing) return;
    // Unlock this separate media element in the gesture, before an async write finishes.
    cue.muted = true;
    preparing = play(cue).then((ok) => {
      cue.pause();
      cue.currentTime = 0;
      cue.muted = false;
      cueReady = ok;
      return ok;
    }).finally(() => { preparing = null; });
  }

  function activate(event) {
    if (event?.target?.closest?.("[data-audio-control]")) return;
    const first = !activated;
    activated = true;
    prepareCue();
    if (!muted && !document.hidden && (first || !event || music.paused)) void play(music);
    if (first || !event) onChange({ muted, activated });
  }

  function stopFanfare() {
    cueGeneration++;
    cue.pause();
    cue.currentTime = 0;
  }

  async function fanfare() {
    const generation = ++cueGeneration;
    if (muted || document.hidden || !activated) return;
    if (preparing) await preparing;
    if (!cueReady || generation !== cueGeneration || muted || document.hidden) return;
    cue.currentTime = 0;
    void play(cue);
  }

  function toggle() {
    muted = !muted;
    try {
      localStorage.setItem(SOUND_KEY, muted ? "off" : "on");
    } catch (e) {
      console.warn("sound preference could not be saved", e);
    }
    if (muted) {
      music.pause();
      stopFanfare();
    } else {
      activate();
    }
    onChange({ muted, activated });
  }

  function visibility() {
    if (document.hidden) {
      music.pause();
      stopFanfare();
    } else if (activated && !muted) {
      void play(music);
    }
  }

  document.addEventListener("pointerdown", activate);
  document.addEventListener("keydown", activate);
  document.addEventListener("visibilitychange", visibility);
  onChange({ muted, activated });

  return {
    toggle, fanfare, stopFanfare,
    destroy() {
      document.removeEventListener("pointerdown", activate);
      document.removeEventListener("keydown", activate);
      document.removeEventListener("visibilitychange", visibility);
      music.pause();
      stopFanfare();
    },
  };
}
