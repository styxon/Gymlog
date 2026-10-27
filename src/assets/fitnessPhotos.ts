import { ImageSourcePropType } from 'react-native';

export type FitnessPhotoKey = 'strength' | 'hiit' | 'running' | 'recovery';

export const fitnessPhotos: Record<FitnessPhotoKey, ImageSourcePropType> = {
  strength: require('../../assets/fitness/selected/strength.jpg'),
  hiit: require('../../assets/fitness/selected/hiit.jpg'),
  running: require('../../assets/fitness/selected/running.jpg'),
  recovery: require('../../assets/fitness/selected/recovery.jpg'),
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

export function getFitnessPhotoVariant({
  title,
  goal,
}: {
  title?: string | null;
  goal?: string | null;
}): FitnessPhotoKey {
  const haystack = `${normalize(title)} ${normalize(goal)}`;

  if (
    haystack.includes('run') ||
    haystack.includes('cardio') ||
    haystack.includes('conditioning') ||
    haystack.includes('sprint')
  ) {
    return 'running';
  }

  if (
    haystack.includes('hiit') ||
    haystack.includes('circuit') ||
    haystack.includes('athletic') ||
    haystack.includes('explosive')
  ) {
    return 'hiit';
  }

  if (
    haystack.includes('recovery') ||
    haystack.includes('mobility') ||
    haystack.includes('stretch') ||
    haystack.includes('deload')
  ) {
    return 'recovery';
  }

  return 'strength';
}
