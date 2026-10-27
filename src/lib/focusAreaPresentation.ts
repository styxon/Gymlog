import { I18nKey, t } from './i18n';
import type { AppLanguage, SetupFocusArea } from '../types/models';

type FocusAreaAssetKey =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'quads'
  | 'glutes'
  | 'hamstrings'
  | 'calves'
  | 'mobility'
  | 'legs'
  | 'conditioning';

interface FocusAreaPresentationOption {
  area: SetupFocusArea;
  title: string;
  assetKey: FocusAreaAssetKey;
  accessibilityLabel: string;
  group: 'upper' | 'lower' | 'performance' | 'legacy';
}

const FOCUS_AREA_PRESENTATION_OPTIONS: FocusAreaPresentationOption[] = [
  {
    area: 'chest',
    title: 'Chest',
    assetKey: 'chest',
    accessibilityLabel: 'Chest focus',
    group: 'upper',
  },
  {
    area: 'back',
    title: 'Back',
    assetKey: 'back',
    accessibilityLabel: 'Back focus',
    group: 'upper',
  },
  {
    area: 'shoulders',
    title: 'Shoulders',
    assetKey: 'shoulders',
    accessibilityLabel: 'Shoulders focus',
    group: 'upper',
  },
  {
    area: 'arms',
    title: 'Arms',
    assetKey: 'arms',
    accessibilityLabel: 'Arms focus',
    group: 'upper',
  },
  {
    area: 'core',
    title: 'Abs',
    assetKey: 'core',
    accessibilityLabel: 'Abs focus',
    group: 'upper',
  },
  {
    area: 'quads',
    title: 'Quads',
    assetKey: 'quads',
    accessibilityLabel: 'Quads focus',
    group: 'lower',
  },
  {
    area: 'glutes',
    title: 'Glutes',
    assetKey: 'glutes',
    accessibilityLabel: 'Glutes focus',
    group: 'lower',
  },
  {
    area: 'hamstrings',
    title: 'Hamstrings',
    assetKey: 'hamstrings',
    accessibilityLabel: 'Hamstrings focus',
    group: 'lower',
  },
  {
    area: 'calves',
    title: 'Calves',
    assetKey: 'calves',
    accessibilityLabel: 'Calves focus',
    group: 'lower',
  },
  {
    area: 'mobility',
    title: 'Mobility',
    assetKey: 'mobility',
    accessibilityLabel: 'Mobility focus',
    group: 'lower',
  },
  {
    area: 'legs',
    title: 'Legs',
    assetKey: 'legs',
    accessibilityLabel: 'Legs focus',
    group: 'legacy',
  },
  {
    area: 'conditioning',
    title: 'Conditioning',
    assetKey: 'conditioning',
    accessibilityLabel: 'Conditioning focus',
    group: 'legacy',
  },
];

/**
 * The area is the stored identifier and stays English; `title` above is the
 * English label. This returns the label in the user's language.
 */
const FOCUS_AREA_LABEL_KEYS: Record<SetupFocusArea, I18nKey> = {
  chest: 'focusArea.chest',
  back: 'focusArea.back',
  shoulders: 'focusArea.shoulders',
  arms: 'focusArea.arms',
  core: 'focusArea.core',
  quads: 'focusArea.quads',
  glutes: 'focusArea.glutes',
  hamstrings: 'focusArea.hamstrings',
  calves: 'focusArea.calves',
  mobility: 'focusArea.mobility',
  legs: 'focusArea.legs',
  conditioning: 'focusArea.conditioning',
  bodyweight: 'focusArea.conditioning',
};

export function getFocusAreaLabel(area: SetupFocusArea, language: AppLanguage = 'en'): string {
  return t(language, FOCUS_AREA_LABEL_KEYS[area]);
}

export function getOnboardingFocusAreaPresentationOptions() {
  return FOCUS_AREA_PRESENTATION_OPTIONS.filter((option) => option.group === 'upper' || option.group === 'lower');
}
