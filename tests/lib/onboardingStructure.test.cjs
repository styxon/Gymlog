const assert = require('node:assert/strict');
const fs = require('node:fs');

const { LEVEL_STREAKS } = require('../../.test-dist/lib/levelStreaks.js');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

const onboardingSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'OnboardingScreen.tsx'),
  'utf8',
);
const welcomeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'WelcomeScreen.tsx'),
  'utf8',
);
const appSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'App.tsx'),
  'utf8',
);
// The whole shell — App.tsx plus the src/app modules the phase-B split
// (2026-09-30) moved VinhaApp's hooks into — for the absence guards: a shape
// that must not come back must not come back in a hook either.
const shellSource = readAppWiring();
// The questionnaire-to-preferences builders moved out of App.tsx in the
// phase-A split (2026-08-26) — the persistence pins read their new home.
const handoffSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', 'onboardingHandoff.ts'),
  'utf8',
);
const iconSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'VinhaIcon.tsx'),
  'utf8',
);
const pickSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramPickScreen.tsx'),
  'utf8',
);
const i18nSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'),
  'utf8',
);

function getFunctionBody(name) {
  const start = onboardingSource.indexOf(`function ${name}()`);
  assert.notEqual(start, -1, `${name} should exist`);

  const nextFunction = onboardingSource.indexOf('\n  function ', start + 1);
  assert.notEqual(nextFunction, -1, `${name} should be followed by another function`);

  return onboardingSource.slice(start, nextFunction);
}

/**
 * The text between two anchors, failing loudly when either has moved.
 *
 * `slice(indexOf(a), indexOf(b))` says nothing when an anchor is gone: -1 is a
 * valid slice bound, so a missing END quietly widens the window to the whole
 * file and every `doesNotMatch` in it starts asking a different question. That
 * is what happened when `SetupOptionCard` was deleted as dead code — the scope
 * of the LocationChoiceCard guards grew from 130 lines to 4,700 and they all
 * still passed (CI review of #143, 2026-09-19).
 */
function between(source, from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `anchor missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

module.exports = [
  {
    name: 'onboarding review step uses the light plan-ready flow',
    run() {
      const reviewBody = getFunctionBody('renderReview');

      // Plan-ready is ONE view: the programme pick (08b). It had two more.
      // The Pro paywall went on 2026-08-24 (the reader had just been handed a
      // programme and the next thing the app did was ask for money) and the
      // day preview on 2026-09-07, its content moved onto the card and into
      // the empty half the reader was looking at while a link pointed
      // somewhere else.
      assert.doesNotMatch(
        onboardingSource,
        /planReadyView|planReadyWorkoutPage|renderPlanReadyDay/,
        'the plan-ready day route grew back',
      );
      assert.doesNotMatch(onboardingSource, /renderProgramPick|ProgramPickCard/);
      assert.doesNotMatch(onboardingSource, /renderPlanReadyPro|ProPaywallScreen|onStartProTrial/);
      // The picker's own CTA is what finishes onboarding now.
      assert.match(reviewBody, /onContinue=\{[\s\S]{0,400}?onCompleteToTraining\(selection, activeRecommendedProgramId\)/);

      // One plan-ready screen, from design 08b variant D: two programs either
      // side of a diagonal seam, the choice made where the programs are. It
      // replaced BOTH the announce-then-ask pair — an overview that hid the
      // alternative behind "Vaihda", and a second screen with the same title
      // that asked again on two stacked cards.
      assert.match(onboardingSource, /setStageIndex\(getStageIndex\('review'\)\)/);
      assert.match(reviewBody, /<ProgramPickScreen/);
      assert.match(reviewBody, /selectedId=\{activeRecommendedProgramId\}/);
      assert.match(reviewBody, /setSelectedRecommendationProgramId\(id\)/);
      // The CTA continues; it does not save. The plan is written at the very
      // end, after the paywall — and "Valitse tämä ohjelma" beside a card
      // already reading "VALITSE TÄMÄ" was the same words meaning two things.
      // The picker's CTA ends onboarding, so it says so rather than "Continue".
      assert.match(reviewBody, /ctaLabel=\{t\(language, 'onb\.cta\.startTraining'\)\}/);

      // Days-per-week truth: the picker's stats and focus split come from the
      // composed week (what actually gets saved), never the raw catalog
      // template. The screen renders them; this is where they are computed.
      assert.match(reviewBody, /programPickOptions\.map/);
      assert.match(onboardingSource, /composeProgramWeekForSelection\(selection, programId\)/);
      assert.match(onboardingSource, /buildProgramFocusSplit\(week\.sessions\)/);
      assert.doesNotMatch(onboardingSource, /days: template\.daysPerWeek/);

      // The composed week is ON the card. It is the only place the reader can
      // see which days they actually get, and it used to be a link to a screen
      // of its own while the card's own lower half sat empty.
      //
      // Seven cells since 2026-09-09, not one row per training day: the list
      // grew with the programme and a five-day week pushed its own first rows
      // out of the card. Every weekday is drawn, and the sessions only decide
      // which ones are filled.
      assert.match(reviewBody, /WEEKDAY_OPTIONS\.map\(\(day\) => \(\{/);
      assert.doesNotMatch(reviewBody, /week=\{projectedSessions\.map/);
      // A rolling rhythm has no weekdays, so the strip stops pretending it has
      // (user, 2026-09-10). `resolveProjectedTrainingDays` has never known
      // about a cycle: a 3-on-1-off answer was rounded to "5 days a week" and
      // laid out on Mon/Tue/Thu/Fri/Sat, so the card showed five weekdays for
      // a four-day rhythm. With a cycle the strip walks the next seven days
      // from today and says out loud that it repeats on its own length.
      assert.ok(reviewBody.includes('cyclePattern'), 'the review must branch on the cycle');
      // Read through the same resolver Home reads the cycle with, rather than
      // by indexing the pattern from today. Those agree only while the anchor
      // is today, and the anchor is stamped when onboarding finishes, not when
      // this page is drawn (2026-09-10).
      assert.match(reviewBody, /training: trainsOn\(previewCycleSchedule, date\)/);
      assert.doesNotMatch(reviewBody, /cyclePattern\[offset/);
      assert.match(reviewBody, /weekNote=\{/);
      // Stepped by calendar date, never by a fixed number of milliseconds:
      // Helsinki has 23- and 25-hour days twice a year.
      assert.match(reviewBody, /date\.setDate\(date\.getDate\(\) \+ offset\)/);
      assert.doesNotMatch(reviewBody, /DAY_MS|86400000/);
      // The label follows the strip: a cycle is not somebody's week.
      assert.match(reviewBody, /weekLabel=\{t\(language, cyclePattern \? 'onb\.days\.cycleWeek' : 'onb\.planReady\.yourWeek'\)\}/);
      assert.doesNotMatch(reviewBody, /onOpenWeek|weekLinkLabel/);
      // The strip carries no session names at all now, so the two traps the
      // row list had cannot come back: no day ordinal printed beside its own
      // weekday, and no exercise count taken from the five-item preview
      // instead of the whole day.
      assert.doesNotMatch(reviewBody, /localizeSessionName\(|localizeSessionFocus\(/);
      assert.doesNotMatch(reviewBody, /onb\.day\.exerciseOne/);
      // The weekday word still comes from the reader's language.
      assert.match(reviewBody, /weekday: getWeekdayShortLabel\(day, language\)/);

      // And the picker RENDERS it rather than dropping the prop, which is
      // exactly what happened to `subtitle`.
      assert.match(pickSource, /week\.map\(\(day\) =>/);
      assert.match(pickSource, /\{day\.weekday\}/);
      // A cell per weekday, filled or hollow. The title and the meta went with
      // the row list: seven cells that never grow beat a list that pushed its
      // own head off the card.
      assert.match(pickSource, /day\.training && styles\.weekCellOn/);
      assert.doesNotMatch(pickSource, /\{day\.title\}|\{day\.meta\}/);
      assert.doesNotMatch(pickSource, /onOpenWeek|weekLinkText/);

      // The automated-progression toggle screen is gone from onboarding — the
      // paywall took its slot. The PREFERENCE is untouched: it still ships from
      // the selection, still defaults on, and stays editable in plan settings.
      // Onboarding just no longer asks a free user to configure a Pro feature.
      assert.doesNotMatch(onboardingSource, /renderPlanReadyProgression/);
      // Read, never written: with the screen gone there is nothing left in
      // onboarding that could change it, so the setter went with the dead
      // code (2026-09-19). The value still reaches the selection below.
      assert.match(onboardingSource, /const \[automatedProgressionEnabled\] = useState\(/);
      assert.match(onboardingSource, /automatedProgression: automatedProgressionEnabled/);
      assert.match(handoffSource, /automatedProgressionEnabled: selection\.automatedProgression \?\? true/);
      assert.doesNotMatch(onboardingSource, /Save your plan/);
      assert.doesNotMatch(onboardingSource, /renderPlanReadyAccount/);

      // The picker's CTA completes onboarding; nothing steps through days.
      assert.match(onboardingSource, /onCompleteToTraining\(selection, activeRecommendedProgramId\)/);
      assert.doesNotMatch(onboardingSource, /: 'See day 1'/);
      // The shared footer stands down for the picker, which is full-bleed and
      // brings its own pinned CTA. Nothing else in the review stage wants it
      // now that the day view is gone, so the condition is the stage alone.
      assert.match(onboardingSource, /const footerVisible = stage !== 'review';/);

      // The ready-catalog pick ADOPTS the programme, it does not merely
      // remember it. This wrote `activePlanId: null` next to a
      // `recommendedProgramId`, so Home — which reads the active plan — showed
      // no programme at all after the reader had just chosen one, and Profile
      // said "no programme selected". Verified on device 2026-08-13.
      // \r?\n throughout: App.tsx is CRLF on this checkout, and a \n-only
      // terminator matches nothing at all rather than failing loudly. Over the
      // shell: the pick moves to src/app in phase C (2026-10-01), at the same
      // two-space indent, so the match still ends at its own closing brace.
      const readyPick = shellSource.match(
        /async function handleOnboardingPickReadyProgram\(programId: string\)[\s\S]*?\r?\n {2}\}\r?\n/,
      );
      assert.ok(readyPick, 'handleOnboardingPickReadyProgram not found');
      assert.match(readyPick[0], /buildProgramWorkoutPlan\(/);
      assert.match(readyPick[0], /await upsertWorkoutPlan\(plan\)/);
      // The plan leads and joins the running set by the same rule the guided
      // finishes use (programCapWiring pins the rule itself).
      assert.match(readyPick[0], /activateOnboardingPlan\(\s*preferences,\s*adoptedPlanId,/);
      // Comments stripped first: the code block explains the old bug by quoting
      // it, and a naive search would match the explanation instead of a relapse.
      const readyPickCode = readyPick[0].replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(readyPickCode, /activePlanId: null/);
      // And the fork reaches the catalog without the About form in between.
      // The fork's render moved to src/app/renderOnboarding.tsx (phase C,
      // 2026-10-01): read the whole shell, bounded to the one handler.
      assert.match(
        between(shellSource, 'onBrowsePrograms={() => {', 'onBack='),
        /^onBrowsePrograms=\{\(\) => \{[\s\S]*?setOnboardingStep\('ready_catalog'\);\s*\}\}\s*$/,
      );

      // App-side save truthfulness: persist the plan and activate it before
      // landing on Home (no auto-started workout in the light flow).
      // The rule is the ORDER, not a wait. This used to pin a flat three-second
      // setTimeout in front of the save, which is not save truthfulness — it is
      // three seconds of nothing, and it read on the phone as a five-second
      // freeze on the last button of onboarding. The saving state now lasts as
      // long as the save does.
      assert.doesNotMatch(shellSource, /setTimeout\(resolve, 3000\)/);
      // Save path shares the composed week with the onboarding previews
      // (days-per-week truth): what was shown is exactly what is saved.
      assert.match(handoffSource, /function buildSavedOnboardingPlan\([\s\S]*composeProgramWeekForSelection\(selection, recommendedProgramId\)/);
      // The rule is still the order — saved and activated BEFORE Home — but it
      // is now one write instead of four. The template, its exercises, the plan
      // and the preferences land in a single commit, and the plan is built
      // inside that lock from the id the template upsert generates.
      // The finish to its own closing brace, over the shell: it moves to
      // src/app in phase C (2026-10-01), and the greedy match used to run on
      // to the last resetToRoute in App.tsx.
      assert.match(
        functionBody(shellSource, 'async function handleOnboardingCompleteToTraining('),
        /handleOnboardingCompleteToTraining[\s\S]*saveOnboardingOrExplain\(\{[\s\S]*onboardingCompleted: true[\s\S]*templateDraft: withReplaceableOnboardingId\(savedPlan\.draft\)[\s\S]*buildPlan:[\s\S]*buildSavedOnboardingWorkoutPlan[\s\S]*activate: \(planId, current\) => \{\s*const next = activateOnboardingPlan\(current, planId, resolveActiveProgramCap\(resolveProEntitlement\(current\)\.unlocked\)\);[\s\S]{0,300}?return next;[\s\S]*resetToRoute\(ROOT_ROUTES\.home\)/,
      );
      // And the four-call chain must not come back.
      assert.doesNotMatch(shellSource, /await upsertWorkoutTemplate\(savedPlan\.draft\)/);

      // The removed dark plan-ready must stay gone.
      assert.doesNotMatch(onboardingSource, /PLAN_READY_GYM_BACKDROP_SOURCE/);
      assert.doesNotMatch(onboardingSource, /planReadyHeroGradient/);
      assert.doesNotMatch(onboardingSource, /planReadyFitSummaryPanel/);
      assert.doesNotMatch(onboardingSource, /planReadyDetailSheet/);
      assert.doesNotMatch(onboardingSource, /planReadyProgramOverviewVisible/);
      assert.doesNotMatch(onboardingSource, /VIEW FULL PROGRAM/);
      assert.doesNotMatch(onboardingSource, /'SAVE PLAN & START'/);
      assert.doesNotMatch(reviewBody, /WHY THIS PLAN\?/);
      assert.doesNotMatch(reviewBody, /PLAN OVERVIEW/);
      assert.doesNotMatch(reviewBody, /YOUR WORKOUT PLAN/);
    },
  },
  {
    name: 'onboarding footer requires one focus area and guards invalid and busy transitions',
    run() {
      const canContinueStart = onboardingSource.indexOf('const canContinue =');
      const locationStageActiveStart = onboardingSource.indexOf('const locationStageActive =');
      assert.notEqual(canContinueStart, -1, 'canContinue should exist');
      assert.notEqual(locationStageActiveStart, -1, 'locationStageActive should exist');

      const canContinueBlock = onboardingSource.slice(canContinueStart, locationStageActiveStart);
      assert.match(canContinueBlock, /stage === 'level'[\s\S]*profileLevelSelected/);
      // The days step no longer requires a tap: the screen shows the
      // recommendation as the selection and an effect commits it, so a
      // disabled button there would be disabled over an answer already given.
      assert.match(canContinueBlock, /stage === 'days'[\s\S]*true/);
      assert.match(
        onboardingSource,
        /STAGES\[stageIndex\] !== 'days' \|\| profileFrequencySelected/,
        'the recommendation is committed to state, so the saved week matches the shown one',
      );
      assert.match(canContinueBlock, /stage === 'planning'[\s\S]*focusAreas\.length > 0/);
      assert.match(onboardingSource, /if \(!canContinue \|\| busy\)/);
      assert.match(onboardingSource, /disabled=\{!canContinue \|\| busy\}/);
    },
  },
  {
    name: 'onboarding uses six input steps and builds directly from focus areas',
    run() {
      const footerStart = onboardingSource.indexOf('const footerPrimaryLabel =');
      assert.notEqual(footerStart, -1, 'footerPrimaryLabel should exist');
      const footerBody = onboardingSource.slice(footerStart, onboardingSource.indexOf('<Modal', footerStart));

      assert.match(onboardingSource, /const STAGES: SetupStage\[\] = \['location', 'goal', 'level', 'days', 'avoid', 'planning', 'review'\]/);
      assert.match(onboardingSource, /const ONBOARDING_PROGRESS_STAGES: SetupStage\[\] = \['location', 'goal', 'level', 'days', 'avoid', 'planning'\]/);
      assert.match(onboardingSource, /ONBOARDING_PROGRESS_STAGES\.map/);
      // STEP n OF m labels are computed from the stage array, never hardcoded.
      assert.match(onboardingSource, /function getQuestionnaireStepLabel\(stage: SetupStage, language: AppLanguage\)/);
      assert.match(i18nSource, /'onb\.stepLabel': 'STEP \{index\} OF \{count\}'/);
      assert.doesNotMatch(onboardingSource, /stepLabel: 'STEP \d OF \d'/);
      // Focus areas is the last question; building starts straight from it.
      assert.match(footerBody, /stage === 'planning'[\s\S]*t\(language, 'onb\.cta\.buildPlan'\)/);
      assert.match(i18nSource, /'onb\.cta\.buildPlan': 'Build my plan'/);
      assert.match(footerBody, /if \(stage === 'planning'\) \{[\s\S]*setIsBuildingPlan\(true\)/);
    },
  },
  {
    name: 'onboarding avoid step colour-codes caution levels and writes shared flags',
    run() {
      const avoidBody = getFunctionBody('renderAvoid');
      const rowStart = onboardingSource.indexOf('function renderCautionRow(');
      assert.notEqual(rowStart, -1, 'renderCautionRow should exist');
      const rowEnd = onboardingSource.indexOf('\n  function renderAvoid', rowStart);
      assert.notEqual(rowEnd, -1, 'renderCautionRow should be followed by renderAvoid');
      const rowBody = onboardingSource.slice(rowStart, rowEnd);

      assert.match(avoidBody, /stepLabel: getQuestionnaireStepLabel\('avoid', language\)/);
      assert.match(avoidBody, /titleLines: \[t\(language, 'onb\.stage\.avoid\.title1'\), t\(language, 'onb\.stage\.avoid\.title2'\)\]/);
      assert.match(avoidBody, /AVOID_AREA_OPTIONS\.map/);
      assert.match(avoidBody, /t\(language, 'onb\.avoid\.addOther'\)/);
      // "Ei huomautettavaa" is gone. It cleared an already-empty list and
      // stayed on the step, so on a fresh run it did nothing at all — and the
      // primary button below already reads "Ohita" when nothing is selected.
      assert.doesNotMatch(avoidBody, /nothingToNote/);
      // The advisory was hardcoded English inside a Finnish questionnaire.
      assert.match(avoidBody, /t\(language, 'onb\.avoid\.advisory'\)/);
      assert.doesNotMatch(avoidBody, /we recommend checking in with a physio/);

      // Three colour-coded levels tint the tile, border, radio and title.
      assert.match(onboardingSource, /info: \{ ink: '#667085', soft: '#F1F0F4' \}/);
      assert.match(onboardingSource, /careful: \{ ink: '#D97706', soft: '#FEF3C7' \}/);
      assert.match(onboardingSource, /avoid: \{ ink: '#DC2626', soft: '#FEE2E2' \}/);
      assert.match(rowBody, /CAUTION_LEVEL_OPTIONS\.map/);
      assert.match(rowBody, /setCautionLevel\(option\.area, levelOption\.level\)/);
      // The REFINE chips and the "Remove" link are gone (user, 2026-08-19): the
      // card header is the on/off, and a flagged card shows its levels.
      assert.doesNotMatch(rowBody, /toggleCautionRefinement/);
      assert.doesNotMatch(rowBody, /onb\.avoid\.remove/);
      assert.match(rowBody, /removeCautionFlag\(option\.area\)/);
      assert.match(rowBody, /const expanded = flag !== null/);
      assert.doesNotMatch(rowBody, /onb\.avoid\.refine/);
      // Copy lives in the dictionary; the catalog carries the keys.
      assert.match(onboardingSource, /labelKey: 'onb\.caution\.info\.label'/);
      assert.match(onboardingSource, /labelKey: 'onb\.caution\.careful\.label'/);
      assert.match(onboardingSource, /labelKey: 'onb\.caution\.avoid\.label'/);
      assert.match(i18nSource, /'onb\.caution\.info\.label': 'For info only'/);
      assert.match(i18nSource, /'onb\.caution\.careful\.label': 'Be careful'/);
      assert.match(i18nSource, /'onb\.caution\.avoid\.label': 'Avoid entirely'/);

      // CTA reads Skip until something is flagged; flags persist to prefs.
      assert.match(
        onboardingSource,
        /stage === 'avoid'\s*\r?\n?\s*\? cautionFlags\.length > 0\s*\r?\n?\s*\? t\(language, 'common\.continue'\)\s*\r?\n?\s*: t\(language, 'onb\.cta\.skip'\)/,
      );
      assert.match(onboardingSource, /cautionFlags,/);
      assert.match(handoffSource, /setupCautionFlags: selection\.cautionFlags \?\? \[\]/);
    },
  },
  {
    name: 'onboarding step 1 asks what you can train with using equipment chips',
    run() {
      const locationBody = getFunctionBody('renderLocation');

      assert.match(locationBody, /titleLines: \[t\(language, 'onb\.stage\.location\.title1'\), t\(language, 'onb\.stage\.location\.title2'\)\]/);
      assert.doesNotMatch(locationBody, /Where do you train\?/);
      // The cards keep their order and the selected one expands IN PLACE into
      // toggle chips with a live count; its header toggles it open and closed.
      // It used to jump to the top and list the rest under "or choose another",
      // which moved the card away from under the thumb and left no way to close
      // it except picking a different one (user, 2026-08-19).
      assert.match(locationBody, /LOCATION_SELECTION_OPTIONS\.map\(\(option\) => \{/);
      assert.match(locationBody, /const isSelected = option\.id === selectedLocationOptionId/);
      assert.match(locationBody, /EQUIPMENT_CHIP_CATALOG\[option\.id\]/);
      assert.match(locationBody, /t\(language, 'onb\.equip\.selectedCount', \{ count: equipmentItems\.length \}\)/);
      assert.match(locationBody, /setEquipmentCardOpen\(\(open\) => !open\)/);
      assert.match(locationBody, /toggleEquipmentItem\(option, item\)/);
      assert.doesNotMatch(locationBody, /onb\.equip\.orChoose/);
      assert.match(onboardingSource, /const EQUIPMENT_CHIP_CATALOG/);
      assert.match(onboardingSource, /const EQUIPMENT_DEFAULT_ITEMS/);
      // A home treadmill, bike or cross-trainer can be ticked, but is never on
      // by default: most homes have none (user, 2026-10-04).
      const chipCatalog = onboardingSource.match(/const EQUIPMENT_CHIP_CATALOG[\s\S]*?\n\};/)[0];
      const defaults = onboardingSource.match(/const EQUIPMENT_DEFAULT_ITEMS[\s\S]*?\n\};/)[0];
      assert.match(chipCatalog.match(/home_gym: \[[^\]]*\]/)[0], /'Cardio machines'/);
      assert.doesNotMatch(defaults.match(/home_gym: \[[^\]]*\]/)[0], /'Cardio machines'/);
      // Three setups only; heavy home gear decides home_gym vs minimal_equipment.
      assert.doesNotMatch(onboardingSource, /id: 'minimal_equipment'/);
      assert.doesNotMatch(onboardingSource, /id: 'running_hybrid'/);
      assert.match(onboardingSource, /equipmentSetupForChips\(option, items\)/);
      const cardSetup = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'equipmentCardSetup.ts'), 'utf8');
      assert.match(cardSetup, /trainingEnvironment: hasHeavy \? 'home_gym' : 'minimal_equipment'/);
      // Chip labels persist into the setup selection and preferences.
      assert.match(onboardingSource, /const \[equipmentItems, setEquipmentItems\] = useState<string\[\]>\(setupSeed\.equipmentItems \?\? \[\]\)/);
      assert.match(handoffSource, /setupEquipmentItems: selection\.equipmentItems \?\? \[\]/);
      // No "why it's great" expansion anywhere.
      assert.doesNotMatch(onboardingSource, /WHY IT'S GREAT/);
    },
  },
  {
    name: 'onboarding no longer asks gender or goal weight mid-questionnaire',
    run() {
      // Gender/age-band/weight arrive from the About-you screen (01e) via
      // basicsSeed; the old Training profile gender block and the whole
      // bodyweight-goal stage are gone from the stage machine.
      //
      // The band, not a year: the About form stopped asking for a birth year
      // on 2026-09-09 because scorePreferenceFit reads one thing from the age,
      // whether the reader is 41 or over. A questionnaire that still emitted
      // an `age` would carry a number nothing asked for.
      assert.doesNotMatch(onboardingSource, /stage === 'profile'/);
      assert.doesNotMatch(onboardingSource, /stage === 'about'/);
      assert.doesNotMatch(onboardingSource, /function renderProfile\(/);
      assert.doesNotMatch(onboardingSource, /function renderAbout\(/);
      assert.doesNotMatch(onboardingSource, /bodyweightSetupStep/);
      assert.doesNotMatch(onboardingSource, /Program Fit/);
      assert.doesNotMatch(onboardingSource, /GENDER_OPTIONS\.map/);
      assert.doesNotMatch(onboardingSource, /profileGenderSelected/);
      // The seeded values still flow into the selection unchanged.
      assert.match(onboardingSource, /basicsSeed/);
      assert.match(onboardingSource, /gender,\r?\n\s*ageRange,/);
      assert.doesNotMatch(onboardingSource, /\bage,\r?\n/);
      assert.match(onboardingSource, /currentWeightKg: currentWeightValue === null \? null : convertWeightToKg\(currentWeightValue, unitPreference\)/);
      assert.match(onboardingSource, /targetWeightKg: targetWeightValue === null \? null : convertWeightToKg\(targetWeightValue, unitPreference\)/);
      assert.match(onboardingSource, /scrollEnabled=\{!scrollLockedStage\}/);
      assert.match(onboardingSource, /bounces=\{allowScrollBounce\}/);
    },
  },
  {
    name: 'onboarding step 2 uses the light sentence-case primary-goal cards',
    run() {
      const goalBody = getFunctionBody('renderGoal');

      assert.match(goalBody, /stepLabel: getQuestionnaireStepLabel\('goal', language\)/);
      // One line since 2026-09-09: the question is short in both languages,
      // and split across two it took a third of the screen from the cards.
      assert.match(goalBody, /titleLines: \[t\(language, 'onb\.stage\.goal\.title1'\)\]/);
      assert.doesNotMatch(goalBody, /onb\.stage\.goal\.title2/);
      assert.match(goalBody, /subtitle: t\(language, 'onb\.stage\.goal\.sub'\)/);
      assert.match(i18nSource, /'onb\.stage\.goal\.sub': "We'll build your training around this\."/);
      assert.match(goalBody, /renderSplitSelectionStage\(\{/);
      assert.match(goalBody, /roomyCards: true/);
      assert.doesNotMatch(goalBody, /compactCards: true/);
      assert.match(goalBody, /optionsContainerStyle: styles\.locationStepTwoOptionsShift/);
      assert.match(goalBody, /topPaneStyleOverride: styles\.locationEquipmentTopPane/);
      assert.match(goalBody, /titleStyleOverride: styles\.locationEquipmentHeadline/);
      // The highlight and the Continue gate read the SAME thing (user,
      // 2026-09-09). `goal` carries the schema's default, so highlighting from
      // it lit a card nobody had tapped while `canContinue` read `goals` and
      // let the reader through — a goal shipped that nobody chose, and the
      // programme built from it. `goals` is empty until the first tap.
      assert.match(goalBody, /active: goals\.includes\(option\.id\)/);
      assert.doesNotMatch(goalBody, /active: goal === option\.id/);
      assert.match(onboardingSource, /const canContinue[\s\S]{0,200}stage === 'goal'\s*\r?\n?\s*\? goals\.length > 0/);
      // Answered only when a selection came in: the editor opened without one
      // (a reader who never finished setup) asks the goal too (2026-09-17).
      assert.match(
        onboardingSource,
        /seededAnswers \? \(setupSeed\.goals\?\.length \? setupSeed\.goals : \[setupSeed\.goal\]\) : \[\]/,
      );
      assert.match(onboardingSource, /titleKey: 'onb\.goal\.strength\.title'/);
      assert.match(onboardingSource, /goal: 'lean_athletic'/);
      assert.match(onboardingSource, /goal: 'general_fitness'/);
      // The sheet is a parameter since the palette split (2026-08-23): these
      // are plain functions, so they cannot read the theme through a hook.
      assert.match(onboardingSource, /getLocationFocusBadgeStyle\(styles, tag\.tone\)/);
      assert.match(onboardingSource, /getLocationFocusBadgeTextStyle\(styles, tag\.tone\)/);
      // Sentence case replaced the old shouty two-line headline.
      assert.doesNotMatch(goalBody, /WHAT DO YOU/);
      assert.doesNotMatch(goalBody, /WANT MOST\?/);
      assert.doesNotMatch(goalBody, /Pick one or more/);
    },
  },
  {
    name: 'onboarding splits training level and days into their own steps',
    run() {
      const levelBody = getFunctionBody('renderLevel');
      const daysBody = getFunctionBody('renderDays');

      assert.match(levelBody, /stepLabel: getQuestionnaireStepLabel\('level', language\)/);
      assert.match(levelBody, /titleLines: \[t\(language, 'onb\.stage\.level\.title1'\)\]/);
      assert.match(levelBody, /subtitle: t\(language, 'onb\.stage\.level\.sub'\)/);
      assert.match(i18nSource, /'onb\.stage\.level\.sub': 'How much training experience do you have\?'/);
      // Slider with three stops, live descriptor lines, and the launch
      // sequence's own bars sweeping the wordmark's box — denser and quicker
      // the higher the level. They replaced flame emoji, which said
      // "intensity" in a vocabulary the app does not otherwise speak.
      assert.match(levelBody, /LEVEL_SLIDER_OPTIONS\.map/);
      assert.match(levelBody, /setLevel\(option\.level\)/);
      assert.match(levelBody, /levelThumbAnim/);
      assert.match(levelBody, /levelFlamePop/);
      assert.match(levelBody, /<LevelStreaks levelIndex=\{selectedLevelIndex\}/);
      assert.match(levelBody, /selectedLevelOption\.lineKeys\.map/);
      assert.doesNotMatch(levelBody, /GENDER_OPTIONS/);
      assert.doesNotMatch(levelBody, /TRAINING_FREQUENCY_OPTIONS/);
      // SetupLevel and the UI share the same tier names: beginner/advanced/pro.
      assert.match(onboardingSource, /level: 'advanced',\s*\r?\n\s*labelKey: 'onb\.level\.advanced\.label'/);
      assert.match(onboardingSource, /level: 'pro',\s*\r?\n\s*labelKey: 'onb\.level\.pro\.label'/);
      assert.match(i18nSource, /'onb\.level\.advanced\.label': 'Advanced'/);
      assert.match(i18nSource, /'onb\.level\.pro\.label': 'Pro'/);
      // No flame left anywhere: the glyph, its red and its layout table all
      // went with the field that used them.
      assert.doesNotMatch(onboardingSource, /Flame(Glyph|_RED|_LAYOUTS)|AnimatedFlame/);
      assert.match(onboardingSource, /function LevelStreaks\(/);
      // Three tiers, and each one denser than the last.
      assert.equal(LEVEL_STREAKS.length, 3);
      assert.ok(
        LEVEL_STREAKS[0].length < LEVEL_STREAKS[1].length && LEVEL_STREAKS[1].length < LEVEL_STREAKS[2].length,
        'each level should carry more bars than the one below it',
      );
      // …and quicker: the slowest bar of a tier still beats the tier below.
      const slowest = LEVEL_STREAKS.map((tier) => Math.max(...tier.map((bar) => bar.ms)));
      assert.ok(slowest[0] > slowest[1] && slowest[1] > slowest[2], `tempo should rise with level: ${slowest}`);
      // Every bar starts mid-flight, so switching level never shows an empty
      // box filling in.
      assert.ok(LEVEL_STREAKS.every((tier) => tier.every((bar) => bar.delay < 0)));
      assert.match(levelBody, /levelYearsRow/);
      assert.match(i18nSource, /'onb\.level\.beginner\.years': '0–1 years'/);

      assert.match(daysBody, /stepLabel: getQuestionnaireStepLabel\('days', language\)/);
      assert.match(daysBody, /titleLines: \[t\(language, 'onb\.stage\.days\.title1'\)\]/);
      assert.match(daysBody, /subtitle: t\(language, 'onb\.stage\.days\.sub'\)/);
      assert.match(i18nSource, /'onb\.stage\.days\.sub': 'How many days per week can you train\?'/);
      // Number chips 2-6 on top (recommended flagged by level) and a tappable
      // Mon-Sun letter row below that drives the count both ways.
      assert.match(daysBody, /TRAINING_DAY_COUNT_OPTIONS\.map/);
      assert.match(daysBody, /selectTrainingDaysCount\(option\)/);
      assert.match(daysBody, /option === recommendedDays/);
      assert.match(daysBody, /Recommended/);
      assert.match(daysBody, /WEEKDAY_OPTIONS\.map/);
      assert.match(daysBody, /toggleTrainingDay\(day\)/);
      assert.match(daysBody, /t\(language, WEEKDAY_LETTER_KEYS\[shown\]\)/);
      assert.match(daysBody, /t\(language, 'onb\.days\.summary', \{ days: selectedDays\.length, rest: restCount \}\)/);
      assert.match(i18nSource, /'onb\.days\.summary': '\{days\} training days · \{rest\} rest'/);
      assert.doesNotMatch(daysBody, /TRAINING_FREQUENCY_OPTIONS/);

      assert.match(onboardingSource, /const TRAINING_DAY_COUNT_OPTIONS: SetupDaysPerWeek\[\] = \[2, 3, 4, 5, 6\]/);
      assert.match(onboardingSource, /level === 'beginner' \? 3 : level === 'pro' \? 5 : 4/);
      // Chips reset to the app-managed default rhythm; hand-picked days switch
      // to self-managed scheduling and clamp to the supported 2-6 range.
      assert.match(onboardingSource, /setAvailableDays\(DEFAULT_RHYTHM_BY_DAYS\[option\]\)/);
      assert.match(onboardingSource, /setScheduleMode\('app_managed'\)/);
      assert.match(onboardingSource, /if \(next\.length < 2 \|\| next\.length > 6\)/);
      assert.match(onboardingSource, /setDaysPerWeek\(next\.length as SetupDaysPerWeek\)/);
      assert.match(onboardingSource, /setScheduleMode\('self_managed'\)/);
      // 112, down from 150: the in-pane progress bar and the 58px copy offset
      // that cleared it are gone (2026-08-23).
      assert.match(onboardingSource, /trainingProfileTopPane:\s*\{[\s\S]*height: 112/);
    },
  },
  {
    name: 'onboarding focus areas is a caution-aware name list',
    run() {
      const planningBody = getFunctionBody('renderPlanning');

      assert.match(planningBody, /stepLabel: getQuestionnaireStepLabel\('planning', language\)/);
      assert.match(planningBody, /titleLines: \[t\(language, 'onb\.stage\.focus\.title1'\), t\(language, 'onb\.stage\.focus\.title2'\)\]/);
      assert.match(planningBody, /FOCUS_AREA_OPTIONS\.filter\(\(option\) => option\.area !== 'mobility'\)/);
      // Name-only selectable rows, tap-to-fill like the goal step; 1-4 picks
      // (raised from 2 on request, 2026-08-23 — every area still adds its own
      // accessory lifts, so the cap holds "focus" to a meaning).
      assert.match(planningBody, /visibleFocusOptions\.map/);
      assert.match(planningBody, /toggleFocusArea\(option\.area\)/);
      assert.match(planningBody, /styles\.focusListRowActive/);
      // Flagged areas keep their caution colour when selected, and picking one
      // swaps the hint for the bodyweight-safety note. No info box.
      assert.match(planningBody, /flaggedFocusSelected/);
      // The note was hardcoded English on a screen that is otherwise Finnish,
      // and long enough that its third line was clipped by the CTA below.
      assert.match(planningBody, /t\(language, 'onb\.focusCaution'\)/);
      assert.doesNotMatch(planningBody, /This shapes your training/);
      assert.match(planningBody, /t\(language, 'onb\.pickAreas'\)/);
      assert.match(i18nSource, /'onb\.pickAreas': 'Pick 1–4 areas\.'/);
      assert.doesNotMatch(planningBody, /Why focus areas\?/);
      assert.match(onboardingSource, /const FOCUS_AREA_OPTIONS = getOnboardingFocusAreaPresentationOptions\(\)/);
      assert.match(onboardingSource, /current\.length >= 4/);

      // Avoid-step flags colour the rows: amber careful / red avoid + triangle.
      assert.match(planningBody, /getFocusAreaCautionLevel\(option\.area, cautionFlags\)/);
      assert.match(planningBody, /cautionLevelColors\(caution, C === ONB_DARK\)/);
      assert.match(planningBody, /<CautionGlyph/);
      // The area mapping is shared with the exercise filter (P2) so UI colour
      // and actual filtering can never disagree.
      // `buildCautionSummaryLabel` rode in on the same import and was read by
      // the projected preview alone; it went with it (2026-09-19). What the
      // guard is about is the mapping, and that is still shared.
      assert.match(onboardingSource, /import \{ CAUTION_TO_FOCUS_AREAS \} from '..\/lib\/cautionExerciseFilter'/);
      assert.match(onboardingSource, /function getFocusAreaCautionLevel\(/);

      // Anatomy-highlight cards are gone.
      assert.doesNotMatch(onboardingSource, /FocusAreaBodyCard/);
      assert.doesNotMatch(onboardingSource, /FOCUS_AREA_BODY_FRAMING/);
      assert.doesNotMatch(onboardingSource, /react-native-body-highlighter/);
    },
  },
  {
    name: 'launch splash waits on every app start and welcome copy is plan focused',
    run() {
      assert.match(appSource, /const \[minimumSplashElapsed, setMinimumSplashElapsed\] = useState\(false\)/);
      assert.match(appSource, /if \(!minimumSplashElapsed\) \{\s*return;\s*\}/);
      assert.doesNotMatch(shellSource, /firstAppOpen/);

      // Light welcome: the copy lives in the i18n dictionary and the screen
      // renders every string through t(language, …).
      // The tagline is the brand package's main claim (2026-08-19): one line
      // that carries the name (speed) and the product (automatic progression).
      // It replaced "Results, not guesswork", which promised an outcome but
      // said nothing about what the app does differently.
      assert.match(i18nSource, /'brand\.tagline': 'Training that moves forward\.'/);
      assert.match(i18nSource, /'brand\.tagline': 'Treeni, joka etenee\.'/);
      // The provider buttons are gone. Both called the same handler: there is
      // no OAuth and no account, so they announced two companies' sign-in for
      // a feature that does not exist — on the first screen, behind no guard.
      assert.doesNotMatch(welcomeSource, /continueGoogle|continueApple/);
      assert.doesNotMatch(welcomeSource, /GoogleMark|AppleMark/);
      assert.match(welcomeSource, /t\(language, 'welcome\.start'\)/);
      // "No account needed — everything stays on this phone." is gone
      // (2026-08-13): it answered a worry the first screen does not raise,
      // there being no sign-in form in sight, and the privacy promise is made
      // properly in Settings where it can be read in full.
      assert.doesNotMatch(welcomeSource, /welcome\.noAccount/);
      assert.doesNotMatch(i18nSource, /welcome\.noAccount/);
      // The CTA is uppercased by the stylesheet, not by the translation, so the
      // string stays readable and the a11y label reads as a sentence.
      assert.match(welcomeSource, /startLabel: \{[^}]*textTransform: 'uppercase'/s);
      // The old Welcome CTA is gone. Scoped to a welcome.* value on purpose:
      // "Start free" is legitimate prose on the access-choice screen.
      assert.doesNotMatch(i18nSource, /'welcome\.[^']*': '[^']*Start free/);
      // The Vinha design stripped Welcome back to the mark, the two providers
      // and a quiet tagline (2026-08-01) — the feature row, the email CTA and
      // the account link were cut on purpose, so the screen no longer renders
      // welcome.tagline as a headline. brand.tagline is the footer now.
      assert.match(welcomeSource, /t\(language, 'brand\.tagline'\)/);
      assert.match(welcomeSource, /<VinhaWordmark/);
      assert.match(welcomeSource, /SUPPORTED_LANGUAGES/);
      // Reads the theme rather than copying a value: a local hex silently
      // drifts the moment the palette moves, which is exactly what happened.
      // The module-level BG constant is gone — a constant cannot follow a
      // theme, so the background is read inside the style factory.
      assert.doesNotMatch(welcomeSource, /const BG = /);
      assert.match(welcomeSource, /backgroundColor: theme\.bg/);
      // The hand-drawn logoRow/logoInk/logoPurple lockup is gone: VinhaWordmark
      // owns the mark and its accent, so a local purple hex here could only
      // disagree with it.
      assert.doesNotMatch(welcomeSource, /const PURPLE = /);
      assert.doesNotMatch(welcomeSource, /logoInk|logoPurple|logoText/);

      // Splash and Welcome must place the mark at the same coordinate, or it
      // jumps at the hand-off. Two things make that true and both are easy to
      // undo by accident:
      //
      //   Both anchors are CENTRES, resolved through the shared helper.
      assert.match(welcomeSource, /markSlotTop\(windowHeight, MARK_CENTER_WELCOME\)/);
      assert.match(welcomeSource, /MARK_SIZE/);
      //   And the screen carries no padding — an absolutely positioned child is
      //   laid out inside the parent's padding box, so a paddingTop here would
      //   push the mark down by the status-bar inset while the splash, which
      //   has none, hands it over at the unpadded coordinate.
      const welcomeScreenStyle = between(welcomeSource, '  screen: {', '  markSlot: {');
      assert.doesNotMatch(welcomeScreenStyle, /padding/);
      // These asserted the feature row's copy was still in the dictionary,
      // twenty lines below the comment saying the feature row was cut on
      // purpose. A guard that contradicts itself keeps dead copy alive: the
      // strings outlived the screen by two redesigns because this line was
      // the only thing still referring to them.
      assert.doesNotMatch(welcomeSource, /welcome\.feature\./);
      assert.doesNotMatch(welcomeSource, /Sinä menet salille/);
      assert.doesNotMatch(welcomeSource, /Aloita ilmaiseksi/);
      assert.doesNotMatch(welcomeSource, /GYMLOG/);
      assert.doesNotMatch(welcomeSource, /#0f0f0f/);
    },
  },
  {
    name: 'onboarding selection steps keep vertical layout still and progress aligned',
    run() {
      // Ends at the next function that survives, not at `SetupOptionCard`:
      // that one went with the dead recommendation page, and the missing
      // anchor had widened this window to the rest of the file.
      const locationChoiceBody = between(onboardingSource, 'function LocationChoiceCard', 'function clampSetupAge');

      // Selection highlight is a subtle scale (max 1.5%), never a layout jump.
      assert.match(locationChoiceBody, /outputRange: \[1, 1\.015\]/);
      assert.doesNotMatch(locationChoiceBody, /outputRange: \[1, 1\.1/);
      // Step 1 is a flat selectable list like Step 2: no expanding benefits
      // panel and no per-card dim state (which caused the collapse-dim bug).
      assert.doesNotMatch(locationChoiceBody, /WHY IT'S GREAT FOR YOU/);
      assert.doesNotMatch(locationChoiceBody, /subdued \? 0\.6/);
      const renderLocationBody = getFunctionBody('renderLocation');
      assert.doesNotMatch(renderLocationBody, /benefits:/);
      assert.doesNotMatch(renderLocationBody, /subdued:/);
      assert.match(onboardingSource, /const fixedTopPaneHeight = Math\.min\(380, Math\.round\(locationStageHeight \* 0\.34\) \+ 34\)/);
      assert.match(onboardingSource, /styles\.locationTopPane,\s*\{ height: fixedTopPaneHeight, marginTop: insets\.top \+ LOCATION_PANE_TOP_GAP \},\s*topPaneStyle/);
      assert.match(onboardingSource, /<View pointerEvents="none" style=\{\[styles\.locationProgressBarWrap, \{ top: insets\.top \+ 10 \}\]\}>[\s\S]*<StepDots index=\{stageIndex\} \/>/);
      // The progress bar shares the back chevron's row (user 2026-08-23): on a
      // short phone the bar-below-button layout pushed the last option card
      // off screen. The bar renders as the shell's child, not the pane's, and
      // centers on the chevron's 40px height — at insets.top + 10, the same
      // edge the chevron is placed from (user 2026-09-02: a fixed top of 10
      // put the bar under the status-bar strip and the step label on the
      // chevron). See tests/screens/onboardingShellInsets.test.cjs.
      assert.match(
        onboardingSource,
        /<View pointerEvents="none" style=\{\[styles\.locationProgressBarWrap, \{ top: insets\.top \+ 10 \}\]\}>[\s\S]{0,1200}<View\s+style=\{\[\s*styles\.locationTopPane/,
      );
      assert.match(onboardingSource, /locationProgressBarWrap:\s*\{[\s\S]*?height: 40/);
      // And the 58px offsets that cleared the in-pane bar are gone with it.
      assert.match(onboardingSource, /focusAreaTopPane:\s*\{[\s\S]*?paddingTop: 36/);
      assert.doesNotMatch(onboardingSource, /paddingTop: 58/);
      assert.match(onboardingSource, /stage === 'planning'/);
      assert.match(onboardingSource, /scrollEnabled=\{!scrollLockedStage\}/);
      assert.match(onboardingSource, /bounces=\{allowScrollBounce\}/);
      assert.match(onboardingSource, /alwaysBounceVertical=\{allowScrollBounce\}/);
      assert.match(onboardingSource, /overScrollMode=\{allowScrollBounce \? 'auto' : 'never'\}/);
      // Steps 1-2 (location/goal) scroll so expanded benefits / wrapped chips stay reachable.
      assert.doesNotMatch(onboardingSource, /const scrollLockedStage =\s*stage === 'location'/);
      assert.doesNotMatch(onboardingSource, /const scrollLockedStage =\s*stage === 'location' \|\|\s*stage === 'goal'/);
      assert.match(onboardingSource, /const allowScrollBounce = !scrollLockedStage && stage !== 'location' && stage !== 'goal'/);
      // Step 2 goal chips wrap instead of truncating.
      assert.match(onboardingSource, /locationChoiceTagRow:\s*\{[\s\S]*flexWrap: 'wrap'/);
    },
  },
  {
    name: 'days step offers the repeating cycle splits and persists them',
    run() {
      // Four fixed splits until 2026-09-09 (1+1, 2+1, 3+1, 1+2), and two dials
      // since. The chips could not express 4+1 or 5+2, and none of them said
      // what the rhythm came to in a week — the reader did that arithmetic.
      // The dials cover every split the chips did and the ones they did not.
      assert.doesNotMatch(onboardingSource, /id: 'on\d+off\d+'/);
      assert.match(onboardingSource, /const CYCLE_ON_LIMITS = \{ min: 1, max: 6 \}/);
      assert.match(onboardingSource, /const CYCLE_OFF_LIMITS = \{ min: 1, max: 4 \}/);
      // Both dials read off the pattern, so a cycle built on the plan screen
      // shows here as itself instead of as "none of the four".
      assert.match(onboardingSource, /cycleOnDays = cyclePattern \? cyclePattern\.filter\(Boolean\)\.length/);
      assert.match(onboardingSource, /cycleOffDays = cyclePattern \? cyclePattern\.length - cycleOnDays/);
      // The dials step from the pattern that IS, not from the numbers this
      // render read. Absolute steps meant two quick taps both read the same
      // render and the second discarded the first: rest+ then training+ from
      // 2+1 landed on 3+1 and lost the rest day (user, 2026-09-09).
      assert.match(onboardingSource, /setCyclePattern\(\(current\) => \{/);
      assert.match(onboardingSource, /function stepCycle\(deltaOn: number, deltaOff: number\)/);
      assert.doesNotMatch(onboardingSource, /stepCycle\(cycleOnDays/);
      assert.doesNotMatch(onboardingSource, /setCycle\(cycleOnDays/);
      // And the sentence that was the point of the change.
      for (const key of ['onb.days.cycleFrequency', 'onb.days.cycleOnLabel', 'onb.days.cycleOffLabel']) {
        const occurrences = i18nSource.split(`'${key}':`).length - 1;
        assert.equal(occurrences, 2, `${key} is missing one of its two languages`);
      }
      // The selection carries the raw pattern, not a preset id, so a custom
      // cycle built on the plan screen survives a questionnaire re-run.
      assert.match(onboardingSource, /trainingCyclePattern: cyclePattern,/);
      assert.match(
        onboardingSource,
        /const \[cyclePattern, setCyclePattern\] = useState<boolean\[\] \| null>\(setupSeed\.trainingCyclePattern \?\? null\)/,
      );
      /**
       * ONE week row, above the cycle chips, whichever rhythm is answering.
       *
       * It used to be rendered twice — an editable row above the chips while
       * no cycle was chosen, a read-only preview below them once one was — so
       * picking a preset deleted the row the reader was looking at and drew
       * another further down. "Painamalla 1treeni 1lepo kaikki pomppaa
       * oudosti päivät alas vaikka olivat alkuun ylhäällä" (#bugs 2026-08-31).
       *
       * Two rows cannot be pinned by counting `daysWeekRow`: the fix IS that
       * there is one of it, and that it comes first.
       */
      const daysRender = between(onboardingSource, 'function renderDays', 'function renderCautionRow');
      assert.equal(
        daysRender.split('style={styles.daysWeekRow}').length - 1,
        1,
        'the week is rendered once, not once per rhythm',
      );
      assert.ok(
        daysRender.indexOf('style={styles.daysWeekRow}') <
          daysRender.indexOf('style={styles.daysCycleHead}'),
        'the week stays above the rhythm dials, so changing one does not move it',
      );
      // Read-only while a cycle owns it: tapping a day would be the weekday
      // picker again, and the two cannot both be the answer.
      assert.match(daysRender, /return cycleActive \? \(/);
      // Choosing weekdays or a count still clears the cycle.
      // Three clears: the count chips, the weekday toggles, and Remove.
      const countBody = between(onboardingSource, 'function selectTrainingDaysCount', 'function renderDays');
      assert.equal(countBody.split('setCyclePattern(null)').length - 1, 3);
      // The handoff persists the pattern anchored at today — and keeps the
      // old anchor when only the questionnaire was re-run with the same
      // pattern.
      assert.match(handoffSource, /trainingCyclePattern: leadCycle\?\.pattern \?\? null/);
      assert.match(handoffSource, /trainingCycle: resolveCycleAnchor\(selection\.trainingCyclePattern, previousCycle/);
    },
  },
  {
    name: 'plan-ready screens share the onboarding palette, in both themes',
    run() {
      // The light values are the originals to the digit. Onboarding paints
      // from its own constants rather than the app Theme, whose tokens are
      // close but not identical — remapping would have restyled a signed-off
      // flow nobody asked to restyle.
      assert.match(onboardingSource, /const ONB_LIGHT: OnbPalette = \{[\s\S]*?panel: HG\.bg/);
      assert.match(onboardingSource, /const ONB_LIGHT: OnbPalette = \{[\s\S]*?card: '#FFFFFF'/);
      assert.match(onboardingSource, /const ONB_LIGHT: OnbPalette = \{[\s\S]*?primary: '#7C3AED'/);
      assert.match(onboardingSource, /const ONB_LIGHT: OnbPalette = \{[\s\S]*?text: '#101828'/);
      // And a dark counterpart exists for every one of them, so a reader who
      // picks dark one tap after "Let's begin" is not walked through eight
      // white screens.
      assert.match(onboardingSource, /const ONB_DARK: OnbPalette = \{[\s\S]*?panel: HG_DARK\.bg/);
      const shape = (name) => {
        const body = new RegExp(`const ${name}: OnbPalette = \\{([\\s\\S]*?)\\n\\};`).exec(onboardingSource);
        assert.ok(body, `${name} not found`);
        return [...body[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
      };
      assert.deepEqual(shape('ONB_LIGHT'), shape('ONB_DARK'), 'both palettes must fill the same tokens');
      // Every token is wired: an unused one is the "written but never
      // connected" bug this codebase keeps finding.
      for (const token of shape('ONB_LIGHT')) {
        assert.ok(
          new RegExp(`\\bC\\.${token}\\b`).test(onboardingSource),
          `palette token ${token} is defined but never used`,
        );
      }
      // The sheet is built per palette at module load, not per render: it is
      // ~2200 entries and there are exactly two possible answers.
      assert.match(onboardingSource, /const makeOnboardingStyles = \(C: OnbPalette\) => StyleSheet\.create/);
      assert.match(onboardingSource, /light: makeOnboardingStyles\(ONB_LIGHT\)/);
      assert.match(onboardingSource, /dark: makeOnboardingStyles\(ONB_DARK\)/);
      // The old black plan-ready stage is gone.
      assert.doesNotMatch(onboardingSource, /planReadyStage:\s*\{\s*backgroundColor: '#050505'/);
      assert.doesNotMatch(onboardingSource, /planReadyHeader:/);
      // The stacked-card overview and the separate picker are both gone —
      // ProgramPickScreen replaced them — so their styles must not linger
      // either. Two assertions here used to describe the overview's cover
      // stats, which is how 83 dead style definitions survived the redesign:
      // a guard naming a style keeps it alive whether or not anything renders
      // it.
      assert.doesNotMatch(onboardingSource, /planReadyOverviewStat|planReadyPrimaryCard|planReadyAltCard|progPickCard|programPickTitle/);
      assert.doesNotMatch(onboardingSource, /planReadyOverviewCoverGlow/);
      // The automatic-progression step became the Pro paywall; its card,
      // toggle and bullet styles went with it.
      assert.doesNotMatch(onboardingSource, /progressionToggleTrack|progressionBulletRow|progressionCardOn/);
    },
  },
  {
    name: 'plan-ready alternatives are hidden from the ready hero',
    run() {
      const reviewBody = getFunctionBody('renderReview');

      assert.doesNotMatch(reviewBody, /const nextPlanOption = planReadyOptions\[0\] \?\? null/);
      assert.doesNotMatch(reviewBody, /planReadyOtherPlansPeek/);
      assert.doesNotMatch(reviewBody, /See other plans/);
      assert.doesNotMatch(reviewBody, /setPlanReadyOptionsMenuOpen/);
      assert.doesNotMatch(reviewBody, /planReadyOptionsMenuOpen \? \(/);
      assert.doesNotMatch(reviewBody, /planReadyOptionsMenuItem/);
      assert.doesNotMatch(reviewBody, /planReadyOptionsMenuFooter/);
      assert.doesNotMatch(onboardingSource, /planReadyOtherPlansPeek:\s*\{/);
      assert.doesNotMatch(onboardingSource, /planReadyOtherPlansLabel:\s*\{/);
      assert.doesNotMatch(onboardingSource, /planReadyOptionsMenu:\s*\{/);
      // The card-swap animation went with the stacked cards; the seam itself
      // is the transition now.
      assert.doesNotMatch(reviewBody, /SEE OTHER PLANS/);
      assert.doesNotMatch(reviewBody, /planReadyOtherPlansRail/);
      assert.doesNotMatch(reviewBody, /PROGRAM OPTIONS PREVIEW/);
      assert.doesNotMatch(reviewBody, /ALTERNATIVE PLAN/);
    },
  },
  {
    name: 'plan-ready summary derives its numbers from the recommendation payload',
    run() {
      const reviewBody = getFunctionBody('renderReview');

      // Weeks / per-week / total workouts come from the payload with safe fallbacks.
      // The fallback is the catalog's floor, not a four-week answer of the
      // screen's own — nothing is offered below eight weeks any more.
      assert.match(
        reviewBody,
        /const planReadyWeeks = planReadyPayload\.blockLengthWeeks > 0 \? planReadyPayload\.blockLengthWeeks : READY_PROGRAM_MIN_BLOCK_WEEKS/,
      );
      /*
       * The per-week and total-workout numbers are the option's, not a second
       * copy worked out here.
       *
       * `renderReview` derived `planReadyPerWeek` and `planReadyTotalWorkouts`
       * from the payload and handed the card `option.totalWorkouts` — the
       * composed week's own figure. Two derivations of one number, one of them
       * printed and one of them not (2026-09-19). The card is fed from the
       * option; the composer is what decides the number.
       */
      assert.doesNotMatch(reviewBody, /planReadyPerWeek|planReadyTotalWorkouts/);
      assert.match(reviewBody, /totalWorkouts: option\.totalWorkouts,/);
      assert.match(onboardingSource, /totalWorkouts: week\.totalWorkouts,/);

      // Subtitle line: "{N}-week plan · goal · location", dot separated.
      assert.match(
        reviewBody,
        /'onb\.planReady\.weekPlan', \{ count: planReadyWeeks \}[\s\S]{0,60}goalLabel,\s*locationLabel/,
      );

      // The card computes no "why" sentence, because it never rendered one.
      // The blurb slot was resolved from the waterfall into a `subtitle` prop
      // that `ProgramPickScreen` declared and never printed, from the day the
      // description line came off this card (user 2026-08-23).
      assert.doesNotMatch(
        reviewBody,
        /whyFor|recommendation\.waterfall/,
        'the plan-ready card computes a reason it does not show again',
      );
      const pick = pickSource;
      assert.doesNotMatch(pick, /subtitle/, 'the picker grew a prop it does not render again');

      // But the reason itself is LIVE, and this is the assertion that keeps
      // the deletion above honest: App.tsx feeds the same waterfall keys into
      // the backfill, and the Programs tab prints them on the programme's own
      // screen. A first sweep for `whyPrimary` searched `src/` only, missed
      // App.tsx, and concluded 44 `wf.*` strings were unreachable — they are
      // not (ref-grep-scope-app-tsx, hit again 2026-09-07).
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(app, /whyKey: waterfall\.whyPrimary/);
      assert.match(app, /whyKey: waterfall\.whyAlternative/);
      assert.match(app, /t\(preferences\.appLanguage, slot\.whyKey/);
      // And the strings they name are still shipped.
      assert.match(i18nSource, /'wf\.strength\.primary':/);
      assert.match(i18nSource, /'wf\.home_equipment\.primary':/);

    },
  },
  {
    name: 'the hardware back key steps the questionnaire back instead of closing the app',
    run() {
      // The app-level handler stands down while onboarding is open, and
      // nothing took its place: the key fell through to Android's default and
      // closed the app, from any step, with every answer thrown away
      // (2026-09-16).
      // Through the shared hook since 2026-09-19 — this screen had its own
      // copy of it, subscription contract and all, in the same repo that now
      // has the hook.
      assert.match(onboardingSource, /useHardwareBack\(\(\) => backActionRef\.current\(\)\);/);
      assert.doesNotMatch(onboardingSource, /BackHandler/);
      // The key does what the button does...
      assert.match(onboardingSource, /backActionRef\.current = resolveBackAction\(goBack\);/);
      // ...an open sheet closes before the stage steps...
      assert.match(
        onboardingSource,
        /if \(helperVisible\) \{\s*return \(\) => setHelperVisible\(false\);\s*\}/,
      );
      assert.match(onboardingSource, /onRequestClose=\{\(\) => setHelperVisible\(false\)\}/);
      // ...and nothing at all while the plan is being written.
      assert.match(onboardingSource, /return isBuildingPlan \? \(\) => undefined : stageBack;/);
      // App.tsx stands down for both forms of the questionnaire, which is
      // what leaves the screen in charge. The setup route is the same screen,
      // and the app's listener — re-subscribed on every route change, after
      // the child's — used to win there and send back straight to settings
      // (device, 2026-09-16). The whole shell: the listener left App.tsx for a
      // src/app hook in the phase-C split (2026-10-01).
      assert.match(
        shellSource,
        /if \(onboardingActive \|\| \(route\.tab === 'profile' && route\.screen === 'setup'\)\) \{\s*return undefined;\s*\}\s*const subscription = BackHandler\.addEventListener/,
      );
    },
  },
];
