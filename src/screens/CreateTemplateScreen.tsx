import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CutButton } from '../components/CutButton';
import { CutSurface } from '../components/CutSurface';
import { Theme, useTheme, useThemedStyles } from '../theming';

import { AddExerciseSheet } from '../components/AddExerciseSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScreenHeader } from '../components/ScreenHeader';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { getExerciseTemplateDefaults } from '../lib/exerciseSuggestions';
import { formatRepRange } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import { libraryLabel } from '../lib/libraryLabel';
import { layout, radii, spacing } from '../theme';
import {
  AppLanguage,
  ExerciseLibraryItem,
  ExerciseTemplateDraft,
  WorkoutTemplateDraft,
} from '../types/models';
import { createId } from '../lib/ids';
import { resolveQuickLayoutExercises } from '../lib/quickLayoutExercises';
import { localizeWorkoutFocus } from '../lib/sessionNameLabel';
import {
  SplitPreset,
  TEMPLATE_BUILDER_STEPS,
  TEMPLATE_DAY_OPTIONS,
  TemplateBuilderStep,
  TemplateDayCount,
  baseChoiceDiscardsWork,
  baseSignature,
  clampDayCount,
  canJumpToTemplateBuilderStep,
  initialTemplateBuilderStep,
  laterTemplateBuilderStep,
  nextTemplateBuilderStep,
  presetsForDayCount,
  previousTemplateBuilderStep,
  templateBuilderStepIndex,
  templateDraftSignature,
} from '../lib/templateBuilderSteps';
import { useHardwareBack } from '../hooks/useHardwareBack';

interface TemplateExerciseState extends ExerciseTemplateDraft {
  localKey: string;
}

interface TemplateSessionState {
  localKey: string;
  id?: string;
  name: string;
  exercises: TemplateExerciseState[];
}

interface CreateTemplateScreenProps {
  initialDraft: WorkoutTemplateDraft;
  exerciseLibrary: ExerciseLibraryItem[];
  recentExerciseLibraryItems: ExerciseLibraryItem[];
  defaultRestSeconds: number;
  language?: AppLanguage;
  onBack: () => void;
  onSave: (draft: WorkoutTemplateDraft) => Promise<void> | void;
}

const STEP_LABEL_KEYS: Record<TemplateBuilderStep, I18nKey> = {
  name: 'tpl.step.name',
  days: 'tpl.step.days',
  base: 'tpl.step.base',
  build: 'tpl.step.build',
  review: 'tpl.step.review',
};

/** The base the reader picked: a layout's id, "scratch", or none yet. */
type ChosenBase = string | null;
const SCRATCH_BASE = 'scratch';

/**
 * Session names are stored, not derived — whatever is written here ends up in
 * the user's database and on every screen that shows it. They are written in
 * the user's language for that reason: a Finnish user's own program should not
 * be called "Day 3" forever because of the moment it was created.
 *
 * Names already stored in English still read correctly everywhere, because
 * `localizeSessionName` translates them on the way out.
 */
function createBlankSession(index: number, language: AppLanguage): TemplateSessionState {
  return {
    localKey: createId('template_session'),
    name: `${t(language, 'tpl.dayWord')} ${index + 1}`,
    exercises: [],
  };
}

function createExerciseFromLibraryItem(
  item: ExerciseLibraryItem,
  defaultRestSeconds: number,
): TemplateExerciseState {
  const defaults = getExerciseTemplateDefaults(item, defaultRestSeconds);

  return {
    localKey: createId('template_exercise'),
    name: item.name,
    targetSets: defaults.targetSets,
    repMin: defaults.repMin,
    repMax: defaults.repMax,
    restSeconds: defaults.restSeconds,
    trackedDefault: defaults.trackedDefault,
    libraryItemId: item.id,
  };
}

function mapDraftToSessions(draft: WorkoutTemplateDraft, language: AppLanguage): TemplateSessionState[] {
  if (Array.isArray(draft.sessions) && draft.sessions.length > 0) {
    return draft.sessions.map((session, index) => ({
      localKey: session.id ?? createId('template_session'),
      id: session.id,
      name: session.name.trim() || `${t(language, 'tpl.dayWord')} ${index + 1}`,
      exercises: (session.exercises ?? []).map((exercise) => ({
        localKey: exercise.id ?? createId('template_exercise'),
        ...exercise,
      })),
    }));
  }

  return [createBlankSession(0, language)];
}

function buildTemplateDraft(
  name: string,
  sessions: TemplateSessionState[],
  initialDraft: WorkoutTemplateDraft,
  language: AppLanguage,
): WorkoutTemplateDraft {
  return {
    id: initialDraft.id,
    // A name left blank takes the placeholder the reader saw in the field. It
    // was "New template", stored in English on a Finnish programme (2026-09-14).
    name: name.trim() || t(language, 'tpl.namePlaceholder'),
    sessions: sessions.map((session, index) => ({
      id: session.id,
      name: session.name.trim() || `${t(language, 'tpl.dayWord')} ${index + 1}`,
      exercises: session.exercises.map(({ localKey: _localKey, ...exercise }) => exercise),
    })),
  };
}

function resolvePresetPreviewImage(preset: SplitPreset, exerciseLibrary: ExerciseLibraryItem[]) {
  const normalizedKeywords = preset.previewKeywords.map((keyword) => keyword.toLowerCase());

  for (const item of exerciseLibrary) {
    const imageUrl = item.imageUrls?.[0];
    if (!imageUrl) {
      continue;
    }

    const haystack = `${item.name} ${item.bodyPart} ${item.equipment} ${item.category}`.toLowerCase();
    if (normalizedKeywords.some((keyword) => haystack.includes(keyword))) {
      return imageUrl;
    }
  }

  return exerciseLibrary.find((item) => item.imageUrls?.[0])?.imageUrls?.[0] ?? null;
}

export function CreateTemplateScreen({
  initialDraft,
  exerciseLibrary,
  recentExerciseLibraryItems,
  defaultRestSeconds,
  language = 'en',
  onBack,
  onSave,
}: CreateTemplateScreenProps) {
  const theme = useTheme();
  // The add-exercise sheet is a Modal and cannot read this itself.
  const sheetInsets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const editing = Boolean(initialDraft.id);

  const [templateName, setTemplateName] = useState(initialDraft.name);
  const [sessions, setSessions] = useState<TemplateSessionState[]>(() => mapDraftToSessions(initialDraft, language));
  /**
   * What the screen opened with, as one string. Leaving with anything else
   * drops work nothing has saved, and Back asks first.
   */
  const [openedSignature] = useState(() => templateDraftSignature(templateName, sessions));
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [pendingDayDrop, setPendingDayDrop] = useState<{ nextCount: TemplateDayCount; days: number } | null>(null);
  /**
   * The count the dialog was opened with, kept past the closing.
   *
   * `pendingDayDrop` is cleared on the tap and the modal fades out after it,
   * so reading the count straight off it repainted the body as "0 päivää" for
   * the length of the fade.
   */
  const lastDayDropCount = useRef(1);

  // The guided path. An edit opens on the days, with every step behind it
  // already reached.
  const [step, setStep] = useState<TemplateBuilderStep>(() => initialTemplateBuilderStep(editing));
  const [furthestStep, setFurthestStep] = useState<TemplateBuilderStep>(editing ? 'review' : 'name');
  const [chosenBase, setChosenBase] = useState<ChosenBase>(null);
  /** The days exactly as the last base made them — see baseChoiceDiscardsWork. */
  const lastBaseSignature = useRef<string | null>(null);
  const [pendingBase, setPendingBase] = useState<{ preset: SplitPreset | null } | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const sessionCount = clampDayCount(sessions.length);
  const presets = presetsForDayCount(sessionCount);
  const libraryById = useMemo(() => new Map(exerciseLibrary.map((item) => [item.id, item] as const)), [exerciseLibrary]);
  const presetPreviewImages = useMemo(
    () =>
      Object.fromEntries(
        presets.map((preset) => [preset.id, resolvePresetPreviewImage(preset, exerciseLibrary)]),
      ) as Record<string, string | null>,
    [exerciseLibrary, presets],
  );

  const totalExercises = useMemo(
    () => sessions.reduce((sum, session) => sum + session.exercises.length, 0),
    [sessions],
  );

  // A programme with an empty day is not a programme; the button waits until
  // every day has at least one lift. It used to accept three named, empty
  // days, which then showed up on Home as a session with nothing in it.
  const emptyDayCount = sessions.filter((session) => session.exercises.length === 0).length;
  const canSave = sessions.length > 0 && emptyDayCount === 0;
  const dayDropCount = pendingDayDrop?.days ?? lastDayDropCount.current;
  const activeSession = sessions.find((session) => session.localKey === activeSessionKey) ?? null;
  const activeSessionLibraryIds = useMemo(
    () =>
      activeSession?.exercises
        .map((exercise) => exercise.libraryItemId)
        .filter((value): value is string => Boolean(value)) ?? [],
    [activeSession],
  );
  const hasUnsavedWork = templateDraftSignature(templateName, sessions) !== openedSignature;

  function goToStep(target: TemplateBuilderStep) {
    setStep(target);
    setFurthestStep((current) => laterTemplateBuilderStep(current, target));
    // Each step is its own page; the next one opens at its top, not at the
    // scroll depth the last one was left at.
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function goToNextStep() {
    const next = nextTemplateBuilderStep(step);
    if (next) {
      goToStep(next);
    }
  }

  function setSessionCount(nextCount: TemplateDayCount) {
    setSessions((current) => {
      if (nextCount === current.length) {
        return current;
      }

      if (nextCount > current.length) {
        return [
          ...current,
          ...Array.from({ length: nextCount - current.length }, (_, index) => createBlankSession(current.length + index, language)),
        ];
      }

      return current.slice(0, nextCount);
    });
  }

  /**
   * Lowering the count takes the LAST days, and takes what is in them.
   *
   * The chips sit side by side, so "3" is a finger-width from "4", and a tap
   * dropped a day full of lifts with no confirmation and nothing to undo it
   * with — the drop is recoverable only by backing out of the whole screen,
   * which nothing says (audit 3, 2026-09-19). Asking first, and only when
   * there is something to lose: going from three empty days to two is not a
   * question worth asking.
   */
  function requestSessionCount(nextCount: TemplateDayCount) {
    const dropped = sessions.slice(nextCount);
    if (nextCount >= sessions.length || dropped.every((session) => session.exercises.length === 0)) {
      setSessionCount(nextCount);
      return;
    }
    // Every day the slice takes, not only the ones with lifts in them:
    // `setSessionCount` removes the whole tail, so counting the non-empty days
    // alone said "one day" while two disappeared.
    lastDayDropCount.current = dropped.length;
    setPendingDayDrop({ nextCount, days: dropped.length });
  }

  /**
   * A layout is days *with lifts in them*. It used to set three names on three
   * empty days and call that "Push / Pull / Legs" — a layout in name only,
   * with every exercise still to be found. Each day the layout names now opens
   * with the two to four lifts a programme for that focus starts from.
   *
   * A base replaces the days rather than filling the gaps in them: on a path
   * where the reader can go back and try another, keeping Push's lifts under a
   * day renamed "Full Body A" would be neither base. Replacing work that is
   * the reader's own is asked first (chooseBase).
   */
  function buildBaseSessions(preset: SplitPreset | null, current: TemplateSessionState[]): TemplateSessionState[] {
    if (!preset) {
      return Array.from({ length: current.length || 1 }, (_, index) => ({
        ...createBlankSession(index, language),
        id: current[index]?.id,
      }));
    }
    return preset.names.map((englishName, index) => ({
      ...createBlankSession(index, language),
      // An edited programme's day keeps its id, as the gap-filling version
      // did, so its history stays its own.
      id: current[index]?.id,
      name: localizeWorkoutFocus(englishName, language),
      exercises: resolveQuickLayoutExercises(englishName, exerciseLibrary).map(({ name: liftName, item }) => ({
        ...createExerciseFromLibraryItem(item, defaultRestSeconds),
        // The catalog's name, not the library variant's: "Back Squat"
        // translates and matches history the way the ready programmes do.
        name: liftName,
      })),
    }));
  }

  function applyBase(preset: SplitPreset | null) {
    const next = buildBaseSessions(preset, sessions);
    lastBaseSignature.current = baseSignature(next);
    setSessions(next);
    setChosenBase(preset ? preset.id : SCRATCH_BASE);
    goToStep('build');
  }

  function chooseBase(preset: SplitPreset | null) {
    if (baseChoiceDiscardsWork(sessions, lastBaseSignature.current)) {
      setPendingBase({ preset });
      return;
    }
    applyBase(preset);
  }

  /**
   * Back walks the path before it leaves it: from Exercises to Base, from
   * Base to Days. It leaves from the step the screen opened on, and asks
   * first when leaving would drop work nothing has saved. While a save is on
   * its way it does nothing; the programme page follows the save.
   */
  function handleBack() {
    if (savingRef.current) {
      return;
    }
    const previous = previousTemplateBuilderStep(step, editing);
    if (previous) {
      goToStep(previous);
      return;
    }
    if (hasUnsavedWork) {
      setConfirmingLeave(true);
      return;
    }
    onBack();
  }

  // The route-level back listener stands down on this screen (useRouteBack),
  // so the key walks the steps the way the header's chevron does.
  useHardwareBack(handleBack);

  function updateSessionName(sessionKey: string, nextName: string) {
    setSessions((current) =>
      current.map((session) =>
        session.localKey === sessionKey
          ? {
              ...session,
              name: nextName,
            }
          : session,
      ),
    );
  }

  function removeSession(sessionKey: string) {
    setSessions((current) => current.filter((session) => session.localKey !== sessionKey));
    setActiveSessionKey((current) => (current === sessionKey ? null : current));
  }

  function openAddExercise(sessionKey: string) {
    setActiveSessionKey(sessionKey);
  }

  function appendExercisesToSession(items: ExerciseLibraryItem[]) {
    if (!activeSessionKey || items.length === 0) {
      return;
    }

    setSessions((current) =>
      current.map((session) =>
        session.localKey === activeSessionKey
          ? {
              ...session,
              exercises: [...session.exercises, ...items.map((item) => createExerciseFromLibraryItem(item, defaultRestSeconds))],
            }
          : session,
      ),
    );
    setActiveSessionKey(null);
  }

  function removeExercise(sessionKey: string, exerciseKey: string) {
    setSessions((current) =>
      current.map((session) =>
        session.localKey === sessionKey
          ? {
              ...session,
              exercises: session.exercises.filter((exercise) => exercise.localKey !== exerciseKey),
            }
          : session,
      ),
    );
  }

  /**
   * One save per press, however fast the second one comes.
   *
   * A new programme has no id until the provider mints one, so each save is a
   * new programme: two taps on Tallenna made two, the reader landed on the
   * second, and the pair spent two of the three free places — or the second
   * met the limit sheet over the programme the first had just saved
   * (double-tap audit, 2026-09-21). A ref, because the second tap arrives
   * before a re-render could disable the buttons; the state is what disables
   * them after.
   */
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!canSave || savingRef.current) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(buildTemplateDraft(templateName, sessions, initialDraft, language));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const stepIndex = templateBuilderStepIndex(step);

  function renderStepIndicator() {
    return (
      <View style={styles.stepper}>
        <View style={styles.stepTrack}>
          {TEMPLATE_BUILDER_STEPS.map((candidate, index) => {
            const reachable = candidate !== step && canJumpToTemplateBuilderStep(candidate, furthestStep);
            return (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityLabel={t(language, 'tpl.step.a11y', {
                  index: index + 1,
                  label: t(language, STEP_LABEL_KEYS[candidate]),
                })}
                accessibilityState={{ selected: candidate === step, disabled: !reachable }}
                disabled={!reachable || saving}
                hitSlop={{ top: 12, bottom: 12 }}
                onPress={() => goToStep(candidate)}
                style={styles.stepSegmentHit}
              >
                <View
                  style={[
                    styles.stepSegment,
                    index < stepIndex && styles.stepSegmentDone,
                    index === stepIndex && styles.stepSegmentCurrent,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.stepCounter}>
          {t(language, 'tpl.step.counter', { index: stepIndex + 1, total: TEMPLATE_BUILDER_STEPS.length })}
          {' · '}
          <Text style={styles.stepCounterLabel}>{t(language, STEP_LABEL_KEYS[step])}</Text>
        </Text>
      </View>
    );
  }

  function renderNameStep() {
    return (
      <>
        <Text style={styles.stepTitle}>{t(language, 'tpl.nameTitle')}</Text>
        <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
          <Text style={styles.cardKicker}>{t(language, 'tpl.name')}</Text>
          <TextInput
            value={templateName}
            onChangeText={setTemplateName}
            placeholder={t(language, 'tpl.namePlaceholder')}
            placeholderTextColor={theme.faint}
            selectionColor={theme.purple}
            autoFocus={!editing}
            returnKeyType="next"
            onSubmitEditing={goToNextStep}
            style={styles.nameInput}
          />
        </CutSurface>
        <CutButton label={t(language, 'common.continue')} onPress={goToNextStep} variant="primary" size="lg" stretch />
      </>
    );
  }

  function renderDaysStep() {
    return (
      <>
        <Text style={styles.stepTitle}>{t(language, 'tpl.daysTitle')}</Text>
        <View style={styles.dayGrid}>
          {TEMPLATE_DAY_OPTIONS.map((option) => {
            const active = option === sessions.length;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(language, option === 1 ? 'tpl.dayCountOne' : 'tpl.dayCount', { count: option })}
                onPress={() => requestSessionCount(option)}
                style={styles.dayTileHit}
              >
                <CutSurface
                  size="md"
                  fill={active ? theme.purpleFill : theme.surface}
                  stroke={active ? undefined : theme.border}
                  strokeWidth={1}
                  style={styles.dayTile}
                >
                  <Text style={[styles.dayTileNumber, active && styles.dayTileTextActive]}>{option}</Text>
                  <Text style={[styles.dayTileUnit, active && styles.dayTileTextActive]}>
                    {t(language, option === 1 ? 'tpl.dayUnitOne' : 'tpl.dayUnitMany')}
                  </Text>
                </CutSurface>
              </Pressable>
            );
          })}
        </View>
        <CutButton label={t(language, 'common.continue')} onPress={goToNextStep} variant="primary" size="lg" stretch />
      </>
    );
  }

  function renderBaseStep() {
    return (
      <>
        <Text style={styles.stepTitle}>{t(language, 'tpl.baseTitle')}</Text>
        <Text style={styles.stepBody}>{t(language, 'tpl.baseBody')}</Text>
        <View style={styles.baseList}>
          {presets.map((preset) => {
            const previewImage = presetPreviewImages[preset.id];
            const chosen = chosenBase === preset.id;
            return (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                onPress={() => chooseBase(preset)}
              >
                <CutSurface
                  size="lg"
                  fill={theme.surface}
                  stroke={chosen ? theme.purple : theme.border}
                  strokeWidth={chosen ? 2 : 1}
                  style={styles.baseCard}
                >
                  <View style={styles.baseMedia}>
                    {previewImage ? (
                      <Image source={{ uri: previewImage }} style={styles.baseMediaImage} resizeMode="cover" />
                    ) : (
                      <Text style={styles.baseMediaFallbackText}>
                        {t(language, preset.labelKey).slice(0, 1).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.baseCopy}>
                    <Text style={styles.baseTitle}>{t(language, preset.labelKey)}</Text>
                    <Text style={styles.baseBody}>{t(language, preset.descriptionKey)}</Text>
                    <Text numberOfLines={2} style={styles.baseMeta}>
                      {/* The days as the reader will see them, not the
                          English tokens they are stored as. */}
                      {preset.names.map((name) => localizeWorkoutFocus(name, language)).join(' · ')}
                    </Text>
                  </View>
                </CutSurface>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: chosenBase === SCRATCH_BASE }}
            onPress={() => chooseBase(null)}
          >
            <CutSurface
              size="lg"
              fill={theme.bg}
              stroke={chosenBase === SCRATCH_BASE ? theme.purple : theme.border}
              strokeWidth={chosenBase === SCRATCH_BASE ? 2 : 1}
              dashed={chosenBase !== SCRATCH_BASE}
              style={styles.baseCard}
            >
              <View style={[styles.baseMedia, styles.scratchMedia]}>
                <Text style={styles.scratchPlus}>+</Text>
              </View>
              <View style={styles.baseCopy}>
                <Text style={styles.baseTitle}>{t(language, 'tpl.scratch')}</Text>
                <Text style={styles.baseBody}>
                  {t(language, sessions.length === 1 ? 'tpl.scratchDescOne' : 'tpl.scratchDescMany', {
                    count: sessions.length,
                  })}
                </Text>
              </View>
            </CutSurface>
          </Pressable>
        </View>
      </>
    );
  }

  function renderBuildStep() {
    return (
      <>
        <Text style={styles.stepTitle}>{t(language, 'tpl.buildTitle')}</Text>
        <Text style={styles.stepBody}>
          {t(language, sessions.length === 1 ? 'tpl.summaryOne' : 'tpl.summaryMany', {
            days: sessions.length,
            exercises: totalExercises,
          })}
        </Text>
        <View style={styles.sessionList}>
          {sessions.map((session, index) => (
            <CutSurface
              key={session.localKey}
              size="lg"
              fill={theme.surface}
              stroke={theme.border}
              strokeWidth={1}
              style={styles.sessionCard}
            >
              <View style={styles.sessionHeader}>
                <View style={styles.sessionHeaderCopy}>
                  <Text style={styles.cardKicker}>{t(language, 'tpl.day', { index: index + 1 })}</Text>
                  <Text style={[styles.sessionCountText, session.exercises.length === 0 && styles.sessionCountEmpty]}>
                    {t(
                      language,
                      session.exercises.length === 1 ? 'tpl.exerciseOne' : 'tpl.exerciseMany',
                      { count: session.exercises.length },
                    )}
                  </Text>
                </View>

                {sessions.length > 1 ? (
                  <Pressable onPress={() => removeSession(session.localKey)} style={styles.sessionRemoveButton}>
                    <Text style={styles.sessionRemoveButtonText}>{t(language, 'tpl.remove')}</Text>
                  </Pressable>
                ) : null}
              </View>

              <TextInput
                value={session.name}
                onChangeText={(value) => updateSessionName(session.localKey, value)}
                placeholder={t(language, 'tpl.day', { index: index + 1 })}
                placeholderTextColor={theme.faint}
                selectionColor={theme.purple}
                style={styles.sessionNameInput}
              />

              {session.exercises.length ? (
                <View style={styles.exerciseList}>
                  {session.exercises.map((exercise) => {
                    const libraryItem = exercise.libraryItemId ? libraryById.get(exercise.libraryItemId) ?? null : null;
                    const previewImage = libraryItem?.imageUrls?.[0] ?? null;

                    return (
                      <CutSurface
                        key={exercise.localKey}
                        size="md"
                        fill={theme.surfaceSoft}
                        style={styles.exerciseRow}
                      >
                        <View style={styles.exerciseLead}>
                          <View style={styles.exerciseThumb}>
                            {previewImage ? (
                              <Image source={{ uri: previewImage }} style={styles.exerciseThumbImage} resizeMode="cover" />
                            ) : (
                              <View style={styles.exerciseThumbFallback}>
                                <Text style={styles.exerciseThumbFallbackText}>
                                  {(exercise.name.trim().charAt(0) || 'E').toUpperCase()}
                                </Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.exerciseCopy}>
                            <Text numberOfLines={2} style={styles.exerciseName}>
                              {exerciseNameLabel(language, exercise.name)}
                            </Text>
                            <Text numberOfLines={1} style={styles.exerciseMeta}>
                              {libraryItem
                                ? `${libraryLabel(libraryItem.bodyPart, language)} · ${libraryLabel(libraryItem.equipment, language)}`
                                : t(language, 'tpl.setsReps', {
                                    sets: exercise.targetSets,
                                    // "12-12 toistoa" — the row printed both
                                    // ends of the range even when they were the
                                    // same number (#bugs 2026-08-26). The app
                                    // has one rep-range formatter and it has
                                    // always collapsed an equal range; this row
                                    // was interpolating the raw fields instead.
                                    reps: formatRepRange(exercise.repMin, exercise.repMax),
                                  })}
                            </Text>
                          </View>
                        </View>

                        {/* Named, and 44 to the thumb: this was a bare "X"
                            in a 32-wide circle (accessibility audit,
                            2026-09-21). */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(language, 'emptyWorkout.a11y.remove', {
                            name: exerciseNameLabel(language, exercise.name),
                          })}
                          hitSlop={6}
                          onPress={() => removeExercise(session.localKey, exercise.localKey)}
                          style={styles.exerciseRemoveButton}
                        >
                          <Text style={styles.exerciseRemoveButtonText}>X</Text>
                        </Pressable>
                      </CutSurface>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateTitle}>{t(language, 'tpl.noExercises')}</Text>
                  <Text style={styles.emptyStateBody}>{t(language, 'tpl.noExercisesBody')}</Text>
                </View>
              )}

              {/* Outline, not filled. Adding an exercise is what you do
                  repeatedly inside a day; saving the template is what ends the
                  screen. As a solid black bar per day this was the loudest
                  thing on the page, repeated once per day card, and Tallenna
                  was quieter than all of them. */}
              <CutButton
                label={t(language, 'editor.addExercises')}
                onPress={() => openAddExercise(session.localKey)}
                variant="outline"
                size="lg"
                stretch
              />
            </CutSurface>
          ))}
        </View>

        {/* Says why Continue is quiet: an empty day is the one thing that
            holds the path here. */}
        {emptyDayCount > 0 ? (
          <Text style={styles.blockedHint}>
            {t(language, emptyDayCount === 1 ? 'tpl.emptyDaysOne' : 'tpl.emptyDaysMany', { count: emptyDayCount })}
          </Text>
        ) : null}
        <CutButton
          label={t(language, 'common.continue')}
          onPress={canSave ? goToNextStep : undefined}
          variant={canSave ? 'primary' : 'disabled'}
          size="lg"
          stretch
        />
      </>
    );
  }

  function renderReviewStep() {
    return (
      <>
        <Text style={styles.stepTitle}>{t(language, 'tpl.reviewTitle')}</Text>
        <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
          <Text style={styles.cardKicker}>{t(language, 'tpl.name')}</Text>
          <Text style={styles.reviewName}>{templateName.trim() || t(language, 'tpl.namePlaceholder')}</Text>
          <Text style={styles.reviewSummary}>
            {t(language, sessions.length === 1 ? 'tpl.summaryOne' : 'tpl.summaryMany', {
              days: sessions.length,
              exercises: totalExercises,
            })}
          </Text>
        </CutSurface>
        <View style={styles.reviewList}>
          {sessions.map((session, index) => (
            <CutSurface key={session.localKey} size="md" fill={theme.surface} style={styles.reviewDay}>
              <Text style={styles.cardKicker}>{t(language, 'tpl.day', { index: index + 1 })}</Text>
              <Text style={styles.reviewDayName}>
                {session.name.trim() || `${t(language, 'tpl.dayWord')} ${index + 1}`}
              </Text>
              <Text numberOfLines={3} style={styles.reviewDayLifts}>
                {session.exercises.map((exercise) => exerciseNameLabel(language, exercise.name)).join(' · ')}
              </Text>
            </CutSurface>
          ))}
        </View>
        {/* The indicator can bring the reader here after a day was emptied;
            the quiet Save says why, as Continue does on the days. */}
        {emptyDayCount > 0 ? (
          <Text style={styles.blockedHint}>
            {t(language, emptyDayCount === 1 ? 'tpl.emptyDaysOne' : 'tpl.emptyDaysMany', { count: emptyDayCount })}
          </Text>
        ) : null}
        {/* The label holds still while the save runs: the success is the
            programme page that opens after the write resolves, never this
            button. */}
        <CutButton
          label={t(language, 'tpl.save')}
          onPress={canSave && !saving ? () => void handleSave() : undefined}
          variant={canSave && !saving ? 'primary' : 'disabled'}
          size="lg"
          stretch
        />
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        language={language}
        title={t(language, initialDraft.id ? 'tpl.editTitle' : 'tpl.createTitle')}
        onBack={handleBack}
        // Same gate as the button at the bottom: while a day is empty there is
        // no save action, so the header shows none rather than a word that
        // does nothing when tapped.
        rightActionLabel={canSave && !saving ? t(language, 'common.save') : undefined}
        onRightActionPress={canSave && !saving ? () => void handleSave() : undefined}
      />

      {renderStepIndicator()}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'name'
          ? renderNameStep()
          : step === 'days'
            ? renderDaysStep()
            : step === 'base'
              ? renderBaseStep()
              : step === 'build'
                ? renderBuildStep()
                : renderReviewStep()}
      </ScrollView>

      <AddExerciseSheet
        bottomInset={sheetInsets.bottom}
        visible={activeSession !== null}
        items={exerciseLibrary}
        recentItems={recentExerciseLibraryItems}
        currentItemIds={activeSessionLibraryIds}
        language={language}
        title={t(language, 'editor.addExercises')}
        subtitle={t(language, 'tpl.pickForDay')}
        multiSelect
        autoFocusSearch
        onClose={() => setActiveSessionKey(null)}
        onSelectItem={() => {}}
        onConfirmSelection={appendExercisesToSession}
      />

      {/* Asked only when a day with lifts in it is about to go. The chips sit
          side by side, so the tap that drops one is a finger-width from the
          tap that keeps it. */}
      <ConfirmDialog
        language={language}
        visible={pendingDayDrop !== null}
        destructive
        title={t(language, dayDropCount === 1 ? 'tpl.dropDays.titleOne' : 'tpl.dropDays.titleMany')}
        message={t(language, dayDropCount === 1 ? 'tpl.dropDays.bodyOne' : 'tpl.dropDays.bodyMany', {
          count: dayDropCount,
        })}
        confirmLabel={t(language, 'tpl.dropDays.confirm')}
        onCancel={() => setPendingDayDrop(null)}
        onConfirm={() => {
          const target = pendingDayDrop;
          setPendingDayDrop(null);
          if (target) {
            setSessionCount(target.nextCount);
          }
        }}
      />

      {/* A base replaces the days; asked only when the lifts in them are the
          reader's own rather than what the last base put there. */}
      <ConfirmDialog
        language={language}
        visible={pendingBase !== null}
        destructive
        title={t(language, 'tpl.replaceBase.title')}
        message={t(language, 'tpl.replaceBase.body')}
        confirmLabel={t(language, 'tpl.replaceBase.confirm')}
        onCancel={() => setPendingBase(null)}
        onConfirm={() => {
          const target = pendingBase;
          setPendingBase(null);
          if (target) {
            applyBase(target.preset);
          }
        }}
      />

      <ConfirmDialog
        language={language}
        visible={confirmingLeave}
        destructive
        title={t(language, 'tpl.leave.title')}
        message={t(language, 'tpl.leave.body')}
        confirmLabel={t(language, 'tpl.leave.confirm')}
        onCancel={() => setConfirmingLeave(false)}
        onConfirm={() => {
          setConfirmingLeave(false);
          onBack();
        }}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    // The page was `surface` — the same white the cards are. Every card was a
    // hairline drawn on its own background, which is why the screen read as a
    // list of outlines rather than as a stack of cards.
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: layout.bottomTabBarReserve,
      gap: spacing.lg,
    },
    card: {
      padding: spacing.md,
      gap: spacing.xs,
    },
    // The path's indicator: one segment per step, filled up to where the
    // reader is. It sits under the header, outside the scroll, so it is the
    // one thing on every step that does not move.
    stepper: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      gap: spacing.xs,
    },
    stepTrack: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    stepSegmentHit: {
      flex: 1,
      paddingVertical: 4,
    },
    stepSegment: {
      height: 6,
      borderRadius: radii.pill,
      backgroundColor: theme.border,
    },
    stepSegmentDone: {
      backgroundColor: theme.purple,
    },
    stepSegmentCurrent: {
      backgroundColor: theme.highlight,
    },
    stepCounter: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    stepCounterLabel: {
      color: theme.ink,
    },
    stepTitle: {
      color: theme.ink,
      fontSize: 26,
      lineHeight: 31,
      fontWeight: '900',
      letterSpacing: -0.6,
    },
    stepBody: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      marginTop: -spacing.sm,
    },
    cardKicker: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    nameInput: {
      minHeight: 52,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
      paddingHorizontal: spacing.md,
      color: theme.ink,
      fontSize: 20,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    dayGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: spacing.sm,
    },
    dayTileHit: {
      width: '31.5%',
    },
    dayTile: {
      height: 92,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    dayTileNumber: {
      color: theme.ink,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: '900',
      letterSpacing: -1,
    },
    dayTileUnit: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    dayTileTextActive: {
      color: '#FFFFFF',
    },
    baseList: {
      gap: spacing.sm,
    },
    baseCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.sm,
      paddingRight: spacing.md,
    },
    baseMedia: {
      width: 76,
      height: 76,
      borderRadius: radii.sm,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.purpleDark,
    },
    baseMediaImage: {
      width: '100%',
      height: '100%',
    },
    baseMediaFallbackText: {
      color: '#FFFFFF',
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: -1,
    },
    scratchMedia: {
      backgroundColor: theme.surfaceSoft,
    },
    scratchPlus: {
      color: theme.purple,
      fontSize: 34,
      fontWeight: '700',
    },
    baseCopy: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    baseTitle: {
      color: theme.ink,
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    baseBody: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    baseMeta: {
      color: theme.ink,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
    },
    blockedHint: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: -spacing.xs,
    },
    reviewName: {
      color: theme.ink,
      fontSize: 22,
      fontWeight: '900',
      letterSpacing: -0.5,
    },
    reviewSummary: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    reviewList: {
      gap: spacing.sm,
    },
    reviewDay: {
      padding: spacing.md,
      gap: 3,
    },
    reviewDayName: {
      color: theme.ink,
      fontSize: 16,
      fontWeight: '800',
    },
    reviewDayLifts: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    sessionList: {
      gap: spacing.md,
    },
    sessionCard: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    sessionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    sessionHeaderCopy: {
      gap: 4,
    },
    sessionCountText: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '600',
    },
    sessionCountEmpty: {
      color: theme.amberInk,
    },
    sessionRemoveButton: {
      minHeight: 36,
      paddingHorizontal: spacing.sm,
      justifyContent: 'center',
    },
    sessionRemoveButtonText: {
      color: theme.danger,
      fontSize: 13,
      fontWeight: '700',
    },
    sessionNameInput: {
      minHeight: 50,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSoft,
      paddingHorizontal: spacing.md,
      color: theme.ink,
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    exerciseList: {
      gap: spacing.sm,
    },
    // Filled rather than outlined: inside a card, a row that repeats five times
    // reads better as a tinted band than as five more hairlines.
    exerciseRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      padding: spacing.sm,
    },
    exerciseLead: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minWidth: 0,
    },
    exerciseThumb: {
      width: 52,
      height: 52,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: theme.surface,
    },
    exerciseThumbImage: {
      width: '100%',
      height: '100%',
    },
    exerciseThumbFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    exerciseThumbFallbackText: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    exerciseCopy: {
      flex: 1,
      gap: 4,
      minWidth: 0,
    },
    exerciseName: {
      color: theme.ink,
      fontSize: 16,
      fontWeight: '800',
      lineHeight: 20,
    },
    exerciseMeta: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600',
    },
    exerciseRemoveButton: {
      width: 32,
      height: 32,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.dangerBorder,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.dangerSoft,
    },
    exerciseRemoveButtonText: {
      color: theme.danger,
      fontSize: 12,
      fontWeight: '900',
    },
    emptyState: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.bg,
      padding: spacing.md,
      gap: 4,
    },
    emptyStateTitle: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '800',
    },
    emptyStateBody: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
  });
