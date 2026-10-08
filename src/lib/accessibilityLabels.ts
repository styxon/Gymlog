/**
 * Screen-reader labels that are built from what a control shows.
 *
 * The accessibility audit of 2026-09-21 found the same mistake in several
 * places: a pressable card given a label that named its ACTION, which on
 * Android replaces everything inside it. The set screen's lift card was read
 * as "Liikkeen tiedot" — the lift's name and last time's numbers, the two
 * things the card exists to show, were never spoken. The action belongs in
 * the hint; the label is the content.
 *
 * Pure, so the wording can be tested without rendering a screen.
 */
import { AppLanguage } from '../types/models';
import { removeTrailingZeros } from './format';
import { summarizeHistoricalSetChips } from './guidedSetWeightSummary';
import { t } from './i18n';
import { WEIGHT_DIAL_STEP_KG } from './weightDial';

export interface LastTimeSummary {
  /** Each set's load and reps, in order — the same data the card's own
   *  per-set chips are built from (decision "a", #bugs 2026-09-29). */
  sets: readonly { loadKg: number; reps: number }[];
  /** From this lift in another program or an empty workout, not this slot. */
  borrowed: boolean;
}

/**
 * The lift card on the set screen: the name, then last time, in the order the
 * card draws them. A lift never done reads the card's own first-time line.
 *
 * A ramp reads as a ramp here too: when the sets did not all carry the same
 * weight, the card's heading hides its single "heaviest" number and shows
 * per-set weight×reps chips instead — the spoken label follows the same
 * split (`summarizeHistoricalSetChips`), so TalkBack/VoiceOver users are not
 * told the old single-heaviest-weight-plus-reps summary the visual change
 * was written to stop showing.
 */
export function exerciseCardAccessibilityLabel(
  language: AppLanguage,
  name: string,
  lastTime: LastTimeSummary | null,
  /**
   * Today's sets as the card's TÄNÄÄN row shows them (lib/guidedPlayer
   * resolveGuidedSetPlan) — null for a set with no number. The label stands in
   * for the card's children, so the row is said here or not at all.
   */
  todayReps?: ReadonlyArray<number | null> | null,
): string {
  const label = lastTimeCardLabel(language, name, lastTime);
  return todayReps && todayReps.length > 0
    ? `${label}. ${t(language, 'guided.card.todayA11y', { reps: todayReps.map((reps) => reps ?? '–').join(', ') })}`
    : label;
}

function lastTimeCardLabel(language: AppLanguage, name: string, lastTime: LastTimeSummary | null): string {
  if (!lastTime) {
    return `${name}. ${t(language, 'guided.card.firstTime')}`;
  }
  const lead = t(language, lastTime.borrowed ? 'guided.a11y.lastTimeBorrowed' : 'guided.a11y.lastTime');
  const { uniform, chips } = summarizeHistoricalSetChips(lastTime.sets);
  if (!uniform) {
    return chips.length > 0 ? `${name}. ${lead}: ${chips.join(', ')} kg` : `${name}. ${lead}`;
  }
  const heaviestKg = Math.max(0, ...lastTime.sets.map((set) => set.loadKg));
  const reps = lastTime.sets.map((set) => set.reps);
  const details = [
    heaviestKg > 0 ? `${removeTrailingZeros(heaviestKg)} kg` : null,
    reps.length > 0 ? t(language, 'guided.a11y.lastTimeReps', { reps: reps.join(', ') }) : null,
  ].filter((part): part is string => part !== null);
  return details.length > 0 ? `${name}. ${lead}: ${details.join(', ')}` : `${name}. ${lead}`;
}

/**
 * One of a set's two number fields. `setNumber` is the one the screen prints
 * (1-based). `liftName` goes first where the list holds more than one lift.
 */
export function setFieldAccessibilityLabel(
  language: AppLanguage,
  field: 'kg' | 'reps',
  setNumber: number,
  liftName?: string | null,
): string {
  if (liftName) {
    return t(language, field === 'kg' ? 'a11y.setField.kgInLift' : 'a11y.setField.repsInLift', {
      name: liftName,
      index: setNumber,
    });
  }
  return t(language, field === 'kg' ? 'a11y.setField.kg' : 'a11y.setField.reps', { index: setNumber });
}

/**
 * The weight dial's −/+ labels, from the step the dial actually takes. The
 * copy used to state 2,5 kg while the dial moved 1,25, so a screen-reader user
 * was told twice the change they made. Printed with the app's decimal mark.
 */
export function weightStepAccessibilityLabel(language: AppLanguage, direction: -1 | 1): string {
  return t(language, direction < 0 ? 'guided.a11y.weightDown' : 'guided.a11y.weightUp', {
    kg: removeTrailingZeros(WEIGHT_DIAL_STEP_KG),
  });
}
