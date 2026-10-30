/**
 * The app's dark palette.
 *
 * It is not a mechanical inversion of `HG`. The app already had a dark visual
 * language before it had a dark theme — the AI Coach surface, the paywall
 * sheets, the exercise-info panel — and all of them are dark *violet*, not
 * neutral grey. The coach palette in particular had been on screen since
 * 2026-07-19 and the user had approved how it reads. So the values below start
 * from its text and accent colours and build the missing surfaces around them, which
 * means switching to dark makes the rest of the app look like the parts that
 * were already dark rather than like a different product.
 *
 * Two token pairs carry weight beyond their names:
 *
 *   ink / surface   — these are an inverting pair. A black button is written as
 *                     `backgroundColor: theme.ink` with `color: theme.surface`,
 *                     so in dark it becomes a white button with dark text,
 *                     which is what both platform conventions do.
 *   purpleLight /
 *   purpleSoft      — in light these are pale tinted *fills* that carry dark
 *                     text. Inverting them to dark tints keeps that role; a
 *                     literal lightening would have made unreadable surfaces.
 *
 * `gold` is unchanged: it was already a dark-surface colour in the coach and reads
 * correctly on both backgrounds. The Pro sheet gradient stops are unchanged for
 * the same reason — they were always dark.
 *
 * 2026-08-10: the surfaces moved to the boost design's dark values. Two things
 * changed and both are about depth. The page went deeper and bluer, so a card
 * sitting on it reads as a card rather than as a slightly different grey. And
 * the card outline became a translucent white hairline instead of an opaque
 * violet one — on a near-black page an opaque border draws itself, while a
 * hairline lets the surface do the separating. The text ramp and the orange
 * action accent are unchanged: those were decided on their own evidence.
 */
export const HG_DARK = {
  bg: '#0D0A20',
  surface: '#191436',
  surfaceSoft: '#201A42',
  // The coach palette's text ramp, unchanged.
  ink: '#F4F1FF',
  muted: '#A79FC4',
  faint: '#8B83AE',
  // A hairline, not a line. See the note above.
  border: 'rgba(255, 255, 255, 0.09)',
  // A violet drop shadow is invisible on a dark background; black still reads.
  shadow: '#000000',
  // The light theme's purples are 4.5:1 against white and near-invisible
  // against #141021, so the whole accent ramp lifts rather than inverts.
  purple: '#9B6DFF',
  purpleBright: '#A78BFA',
  purpleDark: '#8B5CF6',
  // The violet under a white label (accessibility audit, 2026-09-21). The
  // lifted ramp above is right for violet TEXT on this page and wrong under
  // white text: white on `purple` is 3.49:1, on `purpleBright` 2.72, on
  // `purpleDark` 4.23. #7C3AED takes white at 5.70:1 and still stands 3.08:1
  // off `surface`, so a filled button reads as a shape rather than a hole.
  purpleFill: '#7C3AED',
  purpleLight: '#2C2350',
  purpleSoft: '#2A2049',
  green: '#37D08A',
  greenSoft: '#16321F',
  greenInk: '#5FE3A6',
  // The action accent goes orange in dark (user decision 2026-08-01). Warm
  // enough to lead the eye on a near-black screen, and far enough from `gold`
  // (#E4B14C) that a favourite star and a start button do not read alike.
  accent: '#FF8A4C',
  // Dark collapses the two accent families into one: anything pressable is
  // orange, violet carries brand and structure. `onHighlight` is near-black
  // because white on #FF8A4C is about 2:1 — a white TODAY badge would be
  // unreadable.
  highlight: '#FF8A4C',
  highlightSoft: 'rgba(255, 138, 76, 0.26)',
  onHighlight: '#241203',
  controlFill: '#201A42',
  controlBorder: 'rgba(255, 255, 255, 0)',
  // 3.4:1 on the card, 3.1 on surfaceSoft (#4A4470 was 1.97, hunt C6).
  switchOff: '#6C65A3',
  blue: '#4FA8FF',
  gold: '#E4B14C',
  orange: '#FF8A4C',
  orangeSoft: 'rgba(255, 138, 76, 0.26)',
  // The caution and danger washes invert: light's cream and pink become a
  // tinted panel a shade off `surface`, with the ink brightened to carry the
  // meaning instead. The light values (#FDF3E3, #FEF2F2) are all but white and
  // would have read as two lit panels on a near-black page.
  amber: '#F0A44E',
  amberSoft: '#2E2216',
  amberBorder: 'rgba(240, 164, 78, 0.30)',
  amberInk: '#F3C68A',
  danger: '#FF6B6B',
  dangerSoft: '#331A1E',
  dangerBorder: 'rgba(255, 107, 107, 0.30)',
  proSheetTop: '#241A3E',
  proSheetBottom: '#150E28',
  // About 5:1 on dark `purpleLight`, where the locked teasers sit.
  proInk: '#A78BFA',
};

/**
 * AW3 under the dark theme.
 *
 * AW3 (lightTheme.ts) is the Active Workout v3 field palette, and the freestyle
 * logger imported it straight from the light theme — so every field, hairline
 * and placeholder in it stayed light whatever the app was wearing. Reported
 * from the phone: the whole logged-set row glowed white on a dark screen and
 * the numbers in it were near-invisible.
 *
 * A parallel palette rather than new Theme tokens, deliberately. Mapping these
 * onto the tokens that already exist would have shifted the light theme too —
 * `ghost` is a placeholder ink at #C0B8D4, much lighter than `faint` — and the
 * report is about dark. Light stays exactly as it was; this is what dark gets.
 */
export const AW3_DARK = {
  hair: HG_DARK.border,
  // Quiet, but present. A placeholder has to sit below `muted` without
  // disappearing into the field it is in.
  ghost: HG_DARK.faint,
  field: HG_DARK.surfaceSoft,
  // A touch stronger than the card hairline: a field has to read as an input.
  fieldBorder: 'rgba(255, 255, 255, 0.14)',
  ink2: HG_DARK.muted,
  danger: HG_DARK.danger,
} as const;
