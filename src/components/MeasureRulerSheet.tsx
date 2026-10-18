import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { RulerPicker } from './RulerPicker';
import { TypedRulerValue } from './TypedRulerValue';
import { useKeyboardOpen } from '../hooks/useKeyboardOpen';

import { formatShortDate, removeTrailingZeros } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The weight logger and the BMI editor, both built on the same dialled ruler
 * (design reference: Home Workout's Report tab, 2026-08-13).
 *
 * NO UNIT TOGGLE, deliberately, and this is the one place the reference was not
 * copied. It offers kg/lbs and cm/ft switches; this app is kg-only by decision
 * — `formatWeight` prints "kg" whatever `unitPreference` says. A toggle here
 * would make this the single screen where lbs works: the reader would dial 165,
 * save, and every other surface would answer "75 kg". Two truths about one
 * number is worse than one unit.
 */

const WEIGHT_MIN = 30;
const WEIGHT_MAX = 250;
/** 0.1 kg: the smallest change a bathroom scale reports and a body makes. */
const WEIGHT_STEP = 0.1;
const HEIGHT_MIN = 120;
const HEIGHT_MAX = 230;

interface SheetShellProps {
  visible: boolean;
  /** Required, not defaulted: the backdrop needs a label a reader can hear. */
  language: AppLanguage;
  /**
   * Safe-area inset, read on the SCREEN that mounts this sheet — inside this
   * Modal, `useSafeAreaInsets` itself always answers 0 (#bugs 2026-08-28).
   */
  bottomInset: number;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Whether one of the sheet's numbers is being typed.
 *
 * A typed number is committed when its field blurs, so Save, or a tap on the
 * backdrop, while it is still being typed would save the number from before
 * it, or drop it. Those taps end the typing instead; the next one saves or
 * closes. Asked of the field, not of the keyboard: Android's Modal does not
 * report its keyboard to the app, and iOS reports it gone a quarter of a
 * second after the keys start to leave.
 */
const SheetTyping = createContext<{ typing: boolean; onEditingChange: (editing: boolean) => void }>({
  typing: false,
  onEditingChange: () => {},
});

function SheetShell({ visible, language, bottomInset, onClose, children }: SheetShellProps) {
  const styles = useThemedStyles(makeStyles);
  // Without the inset the action row sits UNDER the system navigation bar and
  // Save is unreachable — the same failure the programme detail footer had.
  const slide = useRef(new Animated.Value(0)).current;
  const translateY = useRef(slide.interpolate({ inputRange: [0, 1], outputRange: [460, 0] })).current;
  // Lifted onto the keyboard, the sheet no longer meets the home indicator.
  const keyboard = useKeyboardOpen();
  const onKeys = Platform.OS === 'ios' && keyboard.open;
  // Counted, not flagged: on the BMI sheet a tap on the second number starts
  // it before the first one's blur ends the first.
  const [typingCount, setTypingCount] = useState(0);
  const onEditingChange = useCallback(
    (editing: boolean) => setTypingCount((count) => Math.max(0, count + (editing ? 1 : -1))),
    [],
  );
  const typing = typingCount > 0;
  const typingState = useMemo(() => ({ typing, onEditingChange }), [typing, onEditingChange]);

  useEffect(() => {
    if (!visible) {
      slide.setValue(0);
      setTypingCount(0);
      return;
    }
    Animated.timing(slide, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [slide, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/*
        The backdrop is a SIBLING of the sheet, not its parent.

        The first version wrapped the sheet in the backdrop Pressable and put a
        no-op Pressable around the content to swallow the press. That made the
        ruler undraggable: a Pressable claims the touch responder on move, so
        the finger's drag never reached the ScrollView underneath it. It looked
        fine under `adb input swipe` — a synthetic fling is dispatched as one
        gesture — and failed on every real thumb.

        Side by side, a press on the sheet cannot reach the backdrop at all, so
        nothing needs to swallow anything.

        iOS does not lift a Modal's content for the keyboard: typing the number
        hid the whole sheet, the number included (iOS hunt 2026-10-17, S5b-4).
        While a number is typed, a tap on the backdrop ends the typing rather
        than dropping it (SheetTyping).
      */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.cancel')}
          style={StyleSheet.absoluteFill}
          onPress={() => (typing ? Keyboard.dismiss() : onClose())}
        />
        <Animated.View style={{ transform: [{ translateY }] }}>
          <View style={[styles.sheet, { paddingBottom: (onKeys ? 0 : bottomInset) + 22 }]}>
            <SheetTyping.Provider value={typingState}>{children}</SheetTyping.Provider>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetActions({
  language,
  onCancel,
  onSave,
  cancelLabel,
  cancelAccessibilityLabel,
  saveLabel,
}: {
  language: AppLanguage;
  onCancel: () => void;
  onSave: () => void;
  /** Defaults to Cancel / Save; onboarding says Skip / Done. */
  cancelLabel?: string;
  cancelAccessibilityLabel?: string;
  saveLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { typing } = useContext(SheetTyping);

  return (
    <View style={styles.actionRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelAccessibilityLabel}
        onPress={onCancel}
        style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
      >
        <Text style={styles.cancelText}>{cancelLabel ?? t(language, 'common.cancel')}</Text>
      </Pressable>
      {/* While a number is typed, Save ends the typing and shows the number
          on the ruler; the next tap saves it (SheetTyping). */}
      <Pressable
        accessibilityRole="button"
        onPress={() => (typing ? Keyboard.dismiss() : onSave())}
        style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
      >
        <Text style={styles.saveText}>{saveLabel ?? t(language, 'common.save')}</Text>
      </Pressable>
    </View>
  );
}

function BigValue({
  language,
  value,
  suffix,
  decimals,
  bounds,
  label,
  onCommit,
}: {
  language: AppLanguage;
  value: number;
  suffix: string;
  decimals: number;
  bounds: { min: number; max: number; step: number };
  label: string;
  onCommit: (value: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const { onEditingChange } = useContext(SheetTyping);

  return (
    <View style={styles.bigRow}>
      <TypedRulerValue
        language={language}
        value={value}
        bounds={bounds}
        decimals={decimals}
        onCommit={onCommit}
        onEditingChange={onEditingChange}
        textStyle={styles.bigValue}
        label={label}
        suffix={<Text style={styles.bigSuffix}>{suffix}</Text>}
        penColor={theme.highlight}
      />
    </View>
  );
}

interface WeightLogSheetProps {
  visible: boolean;
  language: AppLanguage;
  /** Opens on the last logged weight — the common edit is a small one. */
  initialKg: number;
  /**
   * ISO date the entry will carry. Shown as a pill so it is never a surprise.
   * Null for a weight that is not an entry (onboarding's About you).
   */
  dateIso: string | null;
  /** Safe-area inset, read on the screen and passed through to SheetShell. */
  bottomInset: number;
  onCancel: () => void;
  onSave: (weightKg: number) => void;
  /**
   * The scale's ends; the log's own by default. About you keeps its 35–220.
   */
  limits?: { min: number; max: number };
  /** The buttons' words, when Cancel / Save is not what they do (About you: Skip / Done). */
  cancelLabel?: string;
  /** What a screen reader hears for that button, when its word is too short. */
  cancelAccessibilityLabel?: string;
  saveLabel?: string;
  /**
   * A tap on the backdrop, or Android's back key; `onCancel` by default.
   * About you's Cancel is Skip, an answer, and the backdrop must not give it.
   */
  onDismiss?: () => void;
}

/**
 * Logging today's weight, and About you's weight in onboarding (#bugs
 * 2026-10-18, iOS build 5): the two-column wheel there was "tosi vaikea", and
 * the owner asked for this sheet instead — one big number, one ruler, a pen
 * to type, two buttons. One instrument for one number, wherever it is asked.
 */
export function WeightLogSheet({
  visible,
  language,
  initialKg,
  dateIso,
  bottomInset,
  onCancel,
  onSave,
  limits,
  cancelLabel,
  cancelAccessibilityLabel,
  saveLabel,
  onDismiss,
}: WeightLogSheetProps) {
  const min = limits?.min ?? WEIGHT_MIN;
  const max = limits?.max ?? WEIGHT_MAX;
  const styles = useThemedStyles(makeStyles);
  const [weight, setWeight] = useState(initialKg);

  // A reopened sheet starts from today's truth, not from where the last
  // cancelled drag happened to stop.
  useEffect(() => {
    if (visible) {
      setWeight(initialKg);
    }
  }, [visible, initialKg]);

  return (
    <SheetShell visible={visible} language={language} bottomInset={bottomInset} onClose={onDismiss ?? onCancel}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t(language, 'weightLog.title')}</Text>
        {dateIso ? (
          <View style={styles.datePill}>
            <Text style={styles.datePillText}>{formatShortDate(dateIso, language)}</Text>
          </View>
        ) : null}
      </View>

      <BigValue language={language} value={weight} suffix="kg" decimals={1} bounds={{ min, max, step: WEIGHT_STEP }} label={t(language, 'weightLog.title')} onCommit={setWeight} />
      <RulerPicker
        min={min}
        max={max}
        step={WEIGHT_STEP}
        majorEvery={10}
        value={weight}
        onChange={setWeight}
        accessibilityLabel={t(language, 'weightLog.title')}
        unit="kg"
      />

      <SheetActions
        language={language}
        onCancel={onCancel}
        onSave={() => onSave(weight)}
        cancelLabel={cancelLabel}
        cancelAccessibilityLabel={cancelAccessibilityLabel}
        saveLabel={saveLabel}
      />
    </SheetShell>
  );
}

/** Tape measures, and body fat as a percentage — the two shapes of measure. */
const MEASURE_BOUNDS: Record<string, { min: number; max: number; step: number; majorEvery: number }> = {
  '%': { min: 3, max: 60, step: 0.1, majorEvery: 10 },
  cm: { min: 20, max: 200, step: 0.5, majorEvery: 10 },
};

interface MeasureLogSheetProps {
  visible: boolean;
  language: AppLanguage;
  /** The measure's own name, so the sheet says what is being logged. */
  title: string;
  /**
   * Where to put the tape.
   *
   * "Käsivarret" said which limb and nothing about which part of it, and the
   * reader read it as possibly the forearm ("ehkä vähän missleading voisi olla
   * hauiksen ympärysmitta", #bugs 2026-08-27). The name is fixed, but the
   * same ambiguity sits on every one of these: chest at the nipples or under
   * the arms, waist at the navel or the narrowest point. A girth taken from a
   * different place each time is not a measurement, and this screen exists to
   * draw a trend through them.
   */
  hint?: string | null;
  unit: string;
  /** Opens on the last reading; the common edit is a small one. */
  initialValue: number;
  dateIso: string;
  /** Safe-area inset, read on the screen and passed through to SheetShell. */
  bottomInset: number;
  onCancel: () => void;
  onSave: (value: number) => void;
}

/**
 * Logging a tape measurement or a body-fat reading.
 *
 * The same dialled ruler the weight logger uses, for the same reason the user
 * gave when asking for it (2026-08-25): the measures screen had a bare text
 * field and a green Save button wedged into the card, and "kaikkiin näihin
 * tulee kirjaa nappi niinkuin oman painon mittauksessa". A keyboard for a
 * number you nudge by half a centimetre is the wrong instrument.
 *
 * No cm/in toggle here either — see the note at the top of this file. The app
 * stores centimetres, and a sheet that dialled inches would be the one place
 * inches existed.
 */
export function MeasureLogSheet({
  visible,
  language,
  title,
  hint = null,
  unit,
  initialValue,
  dateIso,
  bottomInset,
  onCancel,
  onSave,
}: MeasureLogSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const bounds = MEASURE_BOUNDS[unit] ?? MEASURE_BOUNDS.cm;
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [visible, initialValue]);

  return (
    <SheetShell visible={visible} language={language} bottomInset={bottomInset} onClose={onCancel}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.datePill}>
          <Text style={styles.datePillText}>{formatShortDate(dateIso, language)}</Text>
        </View>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <BigValue language={language} value={value} suffix={unit} decimals={1} bounds={bounds} label={title} onCommit={setValue} />
      <RulerPicker
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        majorEvery={bounds.majorEvery}
        value={value}
        onChange={setValue}
        accessibilityLabel={title}
        unit={unit}
      />

      <SheetActions language={language} onCancel={onCancel} onSave={() => onSave(value)} />
    </SheetShell>
  );
}

interface BmiEditSheetProps {
  visible: boolean;
  language: AppLanguage;
  initialKg: number;
  initialHeightCm: number;
  /** Safe-area inset, read on the screen and passed through to SheetShell. */
  bottomInset: number;
  onCancel: () => void;
  onSave: (next: { weightKg: number; heightCm: number }) => void;
}

export function BmiEditSheet({
  visible,
  language,
  initialKg,
  initialHeightCm,
  bottomInset,
  onCancel,
  onSave,
}: BmiEditSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const [weight, setWeight] = useState(initialKg);
  const [height, setHeight] = useState(initialHeightCm);

  useEffect(() => {
    if (visible) {
      setWeight(initialKg);
      setHeight(initialHeightCm);
    }
  }, [visible, initialKg, initialHeightCm]);

  return (
    <SheetShell visible={visible} language={language} bottomInset={bottomInset} onClose={onCancel}>
      <Text style={styles.title}>{t(language, 'bmi.title')}</Text>

      <Text style={styles.fieldLabel}>{t(language, 'weightCard.title')}</Text>
      <BigValue language={language} value={weight} suffix="kg" decimals={1} bounds={{ min: WEIGHT_MIN, max: WEIGHT_MAX, step: WEIGHT_STEP }} label={t(language, 'weightLog.title')} onCommit={setWeight} />
      <RulerPicker
        min={WEIGHT_MIN}
        max={WEIGHT_MAX}
        step={WEIGHT_STEP}
        majorEvery={10}
        value={weight}
        onChange={setWeight}
        accessibilityLabel={t(language, 'weightLog.title')}
        unit="kg"
      />

      <Text style={styles.fieldLabel}>{t(language, 'bmi.height')}</Text>
      <BigValue language={language} value={height} suffix="cm" decimals={0} bounds={{ min: HEIGHT_MIN, max: HEIGHT_MAX, step: 1 }} label={t(language, 'bmi.height')} onCommit={setHeight} />
      <RulerPicker
        min={HEIGHT_MIN}
        max={HEIGHT_MAX}
        step={1}
        majorEvery={10}
        value={height}
        onChange={setHeight}
        accessibilityLabel={t(language, 'bmi.height')}
        unit="cm"
      />

      <SheetActions
        language={language}
        onCancel={onCancel}
        onSave={() => onSave({ weightKg: weight, heightCm: height })}
      />
    </SheetShell>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(16,10,32,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.ink,
  },
  // Under the name, above the number: read once, then you dial.
  hint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: theme.muted,
  },
  datePill: {
    backgroundColor: theme.surfaceSoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  datePillText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.muted,
  },
  fieldLabel: {
    marginTop: 18,
    fontSize: 17,
    fontWeight: '800',
    color: theme.ink,
  },
  bigRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  bigValue: {
    fontSize: 46,
    lineHeight: 52,
    fontWeight: '800',
    color: theme.highlight,
    letterSpacing: -1,
  },
  bigSuffix: {
    fontSize: 17,
    fontWeight: '800',
    color: theme.ink,
    marginBottom: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  cancelButton: {
    flex: 1,
    height: 54,
    borderRadius: 999,
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.ink,
  },
  saveButton: {
    flex: 1.4,
    height: 54,
    borderRadius: 999,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.onHighlight,
  },
  pressed: {
    opacity: 0.85,
  },
});
