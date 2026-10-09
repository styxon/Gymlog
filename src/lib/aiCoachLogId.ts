/**
 * Whether the coach keeps copies at all. Off since 2026-09-30 (user): no
 * conversation, programme or photo is kept anywhere until the whole question
 * of keeping and reading them is gone through again after release. One
 * switch for both ends — the app stops asking and stops sending the
 * permission, and the server stops writing whatever an older app still sends.
 * A reader who said yes before keeps the Settings switch that takes it back
 * and deletes what was kept.
 */
export const COACH_COPIES_KEPT = false;

/**
 * The random label a reader's kept coach copies are filed under.
 *
 * Its own module because several places need it and none owns it: the screen
 * that mints it on the first yes, the server routes that accept it, and the
 * tests that check its shape.
 * Pure, so it belongs in lib rather than in a screen or a function.
 *
 * Unguessable, not merely unique: the label is also the only thing the
 * withdrawal route asks for, so whoever can produce it can delete what is
 * filed under it (security review, 2026-09-14). The platform's random source
 * when there is one — Hermes and Node both have `crypto.getRandomValues` —
 * and `Math.random` only where there is none. It is never sent to Anthropic,
 * never joined to an account, and never reused after a withdrawal — turning
 * the last line off clears it, and the next yes mints a new one, so two
 * stretches of consent cannot be joined into one history.
 */
export function randomLogId(): string {
  return `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
}

/**
 * The shape a label may take.
 *
 * It ends up in a filename, so anything with a slash or a dot in it would be
 * a path the caller chose rather than a label. Declared here, once, for every
 * place that accepts one or reads one back: the advice body, the image body
 * and the forget route in api/ai-coach.ts.
 */
export const LOG_ID_PATTERN = /^[a-f0-9-]{8,64}$/;

type RandomSource = { getRandomValues?: (array: Uint8Array) => Uint8Array };

/** `length` hex characters from the strongest source at hand. */
export function randomHex(length: number, source: RandomSource | undefined = (globalThis as { crypto?: RandomSource }).crypto): string {
  if (source?.getRandomValues) {
    const bytes = source.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length);
  }
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
