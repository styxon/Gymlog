/**
 * The tiles that drift across the welcome screen.
 *
 * The middle of that screen has been empty since 2026-08-19, when a bisect
 * left the ambient drift layer switched off behind a comment and the commit
 * shipped that way (the layer was deleted 2026-10-12). Filling it with
 * decoration would be the same emptiness in a costume; filling it with the
 * catalog says "there are this many programmes in here" before the reader has
 * read a single word — the way a marketplace app opens on its own inventory.
 *
 * So these are REAL programmes, named as the catalog names them. Nothing is
 * invented for the picture: an empty catalog draws an empty row, because a
 * first screen that promises programmes the app does not have is the seed-data
 * lie with better art.
 */

import { programCoverStyle } from './programVisualIdentity';

export interface WelcomeMarqueeTile {
  id: string;
  title: string;
  /**
   * The one light line under the headline.
   *
   * The programme own tags, joined — "Pakarat · Massa · 5 pv". Not new copy:
   * a tile that describes a programme in words written for the tile is a
   * second description to keep true.
   */
  meta: string;
  /** Tile gradient. */
  from: string;
  to: string;
  /** Title and motif colour — chosen per swatch, because white does not read on orange. */
  ink: string;
  /** Set on the pale swatch, which needs an edge to be a tile at all. */
  border?: string;
  /** The programme family's single-stroke motif. */
  motif: string;
  /**
   * Which of the app's photos sits behind this tile, as a key.
   *
   * A key and not an image: this module stays free of React Native, and the
   * component that draws the tile is the one that can require() a file.
   */
  photoKey: string;
  /** How much of the swatch sits over the photo, so the headline still reads. */
  scrim: number;
}

/**
 * Three colours, not twenty-eight.
 *
 * The first version wore each programme's own identity hue, which is right on
 * the browse screen — the colour is how you recognise a programme — and wrong
 * here: a wall of twenty-eight unrelated hues is a swatch book, not a brand
 * (user 2026-08-27, "väriteema ei oikein sovi"). On this screen the tiles are
 * the brand, so they wear the app's own three: violet carries brand, orange
 * carries action, and the pale one lets the wall breathe.
 *
 * `ink` is per swatch and not negotiable: white on #FF8A4C is about 2:1, which
 * is the same reason the dark theme's `onHighlight` is near-black.
 */
export const WELCOME_TILE_SWATCHES: ReadonlyArray<{
  from: string;
  to: string;
  ink: string;
  border?: string;
  /**
   * Swatch opacity over the photo. Not one number for all three: the pale
   * swatch has to cover almost everything or dark text lands on a dark photo,
   * while the violet can let a lot through and stay readable.
   */
  scrim: number;
}> = [
  { from: '#6D28D9', to: '#5B21B6', ink: '#FFFFFF', scrim: 0.62 },
  { from: '#FF8A4C', to: '#E4622A', ink: '#241203', scrim: 0.72 },
  // Deepened and given a real edge. At #FFFFFF on the welcome screen's pale
  // lavender it read as a hole punched in the wall rather than a tile in it
  // (user 2026-08-27).
  { from: '#F4EEFF', to: '#E2D3FF', ink: '#5B21B6', border: '#B79BEF', scrim: 0.88 },
];

/**
 * Which programmes get to be the shop window, in order.
 *
 * Not the whole catalog. Fifty-seven tiles is fifty-seven times the drawing
 * cost for a wall nobody reads to the end, and the first screen is not a
 * browse surface — it is one glance that has to say what this app is for. So
 * the picks lead with what a reader wants to BE rather than how a programme is
 * structured: Dream Body, Hourglass Shape, Strong & Lean before Push Pull Legs
 * (user 2026-08-27, "unelma keho nimityksiä").
 *
 * Ids, not titles, so a translated or re-worded title still lands. An id that
 * no longer exists is skipped rather than drawn — see buildWelcomeMarqueeRows,
 * which never invents a tile.
 */
const WELCOME_MARQUEE_PICKS: readonly string[] = [
  'tpl_gainer_dream_body_female_v1', // Dream Body Female
  'tpl_gainer_dream_body_man_v1', // Dream Body Man
  'tpl_gainer_hourglass_shape_v1', // Hourglass Shape
  'tpl_shred_v1', // SHRED
  'tpl_gainer_strong_lean_female_v1', // Strong & Lean Female
  'tpl_6_day_ppl_v1', // HUGE Elite
  'tpl_gainer_advanced_glutes_v1', // Advanced Glutes
  'tpl_gainer_lean_shred_v1', // Lean Shred Cut
  'tpl_gainer_athlete_conditioning_v1', // Athlete Conditioning
  'tpl_gainer_glute_foundations_v1', // Glute Foundations
  'tpl_gainer_expert_powerbuilding_v1', // Expert Powerbuilding
  'tpl_gainer_fat_burn_hiit_v1', // Fat Burn HIIT
  'tpl_gainer_calisthenics_mastery_v1', // Calisthenics Mastery
  'tpl_4_day_powerbuilding_v1', // POWERBUILD
  'tpl_gainer_runners_strength_v1', // Runner's Strength
  'tpl_season_summer_v1', // Summer Conditioning
];

/**
 * The picks that exist, in pick order, topped up from the catalog if the list
 * has been trimmed below what the rows need.
 *
 * Never padded with invented entries: if the catalog is short, the wall is
 * short.
 */
function selectWelcomeProgrammes<T extends { id: string }>(
  programmes: ReadonlyArray<T>,
  wanted: number,
  picks: readonly string[] = WELCOME_MARQUEE_PICKS,
): T[] {
  const byId = new Map(programmes.map((programme) => [programme.id, programme] as const));
  const chosen: T[] = [];
  const taken = new Set<string>();
  for (const id of picks) {
    const programme = byId.get(id);
    if (programme && !taken.has(id)) {
      chosen.push(programme);
      taken.add(id);
    }
    if (chosen.length === wanted) {
      return chosen;
    }
  }
  for (const programme of programmes) {
    if (chosen.length === wanted) {
      break;
    }
    if (!taken.has(programme.id)) {
      chosen.push(programme);
      taken.add(programme.id);
    }
  }
  return chosen;
}

/**
 * Deal the programmes across `rowCount` rows, round-robin.
 *
 * Round-robin rather than slicing: consecutive catalog entries belong to the
 * same family and so share a colour, and a sliced row would come out as one
 * long block of the same blue. Dealt, every row gets a mix.
 */
export function buildWelcomeMarqueeRows(
  programmes: ReadonlyArray<{ id: string; title: string; meta?: string; photoKey?: string }>,
  rowCount = 2,
  perRow = 8,
): WelcomeMarqueeTile[][] {
  const rows: WelcomeMarqueeTile[][] = Array.from({ length: Math.max(1, rowCount) }, () => []);
  selectWelcomeProgrammes(programmes, Math.max(1, rowCount) * Math.max(1, perRow)).forEach((programme, index) => {
    // The swatch cycles over the whole catalog rather than per row, so no row
    // repeats a colour twice running while another row is all one shade.
    const swatch = WELCOME_TILE_SWATCHES[index % WELCOME_TILE_SWATCHES.length];
    rows[index % rows.length].push({
      id: programme.id,
      title: programme.title,
      meta: programme.meta ?? '',
      from: swatch.from,
      to: swatch.to,
      ink: swatch.ink,
      border: swatch.border,
      // The motif still comes from the programme: it is the one thing on the
      // tile that says which programme this is.
      motif: programCoverStyle(programme.id, programme.title).motif,
      photoKey: programme.photoKey ?? '',
      scrim: swatch.scrim,
    });
  });
  return rows;
}

/**
 * How long one full pass of a row takes, so both rows drift at the same speed
 * whatever their length. A row with more tiles is longer, not faster.
 */
export function marqueeDurationMs(tileCount: number, tileWidth: number, gap: number, pixelsPerSecond = 22): number {
  const width = tileCount * (tileWidth + gap);
  return Math.max(1, Math.round((width / Math.max(1, pixelsPerSecond)) * 1000));
}
