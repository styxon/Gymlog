import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { applyDecimalSeparator, parseNumberInput } from '../lib/format';
import { t } from '../lib/i18n';
import { BAR_WEIGHT_KG, PLATE_COLORS, plateLoad } from '../lib/plateMath';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

interface PlatePopProps {
  /** Raw kg input for the active set — may be empty or partial while typing. */
  kg: string;
  barKg?: number;
  language?: AppLanguage;
}

function formatPlate(plate: number) {
  // Not removeTrailingZeros: it rounds to one decimal and a 1.25 kg plate
  // would print as 1,3. Plates are already exact.
  return applyDecimalSeparator(`${plate}`);
}

/**
 * Compact per-side plate readout under the active set (AW3 design language).
 * Shared by the freestyle logger; Active Workout v3 will reuse it.
 */
export function PlatePop({ kg, barKg = BAR_WEIGHT_KG, language = 'en' }: PlatePopProps) {
  const styles = useThemedStyles(makeStyles);
  const total = parseNumberInput(kg);
  const valid = total !== null && total > 0;
  const load = valid ? plateLoad(total, barKg) : null;

  // Nothing to load yet: stay out of the way rather than explain yourself.
  if (!valid || !load) {
    return null;
  }
  const { plates } = load;

  return (
    <View>
      <Text style={styles.eyebrow}>{t(language, 'plates.eyebrow', { bar: barKg })}</Text>
      {load.belowBar ? (
        <Text style={styles.barOnly}>{t(language, 'plates.belowBar', { bar: barKg })}</Text>
      ) : plates.length === 0 && load.remainderKg === 0 ? (
        <Text style={styles.barOnly}>{t(language, 'plates.justBar', { bar: barKg })}</Text>
      ) : (
        <View style={styles.chipRow}>
          {plates.map((plate, index) => (
            <View key={`${plate}-${index}`} style={[styles.chip, { backgroundColor: PLATE_COLORS[plate] }]}>
              <Text style={styles.chipText}>{formatPlate(plate)}</Text>
            </View>
          ))}
        </View>
      )}
      {load.remainderKg > 0 ? (
        <Text style={styles.remainder}>
          {t(language, 'plates.remainder', { kg: formatPlate(load.remainderKg) })}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.84,
    color: theme.faint,
  },
  barOnly: {
    fontSize: 13.5,
    fontWeight: '800',
    color: theme.ink,
    marginTop: 7,
  },
  remainder: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.muted,
    marginTop: 7,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  chip: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
