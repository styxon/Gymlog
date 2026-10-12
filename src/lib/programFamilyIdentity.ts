import { I18nKey } from './i18n';

/**
 * Colour, motif and goal line by program FAMILY (design: GAINER Ready Catalog
 * v2 — "tone comes from the program family").
 *
 * The catalog's programs are named as family + level — HOME Starter, STRONG
 * Pro, HUGE Elite — so the family is the first word of the presentation title.
 * Every member of a family wears the same tone, which is what makes the shelf
 * readable at a glance: all the purple cards are strength, all the blue ones
 * are size.
 *
 * Relationship to `programVisualIdentity.ts`: that module picks one of five
 * styles by hashing the template id, so a family's members scatter across five
 * colours and a motif can land on an unrelated program (the barbell currently
 * rides HUGE's blue, the layers ride STRONG's violet). The palette here is the
 * SAME palette — these hex pairs are the design's `oklch(0.70 0.15 h)` and
 * `oklch(0.46 0.19 h)` evaluated per family hue, and five of them come out
 * identical to the five existing styles. What changes is the assignment: by
 * family rather than by hash, and motif locked to the family that owns it.
 *
 * React Native has neither `oklch()` nor CSS gradients, so the stops are
 * precomputed here and painted with an SVG LinearGradient.
 */

export type ProgramFamily = 'HOME' | 'STRONG' | 'HUGE' | 'RESET' | 'FIT' | 'SHRED' | 'RUN' | 'FOCUS' | 'WALK';

export interface ProgramFamilyIdentity {
  family: ProgramFamily;
  /** Cover gradient, light stop first. oklch L .70 C .15 → L .46 C .19. */
  cover: [string, string];
  /** Small tile gradient. L .72 C .13 → L .55 C .17. */
  tile: [string, string];
  /**
   * Detail/day hero gradient — the same hue driven dark enough that white text
   * passes on it. The five families that existed before this table keep their
   * HAND-TUNED values rather than the computed ones: a runtime darken can land
   * on a muddy midtone where white sits at ~3:1, and those five already ship on
   * screens that pass. The three new families use L .61 C .14 → L .34 C .14,
   * which reproduces the hand-tuned five to within a few units.
   */
  hero: [string, string];
  /** Single-stroke signature glyph, drawn oversized and faint on the cover. */
  motif: string;
  /** The one-line "what this is for" under the name on the cover. */
  goalKey: I18nKey;
}

const IDENTITIES: Record<ProgramFamily, Omit<ProgramFamilyIdentity, 'family'>> = {
  // hue 40
  HOME: {
    cover: ['#EB7A52', '#A71000'],
    tile: ['#E98664', '#BF4306'],
    hero: ['#C96040', '#6E0B00'],
    motif: 'M3 10.5 12 3l9 7.5 M5 9.5V20h14V9.5',
    goalKey: 'catalog.goal.home',
  },
  // hue 268
  STRONG: {
    cover: ['#7699FB', '#2D48C0'],
    tile: ['#82A1F6', '#4767D3'],
    hero: ['#6B7FE0', '#1D2C7E'],
    motif: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
    goalKey: 'catalog.goal.strong',
  },
  // hue 222
  HUGE: {
    cover: ['#00B1E0', '#0068A2'],
    tile: ['#15B6DF', '#0083B7'],
    hero: ['#0B93BD', '#02466E'],
    motif: 'M12 3l8 4.5-8 4.5-8-4.5 8-4.5z M4 12l8 4.5 8-4.5 M4 16.5l8 4.5 8-4.5',
    goalKey: 'catalog.goal.huge',
  },
  // hue 176 — new family, hero computed
  RESET: {
    cover: ['#00BC9B', '#007654'],
    tile: ['#1DBFA1', '#008F6E'],
    hero: ['#009D80', '#004C35'],
    motif: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 8a4 4 0 100 8 4 4 0 000-8z',
    goalKey: 'catalog.goal.reset',
  },
  // hue 196 — new family, hero computed
  FIT: {
    cover: ['#00BABD', '#00737A'],
    tile: ['#00BDBF', '#008D92'],
    hero: ['#009B9E', '#004A4F'],
    motif: 'M12 20s-7-4.5-7-9a4 4 0 017-2.5A4 4 0 0119 11c0 4.5-7 9-7 9z',
    goalKey: 'catalog.goal.fit',
  },
  // hue 30 — new family, hero computed
  SHRED: {
    cover: ['#ED7665', '#A90000'],
    tile: ['#EB8373', '#C13E2E'],
    hero: ['#C95E4E', '#6F0000'],
    motif: 'M13 2L4 14h7l-1 8 9-12h-7z',
    goalKey: 'catalog.goal.shred',
  },
  // hue 156
  RUN: {
    cover: ['#37B976', '#007322'],
    tile: ['#55BD82', '#008D44'],
    hero: ['#249A5F', '#014D19'],
    motif: 'M5 19l3-5 4 1 2 4M8 14l-1-4 5-2 3 3 3 1',
    goalKey: 'catalog.goal.run',
  },
  // hue 330
  FOCUS: {
    cover: ['#D179CA', '#8D1A89'],
    tile: ['#D285CB', '#A644A0'],
    hero: ['#B060AB', '#5C0E59'],
    motif: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7a5 5 0 100 10 5 5 0 000-10z M12 11a1 1 0 100 2 1 1 0 000-2z',
    goalKey: 'catalog.goal.focus',
  },
  // hue 90 — new family (2026-10-12), every stop computed as the three above:
  // ochre, apart from HOME's and SHRED's oranges and RUN's green.
  WALK: {
    cover: ['#C39900', '#814C00'],
    tile: ['#C4A032', '#986900'],
    hero: ['#A47E00', '#542F00'],
    motif: 'M8 3a2 3 0 100 6 2 3 0 000-6z M7 11h2 M16 12a2 3 0 100 6 2 3 0 000-6z M15 20h2',
    goalKey: 'catalog.goal.walk',
  },
};

const FAMILIES = Object.keys(IDENTITIES) as ProgramFamily[];

function matchFamily(title: string | null | undefined): ProgramFamily | null {
  const first = (title ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return FAMILIES.find((family) => family === first) ?? null;
}

/**
 * The family is the first word of the title, matched case-insensitively.
 *
 * Falls back to STRONG rather than throwing: a program the catalog gains later,
 * or one a user renamed, must still get a cover. A wrong-but-stable colour is a
 * cosmetic problem; a crash on the first screen of onboarding is not.
 */
export function programFamilyFromTitle(title: string): ProgramFamily {
  return matchFamily(title) ?? 'STRONG';
}

export function programFamilyIdentity(title: string): ProgramFamilyIdentity {
  const family = programFamilyFromTitle(title);
  return { family, ...IDENTITIES[family] };
}

/**
 * Null when the title names no known family — for callers that must keep their
 * own fallback rather than take STRONG's violet. A user's own "Maanantain
 * treeni" has no family, and painting it STRONG blue would claim a kinship the
 * program does not have.
 */
export function programFamilyIdentityOrNull(title: string | null | undefined): ProgramFamilyIdentity | null {
  const family = matchFamily(title);
  return family ? { family, ...IDENTITIES[family] } : null;
}
