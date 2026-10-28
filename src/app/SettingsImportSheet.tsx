import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NewProgramSheet } from '../components/NewProgramSheet';

/**
 * Reads the inset for NewProgramSheet's Modal.
 *
 * VinhaApp itself cannot call `useSafeAreaInsets` — it is the component that
 * RETURNS `<AppShell>`, so its own fiber sits above AppShell's
 * SafeAreaProvider, not inside it, and the hook throws with no provider to
 * read from. This wrapper is rendered as an AppShell child instead (in the
 * same spot NewProgramSheet used to sit), which puts it inside the provider,
 * and it renders no Modal of its own — the same shape as a screen that reads
 * insets and hands them to a sheet component (#bugs 2026-08-28 pattern).
 */
export function SettingsImportSheet(props: Omit<React.ComponentProps<typeof NewProgramSheet>, 'bottomInset'>) {
  const insets = useSafeAreaInsets();
  return <NewProgramSheet {...props} bottomInset={insets.bottom} />;
}
