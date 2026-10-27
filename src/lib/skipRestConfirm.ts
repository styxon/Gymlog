/**
 * Skip rest takes two presses (#bugs 2026-10-17, "painetaan 2x kertaa muuten
 * missklik"). The button sits where a thumb lands reaching for the phone
 * between sets, and one stray touch threw the rest away with no way back.
 *
 * The first press arms it and the label says so; a second press inside the
 * window skips. After the window the next press arms again, so a press long
 * after the first is never taken as its confirmation.
 */
export const SKIP_REST_CONFIRM_MS = 3000;

type SkipRestTap = 'arm' | 'skip';

export function skipRestTap(armedAtMs: number | null, nowMs: number): SkipRestTap {
  if (armedAtMs === null) {
    return 'arm';
  }
  const since = nowMs - armedAtMs;
  return since >= 0 && since <= SKIP_REST_CONFIRM_MS ? 'skip' : 'arm';
}
