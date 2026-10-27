import type { I18nKey } from '../lib/i18n';

/**
 * The legal document, laid over the hand-off rather than swapped in for it.
 *
 * Its own background is opaque, so nothing of the screen underneath shows
 * through; what survives is that screen's state, which is the whole point.
 */
export const LEGAL_OVER_HANDOFF = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
/** Above the consent sheet's zIndex/elevation (40). */
export const LEGAL_OVER_CONSENT = { ...LEGAL_OVER_HANDOFF, zIndex: 50, elevation: 50 } as const;

/** Stored weekday codes → the display keys the rest of the app uses. */
export const WEEKDAY_LABEL_KEYS: Record<string, I18nKey> = {
  MON: 'setup.day.mon',
  TUE: 'setup.day.tue',
  WED: 'setup.day.wed',
  THU: 'setup.day.thu',
  FRI: 'setup.day.fri',
  SAT: 'setup.day.sat',
  SUN: 'setup.day.sun',
};
