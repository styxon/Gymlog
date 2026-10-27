import { I18nManager, NativeModules, Platform } from 'react-native';

import { AppLanguage } from '../types/models';
import { resolveLanguageFromLocale } from '../lib/deviceLanguage';

/**
 * Asking the phone what language it is in.
 *
 * Split from lib/deviceLanguage so the RULE stays testable in Node: importing
 * react-native from anything the seed pulls in makes the whole test suite
 * refuse to load.
 *
 * Four sources, tried in order, because there is no single one that answers on
 * every build. `NativeModules.I18nManager` alone is what the first attempt used
 * and it came back empty on this app: the new architecture is on, and under
 * TurboModules the NativeModules proxy is not populated for modules the JS side
 * already wraps. The wrapper's own getConstants() is.
 *
 * Every branch is wrapped. This runs before storage is read, and a throw here
 * would be a blank app rather than a wrong language.
 */
function readDeviceLocaleTag(): string | null {
  const candidates: Array<() => unknown> = [
    // RN's own wrapper — works on both architectures, Android only.
    () => (I18nManager as unknown as { getConstants?: () => { localeIdentifier?: string } })
      .getConstants?.()?.localeIdentifier,
    // The old-architecture proxy, kept as a fallback rather than a primary.
    () => (NativeModules?.I18nManager as { localeIdentifier?: string } | undefined)?.localeIdentifier,
    () => {
      if (Platform.OS !== 'ios') {
        return undefined;
      }
      const settings = (NativeModules?.SettingsManager as
        | { settings?: { AppleLocale?: string; AppleLanguages?: string[] } }
        | undefined)?.settings;
      return settings?.AppleLocale ?? settings?.AppleLanguages?.[0];
    },
    // Hermes ships Intl on both platforms; this also covers web.
    () => Intl?.DateTimeFormat?.().resolvedOptions?.().locale,
  ];

  for (const read of candidates) {
    try {
      const tag = read();
      if (typeof tag === 'string' && tag.trim().length > 0) {
        return tag;
      }
    } catch {
      // Try the next source rather than giving up on the whole question.
    }
  }

  return null;
}

/** The first-run language, resolved from the device. */
export function resolveDeviceLanguage(): AppLanguage {
  return resolveLanguageFromLocale(readDeviceLocaleTag());
}
