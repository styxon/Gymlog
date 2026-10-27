/**
 * The guided player's photo duotone: where black lands and where white lands.
 * The light theme keeps the photo airy so it sits on the lilac surface; the
 * dark theme keeps it deep so it does not glare mid-set.
 */
export const DUOTONE_RAMPS = {
  light: { shadow: [0.298, 0.227, 0.478], light: [1, 1, 1] },
  dark: { shadow: [0.09, 0.063, 0.169], light: [0.851, 0.8, 0.961] },
} as const;

/** Rec.601 luma weights — the same ones feColorMatrix's own saturate uses. */
const DUOTONE_LUMA = [0.299, 0.587, 0.114] as const;

/**
 * The colour space a platform runs feColorMatrix in. Android applies it to the
 * bitmap's sRGB values. iOS runs it through Core Image, whose working space is
 * linear: the photo is linearised, the matrix applied, the result encoded
 * back to sRGB. A matrix written for sRGB therefore lifted every shadow and
 * midtone on iPhone, and the photos looked washed out (owner's #11, iOS hunt
 * 2026-10-17): the light theme's black came out #9483b8 instead of #4c3a7a.
 */
type DuotoneSpace = 'srgb' | 'linear';

/** The sRGB transfer curve, encoded value to linear light. */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * The whole duotone as one feColorMatrix.
 *
 * The textbook recipe is saturate-to-grey followed by an feComponentTransfer
 * table per channel, and on Android the transfer node is ignored — the photo
 * came out plain greyscale. A single matrix does both steps at once and is the
 * one filter primitive that definitely renders: each output channel is the
 * luma weights scaled by that channel's ramp span, with the shadow end as the
 * constant term. Verified on an Android device in sRGB; do not "simplify" it
 * back into two nodes.
 *
 * In 'linear' the two ends are linearised first, so after iOS encodes the
 * result black and white land on the same two colours as on Android. The
 * tones between follow linear light, a little darker than Android's.
 */
export function duotoneMatrix(shadow: readonly number[], light: readonly number[], space: DuotoneSpace): string {
  const low = space === 'linear' ? shadow.map(srgbToLinear) : shadow;
  const high = space === 'linear' ? light.map(srgbToLinear) : light;
  const row = (index: number) => {
    const span = high[index] - low[index];
    return [DUOTONE_LUMA[0] * span, DUOTONE_LUMA[1] * span, DUOTONE_LUMA[2] * span, 0, low[index]];
  };
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0]
    .map((value) => value.toFixed(4))
    .join(' ');
}
