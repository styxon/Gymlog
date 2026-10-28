import { StyleSheet } from 'react-native';

import { Theme } from '../theming';

/**
 * The guided player's look: the dark palette, the shared size constants and
 * the one makeStyles factory. makeStyles is exported once, because
 * useThemedStyles caches by the factory function's identity.
 */

// Dark palette for rest / finish takeovers (guided-shared.jsx GPD).
export const GPD = {
  bg1: '#241B4A',
  bg2: '#17112E',
  ink: '#F4F1FF',
  muted: '#A79FC4',
  faint: '#7C739E',
  line: 'rgba(255,255,255,0.12)',
  green: '#37D08A',
};

/**
 * A set box and the gap between two, for the row to work out how many fit
 * (lib/guidedSetRow guidedBoxesThatFit). The cap is GUIDED_SET_BOX_CAP, six
 * since #bugs 2026-10-10; it was nine, which did not fit the phone.
 */
export const SET_DOT_SIZE = 18;
export const SET_DOT_GAP = 4;

/** The walk-up's one-line notices — a stall in amber, a step up in green — share one shape. */
export const WALK_BANNER = { borderWidth: 1, borderRadius: 14, padding: 12 } as const;
export const WALK_BANNER_TEXT = { fontSize: 12.5, fontWeight: '700', lineHeight: 18 } as const;

/**
 * The walk-up's contents list draws its heading and rows at exactly these
 * heights, so the space they need can be worked out before they are drawn
 * (lib/guidedRunPreview).
 */
export const WALK_RUN_HEAD = 28;
export const WALK_RUN_ROW = 30;

export const makeStyles = (theme: Theme) => StyleSheet.create({
  /* entry */
  entryRoot: { flex: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  entryEyebrow: { fontSize: 12.5, fontWeight: '800', letterSpacing: 1.5, color: theme.muted },
  entryTitle: { marginTop: 8, marginBottom: 4, fontSize: 32, fontWeight: '800', letterSpacing: -0.6, color: theme.ink },
  entrySub: { fontSize: 14.5, fontWeight: '600', color: theme.muted },
  resumeCard: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.highlightSoft,
    borderWidth: 1.5,
    borderColor: theme.highlight,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  entryLastRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  entryProgressPill: {
    backgroundColor: theme.highlightSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 0,
  },
  entryProgressPillText: { fontSize: 12.5, fontWeight: '800', color: theme.highlight },
  // A block of the list, not a card. The box and its 15 px of padding a side
  // were width the lift names needed: "Ojentajapushdown" broke mid-word at the
  // phone's text size (#bugs 2026-09-30, "laatikointi pois ... levennetään").
  // A hairline under each block keeps them apart.
  phaseCard: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 18,
  },
  phaseRows: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingVertical: 8,
    marginBottom: 6,
  },
  // The box a paired row lives in on the entry table, and the label that
  // straddles its top line.
  phaseSupersetGroup: {
    borderRadius: 12,
    paddingTop: 8,
    paddingBottom: 2,
    marginVertical: 6,
  },
  phaseSupersetPill: {
    position: 'absolute',
    top: -7,
    left: 20,
    // The page, now that the block sits on it rather than on a card.
    backgroundColor: theme.bg,
    paddingHorizontal: 6,
  },
  phaseSupersetPillText: {
    color: theme.purple,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  phaseRowGroup: {
    paddingLeft: 4,
    paddingRight: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
  },
  // Name first and wide, wrapping as far as it needs; the three number
  // columns are fixed so a value sits in the same place on every row, blank
  // or not. Sized so "SARJAT" and "TOISTOT" fit their heads on one line.
  phaseRowName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 17, fontWeight: '700', color: theme.ink },
  phaseCol: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  phaseColHead: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.3, color: theme.faint, textAlign: 'right' },
  // As wide as the reps column: "SARJAT" did not fit in 38 and read
  // "SARJA…" (#bugs 2026-09-22), and the two headers are the same kind of word.
  phaseColSets: { width: 46 },
  phaseColReps: { width: 46 },
  phaseColLoad: { width: 60 },
  // The step number's disc. Same size and place the play disc held, so the
  // header's rhythm is unchanged — only the thing inside it means something now.
  phaseStep: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: theme.highlightSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseStepText: { fontSize: 17, fontWeight: '800', color: theme.highlight },
  // `accent`, not `green`: this is the "do the thing" button, the same one
  // Home's Start workout is, and in dark that action colour is orange while
  // green keeps meaning *done*. In light both tokens are the same green, so
  // nothing moves there.
  startCta: {
    height: 60,
    borderRadius: 19,
    backgroundColor: theme.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 18,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },
  startOverLink: {
    alignSelf: 'center',
    paddingTop: 14,
    paddingHorizontal: 12,
  },
  startOverText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.muted,
  },

  /* chrome */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  topBtnDark: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderColor: GPD.line,
  },
  // Lit while the panel it opens is showing: the button is a toggle, and a
  // toggle you cannot see the state of is a button you press twice.
  topBtnActive: {
    backgroundColor: theme.purpleLight,
    borderColor: theme.purple,
  },
  topLabel: { flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '800', letterSpacing: 1.6, marginHorizontal: 8 },
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 4,
  },
  railSetPill: {
    flex: 2.6,
    height: 16,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },

  /* media */
  mediaZone: {
    height: 250,
    marginTop: 12,
    // Wider than the rest of the content so the exercise photo reads bigger.
    marginHorizontal: 10,
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  mediaInitials: { fontSize: 118, fontWeight: '800', letterSpacing: -5, color: 'rgba(124,58,237,0.22)' },

  /* interval */
  intervalRound: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: theme.muted,
    marginBottom: 10,
  },
  // The one word you read at a glance while moving, so it carries the weight
  // the reps number carries on an ordinary set.
  intervalPhase: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  intervalNext: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
    marginTop: 12,
  },

  /* splash / ready */
  splashRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 32 },
  splashTitle: { fontSize: 46, fontWeight: '800', letterSpacing: -1.4, color: theme.ink, textAlign: 'center' },
  /**
   * The block had no style at all, which is not the same as "no layout".
   *
   * An unstyled View takes the width of its widest child — here the "warm-up
   * done" row — and its other children stretch to that width and then sit at
   * its left edge, because only the big title carried textAlign: 'center'. So
   * the eyebrow and the meta line landed left of the title while the title was
   * centred, and the block read as crooked (user 2026-08-26, "tekstit ovat
   * ihan vinossa"). Centring the box centres every line in it, whatever the
   * line happens to be.
   */
  splashCopy: { alignItems: 'center', gap: 6 },

  // The phase intro that carries a fork: copy in the upper half, the two
  // buttons down where a thumb rests rather than floating mid-screen.
  splashChoiceRoot: {
    flex: 1,
    paddingHorizontal: 26,
    paddingTop: 20,
    // Lifted off the bottom edge (user 2026-08-26, "vähän ylemmäs nappeja"):
    // the pair sat against the system bar, which on a tall phone is below
    // where a thumb rests rather than at it.
    paddingBottom: 64,
    justifyContent: 'space-between',
  },
  splashChoiceCopy: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },

  /* doing a block your own way */
  ownBlockSheet: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg },
  // 62pt was the size of a target. This clock is a record of what you have
  // spent, and the drill countdowns are the numbers worth being that big.
  ownBlockClock: {
    textAlign: 'center',
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -1.4,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  ownBlockHint: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  ownBriefCard: {
    marginTop: 18,
    alignSelf: 'stretch',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  ownBriefLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3, color: theme.faint },
  ownBriefChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  ownBriefChip: {
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  ownBriefChipText: { fontSize: 12.5, fontWeight: '700', color: theme.ink },
  ownBriefFirst: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, gap: 3 },
  ownBriefFirstName: { fontSize: 15.5, fontWeight: '800', color: theme.ink },
  ownBriefFirstScheme: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.highlight,
    fontVariant: ['tabular-nums'],
  },
  /* the warm-up / recovery gate */
  gateCard: {
    flexGrow: 0,
    // Stretched, because the copy block that holds it centres its children —
    // left to itself the card shrank to its content and the drill names came
    // out as "…" (device 2026-09-04).
    alignSelf: 'stretch',
    marginTop: 18,
    maxHeight: 260,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  gateRowIndex: {
    width: 18,
    fontSize: 13,
    fontWeight: '800',
    color: theme.faint,
    fontVariant: ['tabular-nums'],
  },
  gateRowName: { fontSize: 15, fontWeight: '700', color: theme.ink },
  gateRowLength: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  gateOwnBtn: {
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
  },
  gateOwnLabel: { fontSize: 16, fontWeight: '800', color: theme.ink },
  // No border, no fill — quieter than the two buttons above it on purpose.
  gateAddExerciseLink: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  gateAddExerciseLinkText: { fontSize: 14, fontWeight: '700', color: theme.muted },
  readyDigit: { fontSize: 150, fontWeight: '800', letterSpacing: -7, color: theme.ink, lineHeight: 160, fontVariant: ['tabular-nums'] },

  /* drill / set */
  exerciseName: { fontSize: 27, fontWeight: '800', letterSpacing: -0.5, color: theme.ink, lineHeight: 31, textAlign: 'center' },
  cueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 7, maxWidth: '100%' },
  howToLink: { fontSize: 13, fontWeight: '800', color: theme.purple },
  positionName: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.9,
    color: theme.ink,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  drillCountdown: { fontSize: 104, fontWeight: '800', letterSpacing: -4, lineHeight: 110, fontVariant: ['tabular-nums'] },
  ctrlCircle: {
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },
  /* set screen v4 */
  setMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The blue + sat flush against the green one when the boxes ran long
    // (#bugs 2026-10-10); the row keeps a gap of its own now.
    gap: 8,
    paddingTop: 18,
    paddingHorizontal: 24,
  },
  setMetaLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  // `highlight`, not `purple`. The player's own rule two hundred lines up is
  // "anything pressable is orange, violet carries brand", and the set counter,
  // the open dial's border, its label and its +/- buttons were all still
  // violet — the one cluster on the screen that had not been told (user
  // 2026-09-07, "otetaan vahan tuota purppuraa pois"). `highlight` is orange
  // in dark and the same violet in light, so this repaints the theme that was
  // complained about and leaves the other one exactly as it is.
  setCounter: { flexShrink: 0, fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: theme.highlight, fontVariant: ['tabular-nums'] },
  // The dots are the one part of this row that grows without a bound — one
  // per set, and a reader can keep adding sets. They give way first, and the
  // counter beside them still says how many there are.
  // They take the room between the counter and the buttons, and the row draws
  // only as many as that room holds (guidedBoxesThatFit), so the buttons stay
  // put at its right end.
  setDots: { flexDirection: 'row', gap: SET_DOT_GAP, flex: 1, minWidth: 0, overflow: 'hidden' },
  // Above the lift, because it changes what the next tap means: log this and
  // you are walking to the other station, not starting a rest.
  setSupersetPill: {
    // Top-left, where the frame's line used to run; the frame is gone from
    // this screen (device, 2026-09-16) and the badge stands on its own.
    position: 'absolute',
    top: -2,
    left: 26,
    borderRadius: 999,
    borderWidth: 1.4,
    borderColor: theme.purple,
    // Filled with the screen's own ground, which is what breaks the line
    // behind it instead of letting it run across the word.
    backgroundColor: theme.bg,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  setSupersetPillText: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: theme.purple,
  },
  setSupersetFlow: {
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 22,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: theme.faint,
  },
  /** The lift the screen is asking for, among the ones it names. */
  setSupersetFlowNow: {
    color: theme.ink,
    fontWeight: '900',
  },
  setDot: {
    width: SET_DOT_SIZE,
    height: SET_DOT_SIZE,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* the lift's own card, at the top of the set screen */
  setExerciseCard: {
    marginHorizontal: 20,
    // Clear of the header. At 4 it sat against the ✕ and the speaker (user
    // 2026-09-04).
    marginTop: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  setExerciseTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  setExerciseThumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setExerciseInitials: { fontSize: 20, fontWeight: '800', color: theme.faint },
  setExerciseName: { flexShrink: 1, fontSize: 18, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
  // Bigger, and one claim rather than a list of three tab names the reader
  // has to have opened the sheet once to understand (user 2026-09-04).
  setExerciseHint: { marginTop: 4, fontSize: 14, fontWeight: '600', color: theme.muted },
  // Last time over today under one rule, 6 apart (#bugs 2026-10-09: the two
  // lines sat 17 apart and the first one wrapped).
  setExerciseRows: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 9,
  },
  setExerciseRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The chips take what the label and the load leave, and scroll inside it.
  setExerciseChipScroll: { flex: 1 },
  setExerciseLastLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: theme.faint },
  setExerciseLastLoad: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  // A ramp's chips are "16,25×8" (7-8 characters), not the bare 1-2 digit rep
  // count this row was built for — five of them can run past the card's right
  // edge, and `justifyContent: 'flex-end'` on a plain row pushed the overflow
  // off the near (left) side (review, #bugs 2026-09-29). The row wrapped to a
  // second line for that, which made the card tall (#bugs 2026-10-09); it is
  // the content of a sideways ScrollView now. `flexGrow` keeps a short row
  // against the right edge; a long one starts at the left and scrolls.
  setExerciseLastPills: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
  },
  setExerciseLastPill: {
    minWidth: 23,
    alignItems: 'center',
    backgroundColor: theme.surfaceSoft,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  setExerciseLastPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  // Today's weight and its arrow, one unit beside the label.
  setExerciseTodayLoad: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // The set being done: ringed in the action colour, as its dot is below.
  setExerciseTodayCurrent: { borderWidth: 1.5, borderColor: theme.highlight, paddingHorizontal: 3.5, paddingVertical: 1.5 },
  setExerciseFirstTime: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.muted,
  },
  // Sized to the card and the set row, and the only thing that shrinks.
  setTopScroll: { flexGrow: 0, flexShrink: 1 },
  // Shrinks, and clips, before anything under it moves.
  setTypingHead: { flexShrink: 1, minHeight: 0, overflow: 'hidden', paddingHorizontal: 22, paddingTop: 6, paddingBottom: 12 },
  hidden: { display: 'none' },
  setTypingName: { fontSize: 18, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
  // Grows to centre the dials in the room left over, and never shrinks under
  // them: `flex: 1, minHeight: 0` here let the box go smaller than its cards,
  // and centring split the overflow over both neighbours (owner's #2).
  setTargetArea: { flexGrow: 1, flexShrink: 0, justifyContent: 'center', paddingHorizontal: 22, gap: 10 },
  // Two dials of equal width. Each is a card, so the reps dial no longer
  // floats as a bare headline over a boxed weight — same shape, same weight.
  setDialRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  // A bout of minutes: the clock above the dial, on the same card ground.
  minutesClock: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  minutesClockTime: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1.6,
    color: theme.ink,
    lineHeight: 58,
    fontVariant: ['tabular-nums'],
  },
  minutesClockOf: { fontSize: 13, fontWeight: '700', color: theme.muted },
  minutesClockDone: { fontSize: 13, fontWeight: '800', color: theme.ink, textAlign: 'center' },
  minutesClockButton: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  minutesClockButtonText: { fontSize: 15, fontWeight: '800', color: theme.ink },
  setDialCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  // A bodyweight lift has one dial; it takes the row rather than half of it.
  setDialCardWide: { flex: 1 },
  // On `surface`, not on the page: the light danger ink is 4.83:1 on white
  // and only 4.10 on `bg` (accessibility audit, 2026-09-21).
  setWeightError: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.dangerBorder,
    backgroundColor: theme.surface,
  },
  setWeightErrorText: { fontSize: 12.5, fontWeight: '800', color: theme.danger },
  // Not an error: a question the next tap answers.
  setWeightNote: {
    alignSelf: 'center',
    marginTop: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  setWeightNoteText: { fontSize: 12.5, lineHeight: 17, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  // Open: the border says which card the buttons belong to.
  setDialCardOpen: { borderColor: theme.highlight, backgroundColor: theme.surface },
  setDialLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.1, color: theme.muted },
  // Under the number, always there. 52 wide so a gym thumb finds them; the
  // number above has the card's whole width to itself.
  setDialControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  setDialBtn: {
    width: 52,
    height: 40,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setDialBtnText: { fontSize: 22, fontWeight: '800', color: theme.highlight, lineHeight: 26 },
  // The number's own row: nothing beside it but its unit, so "16,25 kg" fits
  // at one size. The auto-fit on the number is a net for "102,5", no more.
  setDialValue: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 3,
    minWidth: 0,
    paddingVertical: 2,
  },
  setDialNumber: {
    flexShrink: 1,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1.3,
    color: theme.ink,
    lineHeight: 42,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    minWidth: 0,
    padding: 0,
  },
  setDialUnit: { fontSize: 14, fontWeight: '800', color: theme.faint },
  setBadgeRow: { alignItems: 'center', minHeight: 27 },
  // Green up, red down (user 2026-08-25): the progression chip states its
  // direction in colour, not just in sign. Purple stays on the badges that
  // explain provenance rather than a change (carried-from).
  setAutoBadgeUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 11,
    height: 27,
    borderRadius: 14,
    backgroundColor: theme.greenSoft,
  },
  setAutoBadgeUpText: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.4, color: theme.greenInk },
  setAutoBadgeDown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 11,
    height: 27,
    borderRadius: 14,
    backgroundColor: theme.dangerSoft,
  },
  setAutoBadgeDownText: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.4, color: theme.danger },
  // Quiet, not green: green now marks a raise, and a hold is the opposite
  // claim — the app deliberately NOT raising. Muted on the soft surface reads
  // as calm bookkeeping rather than either a success or an alarm.
  setHoldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 11,
    height: 27,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  setHoldBadgeText: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.4, color: theme.muted },
  // 64 → 52 and a lighter shadow: the button had the height of the two dials
  // above it put together, and the shadow made it read taller still.
  setLogButton: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    height: 52,
    borderRadius: 18,
    // `accent`, the app's "do the thing" colour — the same one the session's
    // own start button wears. It was `purple`, which in dark is the brand
    // colour and not the pressable one.
    backgroundColor: theme.accent,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  setLogButtonText: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: theme.onHighlight, letterSpacing: -0.17 },
  setControls: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingTop: 4, paddingBottom: 12 },
  /** The − button's place, kept while it is hidden. */
  setAddBtnSpacer: { borderWidth: 0, backgroundColor: 'transparent', flexShrink: 0 },
  setAddBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.green,
    backgroundColor: theme.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * Warm-ups in blue (user, 2026-10-05): set apart from the green of the work
   * at a glance. Blue edges and ink text, not white on blue — white on the
   * light theme's #0A84FF falls short of 4.5:1.
   */
  warmupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.blue,
  },
  // The blue + at the end of the set row: the green one's shape, dashed, so
  // it reads as "something before the sets", not one more set.
  warmupAdd: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.blue,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  warmupLogButton: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    height: 52,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: theme.blue,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  warmupLogButtonText: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  warmupCancel: {
    flexShrink: 0,
    paddingVertical: 4,
    paddingLeft: 10,
  },
  warmupCancelText: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  setRoundBtn: {
    width: 52,
    height: 52,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#28185A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  bigBtn: {
    height: 60,
    borderRadius: 19,
    // Keeps the shimmer inside the button's corners.
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.33,
    shadowRadius: 24,
    elevation: 6,
  },
  bigBtnTall: { height: 70, borderRadius: 22 },
  bigBtnText: { fontSize: 16.5, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  bigBtnTextTall: { fontSize: 19 },
  ghostBtn: {
    height: 48,
    borderRadius: 15,
    borderWidth: 1.5,
    // Was a light-theme hex on both themes: a pale lilac outline drawn on the
    // dark page, brighter than the text inside it.
    borderColor: theme.border,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ghostBtnText: { fontSize: 14.5, fontWeight: '800', color: theme.ink },
  walkActions: { flexDirection: 'row', gap: 10 },
  walkAction: { flex: 1 },
  walkAddedNote: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
    textAlign: 'center',
  },

  /* rest (light theme like every other in-workout screen) */
  // The ring itself carries the purple; label and figure stay ink so the
  // countdown reads like every other number in the player.
  restRingLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 2.6, color: theme.ink },
  // Stretched across the ring less its stroke, so RING_CLOCK_FIT's shrink has
  // a width to fit to.
  restCountdown: {
    alignSelf: 'stretch',
    paddingHorizontal: 22,
    textAlign: 'center',
    fontSize: 76,
    fontWeight: '800',
    letterSpacing: -2.9,
    color: theme.ink,
    lineHeight: 80,
    fontVariant: ['tabular-nums'],
  },
  /* walking to the next machine */
  walkStat: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 13,
    gap: 3,
  },
  walkStatLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: theme.faint },
  walkStatValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  walkStatSub: { fontSize: 12, fontWeight: '600', color: theme.muted, fontVariant: ['tabular-nums'] },
  // Amber, matching Home's plateau card and the rest-denied banner above —
  // one finding, one colour, wherever it shows up.
  walkPlateauBanner: { ...WALK_BANNER, borderColor: theme.amberBorder, backgroundColor: theme.amberSoft },
  walkPlateauText: { ...WALK_BANNER_TEXT, color: theme.amberInk },
  // Green, the colour a step forward wears on the set rail and the finish
  // screen — the plateau banner's answer, in the same shape.
  walkPraiseBanner: { ...WALK_BANNER, borderColor: theme.green, backgroundColor: theme.greenSoft },
  walkPraiseText: { ...WALK_BANNER_TEXT, color: theme.greenInk },
  // The walk-up's contents list. Heading and rows are FIXED heights
  // (WALK_RUN_HEAD, WALK_RUN_ROW): the room is worked out before they are
  // drawn, and a row that grew with its text would spill past it.
  walkRun: { paddingHorizontal: 2 },
  walkRunHead: { height: WALK_RUN_HEAD, flexDirection: 'row', alignItems: 'center', gap: 4 },
  walkRunTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: theme.faint },
  walkRunRow: { height: WALK_RUN_ROW, flexDirection: 'row', alignItems: 'center', gap: 10 },
  walkRunDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkRunName: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: '700', color: theme.ink },
  walkRunPlan: { fontSize: 12.5, fontWeight: '700', color: theme.muted, fontVariant: ['tabular-nums'] },
  walkRunMore: { fontSize: 12.5, fontWeight: '700', color: theme.muted, paddingLeft: 26 },
  /* rest screen */
  restRunStrip: {
    marginHorizontal: 20,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  restRunStripText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: theme.ink },
  restRunStripMeta: { fontSize: 13, fontWeight: '700', color: theme.muted, fontVariant: ['tabular-nums'] },
  // Amber, not red: nothing is broken, one thing is off. Theme tokens, so it
  // reads in dark as well (the freestyle banner's fixed hexes are light-only).
  restDeniedBanner: {
    marginHorizontal: 20,
    marginTop: 8,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.amberBorder,
    backgroundColor: theme.amberSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  restDeniedTitle: { fontSize: 13.5, fontWeight: '800', color: theme.amberInk },
  restDeniedBody: { fontSize: 12.5, fontWeight: '700', color: theme.ink, marginTop: 3, lineHeight: 17 },
  restDeniedAction: { fontSize: 13, fontWeight: '800', color: theme.amberInk },
  editVeil: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 14,
  },
  editTitle: { fontSize: 19, fontWeight: '800', color: theme.ink },
  editLiftName: { fontSize: 13, fontWeight: '700', color: theme.muted },
  editSetRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  editSetRowSelected: { borderColor: theme.highlight, backgroundColor: theme.highlightSoft },
  editSetRowText: { fontSize: 14.5, fontWeight: '700', color: theme.ink },
  editSetRowTextSelected: { color: theme.ink, fontWeight: '800' },
  // The finish step is the dark screen, so its failure copy is on GPD's ink.
  finishFailed: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14 },
  finishFailedTitle: { fontSize: 24, fontWeight: '800', color: GPD.ink },
  finishFailedBody: { fontSize: 15, lineHeight: 22, color: GPD.muted, marginBottom: 10 },
  editBtn: {
    flex: 1,
    height: 54,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  editBtnGhost: { borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.surface },
  editBtnGhostText: { fontSize: 15.5, fontWeight: '800', color: theme.ink },
  editBtnText: { fontSize: 15.5, fontWeight: '800' },
  editField: { flex: 1, gap: 6 },
  editLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, color: theme.faint },
  editInput: {
    height: 58,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    color: theme.ink,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  // An outline, not a filled button: skipping a rest is a shortcut past a
  // wait, and the loudest thing on the screen should not be a shortcut.
  restAdjustPair: { flexGrow: 2, flexShrink: 1, flexBasis: 10, flexDirection: 'row', gap: 10 },
  skipRestBtnArmed: { borderColor: theme.danger },
  skipRestBtn: {
    height: 56,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  /* finish */

  /* sheets */
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(14,8,30,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 30,
    // Gives way to the frame's cap below rather than overflowing it.
    flexShrink: 1,
  },
  sheetFrame: { maxHeight: '78%' },
  // A long sheet's list (GPSheet `scrollable`): sized to its rows, and given
  // way to the measured bound rather than overflowing the sheet.
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetScrollContent: { paddingBottom: 6 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 },
  // The pull zone: out to the sheet's edges and up to its top, so a thumb does
  // not have to find the 40 px grip (#bugs 2026-09-30).
  sheetGrab: { marginTop: -12, marginHorizontal: -22, paddingTop: 12, paddingHorizontal: 22 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  sheetTitleText: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: theme.ink },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  // A superset is one box holding several lifts: the row keeps its shape and
  // gains room for the outline to run without touching the text.
  runRowSuperset: {
    borderBottomWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginVertical: 4,
    borderRadius: 14,
  },
  // Inside the boundary, not on it — the line has to be able to pass behind
  // nothing.
  runSupersetPill: {
    position: 'absolute',
    top: -7,
    left: 14,
    backgroundColor: theme.surface,
    paddingHorizontal: 6,
  },
  runSupersetPillText: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: theme.purple,
  },
  // Hollow until reached, filled when it is where you are, ticked when done.
  runDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: theme.ink,
  },
  // One lift of a row: its name and plan, and its pencil on the right.
  runMember: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Orange in both themes (device, 2026-09-16): `highlight` is violet in light.
  // A 36 dp square: a thumb target, not an icon to aim at.
  runEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: theme.orange,
    backgroundColor: theme.orangeSoft,
  },
  runPlan: {
    marginTop: 2,
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  runMeta: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.faint,
  },
  howToNumber: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
