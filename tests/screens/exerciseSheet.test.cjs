const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const sheetSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'ExerciseSheet.tsx'),
  'utf8',
);
const playerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'),
  'utf8',
);
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');

/**
 * The set screen's exercise card, and the sheet it opens.
 *
 * This file guarded components/SetPanels.tsx until 2026-09-04 — three panels
 * swiped sideways at the top of the set screen, from design "GAINER
 * Sarjaruudun paneelit". The panels answered the right questions behind the
 * wrong control: a swipe, above a screen whose whole job is a number you are
 * about to type, and a camera glyph in the header that cost the sound toggle
 * its slot.
 *
 * The card replaced them. It is always on screen, it carries last time's
 * numbers without a tap, and it is the only door to the sheet. What survives
 * from the old file is everything that was never really about the panels: one
 * reader for "last time", and a skipped day not counting as one.
 */
module.exports = [
  {
    name: 'exercise card: always on screen, and the only way into the sheet',
    run() {
      // Not behind a toggle. The reader standing at the rack should not have
      // to press anything to see what they lifted last time.
      assert.doesNotMatch(playerSource, /\{panelsOpen \?/);
      assert.match(playerSource, /onPress=\{onOpenSheet\}\s*\r?\n\s*style=\{styles\.setExerciseCard\}/);
      assert.match(playerSource, /onOpenSheet=\{\(\) => setSetPanelsOpen\(true\)\}/);
      // And the sheet it opens is the new one, not the retired carousel.
      assert.match(playerSource, /<ExerciseSheet\b/);
      assert.equal(
        fs.existsSync(path.join(__dirname, '..', '..', 'src', 'components', 'SetPanels.tsx')),
        false,
        'the retired panels component is still on disk',
      );
    },
  },
  {
    name: 'the top bar right slot is the sound toggle again, on every screen',
    run() {
      // It held the set screen's info button, which put the one control the
      // design says lives in exactly one place in two. The info moved to the
      // card; the slot went back to sound.
      assert.doesNotMatch(playerSource, /video=\{\s*\r?\n?\s*step\.type === 'set'/);
      assert.doesNotMatch(playerSource, /active: setPanelsOpen/);
      // The card carries the info affordance instead.
      assert.match(playerSource, /<GPIcon name="info"/);
    },
  },
  {
    name: 'the sheet offers the tabs it has content for, and says so when one is empty',
    run() {
      // Three when the lift has teaching written, two when it does not — a
      // Learn tab with nothing in it is worse than no Learn tab (2026-09-04).
      assert.match(sheetSource, /const ALL_TABS: ExerciseSheetTab\[\] = \['learn', 'howTo', 'history'\]/);
      assert.match(sheetSource, /learn \? ALL_TABS : ALL_TABS\.filter\(\(key\) => key !== 'learn'\)/);
      // The photo sits with the instructions rather than in a tab of its own
      // whose other half was the same instructions.
      assert.doesNotMatch(sheetSource, /tab === 'loop'/);
      assert.match(sheetSource, /tab === 'howTo'[\s\S]{0,400}styles\.photo/);
      // A tab with nothing behind it says so rather than rendering blank.
      assert.match(sheetSource, /guided\.sheet\.noInstructions/);
      assert.match(sheetSource, /guided\.sheet\.noHistory/);
      // Today's bar is the accent one; the rest are not.
      assert.match(sheetSource, /bar\.isToday \? theme\.highlight : theme\.purpleLight/);
      // The sheet clears the system bar — with the SCREEN's inset. It used to
      // read its own, and inside a Modal that is always 0 in this app: the
      // padding it added was 20 on every phone, and this guard pinned the
      // zero as the fix ("vähän pelivaraa alapalkin ja näppäinten väliin",
      // #bugs 2026-09-20). The screen reads it; the sheet takes a prop.
      assert.doesNotMatch(sheetSource, /useSafeAreaInsets/);
      assert.match(sheetSource, /paddingBottom: bottomInset \+ 20/);
      assert.match(playerSource, /const screenInsets = useSafeAreaInsets\(\);/);
      assert.match(playerSource, /<ExerciseSheet[\s\S]{0,900}bottomInset=\{screenInsets\.bottom\}/);
    },
  },
  {
    /**
     * #bugs 2026-08-29: "Alla näkyy viimeksi tehty 27.8 mutta ei näy ylhäällä
     * olevassa taulukossa mitään."
     *
     * The table read `slotHistory[slotId]` and stopped there; the weight badge
     * under it came from the prefill, which falls through to the unscoped key
     * and then to a name lookup. One screen, two readers of one fact — so what
     * is guarded is that there is one reader, with the same inputs. The card
     * inherited the table's half of it.
     */
    name: 'the card and the prefill resolve last time the same way',
    run() {
      assert.match(playerSource, /resolveLastTimeEntry\(\{/);
      assert.doesNotMatch(playerSource, /workout\.history\.slotHistory\[slotId\]/);
      // Every input the prefill uses: the unscoped key an older install wrote
      // under, the loaded-lift rule, and the rep prescription that keeps a
      // heavy day's weight off a 15-20 day.
      assert.match(playerSource, /templateSlotId: instance\?\.templateSlotId/);
      assert.match(playerSource, /requireLoaded: instance \? !isUnloadedTrackingMode/);
      assert.match(playerSource, /repWindow: instance \? resolveInstanceBorrowRepWindow\(instance\)/);
      // Borrowed sets are shown, and still marked as borrowed in the data.
      assert.match(playerSource, /borrowed: resolved\?\.borrowed \?\? false/);
      // The best set is marked only when it actually beat the others.
      assert.match(playerSource, /last\.sets\.some\(\(other\) => other\.loadKg < heaviest\)/);
    },
  },
  {
    /**
     * One selector for "the newest session that actually happened", used by
     * the prefill and by the card. A skipped day is not a last time — it is a
     * day the lift did not happen.
     */
    name: 'a skipped day is not a last time, decided in one place',
    run() {
      const lookupSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'lib', 'exerciseHistoryLookup.ts'),
        'utf8',
      );
      assert.match(lookupSource, /export function selectLatestUsableEntry/);
      assert.match(lookupSource, /!entry!\.skipped && entry!\.sets\.length > 0/);

      const stateSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'features', 'workout', 'workoutState.ts'),
        'utf8',
      );
      assert.match(stateSource, /const latest = selectLatestUsableEntry\(entries, nowMs\)/);
    },
  },
  {
    /**
     * PR #57 review: `setPanelSource` opens with `if (step.type !== 'set')
     * return null`, and the rest screen's delta pill and the walk-up screen's
     * LAST card both read it while standing on a rest and a position step. So
     * both were null for everybody, always — and on a device they read as
     * "this lift has no history yet" rather than as a bug.
     *
     * A lift's history is a fact about the slot, not about which step is on
     * screen.
     */
    name: 'last time is resolved per slot, not only on a set step',
    run() {
      assert.match(playerSource, /const resolveSlotHistory = useCallback\(/);
      // The walk-up asks for its own slot. (The rest screen's delta pill, the
      // other reader this guarded, went with the rest screen's next-set card on
      // 2026-09-09 — see guidedPlayerSwap.test.cjs.)
      assert.match(playerSource, /const last = resolveSlotHistory\(step\.slotId, step\.exerciseName\);/);
      // And neither reaches for the set-step value any more.
      assert.doesNotMatch(playerSource, /setPanelSource\?\.history/);
    },
  },
  {
    /**
     * PR #57 review: the walk-up card showed `restSecondsMax` while
     * `buildGuidedSteps` is handed `restSecondsMin` — so a 120-180 lift was
     * promised 180 s and got a 2:00 ring thirty seconds later.
     */
    name: 'the walk-up card names the rest the timer actually runs',
    run() {
      assert.match(playerSource, /rest: guidedRestSeconds\(instance\.restSecondsMin\),/);
      assert.doesNotMatch(playerSource, /rest: instance\.restSecondsMax,/);
      // The one place the plan's rest reaches the step machine, unchanged.
      assert.match(playerSource, /restSeconds: exercise\.restSecondsMin,/);
    },
  },
  {
    /**
     * PR #57 review: the card guarded on the FIRST set's load and printed the
     * heaviest. A session whose set 1 was logged at 0 kg — what the dial
     * offers on a lift with no history — hid a real top set behind a dash.
     */
    name: 'the card decides and prints with the same number',
    run() {
      assert.doesNotMatch(playerSource, /panels\.history\.sets\[0\]/);
      assert.match(playerSource, /heaviestOf\(panels\.history\) > 0/);
    },
  },
  {
    name: 'every string of the card and the sheet reads in both languages',
    run() {
      for (const key of [
        'guided.sheet.tab.learn',
        'guided.sheet.tab.howTo',
        'guided.sheet.tab.history',
        'guided.sheet.today',
        'guided.sheet.bestSet',
        'guided.sheet.oneRepMax',
        'guided.sheet.sessions',
        'guided.sheet.topSets',
        'guided.sheet.noHistory',
        'guided.sheet.noInstructions',
        'guided.sheet.watchFor',
        'guided.sheet.pr',
        'guided.sheet.cues',
        'guided.card.hint',
        'guided.card.lastTime',
        'guided.card.firstTime',
        'guided.logSetIndex',
        'guided.rest.editTitle',
        'guided.rest.editSave',
      ]) {
        const occurrences = i18nSource.split(`'${key}':`).length - 1;
        assert.equal(occurrences, 2, `${key} is missing one of its two languages`);
      }
      // The retired panels' own strings went with the component.
      assert.doesNotMatch(i18nSource, /'panels\.last\.title'/);
    },
  },
  {
    /**
     * User decision, 2026-09-26: 78% (set 2026-09-04 so the sheet would not
     * resize itself per tab, see the `sheet` style's own comment) covered
     * most of the set screen behind it. Lowered to 55%, still a fixed
     * fraction of the window rather than of the content — the tab row must
     * still not move when the reader switches tabs — and the body must still
     * be the thing that scrolls, so a smaller sheet reaches its content by
     * scrolling one screen further rather than by clipping it.
     */
    name: 'the sheet opens at 55% of the window, drags up to 90%, and the body still scrolls to reach it all',
    run() {
      // 55% so the set screen stays in view (2026-09-26); 90% by dragging,
      // for reading the steps (#bugs 2026-09-27, "55 % ja vetämällä 90 %").
      assert.match(sheetSource, /const collapsedHeight = Math\.round\(windowHeight \* 0\.55\);/);
      assert.match(sheetSource, /const expandedHeight = Math\.round\(windowHeight \* 0\.9\);/);
      assert.match(sheetSource, /\{\.\.\.pan\.panHandlers\}/);
      // Always 90% tall, slid down to show 55%: a transform on the native
      // driver, not a height laid out again on every frame of the drag
      // (#bugs 2026-09-30, "vähän laginen tuo vedettävä valikko").
      assert.match(sheetSource, /const collapsedOffset = expandedHeight - collapsedHeight;/);
      assert.match(
        sheetSource,
        /\{ height: expandedHeight, paddingBottom: bottomInset \+ 20, transform: \[\{ translateY: sheetOffset \}\] \}/,
      );
      assert.match(sheetSource, /useNativeDriver: true,/);
      assert.doesNotMatch(sheetSource, /sheetHeight/);
      // Every opening starts collapsed.
      assert.match(sheetSource, /sheetOffset\.setValue\(collapsedOffset\);\s*\}, \[visible, collapsedOffset, sheetOffset\]\);/);
      // Collapsed, the part of the sheet below the screen is made up in the
      // body's padding, so its last lines still scroll into view.
      assert.match(sheetSource, /contentContainerStyle=\{\{ paddingBottom: expanded \? 0 : collapsedOffset \}\}/);
      // The pull zone is the whole top: grip, name AND the tab row, which
      // yields a vertical pull and keeps its taps.
      const zone = sheetSource.slice(sheetSource.indexOf('{...pan.panHandlers}'), sheetSource.indexOf('<ScrollView'));
      assert.match(zone, /styles\.grip/);
      assert.match(zone, /styles\.tabs/);
      assert.match(sheetSource, /Math\.abs\(gesture\.dy\) > 4 && Math\.abs\(gesture\.dy\) > Math\.abs\(gesture\.dx\)/);
      assert.doesNotMatch(sheetSource, /height: '78%',/);
      // Still a fixed fraction, not the content's own size — sizing to
      // content is the exact bug the 78% comment documents.
      assert.match(sheetSource, /body: \{ flex: 1, marginTop: 16 \}/);
      assert.match(sheetSource, /<ScrollView\s*style=\{styles\.body\}/);
    },
  },
  {
    /**
     * #bugs 2026-09-20: the History tab said "no entries yet" for a bench
     * press while the records tab, in the same minute, showed its 7 × 60 from
     * 28.8. The tab read this SLOT's entries — this programme's bench — and a
     * bench pressed anywhere else was not this slot's history. The reader
     * pressed the exercise's name and expects the exercise's history.
     *
     * So the tab reads the lift by name — EVERY log, not the tracked summaries
     * the records read: tracking is a per-programme mark, and built from the
     * tracked summaries the tab lost an untracked slot's own sessions (CI
     * review of #154). The slot's rows are added where the lift lacks them,
     * never replaced. Guarded end to end: App builds the lookup from every
     * log, the tab passes it, the player unions the two on performedAt.
     */
    name: "the History tab reads the lift's history, and the slot only when the lift has none",
    run() {
      const tabSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'app', 'renderWorkoutTab.tsx'),
        'utf8',
      );
      const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
      // The memo, from App.tsx or the src/app module it moved into.
      const wiring = readAppWiring();
      assert.match(playerSource, /liftHistory\?\.\(instance\.exerciseName\)/);
      assert.doesNotMatch(playerSource, /lift && lift\.length > 0/, 'the lift replaces the slot again');
      assert.match(
        playerSource,
        /const known = new Set\(lift\.map\(\(entry\) => entry\.performedAt\)\)[\s\S]{0,600}getHistoryEntriesForExercise\(workout\.history, instance\)\s*\.filter\(\(entry\) => isUsableEntry\(entry\) && !known\.has\(entry\.performedAt\)\)/,
        'the slot rows the lift lacks must be added, on performedAt — and only the usable ones (CI review of #155)',
      );
      assert.match(tabSource, /<GuidedPlayerScreen[\s\S]{0,1500}liftHistory=\{liftHistory\}/);
      assert.match(wiring, /const liftHistory = useMemo/);
      const liftMemo = wiring.match(/const liftHistory = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[/);
      assert.ok(liftMemo, 'the liftHistory memo is gone');
      assert.ok(!liftMemo[0].includes('recordSources'), 'the lookup is built from the tracked summaries again');
      assert.match(wiring, /const byName = getLiftHistoryByName\(database\);/, 'the lookup must be built from every log');
      // Any indent, but the deps object's own: `liftHistory,` sits at the
      // depth of the call's first property, not inside some nested object.
      assert.match(appSource, /renderWorkoutTab\(\{\r?\n([ \t]+)[\s\S]{0,4000}\r?\n\1liftHistory,\r?\n/);
    },
  },
];
