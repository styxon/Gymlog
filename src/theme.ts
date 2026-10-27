export const colors = {
  background: '#1D1C35',
  surface: '#17212C',
  card: 'rgba(28, 40, 54, 0.92)',
  cardElevated: '#213142',
  border: '#3C5C77',
  divider: '#35536B',
  textPrimary: '#F4FAFF',
  textSecondary: '#C6D8E8',
  textMuted: '#9CB3C7',
  accent: '#67A8E9',
  accentPressed: '#84C6FF',
  accentAlt: '#96D8FF',
  accentSoft: 'rgba(103, 168, 233, 0.34)',
  accentAltSoft: 'rgba(150, 216, 255, 0.38)',
  feature: '#BF4A69',
  featureSoft: 'rgba(191, 74, 105, 0.30)',
  danger: '#BF4A69',
  dangerSoft: 'rgba(191, 74, 105, 0.30)',
  warning: '#A23612',
  warningSoft: 'rgba(162, 54, 18, 0.32)',
  overlay: 'rgba(8, 11, 16, 0.84)',
  input: '#16212D',
  chartGrid: '#3A5F7E',
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 12,
  md: 18,
  lg: 24,
  pill: 999,
};

export const layout = {
  /** Side gutter of every list/menu screen, tab or pushed: cards and headers share it. */
  screenGutter: 20,
  /** Space above a pushed screen's PageHeader (History, Milestones, Settings...). */
  pageHeaderTop: 8,
  /** The floating tab bar's own height: 16 above the pill, 64 pill, 8 below. */
  bottomTabBarHeight: 88,
  /** Scrolling content clears the bar with a section's air; a fixed foot does not. */
  bottomTabBarReserve: spacing.xxl + 88,
};

export const typography = {
  fontFamily: 'Manrope',
};

export const appInfo = {
  name: 'Vinha',
  version: '1.1.0',
  starterSuggestions: ['Ylakroppa', 'Alakroppa', 'Koko kroppa', 'Push', 'Pull', 'Jalat'],
};

/**
 * The Pro page's three tier skins (design: "Vinha Pro v6 — kolme tasoa").
 *
 * Deliberately NOT themed, for the same reason `PW`'s sheet gradients are not:
 * the paywall commits to one dark treatment and the
 * tier's own colour is the thing being read. A paywall that repaints with the
 * reader's light/dark toggle would make the accent — which is the only signal
 * telling Free from Pro from Lifetime — mean something different per reader.
 *
 * `sky` are the two stops of the hero's vertical gradient, which then runs to
 * black: colour at the top, dark at the bottom. `neb` and `neb2` are the two
 * radial washes over it, and `ring` is the hairline on anything the accent
 * outlines. Values come straight from the design's own token block.
 */
export const PRO_TIER = {
  free: {
    accent: '#37D08A',
    ring: 'rgba(55,208,138,0.55)',
    glow: 'rgba(55,208,138,0.30)',
    sky: ['#0A2A1D', '#07150F'] as const,
    neb: 'rgba(55,208,138,0.30)',
    neb2: 'rgba(90,255,190,0.13)',
  },
  pro: {
    accent: '#A87BFF',
    ring: 'rgba(168,123,255,0.6)',
    glow: 'rgba(168,123,255,0.34)',
    sky: ['#241748', '#0B0713'] as const,
    neb: 'rgba(168,123,255,0.34)',
    neb2: 'rgba(255,210,63,0.10)',
  },
  life: {
    accent: '#FF8A3D',
    ring: 'rgba(255,138,61,0.55)',
    glow: 'rgba(255,138,61,0.30)',
    sky: ['#3D1D06', '#100B14'] as const,
    neb: 'rgba(255,138,61,0.28)',
    neb2: 'rgba(168,123,255,0.16)',
  },
} as const;

/** Ink and surfaces on the paywall's dark ground, from the same token block. */
export const PRO_SURFACE = {
  ink: '#FFFFFF',
  inkDim: 'rgba(255,255,255,0.92)',
  inkMuted: 'rgba(255,255,255,0.66)',
  // .44 → .60 (accessibility audit, 2026-09-21): the benefit sub-lines and
  // the price sub-line are 13–14px text, and at .44 they were 4.3:1 on the
  // card and the plan tiles. .60 is 6.9 on the card and 7.3 on a tile.
  inkFaint: 'rgba(255,255,255,0.60)',
  inkGhost: 'rgba(255,255,255,0.45)',
  card: 'rgba(22,20,30,0.72)',
  cardEdge: 'rgba(255,255,255,0.08)',
  glass: 'rgba(255,255,255,0.11)',
  glassEdge: 'rgba(255,255,255,0.13)',
  tile: 'rgba(255,255,255,0.045)',
  tileOn: 'rgba(255,255,255,0.085)',
  ctaInk: '#0B0713',
  badgeInk: '#1A1030',
} as const;
