/**
 * The app's one light palette.
 *
 * Until 2026-07-31 there were two: `HG` (46 files) and `HG3` (Home and the
 * bottom bar), a migration `lightTheme.ts` itself described as unfinished.
 * Two palettes meant "what is the background colour?" had two answers, which
 * makes a theme engine impossible — you cannot write one dark variant of two
 * competing light ones.
 *
 * They are now the same object. Where they disagreed, HG3's cooler and
 * higher-contrast values won (user decision 2026-07-31): it was the newer,
 * deliberate direction and it dresses the most-looked-at screen.
 *
 * Deliberately NOT themed: the `PW` sheet gradients are designed dark surfaces,
 * not light-theme variants — the contrast is what marks the paid features. They
 * stay fixed in both modes. The AI Coach once had a fixed dark palette of its
 * own; its chat followed the theme first, and the full-analysis screen, the
 * last to wear it, followed on 2026-09-13.
 */
export const HG = {
  bg: '#EFEAF9',
  surface: '#FFFFFF',
  surfaceSoft: '#F2ECFF',
  ink: '#17131F',
  // muted/faint/border darkened 2026-07-22 (user: hairlines and secondary text
  // read too washed-out on device).
  muted: '#5E5670',
  // Darkened again 2026-09-21 (accessibility audit, 2026-09-21): #8A82A0 was
  // 3.08:1 on `bg` and 3.63:1 on white, and `faint` is text in about 170
  // places — dates, counts, meta lines. #6E6684 is 4.57 on `bg`, 4.68 on
  // `surfaceSoft` and 5.39 on white, and still a clear step below `muted`
  // (6.91 on white). tests/lib/themeContrast.test.cjs holds all three.
  faint: '#6E6684',
  // Darkened again 2026-09-02 (user, on the device build: "ääriviivat ovat
  // liian haaleita") — one step, not a redraw.
  border: '#CDBEE6',
  shadow: '#D8C7FF',
  purple: '#6D28D9',
  /** The old HG.purple. Still the brighter accent on a few surfaces. */
  purpleBright: '#7C3AED',
  purpleDark: '#5B21B6',
  /**
   * The violet a white label sits on. The same value as `purple` here — white
   * on #6D28D9 is 7.1:1 — so nothing moves in light; the token exists because
   * the dark theme's `purple` is a text-on-dark violet that white only reaches
   * 3.5:1 on (accessibility audit, 2026-09-21).
   */
  purpleFill: '#6D28D9',
  // purpleLight and purpleSoft are within a hair of each other and should
  // collapse into one token once every call site reads from `HG`.
  purpleLight: '#EFE7FF',
  purpleSoft: '#EEE7FC',
  green: '#16A34A',
  greenSoft: '#E8F7EE',
  greenInk: '#157A3A',
  // A shade deeper than `green` (accessibility audit, 2026-09-21). Until then
  // the two were the same #16A34A, and white on it — "Kirjaa sarja", the
  // session's start button — was 3.30:1. #15803D is still green and takes
  // white at 5.02:1. `green` keeps meaning *done* (ticks, filled dots, the
  // recovery ring), where nothing is written on it. The two are separate
  // tokens because the dark theme moves this one to orange and must not drag
  // "done" along with it.
  accent: '#15803D',
  // Likewise the same violet the app already used for links and badges — the
  // light theme keeps its two accent families, and only dark collapses them.
  highlight: '#6D28D9',
  highlightSoft: 'rgba(167, 139, 250, 0.22)',
  onHighlight: '#FFFFFF',
  controlFill: '#FFFFFF',
  controlBorder: '#CDBEE6',
  switchOff: '#B9A9DB',
  blue: '#0A84FF',
  gold: '#E4B14C',
  // Deep enough to read as 13px text on white (about 5:1).
  orange: '#C2410C',
  orangeSoft: 'rgba(234, 88, 12, 0.10)',
  // Caution and danger, as tokens rather than the fixed `PW`/inline hexes the
  // screens used to carry. A "you may be missing a rack" note and a "delete
  // this program" button are the same two moments in both themes; only the
  // wash under them changes. Light values are the PW ones, so nothing moves
  // here.
  amber: '#D97706',
  amberSoft: '#FDF3E3',
  amberBorder: '#F0D3A2',
  amberInk: '#7A5B32',
  // A step darker than the PW red: #DC2626 was 4.10:1 on the page (`bg`),
  // under the 4.5 body text needs (accessibility audit, 2026-09-21; fixed
  // 2026-09-26). 4.86 on the page, 5.74 on a card.
  danger: '#C81E1E',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
  // Pro sheet gradient stops (dark violet).
  proSheetTop: '#241A3E',
  proSheetBottom: '#150E28',
  // The PW.proInk value, so locked cards do not move in light.
  proInk: '#5B21B6',
} as const;

export type HGToken = keyof typeof HG;

/**
 * Paywall-moment tokens ("PW", pw-shared.jsx): the locked-state language and
 * the caution colours the detection cards use. Shared by the locked card, the
 * contextual sheet, the Pro page, and the traffic-light rows so the moments
 * cannot drift apart.
 */
export const PW = {
  amber: '#D97706',
  amberSoft: '#FDF3E3',
  amberBorder: '#F0D3A2',
  amberInk: '#7A5B32',
  red: '#DC2626',
  redSoft: '#FDECEC',
  green: '#16A34A',
  greenSoft: '#E8F7EE',
  proInk: '#5B21B6',
  /** Contextual sheet gradient stops (dark violet). */
  sheetTop: '#251743',
  sheetMid: '#3A1F7A',
  sheetBottom: '#4A2398',
  sheetLavender: '#C9B6FF',
  sheetMint: '#8FE3B4',
} as const;

/**
 * Active Workout v3 palette additions ("AW3" tokens, aw3-shared.jsx). Field
 * and hairline colors for the shared logging surfaces: the freestyle Empty
 * Workout screen now, the Active Workout v3 rebuild later.
 */
export const AW3 = {
  hair: '#E6E0F2',
  ghost: '#C0B8D4',
  field: '#FAF8FF',
  fieldBorder: '#DCD3EC',
  ink2: '#3B3550',
  danger: '#D64545',
} as const;

export type AW3Token = keyof typeof AW3;

/** The same keys, widened — a themed palette fills them with its own values. */
export type AW3Palette = { readonly [K in AW3Token]: string };
