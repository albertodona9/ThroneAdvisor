import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCourtAudio } from "../src/audio.js";
import { toast } from "../src/dom.js";

vi.mock("../src/dom.js", () => ({ toast: vi.fn() }));

let tracks;
let document;
let audio;
let preferences;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  tracks = [];
  preferences = new Map();
  document = new EventTarget();
  document.hidden = false;
  vi.stubGlobal("document", document);
  vi.stubGlobal("localStorage", {
    getItem: (key) => preferences.get(key) ?? null,
    setItem: (key, value) => preferences.set(key, value),
  });
  vi.stubGlobal("Audio", class extends EventTarget {
    constructor(src) {
      super();
      this.src = src;
      this.currentTime = 0;
      this.muted = false;
      this.paused = true;
      this.play = vi.fn().mockImplementation(() => {
        this.paused = false;
        return Promise.resolve();
      });
      this.pause = vi.fn().mockImplementation(() => { this.paused = true; });
      tracks.push(this);
    }
  });
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  audio?.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("court audio", () => {
  it("starts looping music only after a gesture and plays one audible cue per celebration", async () => {
    audio = createCourtAudio({ onChange: vi.fn() });
    const [music, cue] = tracks;
    expect(music.play).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(music.loop).toBe(true);
    expect(music.play).toHaveBeenCalledTimes(1);
    expect(cue.play).toHaveBeenCalledTimes(1); // silent gesture unlock
    cue.currentTime = 2;
    await audio.fanfare();
    expect(cue.muted).toBe(false);
    expect(cue.currentTime).toBe(0);
    expect(cue.play).toHaveBeenCalledTimes(2);
    await audio.fanfare();
    expect(cue.play).toHaveBeenCalledTimes(3);
    document.dispatchEvent(new Event("pointerdown"));
    expect(music.play).toHaveBeenCalledTimes(1);
  });

  it("remembers mute and does not play music or fanfares while muted", async () => {
    audio = createCourtAudio({ onChange: vi.fn() });
    audio.toggle();
    audio.destroy();
    const changed = vi.fn();
    audio = createCourtAudio({ onChange: changed });
    const [music, cue] = tracks.slice(2);
    expect(changed).toHaveBeenLastCalledWith({ muted: true, activated: false });
    document.dispatchEvent(new Event("keydown"));
    await flush();
    await audio.fanfare();
    expect(music.play).not.toHaveBeenCalled();
    expect(cue.play).toHaveBeenCalledTimes(1); // only the muted unlock
    audio.toggle();
    expect(music.play).toHaveBeenCalledTimes(1);
  });

  it("pauses hidden tabs and resumes only music, not an interrupted fanfare", async () => {
    audio = createCourtAudio({ onChange: vi.fn() });
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    await audio.fanfare();
    const [music, cue] = tracks;
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(music.pause).toHaveBeenCalled();
    expect(cue.pause).toHaveBeenCalled();
    await audio.fanfare();
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(cue.play).toHaveBeenCalledTimes(2);
  });

  it("does not start a late fanfare after the popup was dismissed during audio unlock", async () => {
    audio = createCourtAudio({ onChange: vi.fn() });
    const cue = tracks[1];
    let resolve;
    cue.play.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    document.dispatchEvent(new Event("pointerdown"));
    const pending = audio.fanfare();
    audio.stopFanfare();
    resolve();
    await pending;
    expect(cue.play).toHaveBeenCalledTimes(1);
  });

  it("reports blocked playback and retries on the next gesture", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    audio = createCourtAudio({ onChange: vi.fn() });
    tracks[0].play.mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(warning).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("browser blocked audio"), 5000);
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(tracks[0].play).toHaveBeenCalledTimes(2);
  });

  it("retries an interrupted cue unlock on the next gesture without restarting music", async () => {
    audio = createCourtAudio({ onChange: vi.fn() });
    const [music, cue] = tracks;
    cue.play.mockRejectedValueOnce(new DOMException("Interrupted", "AbortError"));
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    document.dispatchEvent(new Event("pointerdown"));
    await flush();
    await audio.fanfare();
    expect(music.play).toHaveBeenCalledTimes(1);
    expect(cue.play).toHaveBeenCalledTimes(3);
  });
});
