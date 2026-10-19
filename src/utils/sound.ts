/**
 * Short workout cue sounds (guided player + cardio).
 *
 * Players are created lazily and reused, so a cue is just seek-to-zero + play.
 * The audio mode is `mixWithOthers`, which matters in a gym app: cues layer on
 * top of the user's music instead of pausing or ducking it. Every call is
 * fire-and-forget and failure-tolerant — audio must never break a workout.
 *
 * Sound files are generated: node scripts/generate_cue_sounds.mjs
 */
import { Platform } from 'react-native';
import { createOnceReady } from '../lib/onceReady';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type CueSound = 'tick' | 'go' | 'done' | 'rest' | 'finish';

const SOURCES: Record<CueSound, number> = {
  tick: require('../../assets/sounds/tick.wav'),
  go: require('../../assets/sounds/go.wav'),
  done: require('../../assets/sounds/done.wav'),
  rest: require('../../assets/sounds/rest.wav'),
  finish: require('../../assets/sounds/finish.wav'),
};

const players = new Map<CueSound, AudioPlayer>();

// Mirrors the user's "Cue sounds" preference; AppProvider keeps this in sync.
let enabled = true;

export function setSoundCuesEnabled(next: boolean) {
  enabled = next;
}

/**
 * Configured once, and awaited before the first cue: with the setup left
 * running in the background, iOS started the first sound on its default
 * session and cut the user's music for a moment.
 */
const ensureAudioMode = createOnceReady(
  () =>
    setAudioModeAsync({
      // Layer cues over the user's music rather than interrupting it.
      interruptionMode: 'mixWithOthers',
      // A muted phone should stay silent; the player has its own mute toggle.
      playsInSilentMode: false,
      shouldPlayInBackground: false,
    }),
  (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
);

function getPlayer(cue: CueSound): AudioPlayer | null {
  const existing = players.get(cue);
  if (existing) {
    return existing;
  }
  try {
    const player = createAudioPlayer(SOURCES[cue]);
    players.set(cue, player);
    return player;
  } catch (error) {
    console.warn(`[sound] could not create player for "${cue}"`, error);
    return null;
  }
}

function play(cue: CueSound) {
  if (Platform.OS === 'web' || !enabled) {
    return;
  }
  // Fire-and-forget for callers; the cue itself waits for the audio mode.
  void ensureAudioMode().then(() => {
    // The preference may have been switched off while the mode was settling.
    if (!enabled) {
      return;
    }
    try {
      const player = getPlayer(cue);
      if (!player) {
        return;
      }
      // Rewind so rapid repeats (the 3-2-1 ticks) retrigger, but never gate
      // playback on the seek resolving — a fresh player may not be loaded yet.
      void Promise.resolve(player.seekTo(0)).catch(() => undefined);
      player.play();
    } catch (error) {
      console.warn(`[sound] cue "${cue}" failed`, error);
    }
  });
}

export const sound = {
  /** 3-2-1 countdown tick. */
  tick: () => play('tick'),
  /** A timed drill / interval starts. */
  go: () => play('go'),
  /** A set was logged. */
  done: () => play('done'),
  /** Rest finished — back to work. */
  rest: () => play('rest'),
  /** Whole session complete. */
  finish: () => play('finish'),
};

/** Frees the native players (used when tearing the app down in tests/dev). */
export function releaseCueSounds() {
  players.forEach((player) => {
    try {
      player.remove();
    } catch {
      // ignore
    }
  });
  players.clear();
}
