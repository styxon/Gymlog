const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { functionBody } = require('../helpers/sourceSlices.cjs');

const programDetailSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDetailScreen.tsx'),
  'utf8',
);
const programDetailsSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'programDetails.ts'),
  'utf8',
);
// The workout tab's wiring moved to src/app in the phase-A split (2026-08-26).
const appSource = require('../helpers/appWiringSource.cjs').readAppWiring();
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');

module.exports = [
  {
    /**
     * "Ota ohjelma käyttöön" has to adopt the programme.
     *
     * It was wired to handleStartReadyProgram, which starts the first SESSION
     * and never touches the active plan: press it and you trained one workout,
     * then found Home still running whatever it ran before. The adopt function
     * existed the whole time and was reachable only from the season screen.
     *
     * This is the sibling of the bug that left the button unrendered — the
     * label and the wire have now disagreed twice, so both are pinned.
     */
    name: 'the adopt button adopts, rather than starting one session',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      const branch = app.slice(app.indexOf('onPrimaryAction={() => {'), app.indexOf('onStartSession={(sessionId) => {'));
      assert.ok(branch.length > 100, 'the primary action branch moved');
      assert.match(branch, /handleAdoptReadyProgram\(route\.workoutTemplateId/);
      assert.doesNotMatch(branch, /handleStartReadyProgram\(route\.workoutTemplateId\)/);
    },
  },

  {
    /**
     * The same bug, on the other side of the catalog.
     *
     * The ready half of "Ota ohjelma käyttöön" was fixed above and the custom
     * half was left starting a session, so a program the reader built or
     * imported could be run one workout at a time but never became the plan
     * Home reads. Reported by a reader who imported their own six-day program
     * from a spreadsheet and found no route onto the home screen: Home offers
     * the catalog and onboarding, and neither knows about it.
     */
    name: "a program of the reader's own can become the program on Home",
    run() {
      const branch = appSource.slice(
        appSource.indexOf('onPrimaryAction={() => {'),
        appSource.indexOf('onStartSession={(sessionId) => {'),
      );
      assert.ok(branch.length > 100, 'the primary action branch moved');
      assert.match(branch, /handleAdoptCustomProgram\(route\.workoutTemplateId/);

      // Adoption is what writes the plan Home reads. Starting a session is not
      // adoption, and that distinction is the whole bug.
      // Sliced rather than matched with a multi-line regex: App.tsx is CRLF on
      // this checkout, and a line-terminator pattern is the one thing here that
      // silently matches nothing instead of failing loudly.
      const handlerStart = appSource.indexOf('async function handleAdoptCustomProgram(');
      assert.ok(handlerStart > 0, 'handleAdoptCustomProgram not found');
      const handler = appSource.slice(handlerStart, handlerStart + 3000);
      assert.match(handler, /await upsertWorkoutPlan\(plan\)/);
      assert.match(handler, /activePlanId:/);
      assert.match(handler, /buildCustomProgramPlanId\(workoutTemplateId\)/);

      // The button has to say what it does. "Start first session" on a program
      // that is about to become your plan is the label half of the same bug.
      assert.match(programDetailsSource, /isActivePlan \|\| isHeldNotLeading\s*\?\s*'detail\.startNext'/);
      assert.match(programDetailsSource, /:\s*'detail\.adopt'/);
      assert.match(i18nSource, /'detail\.adopt': 'Ota ohjelma käyttöön'/);
    },
  },

  {
    name: 'program detail screen renders the light plan overview instead of the old session-flow hero',
    run() {
      // Every module constant is gone: a constant is evaluated once at import
      // and cannot follow a theme, so colours are read in the style factory.
      //
      // This assertion used to pin PLAN_PURPLE and PLAN_GREEN in place, two
      // lines under a comment explaining why a pinned constant is the bug. The
      // screen kept its whole light palette under the dark theme — white cards
      // and near-black body copy on a near-black page — and the guard stayed
      // green through exactly that.
      assert.doesNotMatch(programDetailSource, /const PLAN_[A-Z_]* =/);
      assert.match(programDetailSource, /backgroundColor: theme.bg/);
      /**
       * The painted hero is gone, and with it the last fixed colours.
       *
       * These lines used to pin it in place: a 262 px gradient carrying a
       * back button, a level chip and the title, with the week drawn behind
       * it as bars. That is a third of the screen, most of it empty colour,
       * before a single fact about the programme — "ylä heron viel ihan
       * liikaa tilaa … otsikko ylös data siihen ja ei mitään värikästä
       * heroa" (#bugs 2026-08-27). The title now leads in the theme's own
       * ink and the stat strip follows it directly.
       */
      assert.match(programDetailSource, /pageTitle: \{\s*color: theme\.ink/);
      assert.match(programDetailSource, /styles\.pageTitle/);
      assert.match(programDetailSource, /styles\.headerRow/);
      assert.doesNotMatch(programDetailSource, /styles\.hero\b/);
      assert.doesNotMatch(programDetailSource, /heroBars/);
      assert.doesNotMatch(programDetailSource, /styles\.heroTitle/);
      // White text still exists where a painted surface still exists — the
      // adopt button and the filled day chip. What went is white text that
      // depended on a gradient BEHIND the page.
      assert.doesNotMatch(programDetailSource, /styles\.headerTitle/);
      assert.doesNotMatch(programDetailSource, /styles\.planCard\b/);
      // Three numbers answering one question — how much of a week is this?
      // It used to run days / session / sessions, where the first and last
      // were the same number wearing two labels (user 2026-08-31).
      assert.match(programDetailSource, /'detail\.stat\.daysPerWeek'/);
      assert.match(programDetailSource, /'detail\.stat\.minPerSession'/);
      assert.match(programDetailSource, /'detail\.stat\.minPerWeek'/);
      // And the day count comes from the RHYTHM, not the session count: a
      // five-session programme on "4 on / 1 off" trains 5.6 days a week and
      // the header used to keep saying five.
      assert.doesNotMatch(programDetailSource, /value: `\$\{program\.sessions\.length\}`/);
      assert.match(programDetailSource, /formatTrainingDays\(weekLoad\.daysPerWeek\)/);
      // The cycle hint reads the same number from the same place; computing
      // it twice is how two lines on one screen end up disagreeing.
      assert.doesNotMatch(programDetailSource, /7 \* trainingCycle\.pattern\.filter/);
      // The week is seven named chips. A dot-and-word list said
      // "Treeni / Palautuminen" seven times and never named a session.
      assert.match(programDetailSource, /styles\.rhythmDay\b/);
      assert.match(programDetailSource, /shortSessionLabel\(session, language\)/);
      assert.doesNotMatch(programDetailSource, /scheduleDot/);
      // Every exercise says what it is FOR, read off the template's own role
      // rather than written per program. The roles moved with the exercise
      // list into the day view (design: GAINER Hourglass Shape screen 2) —
      // the programme page shows compact day rows that open it.
      const programDaySource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );
      assert.match(programDaySource, /ROLE_TAG_KEYS\[exercise\.role/);
      assert.match(programDetailSource, /onOpenSession/);
      assert.match(programDetailSource, /resolveProgramEmphasis/);
      assert.match(i18nSource, /'detail\.role\.primary': 'ANCHOR'/);
      assert.match(i18nSource, /'detail\.role\.primary': 'ANKKURI'/);
      // The summary comes back in the reader's language now. It was fetched
      // without one, so every program's description was English and the screen
      // simply did not render it.
      assert.match(programDetailsSource, /getReadyProgramContent\(template\.id, language\)/);
      assert.match(appSource, /preferences\.appLanguage,\s*\n\s*\)/);

      assert.match(programDetailSource, /t\(language, 'detail\.workouts'\)/);
      // The primary action is "adopt this programme", and it sits IN the page
      // under the week rhythm — not in a footer pinned to the bottom, where
      // the floating tab bar covered it and a reader reported there was no way
      // to start a programme at all. A pinned footer here must stay gone.
      // It asks first when pressing it makes this the active programme and
      // another one is active now (user 2026-09-21).
      assert.match(
        programDetailSource,
        /onPress=\{\(\) => \(primaryActionActivates \? askBeforeActivating\('adopt'\) : onPrimaryAction\(\)\)\}/,
      );
      assert.match(programDetailSource, /styles\.adoptButton/);
      assert.doesNotMatch(programDetailSource, /stickyFooter/);
      assert.match(i18nSource, /'detail\.adopt': 'Start this programme'/);
      assert.match(i18nSource, /'detail\.adopt': 'Ota ohjelma käyttöön'/);
      // The label comes from the view model, so it is translated at the source
      // rather than hardcoded English that no screen ever showed — and it reads
      // the state. TWO answers now: adopt it, or start its next workout once
      // it is running, whether or not it is the one Home leads with.
      //
      // The third — "Show this on Home" — is gone. It changed which programme
      // led and could not turn any of them off, which is not the question a
      // reader arrives with: "aktiivinen/eiaktiivinen nappia ei ole ... 'nayta
      // kodissani' nappi on ihan turha vaan tee sen tilalle tuo" (2026-09-07).
      // The Active switch answers it instead.
      assert.match(
        programDetailsSource,
        /isActivePlan \|\| isHeldNotLeading\s*\?\s*'detail\.startNext'\s*:\s*'detail\.adopt'/,
      );
      assert.doesNotMatch(programDetailsSource, /detail\.lead/, 'the lead button grew back');
      assert.doesNotMatch(i18nSource, /'detail\.lead'/, 'the lead string outlived its button');
      assert.match(i18nSource, /'detail\.startNext': 'Aloita seuraava treeni'/);
      assert.match(programDetailSource, /formatPlanSessionTitle/);
      // The inline warmup/workout/cooldown listing left with the day view:
      // the programme page shows compact rows, and the full session — the
      // same generated warmup and cooldown Home shows — lives one tap in.
      assert.doesNotMatch(programDetailSource, /buildSessionContentSections/);
      assert.doesNotMatch(programDetailSource, /sessionContentSection/);
      assert.match(programDaySource, /getDefaultWarmup/);
      assert.match(programDaySource, /getDefaultCooldown/);
      assert.match(programDaySource, /detail\.day\.warmup/);
      assert.match(programDaySource, /detail\.day\.cooldown/);
      assert.match(programDetailSource, /workoutCard/);

      // How the weight goes up. The catalog carries four rules per template
      // and the app had never shown one — they were written in English, and
      // the screen's answer to English text had been not to render it.
      assert.match(programDetailSource, /'detail\.progression'/);
      assert.match(programDetailSource, /progressionRuleLabel\(language, rule\)/);
      assert.match(appSource, /progressionRules=\{readyTemplate\?\.progressionRules \?\? null\}/);
      // Custom programs have no rules and get no section: they are the
      // reader's own sessions, and inventing a rule invents the whole thing.
      assert.match(programDetailSource, /\{progressionRules \? \(/);
      // The days warning is gone. "Vaatii 4 päivää viikossa. Sinun viikossasi
      // on 1." compared the programme's day count against the reader's stated
      // AVAILABILITY, which is a different thing from their plan's rhythm — so
      // it fired on anyone whose week was recorded loosely, and the reader
      // could not tell what it was about (user 2026-08-26, "en ihan tajua mikä
      // tämä on"). A warning nobody can act on is furniture with an alarm on
      // it; the day count is stated plainly in the Rytmi section.
      assert.doesNotMatch(programDetailSource, /availableDays|daysWarning|styles\.warnRow/);

      // The pinned footer and its "start the first session" shortcut are gone;
      // the adopt button above replaced both. Session rows still open the day.
      assert.match(programDetailSource, /program\.sessions\.map/);
      assert.match(programDetailSource, /\(onOpenSession \?\? onStartSession\)\(session\.id\)/);

      /**
       * And the day row is the ONLY way in (user 2026-08-31).
       *
       * The Workouts heading carried an "Edit" that opened the template
       * editor — a second editor for a programme the reader can already edit
       * by opening the day, where sets, reps, order, swaps and removals all
       * live. Two editors for one programme is two places to look for one
       * control, and two ways for them to disagree.
       */
      assert.doesNotMatch(programDetailSource, /onEdit/);
      assert.doesNotMatch(programDetailSource, /'plan\.edit'/);
      assert.doesNotMatch(appSource, /onEdit=\{route\.programType === 'custom'/);

      /**
       * The one thing on this page that DOES change the programme, and why it
       * is not the door that was removed (user 2026-09-08).
       *
       * A name is the only thing about a programme the day view cannot touch,
       * and a copy carries "(kopio)" for ever because the name is written once
       * at creation and never re-derived. So the title takes a pen — and only
       * a pen. It must not grow into a second editor: no route out of here,
       * and the field it opens replaces the title in place.
       */
      assert.match(programDetailSource, /onRenameProgram\?: \(name: string\) => void;/);
      assert.match(programDetailSource, /accessibilityLabel=\{t\(language, 'plan\.rename'\)\}/);
      assert.match(programDetailSource, /onPress=\{\(\) => setNameDraft\(displayTitle\)\}/);
      // Blank is a cancel, and an unchanged name is not a write — compared
      // against the value the field was SEEDED with, not the stored one. They
      // differ whenever formatWorkoutDisplayLabel had anything to do (a short
      // name becomes "Workout plan"), and comparing the stored name turned
      // "open the pen, press Save" into a rename (review, PR #85).
      assert.match(programDetailSource, /if \(trimmed && trimmed !== displayTitle\)/);
      assert.doesNotMatch(programDetailSource, /trimmed !== program\.title/);
      // And the field autofocuses inside a ScrollView, so one tap on Save has
      // to BE one tap rather than a keyboard dismissal.
      assert.match(
        programDetailSource,
        /<ScrollView[\s\S]{0,600}keyboardShouldPersistTaps="handled"[\s\S]{0,40}>/,
      );
      // Ready programmes keep the catalog's name: the prop is custom-gated.
      // appSource already spans App.tsx and every src/app module.
      assert.match(
        appSource,
        /onRenameProgram=\{\s*route\.programType === 'custom'[\s\S]{0,160}: undefined,?\s*\}/,
      );
      // The pen opens a field, never a screen.
      const penBlock = programDetailSource.slice(
        programDetailSource.indexOf("accessibilityLabel={t(language, 'plan.rename')}"),
        programDetailSource.indexOf('titleActions'),
      );
      assert.ok(penBlock.length > 80, 'the rename block moved - recheck by hand');
      assert.doesNotMatch(penBlock, /navigate\(|onOpen[A-Z]|screen: '/, 'the pen is not a door');

      assert.doesNotMatch(programDetailSource, /WorkoutSceneGraphic/);
      assert.doesNotMatch(programDetailSource, /Session flow/);
      assert.doesNotMatch(programDetailSource, /heroFlow/);
      assert.doesNotMatch(programDetailSource, /SurfaceCard/);
      assert.doesNotMatch(programDetailSource, /accent="blue"/);
      assert.doesNotMatch(programDetailSource, /Start here/);
      assert.doesNotMatch(programDetailSource, /styles\.screenEyebrow/);
      assert.doesNotMatch(programDetailSource, /Progress signals/);
      assert.doesNotMatch(programDetailSource, /inlineTip \?/);
      assert.doesNotMatch(programDetailSource, /secondaryActionLabel && onSecondaryAction/);
      assert.doesNotMatch(programDetailSource, /secondaryButton/);
      assert.doesNotMatch(programDetailSource, /<VinhaIcon name="dumbbell" color="#FFFFFF"/);
      assert.doesNotMatch(programDetailSource, /<VinhaIcon name="chevronRight" color="#FFFFFF"/);

      assert.match(appSource, /<ProgramDetailScreen/);
      assert.match(appSource, /onStartSession=\{\(sessionId\) => \{/);
      assert.doesNotMatch(appSource, /secondaryActionLabel=\{route\.programType === 'ready' \? 'Make it mine' : 'Duplicate'\}/);
    },
  },
  {
    /**
     * "Tee tästä oma versio" reaches a screen.
     *
     * Both strings were translated for the programme page and rendered by
     * nothing; the copy handler took a programme id whose only caller was the
     * plan screen in Profile, three levels deep. Wanting a ready programme
     * CHANGED is the documented buying moment, so the offer has to stand where
     * the reader is when they want it — on the programme, and at the end of the
     * day's list where "one more lift" is felt.
     */
    name: 'the programme page answers "is this for me" before it explains itself',
    run() {
      // "Kenelle" sat fourth, under the day list and the progression rules, so
      // the reader worked through how a programme runs before finding out
      // whether it was meant for them — which is the question they opened it
      // with (user 2026-08-26, "nostetaan kenelle osio ylös").
      // First mention of each: "equipment" appears again further down for the
      // chips it labels, and a second sighting is not a second section.
      const seen = [];
      for (const match of programDetailSource.matchAll(
        /'detail\.(forWhom|rhythm|workouts|progression|equipment)'/g,
      )) {
        if (!seen.includes(match[1])) {
          seen.push(match[1]);
        }
      }
      assert.deepEqual(seen, ['forWhom', 'rhythm', 'workouts', 'progression', 'equipment']);
    },
  },
  {
    name: 'changing a fixed programme is a change to a lift, not a lesson about the catalog',
    run() {
      const programDaySource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );

      // "Tee tästä oma versio" is gone from both screens. It asked the reader
      // to understand that catalog programmes are fixed and theirs are not
      // before they could change one lift — and the reader looking for a way
      // to drop an exercise never found it (user 2026-08-26). The copy still
      // happens; it happens underneath the change that needs it.
      assert.doesNotMatch(programDetailSource, /detail\.ownVersion/);
      assert.doesNotMatch(programDaySource, /detail\.ownVersion/);
      assert.doesNotMatch(programDaySource, /onCopyToCustom/);

      // The plus opens the library here, over the day. It used to navigate to
      // the template editor on the Workout tab, and the reader tapped it and
      // asked what tab they had landed on ("vie johonkin ihan outoon
      // välilehteen", #bugs 2026-08-26). Removal is offered on every
      // programme, fixed or not, and adding now is too — the copy-on-write
      // that makes a ready day editable already existed for removal.
      assert.match(programDaySource, /editor\.addExercise/);
      assert.match(programDaySource, /setAddSheetOpen\(true\)/);
      assert.match(programDaySource, /<AddExerciseSheet/);
      assert.doesNotMatch(programDaySource, /onAddExercise\b(?!s)/);
      assert.match(programDaySource, /home\.swapSheet\.remove/);
      assert.match(programDaySource, /onRemoveExercise\(swapRow\.exerciseId as string\)/);

      assert.doesNotMatch(appSource, /onAddExercise=\{/);
      assert.match(
        appSource,
        /onAddExercises=\{[\s\S]{0,220}kind: 'add',\s*\n\s*exerciseNames,/,
      );

      // The swap search reaches the library, not just the slot's six.
      // Searching "taka" returned "Tälle paikalle ei ole vaihtoehtoa", which
      // is a sentence about the pool and was read as a sentence about the app
      // ("ei pysty hakemaan todellisuudessa mitään", #bugs 2026-08-26).
      // The library search goes through the shared ranker (2026-09-02): the
      // same match rule, best answer first. Since 2026-10-07 the programme
      // day draws the guided player's swap sheet over the shared swap list
      // (useSwapPickerLists, with Home), which lists the library under the
      // cards even before anything is typed.
      assert.match(programDaySource, /useSwapPickerLists\(\{\s*exerciseLibrary,[\s\S]{0,300}query: swapQuery,/);
      assert.match(programDaySource, /main=\{\{ title: swapPicker\.libraryTitle, entries: swapPicker\.libraryEntries \}\}/);
      // An empty list says the search or a chip found nothing.
      assert.match(programDaySource, /emptyTitle=\{t\(language, 'guided\.swap\.noMatch'\)\}/);
      assert.match(
        appSource,
        /onRemoveExercise=\{[\s\S]{0,200}editProgramExercise\(route\.programType, route\.workoutTemplateId, daySession\.id, exerciseId, \{[\s\S]{0,60}kind: 'remove'/,
      );
      // The same path keeps a swap, because both are one edit to one lift in
      // one programme — two near-identical handlers is how they drift.
      assert.match(
        appSource,
        /onKeepSwap=\{[\s\S]{0,240}kind: 'replace',\s*\n\s*exerciseName,/,
      );
      assert.match(programDaySource, /home\.swapSheet\.keep/);
      // The sheet's own padding was a fixed number, so its last row sat behind
      // the phone's system buttons and could not be pressed. The inset travels
      // through the kit's shell now — read on the screen, never in the Modal.
      assert.match(programDaySource, /bottomInset=\{insets\.bottom\}/);
      const kitSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'sheetKit.tsx'),
        'utf8',
      );
      assert.match(kitSource, /\(barUp \? KIT_BAR_SPACE : 26\) \+ bottomInset/);
    },
  },
  {
    /**
     * The day page lost its gradient too, and kept everything that was in it.
     *
     * The programme page went first; the day's own 292 px hero was the same
     * argument one screen along, with one difference worth stating — it
     * carried content, not just colour. So the day name and the two numbers
     * stayed and only the paint went ("ilman gradienttia mutta voisiko silti
     * jättää lämmittely liikkeet ja lopetus osiot", 2026-08-27).
     */
    name: 'the day page leads with its title and keeps every section it had',
    run() {
      const day = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );
      assert.doesNotMatch(day, /HERO_HEIGHT/);
      assert.doesNotMatch(day, /styles\.hero\b/);
      assert.doesNotMatch(day, /SvgLinearGradient/);
      assert.match(day, /pageTitle: \{\s*color: theme\.ink/);
      // What the hero was carrying, still carried — except that the title is
      // now the DAY the reader tapped rather than the programme's name with
      // the session under it, which named the same day twice, differently.
      assert.match(day, /formatPlanSessionTitle\(session, dayNumber - 1, programTitle, language, readerNamed\)/);
      assert.doesNotMatch(day, /styles\.pageSession/);
      // The stat pair went too (design frame 05: title only at the top) —
      // both counts already sit on the section headers the rows live under.
      assert.doesNotMatch(day, /styles\.pageStatValue/);
      // The role legend survives, but LAST on the screen: the reader meets
      // ANCHOR on a row before being lectured about it.
      assert.ok(
        day.indexOf('styles.roleCard') > day.indexOf('detail.day.cooldown'),
        'the role legend should render below the sections, not above them',
      );
      // And the sections under it, untouched.
      assert.match(day, /detail\.day\.warmup/);
      assert.match(day, /detail\.day\.exercises/);
      assert.match(day, /detail\.day\.cooldown/);
      assert.match(day, /ROLE_TAG_KEYS\[exercise\.role/);
    },
  },
  {
    /**
     * Reordering is a mode on the list, not a trip through a sheet.
     *
     * The arrows lived inside the per-row edit sheet: three taps and a read
     * to move one row one place, with the list you are ordering hidden behind
     * the sheet while you do it.
     */
    name: 'the day page is reordered by dragging, as one edit per drag',
    run() {
      const day = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );
      // Drag replaced the Reorder mode and its arrows (design frame 05):
      // grab the handle, the rows make room, and letting go writes ONE
      // reorder with the destination.
      assert.doesNotMatch(day, /reorderMode|<MoveButton/);
      assert.match(day, /onReorderExercise\?\.\(exercise\.id, to\)/);
      // Only when there is an order to change.
      assert.match(day, /onReorderExercise && session\.exercises\.length > 1/);
      // Two vertical gestures cannot share one finger: the screen's scroll
      // freezes for the drag's duration.
      assert.match(day, /scrollEnabled=\{dragIndex === null\}/);
      // Heights are measured, never guessed — the preview shifts rows by the
      // dragged row's real height.
      assert.match(day, /rowHeights\.current\[index\] = event\.nativeEvent\.layout\.height/);
    },
  },
  {
    /**
     * Order is the answer on this screen too.
     *
     * `planWeekdayIndexes` stopped sorting so that its POSITION carries which
     * session owns which day. This screen re-sorted the array before pairing
     * it with `program.sessions[order]`, so a Mon/Thu programme adopted on a
     * Wednesday printed session 1 under MON while Home and the calendar ran
     * it on THU (PR #33 review) — the same failure the sort removal fixed,
     * relocated. The write path was never wrong: handleSaveRhythm re-derives
     * the assignment from the rotation. Only the read lied.
     */
    name: 'the rhythm strip pairs sessions in the plan order, not the sorted one',
    run() {
      // The sorted view still exists — membership, counting and the toggle
      // have no opinion about which session owns which day.
      assert.match(
        programDetailSource,
        /const committedDays = useMemo\(\s*\(\) => \[\.\.\.orderedDays\]\.sort/,
      );
      // The pairing reads the order-carrying array instead, with the plan's
      // own session for each of those days.
      assert.match(
        programDetailSource,
        /sessionsOnTrainingDays\(\s*draftDays \?\? orderedDays,\s*draftDays \? null : trainingDaySessionIds,\s*program\.sessions,?\s*\)/,
      );
      assert.doesNotMatch(
        programDetailSource,
        /shownDays\.forEach\(\(dayIndex, order\)/,
        'pairing from the sorted view is the bug this pins',
      );
      // By position in the programme was the second bug: a day with no
      // exercises is never in the plan (backfill review of #33, 2026-09-16).
      assert.doesNotMatch(programDetailSource, /program\.sessions\[order\]/);
      // And the ids come from the same entries, in the same order, as the days.
      assert.match(
        appSource,
        /trainingDayIndexes=\{planWeekdayIndexes\(detailPlanEntries\)\}\s*\/\/[^\n]*\n\s*trainingDaySessionIds=\{detailPlanEntries\.map\(\(entry\) => entry\.workoutTemplateSessionId \?\? null\)\}/,
      );
    },
  },
  {
    /**
     * One number for one day.
     *
     * Home and the player add the warm-up and cool-down to a session's
     * minutes; this page did not, so a custom programme's day read ~40 min
     * here and ~50 on Home (backfill review of #33, 2026-09-16).
     */
    name: 'the page counts the warm-up and cool-down Home counts',
    run() {
      assert.match(
        programDetailSource,
        /routineSeconds\(session\.exercises\.map\(\(exercise\) => exercise\.name\)\)/,
      );
      assert.match(appSource, /routineSeconds=\{routineSecondsForExercises\}/);
      // Home's own helper, not a second one that could drift from it.
      assert.match(
        appSource,
        /const routineSecondsForExercises = useCallback\(\s*\(exerciseNames: string\[\]\) => routineBlockSeconds\(classifySessionFocus\(exerciseNames\)\),/,
      );
      assert.match(appSource, /availableEquipmentForDrills,\s*routineSecondsForExercises,/);
    },
  },
  {
    /**
     * Editing a ready programme buys a copy, so the copy must carry the edit.
     *
     * The duplication branch built its dose from `edit.prescription` but then
     * wrote `restSeconds: exercise.restSecondsMin` — the catalog's own value.
     * Changing only the rest time therefore spent one of three custom-programme
     * slots and dropped the change in silence (PR #33 review).
     */
    name: 'duplicating a ready programme carries the rest-time edit into the copy',
    run() {
      assert.match(
        appSource,
        /restSeconds:\s*typeof dose\.restSeconds === 'number' \? dose\.restSeconds : exercise\.restSecondsMin/,
      );
    },
  },
  {
    /**
     * A day is dragged exactly like a lift.
     *
     * The exercises inside a day have been draggable since frame 05; the days
     * themselves were fixed in creation order (user 2026-08-31: "tee
     * identtinen systeemi kun siellä missä treenejä voi vaihtaa"). Same
     * contract, so the same three things are pinned: heights measured rather
     * than guessed, the scroll frozen for the drag, and the drop written once
     * with its destination.
     */
    name: 'the day rows are dragged with the same machinery the lifts use',
    run() {
      assert.match(programDetailSource, /rowHeights\.current\[index\] = event\.nativeEvent\.layout\.height/);
      assert.match(programDetailSource, /scrollEnabled=\{dragIndex === null\}/);
      // While a day is held, every resting place is outlined and the one it
      // will drop into is marked (#bugs 2026-09-26); the rows that make room
      // move by a whole slot, gap included, so they land in their outlines.
      assert.match(programDetailSource, /rowTops\.current\[index\] = event\.nativeEvent\.layout\.y/);
      assert.match(programDetailSource, /\{dragIndex !== null \? \(\s*<View pointerEvents="none" style=\{StyleSheet\.absoluteFill\}>/);
      assert.match(programDetailSource, /dragTarget === index && styles\.daySlotTarget/);
      assert.match(programDetailSource, /const slot = \(rowHeights\.current\[dragIndex \?\? 0\] \?\? 0\) \+ DAY_ROW_GAP;/);
      assert.match(programDetailSource, /remaining -= height \+ DAY_ROW_GAP;/);
      // Three-line grips, on the days and on the lifts.
      assert.doesNotMatch(programDetailSource, /M3 9h18M3 15h18/);
      assert.doesNotMatch(
        fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'), 'utf8'),
        /M3 9h18M3 15h18/,
      );
      assert.match(programDetailSource, /onReorderSession\?\.\(session\.id, to\)/);
      // Only when there is an order to change, and only on a programme the
      // reader owns — dragging must never buy them a copy.
      assert.match(programDetailSource, /onReorderSession && program\.sessions\.length > 1/);
      assert.match(appSource, /route\.programType === 'custom'[\s\S]{0,160}handleReorderProgramSession/);
      // And the PLAN follows the template. Each entry pins a weekday to a
      // session by id, and Home, the calendar and the rotation read the
      // assignment from there — a reorder that stopped at the template moved
      // the list on one screen and changed nothing about what gets trained
      // (found in review, 2026-08-31).
      // The week turns with it, from the reader's own history — without that,
      // Home offered one session and the calendar put another on its day.
      assert.match(
        appSource,
        /reorderPlanWeek\(\s*plan\.entries,\s*saved\.map\(\(session\) => session\.id\),\s*completedSessionsForTemplate\(workoutTemplateId\),\s*new Date\(\),?\s*\)/,
      );
      // Read back, not assumed: the repository decides the saved order.
      assert.match(
        appSource,
        /getWorkoutTemplateSessionsFresh\(workoutTemplateId\)[\s\S]{0,400}reorderPlanWeek/,
      );
    },
  },
  {
    /**
     * Both grips have to be HELD, and they hold identically.
     *
     * They armed on touch, so a finger that landed on one while scrolling
     * reordered the list: "liian helppo vaihtaa päivien järjestystä, tein sen
     * vahingossa" (#bugs 2026-09-05). The hold lives in one hook rather than
     * twice in two screens, because the day list was built to be identical to
     * the lift list and a second copy is how they stop being.
     */
    name: 'a day and a lift are both picked up by holding, never by touching',
    run() {
      const dayScreen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );
      const hook = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'hooks', 'useDragHold.ts'),
        'utf8',
      );

      for (const [label, source] of [['days', programDetailSource], ['lifts', dayScreen]]) {
        assert.match(source, /const dragHold = useDragHold\(\)/, `${label}: no hold`);
        assert.match(source, /dragHold\.begin\(event\.nativeEvent\.pageY/, `${label}: pickup not deferred`);
        // The pickup happens in the hold's callback, never straight from the
        // touch — that IS the bug, and it reads almost the same either way.
        assert.match(
          source,
          /dragHold\.begin\([\s\S]{0,80}setDragIndex\(index\);\s*setDragTarget\(index\);\s*\}\)/,
          `${label}: index set outside the hold`,
        );
        assert.doesNotMatch(source, /dragStartPageY/, `${label}: still tracking its own start`);
        // A touch that never became a hold commits nothing.
        assert.match(source, /const wasHeld = dragHold\.end\(\);/, `${label}: end does not check the hold`);
        assert.match(source, /if \(!wasHeld\) \{\s*return;/, `${label}: an unheld grip still writes`);
      }

      assert.match(hook, /DRAG_HOLD_MS = 250/);
      assert.match(hook, /haptics\.impactLight\(\)/, 'the pickup is not felt');
      // Travelling before the hold lands is a scroll, so the gesture dies.
      assert.match(hook, /Math\.abs\(dy\) > DRAG_HOLD_SLOP/);
    },
  },
  {
    /**
     * The day title stopped resizing itself.
     *
     * `adjustsFontSizeToFit` re-measures on every re-layout, and dragging a
     * day translates its neighbours — so the titles visibly changed size while
     * a day was being moved past them (#bugs 2026-09-05). One line, ellipsised,
     * the way Historia and Progress already truncate a long name.
     */
    name: 'a day title is truncated, not shrunk',
    run() {
      // Comments stripped first: the note explaining the removal names the
      // prop, and a guard its own comment can satisfy proves nothing.
      const code = programDetailSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(code, /adjustsFontSizeToFit/);
      assert.match(code, /<Text style=\{styles\.workoutName\} numberOfLines=\{1\}>/);
    },
  },
  {
    /**
     * The programme page stopped offering to start the workout.
     *
     * "Poistetaan ohjelman sisällä oleva start next workout — ei kuulu tänne"
     * (user 2026-08-31). The adopt button stays for a programme the reader
     * has NOT taken up: that is the one thing this page exists to offer.
     */
    name: 'a held programme offers a switch instead of a start button, and an unadopted one still gets the button',
    run() {
      // Every programme the reader holds gets the Active switch. Only a
      // programme the reader has not taken up gets the button, which is the
      // one thing this page exists to offer.
      // Active OR held: a programme that is not the active one keeps its
      // switch, off, rather than turning back into an adopt button (device,
      // 2026-09-16).
      assert.match(programDetailSource, /\{\(active \|\| held\) && onSetActive \? \(/);
      // The switch is ON for one programme: the active one. It read
      // "running", and all four programmes a reader held read as on beside
      // one ACTIVE tag (user 2026-09-21).
      assert.match(programDetailSource, /value=\{active\}/);
      assert.doesNotMatch(programDetailSource, /value=\{running\}/);
      assert.match(programDetailSource, /\) : activePlanSummary \? null : \(/);
      assert.match(programDetailSource, /program\.primaryActionLabel/);
      // The switch is the shared one, not a second spelling of a toggle.
      assert.match(programDetailSource, /import \{ ToggleSwitch \} from '\.\.\/components\/SettingsUi';/);
      assert.match(programDetailSource, /t\(language, 'detail\.active'\)/);
      // And turning it off stops the programme rather than merely unleading
      // it: every plan pointing at the programme goes, because one programme
      // can be held under more than one plan id.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      const stopAt = app.indexOf('async function handleStopProgram(workoutTemplateId: string)');
      assert.ok(stopAt > 0, 'handleStopProgram not found');
      const stopBody = app.slice(stopAt, stopAt + 1400);
      // The plan-matching rule lives in src/lib and is tested there; every
      // plan pointing at the programme has to go, or the switch reads off
      // while it still runs under the other id.
      assert.match(stopBody, /stopProgramme\(\{/);
      assert.match(stopBody, /templateId: workoutTemplateId,/);
      assert.doesNotMatch(
        stopBody,
        /filter\(\(planId\) => planId === preferences\.activePlanId\)/,
        'stopping a programme leaves its other plan running',
      );

      // The switch is the way to change which programme Home leads with:
      // turning it on makes this one the lead, under the plan it already has.
      const resumeAt = app.indexOf('async function handleResumeProgram(workoutTemplateId: string)');
      assert.ok(resumeAt > 0, 'handleResumeProgram not found');
      assert.match(
        app.slice(resumeAt, app.indexOf('\n  }', resumeAt)),
        /activePlanId: resumed\.activePlanId \}\);/,
      );
      // And the only way. Training a session from another programme used to
      // promote it, so a one-off workout moved Home and the ACTIVE tag off
      // the programme the reader had chosen, past the question the switch
      // asks (user 2026-09-21).
      assert.doesNotMatch(app, /leadOnTrain/);
      for (const start of ['startReadyProgramSessionWithUnit', 'handleStartCustomProgramSession']) {
        // The function itself, bracket-matched and asserted present: sliced
        // to the next `function`, what was scanned depended on which
        // neighbours sat below it, and phase B moves neighbours (2026-09-30).
        const body = functionBody(app, `function ${start}(`);
        assert.doesNotMatch(body, /promoteHeldProgramToLead|activePlanId:/, `${start} moves the active programme`);
      }
      assert.match(app, /onStopProgram: handleStopProgram,/);
      // ACTIVE is read off the list's own rows, the ones that carry the tag.
      assert.match(app, /active=\{programIsActive\}/);
      assert.match(
        app,
        /const programIsActive = programsCustomItems\.some\(\s*\(row\) => row\.active && row\.id === route\.workoutTemplateId,?\s*\);/,
      );
      // The cycle's own sentence went with it — the chips draw the week and
      // the header prints the rate.
      assert.doesNotMatch(programDetailSource, /detail\.week\.cycleStatus/);
    },
  },
  {
    /**
     * "Kun sliderista valitaan aktiiviseksi tulisi tulla teksti 'oletko
     * varma, sinulla on aktiivisena ohjelmana xx'" (user 2026-09-21). The
     * advice is to finish one programme before starting the next, so both
     * doors that make a programme active ask first — the switch and the
     * adopt button — and name the programme the reader would move off.
     */
    name: 'making another programme active asks first, and names the active one',
    run() {
      const code = programDetailSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // On asks; off asks too since 2026-09-22 — see the next suite.
      assert.match(
        code,
        /onChange=\{\(next\) => \(next \? askBeforeActivating\('switch'\) : askBeforeSwitchingOff\(\)\)\}/,
      );
      // Only when there is a programme to move off; otherwise it just acts.
      assert.match(
        code,
        /const askBeforeActivating = \(via: 'switch' \| 'adopt'\) => \{\s*if \(switchingFrom\) \{\s*setPendingSwitch\(via\);\s*return;\s*\}\s*activate\(via\);/,
      );
      // Nothing happens until the reader says yes.
      assert.match(code, /visible=\{pendingSwitch !== null && switchingFrom !== null\}/);
      assert.match(code, /onCancel=\{\(\) => setPendingSwitch\(null\)\}/);
      assert.match(code, /t\(language, 'detail\.switchActive\.message', \{ name: switchingFrom \?\? '' \}\)/);

      // The name is the one the list puts beside the ACTIVE tag.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(app, /const switchedFrom = programmeSwitchedFrom\(programsCustomItems, route\.workoutTemplateId\);/);
      assert.match(app, /switchingFrom=\{switchedFrom\?\.name \?\? null\}/);
      // The adopt button asks only on the branches that adopt.
      assert.match(app, /\? !readyProgramIsMine && !ownProgrammeCopyId/);

      assert.match(
        i18nSource,
        /'detail\.switchActive\.message': 'Sinulla on aktiivisena ohjelmana \{name\}\. Suosittelemme, että teet yhden ohjelman loppuun/,
      );
    },
  },
  {
    /**
     * "Kun aktiivisen ohjelman ottaa pois päältä sliderista, pitää tulla
     * toinen popup: haluatko vaihtaa aktiivisen ohjelman tähän x, tai jos ei
     * ole mitään muita omissa ohjelmissa niin pitää viedä katalogiin" (user
     * 2026-09-22). Off used to stop the programme at once and hand the lead
     * to whichever plan came first.
     */
    name: 'switching the active programme off asks: switch to the other one, or look for a new one',
    run() {
      const code = programDetailSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // Nothing happens before the answer: off only opens a question.
      assert.match(
        code,
        /const askBeforeSwitchingOff = \(\) => \{\s*if \(stoppingHandsTo && onSwitchOff\) \{\s*setPendingOff\('switch'\);\s*return;\s*\}\s*if \(!stoppingHandsTo && onBrowseProgrammes\) \{\s*setPendingOff\('browse'\);\s*return;\s*\}\s*onSetActive\?\.\(false\);/,
      );
      assert.match(code, /visible=\{pendingOff !== null\}/);
      assert.match(code, /onCancel=\{\(\) => setPendingOff\(null\)\}/);
      assert.match(code, /t\(language, 'detail\.switchOff\.message', \{ name: stoppingHandsTo \?\? '' \}\)/);

      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      // The offer is the pure rule's, named as the list names it.
      assert.match(app, /const switchTo = programmeToSwitchTo\(\{/);
      assert.match(app, /shown: programsCustomItems\.map\(\(row\) => row\.id\),/);
      assert.match(app, /onSwitchActiveProgram\(route\.workoutTemplateId, switchTo\)/);
      // The reader's own programmes never started count as other programmes
      // (CI review of #179): offered, and given a plan when chosen.
      assert.match(app, /unstarted: programsCustomItems\s*\.filter\(/);
      // No other programme: switched off, then the catalogue.
      assert.match(
        app,
        // Only once the stop is written (hunt 10, #37).
        /onBrowseProgrammes=\{\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*void onStopProgram\(route\.workoutTemplateId\)\.then\(\(stopped\) => \{\s*if \(stopped\) \{\s*navigate\(\{ tab: 'workout', screen: 'catalog' \}\);/,
      );
      // And the switch is one write, not a stop and a resume that would read
      // the running set from the render before the stop.
      const at = app.indexOf('async function handleSwitchActiveProgram(');
      assert.ok(at > 0, 'handleSwitchActiveProgram not found');
      const body = app.slice(at, app.indexOf('\n  }', at));
      assert.match(body, /const next = switchActiveProgramme\(\{/);
      assert.match(body, /await updatePreferences\(next\);/);
      assert.doesNotMatch(body, /stopProgramme\(|resumeProgramme\(/);
      // An unstarted programme gets its plan first, the one adoption builds,
      // and the switch reads the plans with it in.
      assert.match(
        body,
        /if \(!toPlanId\) \{\s*const plan = buildCustomProgrammePlan\(to\.templateId\);[\s\S]*?await upsertWorkoutPlan\(plan\);\s*plans = \[\.\.\.plans\.filter\(\(entry\) => entry\.id !== plan\.id\), plan\];/,
      );
      assert.match(app, /const plan = buildCustomProgrammePlan\(workoutTemplateId\);\s*if \(!plan\) \{\s*return false;/);

      assert.match(i18nSource, /'detail\.switchOff\.message': 'Haluatko vaihtaa aktiiviseksi ohjelmaksi \{name\}\?/);
      assert.match(i18nSource, /'detail\.browseOff\.title': 'Haluatko katsoa uutta ohjelmaa\?'/);
    },
  },
  {
    /**
     * What you can press is the action accent, not the brand violet.
     *
     * The dark theme collapses the two accent families on purpose — "anything
     * pressable is orange, violet carries brand and structure" (darkTheme.ts,
     * user decision 2026-08-01) — and every other screen adopted it. This one
     * painted sixteen things with `theme.purple`, including its primary
     * button, so the whole page stayed violet under a dark theme whose own tab
     * bar was orange.
     */
    name: 'the programme page paints what you can press with the action accent',
    run() {
      // The primary action, and the ink that goes on it: white on the dark
      // theme's orange is about 2:1, which is why onHighlight exists.
      assert.match(
        programDetailSource,
        /adoptButton: \{[\s\S]{0,240}backgroundColor: theme\.highlight,\s*\r?\n\s*shadowColor: theme\.highlight,/,
      );
      assert.match(programDetailSource, /adoptButtonText: \{\s*\r?\n\s*color: theme\.onHighlight,/);

      // The week's training days are the other filled surface on the page.
      assert.match(
        programDetailSource,
        /rhythmDayOn: \{\s*\r?\n\s*backgroundColor: theme\.highlight,\s*\r?\n\s*borderColor: theme\.highlight,/,
      );
      assert.match(programDetailSource, /rhythmDayLabelOn: \{\s*\r?\n\s*color: theme\.onHighlight,/);

      // Text actions travel with it.
      for (const style of ['sectionAction', 'emphasisEdit', 'rhythmHint', 'workoutActionText']) {
        assert.match(
          programDetailSource,
          new RegExp(`${style}: \\{[\\s\\S]{0,60}color: theme\\.highlight,`),
          `${style} is not on the action accent`,
        );
      }

      // Violet is left with the two things that are not actions: the numbered
      // marker in the progression rules, and the star on the "why it fits"
      // card. If either of those grows, decide which family it belongs to.
      //
      // The whole violet family, not bare `theme.purple`: there is no word
      // boundary between "purple" and "Bright", so `theme.purple\b` misses
      // purpleBright, purpleDark, purpleLight and purpleSoft — which are
      // exactly the four this page carried on its pressable styles, and the
      // four a reintroduction would most likely come back as.
      assert.equal(
        (programDetailSource.match(/theme\.purple[A-Za-z]*/g) ?? []).length,
        2,
        'a new violet appeared on this page — is it brand, or is it pressable?',
      );
    },
  },
  {
    /**
     * A superset's frame is the edge of the rows it holds (#bugs 2026-09-26:
     * "liikaa poikkiviivoja … menee päällekkäin"). The first row inside the
     * frame and the first row after it each drew their own rule right
     * against the frame's line — two lines where one belongs.
     */
    name: 'the superset frame is the only line at its top and bottom edge',
    run() {
      const day = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );
      assert.match(day, /const isSuperset = run\.groupId !== null && run\.indexes\.length >= 2;/);
      assert.match(
        day,
        /const afterSuperset = Boolean\(previous && previous\.groupId !== null && previous\.indexes\.length >= 2\);/,
      );
      assert.match(
        day,
        /renderExerciseRow\(session\.exercises\[index\], index, position === 0 && \(isSuperset \|\| afterSuperset\)\)/,
      );
      assert.match(day, /hideTopRule && styles\.exerciseCardNoRule/);
      assert.match(day, /exerciseCardNoRule: \{\s*borderTopWidth: 0,/);
    },
  },
  {
    // The reader calls them days: "Ei lisää liike vaan Lisää päivä" (#bugs
    // 2026-09-26). The row names stay the workout's own; the actions on the
    // list say what they add and remove.
    name: 'the day list adds and removes a day, in those words',
    run() {
      const i18n = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
      assert.match(i18n, /'detail\.addWorkout': 'Lisää päivä',/);
      assert.match(i18n, /'day\.removeWorkout': 'Poista päivä ohjelmasta',/);
      assert.match(i18n, /'detail\.addWorkout': 'Add day',/);
    },
  },
];
