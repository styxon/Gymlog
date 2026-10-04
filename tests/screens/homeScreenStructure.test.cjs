const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between, functionBody } = require('../helpers/sourceSlices.cjs');

const homeScreenSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'HomeScreen.tsx'),
  'utf8',
);
const bottomTabBarSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'BottomTabBar.tsx'),
  'utf8',
);
const vinhaIconSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'VinhaIcon.tsx'),
  'utf8',
);
const dashboardSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'dashboard.ts'),
  'utf8',
);
const progressScreenSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'ProgressScreen.tsx'),
  'utf8',
);
const emptyWorkoutScreenSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'EmptyWorkoutScreen.tsx'),
  'utf8',
);
const workoutsScreenSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'WorkoutsScreen.tsx'),
  'utf8',
);
const routesSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'navigation', 'routes.ts'), 'utf8');
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
// The whole shell — App.tsx plus the src/app modules the phase-A and phase-B
// splits (2026-08-26, 2026-09-30) moved VinhaApp's wiring into — for the
// absence guards: a name or a shape that must not come back must not come
// back in a hook either. Presence pins keep reading App.tsx, except those on
// blocks that have left it: the <HomeScreen> element and the shell's return
// (BottomTabBar), which phase C (2026-10-01) moved into
// src/app/renderHomeDashboard.tsx and renderAppShell.tsx, and Home's
// derivations, which it moved into src/app hooks. Those read the whole shell,
// bounded to the block where a pattern could match elsewhere.
const shellSource = readAppWiring();
/*
 * Home's hero card, bounded to its own memo: from the declaration to its deps
 * line. It left App.tsx for src/app/useHomeActivePlan.ts in the phase-C split
 * (2026-10-01); both anchors are asserted, so the slice cannot quietly grow.
 */
const heroCardSource = () =>
  between(shellSource, 'const homeActivePlanCard = useMemo(() => {', '\n  }, [database.workoutPlans, database.workoutSessions,');

/**
 * The <HomeScreen …/> element, sliced out of the ONE shell file (App.tsx or a
 * src/app module) that renders it, so the slice cannot run across a join of
 * the concatenation. `<HomeScreen` followed by whitespace — the bare prefix
 * also matches `HomeScreenProps` type annotations. The element ends at the
 * first `/>` after the tag (none of its props renders JSX), and that line must
 * sit at the tag's own indentation.
 */
function homeScreenElement() {
  const appDir = path.join(__dirname, '..', '..', 'src', 'app');
  const files = [
    path.join(__dirname, '..', '..', 'App.tsx'),
    ...fs
      .readdirSync(appDir)
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .sort()
      .map((name) => path.join(appDir, name)),
  ];
  const opening = /<HomeScreen\s/g;
  const renderers = files
    .map((file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    .filter((source) => (source.match(opening) || []).length > 0);
  assert.equal(renderers.length, 1, 'HomeScreen is rendered from exactly one shell file');
  const source = renderers[0];
  assert.equal((source.match(opening) || []).length, 1, 'HomeScreen is rendered once in the shell');
  const start = source.search(/<HomeScreen\s/);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  assert.match(indent, /^[ \t]*$/, '<HomeScreen does not open its own line');
  const end = source.indexOf('/>', start);
  assert.ok(end > start, 'the <HomeScreen element does not close');
  assert.equal(source.slice(source.lastIndexOf('\n', end) + 1, end), indent, '<HomeScreen did not close at its own indentation');
  return source.slice(start, end);
}

module.exports = [
  {
    name: 'home screen uses light routine dashboard with purple workout actions',
    run() {
      // Home v3 (GAINER Home v3 mock): palette comes from the shared HG token
      // set in lightTheme.ts — no local hex constants for tokenized colors.
      // Home reads the active theme now, the plateau card included: its fixed
      // PW cream under theme.ink put white text on cream in dark (#bugs
      // 2026-10-01), so nothing on Home takes the fixed paywall palette.
      assert.doesNotMatch(homeScreenSource, /import \{ PW \} from '\.\.\/lightTheme'/);
      assert.match(homeScreenSource, /useThemedStyles\(makeStyles\)/);
      assert.doesNotMatch(homeScreenSource, /const HOME_BACKGROUND =/);
      assert.match(homeScreenSource, /screenBackground:\s*\{[\s\S]*backgroundColor: theme.bg/);

      // The greeting line and its rotation are gone outright (user
      // 2026-08-25): the header is the wordmark, the PRO pill and the date.
      // lib/homeGreeting went with its only caller — a rotation nobody
      // renders must not survive as dead code.
      assert.doesNotMatch(homeScreenSource, /selectHomeGreeting|isRotatingGreeting|selectTimeGreetingKey/);
      assert.ok(
        !fs.existsSync(path.join(__dirname, '..', '..', 'src', 'lib', 'homeGreeting.ts')),
        'homeGreeting.ts is back — if the greeting returns, restore its render too',
      );
      // The date survived the greeting row. It wore the accent for half a day
      // ("Ti 25.08 oranssiksi") and went back to ink the same evening — the
      // user's call both times — with the programme counter now sharing its
      // row from the hero, so the session title owns a full line.
      assert.match(homeScreenSource, /greetingDate:\s*\{[\s\S]{0,200}color: theme\.ink/);
      assert.match(homeScreenSource, /greetingRow[\s\S]{0,700}styles\.heroProg/);
      assert.match(homeScreenSource, /content:\s*\{[\s\S]*paddingTop: 24/);
      // The PRO pill is back, and it reads the entitlement. It was removed for
      // advertising a subscription to people who already paid; that reason
      // applied to the gold offer, not to a status badge. Gold goes to the Pro
      // page, grey goes to the membership the reader already has — a
      // subscriber must never be sent to a page selling them what they own.
      assert.match(homeScreenSource, /proUnlocked \? onOpenSubscription\?\.\(\) : onOpenPremium\?\.\(\)/);
      assert.match(homeScreenSource, /proUnlocked \? styles\.proPillActive : styles\.proPillOffer/);
      assert.match(homeScreenSource, /proPillOffer:\s*\{[\s\S]{0,80}backgroundColor: theme\.gold/);
      assert.match(homeScreenSource, /proPillActive:\s*\{[\s\S]{0,120}backgroundColor: theme\.surfaceSoft/);
      // The label is one word; what it means is in the accessibility label.
      assert.match(homeScreenSource, /proUnlocked \? 'home\.proPill\.manage' : 'home\.proPill\.get'/);
      // The full lockup: the app is called Vinha Fitness, and Home is where
      // the reader looks to see whose app this is. The speed rule under it is
      // gone with the greeting (user 2026-08-25).
      assert.match(homeScreenSource, /<VinhaWordmark size=\{30\} fitness \/>/);
      assert.doesNotMatch(homeScreenSource, /speedRule/);
      // Training dots wear the accent, rest stays green (user 2026-08-25) —
      // in both the week strip and the month grid, or the legend lies.
      assert.match(homeScreenSource, /weekStripDotTraining:\s*\{[\s\S]{0,60}backgroundColor: theme\.highlight/);
      assert.match(homeScreenSource, /weekStripDotRecovery:\s*\{[\s\S]{0,60}backgroundColor: theme\.green/);
      assert.match(homeScreenSource, /monthDayDotTraining:\s*\{[\s\S]{0,60}backgroundColor: theme\.highlight/);
      assert.match(homeScreenSource, /monthDayDotRecovery:\s*\{[\s\S]{0,60}backgroundColor: theme\.green/);
      // The date is stated once, on its own row — today's cell in the
      // week strip is told apart by its highlight, not by different content.
      assert.match(homeScreenSource, /const dayLabel = day\.weekdayLabel;/);
      assert.match(homeScreenSource, /const \[plateauSheetVisible, setPlateauSheetVisible\] = useState\(false\)/);
      // Week strip lives on a white card and expands into a Monday-first month
      // grid; the chevron rotates 180° and the panel height animates.
      assert.match(homeScreenSource, /topCalendarDays/);
      assert.match(homeScreenSource, /weekCard:\s*\{[\s\S]*borderRadius: 18/);
      assert.match(homeScreenSource, /weekStripItemToday:\s*\{[\s\S]*backgroundColor: theme.purpleSoft/);
      assert.match(homeScreenSource, /const \[calendarExpanded, setCalendarExpanded\] = useState\(false\)/);
      // The month grid pages, so the offset is part of what it memoises on.
      assert.match(
        homeScreenSource,
        /getHomeMonthCalendar\(new Date\(\), language, monthOffset\),[\s\S]{0,400}\[language, monthOffset, todayDayStart\]/,
      );
      assert.match(homeScreenSource, /setMonthOffset\(\(current\) => current - 1\)/);
      assert.match(homeScreenSource, /setMonthOffset\(\(current\) => current \+ 1\)/);
      assert.match(homeScreenSource, /monthCalendar\.monthLabel/);
      assert.match(homeScreenSource, /monthDayCellToday/);
      assert.match(homeScreenSource, /monthLegendRow/);
      assert.match(homeScreenSource, /outputRange: \['0deg', '180deg'\]/);
      assert.match(homeScreenSource, /calendarAnim\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0, 480\] \}\)/);
      // Entrance animations: staggered "rise" + progress fill, all skipped when
      // the user has reduced motion enabled (content must never stay hidden).
      assert.match(homeScreenSource, /queryReduceMotion\(\)/);
      assert.match(homeScreenSource, /riseValues\.forEach\(\(value\) => value\.setValue\(1\)\)/);
      assert.match(homeScreenSource, /Easing\.bezier\(0\.22, 1, 0\.36, 1\)/);
      assert.match(homeScreenSource, /outputRange: \[16, 0\]/);
      // The weekly status row + streak pill stay removed.
      assert.doesNotMatch(homeScreenSource, /weeklyStatusRow/);
      assert.doesNotMatch(homeScreenSource, /sessions this week/);
      assert.doesNotMatch(homeScreenSource, /day streak/);
      assert.doesNotMatch(homeScreenSource, /streakPill/);
      assert.doesNotMatch(homeScreenSource, /HomeStreakSummary/);
      assert.match(dashboardSource, /totalDurationMinutes: number/);
      assert.match(dashboardSource, /getCanonicalCompletedSessions\(database\)\.reduce/);

      assert.match(vinhaIconSource, /\| 'dumbbell'/);
      assert.match(vinhaIconSource, /\| 'chevronRight'/);
      assert.match(vinhaIconSource, /case 'dumbbell':/);
      assert.match(vinhaIconSource, /case 'chevronRight':/);

      // Home v4 session hero (design_handoff_home_v4): no eyebrow or plan-name
      // subline — focus title + plan-wide progress beside it, 2x2 meta grid,
      // and a conditional equipment line derived from the exercise library.
      assert.doesNotMatch(homeScreenSource, /CONTINUE PLAN/);
      assert.doesNotMatch(homeScreenSource, /planEyebrow/);
      assert.doesNotMatch(homeScreenSource, /planSubtitle/);
      assert.doesNotMatch(homeScreenSource, /continuePlanCard/);
      assert.match(homeScreenSource, /nextPlanSession/);
      assert.match(homeScreenSource, /onStartActivePlanSession\(nextPlanSession\.id\)/);
      assert.match(homeScreenSource, /const focusTitle = getSessionFocusTitle\(nextPlanSession\?\.title, activePlan\?\.title\)/);
      // Home simplification round (2026-07-20): hero title bumped to 38. Down
      // to 32 on 2026-09-08 — one step back, so the two lines inside the block
      // rows get the space the padding was holding. Still the biggest thing on
      // this screen by a clear margin; the next-largest heading here is 22.
      assert.match(homeScreenSource, /heroTitle:\s*\{[\s\S]*fontSize: 32/);
      assert.match(homeScreenSource, /t\(language, 'home\.hero\.sessionsProgress', \{ done: sessionsDone, total: sessionsTotal \}\)/);
      // Counts sessions plainly (design frame 15): "of 60" repeated the block
      // total that the programme section's "Week 1 of 12" already carries.
      assert.match(i18nSource, /'home\.hero\.sessionsProgress': '\{done\} sessions logged'/);
      assert.match(homeScreenSource, /heroProgTrack:\s*\{\s*width: 88,\s*height: 6/);
      assert.match(homeScreenSource, /heroProgFill:\s*\{[\s\S]*backgroundColor: theme.purple/);
      assert.match(homeScreenSource, /progressFillAnim\.interpolate\(\{ inputRange: \[0, 100\], outputRange: \['0%', '100%'\] \}\)/);
      // Home simplification round (2026-07-20): the hero shows ONLY the focus
      // title + plan progress — no meta grid, no equipment line.
      assert.doesNotMatch(homeScreenSource, /styles\.metaGrid/);
      assert.doesNotMatch(homeScreenSource, /— needed for today's session/);
      // History left Home (user 2026-08-31). Progress already lists the same
      // rows, and Home is for running today rather than reading back — the
      // props that fed the section went with it, not just its JSX.
      assert.doesNotMatch(homeScreenSource, /historyItems|onOpenHistory|onSelectHistorySession/);
      // The three BOXED accordions are gone (user 2026-08-23) and the lifts
      // render flat with no tap to see them. Warmup and recovery came back a
      // few hours later, as rows rather than cards: the reader kept the flat
      // look but wanted the two blocks reachable from it.
      assert.doesNotMatch(homeScreenSource, /openSections|sectionAnims|renderSection|SectionKey/);
      assert.doesNotMatch(homeScreenSource, /styles\.secCard|styles\.secBtn|styles\.secBody/);
      // The reader's own drill picks travel in with the block (user
      // 2026-08-31: "myös warmupliikkeitä voi vaihtaa"). Built without them,
      // a swap would render for one frame and vanish on the next rebuild.
      assert.match(
        homeScreenSource,
        /getDefaultWarmup\(focusKind, language, availableEquipment, routineDrillOverrides\)/,
      );
      assert.match(
        homeScreenSource,
        /getDefaultCooldown\(focusKind, language, availableEquipment, routineDrillOverrides\)/,
      );
      // And the swap writes through a slot key, never through a drill's name.
      assert.match(homeScreenSource, /routineDrillSlotKey\(drillSwap\.kind, focusKind, drillSwap\.index\)/);
      // One open at a time, and closed to start: the lifts are the decision.
      assert.match(homeScreenSource, /useState<'warmup' \| 'cooldown' \| null>\(null\)/);
      // The header row inside a phase card: no fill and no radius of its
      // own (the card carries those), and no top border — the row is always
      // the card's first child, and a hairline there doubled the card edge.
      // Tall on purpose (user 2026-08-30): next to the hero the three
      // headers read as the session's acts, not as footnotes.
      // Bounded to the block's own braces — an unbounded [\s\S]*? runs past
      // the closing brace and reports whatever the next style happens to say.
      const blockRow = /blockRow:\s*\{([^}]*)\}/.exec(homeScreenSource);
      assert.ok(blockRow, 'blockRow style not found');
      assert.doesNotMatch(blockRow[1], /borderTopWidth|borderRadius|backgroundColor/);
      assert.match(homeScreenSource, /styles\.heroList, rise\(RISE_SEC_BASE\)/);
      // The workout header wears the SAME styles as Warmup and Recovery —
      // equal height by shared anatomy, not by three numbers agreeing
      // (user 2026-08-30: the three rows drifted apart in size).
      assert.match(
        homeScreenSource,
        /styles\.blockMeta[\s\S]{0,160}'home\.section\.workoutMeta'[\s\S]{0,260}totalExerciseCount[\s\S]{0,200}totalSets/,
      );
      assert.doesNotMatch(homeScreenSource, /heroListMetaRow|heroListTitle|heroListMeta[^R]/);
      // The lifts' fold row is titled like its neighbours — "Treeni" between
      // Lämmittely and Palautuminen, counts beside it (user 2026-08-25).
      // Since the phase cards (design frame 03) the title also turns violet
      // while its card is open, so the style is an array now.
      assert.match(
        homeScreenSource,
        /styles\.blockTitle, workoutListOpen && styles\.sectTitleOpen\]/,
      );
      // One anatomy for all three phases: warmup, workout and recovery share
      // it, and the violet title marks whichever one is open.
      //
      // Not cards any more (user, 2026-09-09). They were bordered, filled,
      // rounded boxes inside the day's own bordered box, and the rows inside
      // them were already separated by hairlines. The day's box went too. What
      // is left is a hairline above each phase, so the guard is that the phase
      // grows no rule, fill, border or radius of its own: space separates them.
      assert.doesNotMatch(homeScreenSource, /sectCard: \{[^}]*(borderRadius|backgroundColor|border[A-Za-z]*Width)/);
      // The titles carry the structure instead, so they are big.
      assert.match(homeScreenSource, /fontSize: 20,\s+lineHeight: 26,/);
      assert.doesNotMatch(homeScreenSource, /sectCardOpen|sectStripe/);
      // And the day is flat on the page: padding and margin, no frame.
      assert.doesNotMatch(homeScreenSource, /sessionBox: \{[^}]*(borderWidth|borderRadius|backgroundColor)/);
      // And the promo carousel went with them: Home runs today's session, the
      // season and programme offers live on their own screens.
      assert.doesNotMatch(homeScreenSource, /HomePromoCarousel|promoSlides/);
      assert.match(homeScreenSource, /planExerciseNumberChip:\s*\{\s*width: 25,\s*height: 25/);
      assert.match(homeScreenSource, /planExerciseScheme:\s*\{[\s\S]*fontFamily: 'JetBrainsMono'/);
      assert.match(homeScreenSource, /exercise\.schemeLabel \?\? exercise\.setsLabel/);
      // Inline Start row, no floating bar. Adapt stood beside it until
      // 2026-08-30 and is gone with its sheet: dropping the programme and
      // rebuilding it already live in the programme's own screen, and the
      // short version was answering a question the player answers set by set.
      assert.doesNotMatch(homeScreenSource, /adaptButton|adaptSheetVisible|onStartTrimmedSession/);
      // Start workout is a FILLED play button now (user 2026-08-25, after a
      // tester tapped the first exercise to "check it off" — the outline
      // version below the list read as one row among many).
      assert.match(homeScreenSource, /startButton:\s*\{\s*height: 52/);
      assert.match(homeScreenSource, /fill=\{theme\.accent\}[\s\S]{0,160}style=\{styles\.startButton\}/);
      // The play mark sits in a ring since the CTA design (2026-08-26): a
      // mark with an edge reads as a target, and the shimmer needs something
      // to pass behind. Still a triangle, still filled with the on-accent ink.
      // Centred on the triangle's CENTROID (base 8.5, apex 18.5 → 11.83, the
      // viewBox middle), not its bounding box: boxed by its extents the mark
      // sat visibly right of its circle (user 2026-08-26).
      assert.match(homeScreenSource, /M8\.5 5\.5v13l10-6\.5z/);
      assert.doesNotMatch(homeScreenSource, /startPlayRing:[\s\S]{0,220}paddingLeft/);
      assert.match(homeScreenSource, /styles\.startPlayRing/);
      assert.match(homeScreenSource, /<CtaShimmer/);
      // The start CTA reads `accent`, not `green`: green also means "done"
      // (completed sets, finished cardio), and the dark theme moves the action
      // accent to orange without moving those. Its text sits ON the fill.
      assert.match(homeScreenSource, /startButtonText:\s*\{\s*color: theme.onHighlight/);
      // The hero button says "Start workout" only when there is a session to
      // start. With no programme it used to promise one anyway and open an empty
      // workout — the same thing the row below it already offers — so the label
      // and the action now both switch to finding a programme. And with a
      // workout already in progress it says so: the tap resumed it all along,
      // but the label read "Aloita treeni" over a session left mid-warm-up.
      assert.match(homeScreenSource, /hasActiveSession\s*\?\s*'home\.resumeWorkout'\s*:\s*'home\.startWorkout'/);
      assert.match(homeScreenSource, /:\s*'home\.findProgram'/);
      assert.match(homeScreenSource, /const heroStartsSession = Boolean\(nextPlanSession\)/);
      assert.match(i18nSource, /'home\.resumeWorkout': 'Resume workout'/);
      assert.match(i18nSource, /'home\.resumeWorkout': 'Jatka treeniä'/);
      assert.match(shellSource, /hasActiveSession=\{isWorkoutInProgress\(workout\.activeSession\)\}/);
      assert.match(homeScreenSource, /if \(!nextPlanSession && onFindProgram\)/);
      assert.match(i18nSource, /'home\.startWorkout': 'Start workout'/);
      assert.match(i18nSource, /'home\.findProgram': 'Find a program'/);
      // It PUSHES. navigateToTab resets history, which is right for the bar —
      // a tab is where you start — and wrong for a button inside a screen: it
      // left the reader on Programs with nothing behind them, so the next Back
      // closed the app instead of returning Home.
      assert.match(shellSource, /onFindProgram=\{\(\) => navigate\(resolveTabRoute\('workout'\)\)\}/);
      assert.doesNotMatch(shellSource, /onFindProgram=\{\(\) => navigateToTab/);
      // Adapt is gone, whole (user 2026-08-30). Of its three rows, dropping the
      // programme and rebuilding it both already live in the programme's own
      // screen — doing them from Home was a second door onto the same
      // decision — and the short version was answering before you leave the
      // house a question the player now answers set by set. The trim estimate
      // that fed it went with it: it had exactly one reader.
      assert.doesNotMatch(homeScreenSource, /adaptSheet\.|adaptTrim|onStartTrimmedSession|onRedoOnboarding|onRemoveActivePlan/);
      assert.doesNotMatch(shellSource, /previewSessionTrim|onStartTrimmedSession|onRedoOnboarding=/);
      assert.doesNotMatch(i18nSource, /'home\.adapt'|'home\.adaptSheet\./);
      // Home still must not compute a session preview for itself: it sees only
      // the first five exercises, which is why the estimate lived in App.tsx.
      assert.doesNotMatch(homeScreenSource, /previewSessionTrim|getAdaptTrimEstimate/);
      // Hero + accordions render only with an active plan.
      assert.match(homeScreenSource, /\{activePlan && nextPlanSession \? \(/);
      // The Home pro sheet is gone (GAINER Paywall Moments): the PRO pill
      // opens the one full Pro page, and Home's paywall moment is the plateau
      // card whose blurred conclusion is the real text from proInsights.
      assert.doesNotMatch(homeScreenSource, /proSheetVisible|PRO_STATS|PRO_COMPARISON/);
      // The PRO pill is gone from the header, so this is now the only place
      // Home reaches the Pro page: the plateau moment's sheet. The prop and
      // the route stay — twelve other surfaces use them.
      assert.match(homeScreenSource, /onSeePro=\{\(\) => \{[\s\S]{0,120}onOpenPremium\?\.\(\);/);
      assert.match(homeScreenSource, /pro\.plateau\.eyebrow/);
      assert.match(homeScreenSource, /<ProLockedCard/);
      assert.match(homeScreenSource, /<ProMomentSheet/);
      assert.match(homeScreenSource, /t\(language, 'home\.emptyWorkout\.title'\)/);
      assert.match(i18nSource, /'home\.emptyWorkout\.title': 'Empty workout'/);
      // The row's title and its icon, and nothing else. The right-hand caption
      // ("Log freestyle" beside "Empty workout") and the section heading over
      // the pair both went — "jätä vain +Tyhjä treeni ja Cardio + ikonit"
      // (#bugs 2026-09-05).
      assert.doesNotMatch(homeScreenSource, /home\.emptyWorkout\.meta/);
      assert.doesNotMatch(homeScreenSource, /home\.cardio\.meta/);
      assert.doesNotMatch(homeScreenSource, /home\.logElse/);
      assert.doesNotMatch(i18nSource, /'home\.emptyWorkout\.meta'/);
      assert.match(homeScreenSource, /emptyWorkoutRow/);
      assert.match(homeScreenSource, /emptyWorkoutRow:\s*\{[\s\S]*backgroundColor: theme.surface/);
      assert.match(homeScreenSource, /name="plus" color=\{theme.highlight\} size=\{20\}/);
      assert.doesNotMatch(homeScreenSource, /Jump into an empty workout/);
      assert.doesNotMatch(homeScreenSource, /startWorkoutHero/);
      assert.match(homeScreenSource, /onPress=\{onCreateWorkoutFromExercises\}/);

      // Routines section (Templates + Explore shortcut cards) removed from Home —
      // ready templates / programs live in the Programs tab now. Empty workout stays.
      assert.doesNotMatch(homeScreenSource, /routineShortcut/);
      assert.doesNotMatch(homeScreenSource, /onOpenTemplatesHub/);
      assert.doesNotMatch(homeScreenSource, /onBrowseReadyPlans/);
      assert.doesNotMatch(homeScreenSource, /readyTemplateCount/);
      assert.doesNotMatch(homeScreenSource, />Routines</);
      assert.doesNotMatch(homeScreenSource, /My Routines/);
      assert.match(workoutsScreenSource, /const \[showReadyLibrary, setShowReadyLibrary\] = useState\(true\)/);
      assert.match(workoutsScreenSource, /const \[showBrowseWorkouts, setShowBrowseWorkouts\] = useState\(true\)/);
      assert.match(workoutsScreenSource, /const \[readyEquipmentFilter, setReadyEquipmentFilter\] = useState<ReadyEquipmentFilter>\('all'\)/);
      assert.doesNotMatch(shellSource, /readyTemplateCount/);
      // Family-sectioned browse: every ready template is bucketed into one family section.
      assert.match(workoutsScreenSource, /const readySectionItems = new Map<string, ReadyDiscoveryItem\[\]>\(\)/);
      assert.match(workoutsScreenSource, /READY_FAMILY_SECTIONS\.find\(\(candidate\) => candidate\.match\(item\)\)/);
      assert.doesNotMatch(workoutsScreenSource, /tpl_gainer_'\)\)/);
      assert.match(workoutsScreenSource, /title=\{t\(language, 'tabs\.programs'\)\}/);
      // This used to assert `tone="dark"` on the header, because ScreenHeader
      // defaulted to near-white legacy text that vanished on a light screen.
      // The prop is gone and the header always reads from the shared palette,
      // so the guard now protects that instead — reintroducing a tone prop
      // would bring the trap back.
      const screenHeaderSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'ScreenHeader.tsx'),
        'utf8',
      );
      assert.doesNotMatch(screenHeaderSource, /tone\?:/);
      assert.doesNotMatch(screenHeaderSource, /from '\.\.\/theme'[\s\S]*colors/);
      // First component on the theme hook. Reading from the active theme is a
      // stronger version of the old guard — it cannot be a local hex, and it
      // cannot be a palette constant frozen at module load either.
      assert.match(screenHeaderSource, /useThemedStyles\(makeStyles\)/);
      assert.match(screenHeaderSource, /const makeStyles = \(theme: Theme\)/);
      assert.match(screenHeaderSource, /color: theme\.ink/);
      assert.match(workoutsScreenSource, /t\(language, 'ready\.searchPlaceholder'\)/);
      assert.match(workoutsScreenSource, /MagnifyingGlass/);
      assert.match(workoutsScreenSource, /SlidersHorizontal/);
      assert.match(workoutsScreenSource, /showAdvancedReadyFilters/);
      assert.match(workoutsScreenSource, /READY_GOAL_FILTERS/);
      const readyGoalFilterBlock = workoutsScreenSource.slice(
        workoutsScreenSource.indexOf('const READY_GOAL_FILTERS'),
        workoutsScreenSource.indexOf('const READY_TIME_FILTERS'),
      );
      assert.ok(
        readyGoalFilterBlock.indexOf("labelKey: 'facet.all'") <
          readyGoalFilterBlock.indexOf("labelKey: 'ready.goal.fatLoss'"),
        'all should be the first visible goal filter',
      );
      assert.ok(
        readyGoalFilterBlock.indexOf("labelKey: 'ready.goal.fatLoss'") <
          readyGoalFilterBlock.indexOf("labelKey: 'ready.goal.strength'"),
        'fat loss should sit before strength in the ready-template goal carousel',
      );
      assert.match(workoutsScreenSource, /t\(language, 'ready\.filterTemplates'\)/);
      assert.match(workoutsScreenSource, /t\(language, 'progress\.metric\.duration'\)/);
      assert.match(workoutsScreenSource, /t\(language, 'myData\.equipment'\)/);
      assert.match(workoutsScreenSource, /t\(language, 'myData\.experience'\)/);
      assert.match(i18nSource, /'ready\.filterTemplates': 'Filter templates'/);
      assert.match(workoutsScreenSource, /READY_TIME_FILTERS\.map/);
      assert.match(workoutsScreenSource, /READY_EQUIPMENT_FILTERS\.map/);
      assert.match(workoutsScreenSource, /READY_LEVEL_FILTERS\.map/);
      assert.match(workoutsScreenSource, /snapToInterval=\{116\}/);
      assert.match(workoutsScreenSource, /readyTemplateFilterChip:\s*\{[\s\S]*minWidth: 104/);
      assert.match(workoutsScreenSource, /READY_FAMILY_SECTIONS/);
      assert.match(workoutsScreenSource, /titleKey: 'ready\.section\.women'/);
      assert.match(workoutsScreenSource, /titleKey: 'ready\.section\.focus'/);
      assert.match(workoutsScreenSource, /titleKey: 'ready\.goal\.strength'/);
      assert.match(workoutsScreenSource, /titleKey: 'ready\.section\.muscle'/);
      assert.match(workoutsScreenSource, /titleKey: 'ready\.goal\.fatLoss'/);
      assert.match(workoutsScreenSource, /titleKey: 'ready\.section\.home'/);
      assert.match(i18nSource, /'ready\.section\.women': "Women's programs"/);
      assert.match(i18nSource, /'ready\.section\.home': 'Home & minimal equipment'/);
      assert.match(workoutsScreenSource, /readyCategorySections/);
      assert.match(workoutsScreenSource, /readyTemplateCategoryList/);
      assert.match(workoutsScreenSource, /readyTemplateCarousel/);
      assert.match(workoutsScreenSource, /readyTemplateScrollHint/);
      assert.match(workoutsScreenSource, /snapToInterval=\{232\}/);
      assert.match(workoutsScreenSource, /readyTemplateCard/);
      assert.match(workoutsScreenSource, /width: 220/);
      assert.match(workoutsScreenSource, /READY_TEMPLATE_CARD_IMAGE/);
      assert.match(workoutsScreenSource, /ready-template-card\.jpg/);
      assert.match(workoutsScreenSource, /ImageBackground/);
      assert.match(workoutsScreenSource, /readyTemplateHero/);
      assert.match(workoutsScreenSource, /readyTemplateHeroBadge/);
      assert.match(workoutsScreenSource, /Lightning/);
      assert.match(workoutsScreenSource, /CalendarBlank/);
      assert.match(workoutsScreenSource, /Clock/);
      assert.match(workoutsScreenSource, /ready\.startPlan/);
      assert.match(i18nSource, /'ready\.startPlan': 'Start Plan'/);
      assert.doesNotMatch(workoutsScreenSource, /readyTemplateSummary/);
      assert.doesNotMatch(workoutsScreenSource, /formatTemplateSubtitle/);
      assert.doesNotMatch(workoutsScreenSource, /Next: \{firstExercise\}/);
      // The per-screen `*Active` flag was never read once the shell defaulted
      // to light (below), and went with the other dead ones (#bugs 2026-10-01).
      assert.doesNotMatch(appSource, /const readyTemplatesActive =/);
      // The safe area must match the content it frames. App.tsx used to
      // enumerate every light screen to achieve that, and any screen left off
      // the list fell through to the legacy dark theme — which is how Home got
      // a navy status bar. The shell now defaults to light and only the
      // gradient-hero screens opt out, so the guard lives on the default.
      const appShellSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'AppShell.tsx'),
        'utf8',
      );
      assert.match(appShellSource, /shellBackgroundColor \?\? theme\.bg/);
      // Status-bar icons follow the theme now; only gradient heroes override.
      assert.match(appShellSource, /statusBarStyleOverride \?\? \(themeName === 'dark' \? 'light' : 'dark'\)/);
      // The composer screen's own shell tint went with the screen (user
      // 2026-08-26, "koostajaruudun voi poistaa").
      assert.doesNotMatch(shellSource, /aiSetupActive/);
      assert.doesNotMatch(workoutsScreenSource, /Search for programs/);
      assert.doesNotMatch(workoutsScreenSource, /{activeSession \?/);
      assert.doesNotMatch(homeScreenSource, /YOUR PLAN/);
      assert.doesNotMatch(homeScreenSource, /planWeekLabel/);
      assert.doesNotMatch(homeScreenSource, /activePlan\?\.weekLabel/);
      assert.doesNotMatch(homeScreenSource, /activePlan \? 'Week 3 of 8'/);
      assert.doesNotMatch(homeScreenSource, /activePlan \? 42/);
      // The hero's numbers, read off the card itself.
      const heroCard = heroCardSource();
      assert.match(heroCard, /weekLabel: planProgress\.weekLabel/);
      assert.match(heroCard, /progressPercent: planProgress\.progressPercent/);
      // v4 hero data comes from real stores: plan-wide session counts, week
      // position, split focus, and library-derived equipment.
      assert.match(heroCard, /sessionsDone: planProgress\.sessionsDone/);
      assert.match(heroCard, /sessionsTotal: planProgress\.sessionsTotal/);
      assert.match(heroCard, /currentWeek: planProgress\.currentWeek/);
      assert.match(heroCard, /planTotalWeeks: planProgress\.totalWeeks/);
      // The hero's focus label used to come from the recommendation fallback,
      // which impersonated an active plan whenever the reader had none: it
      // hid a removed programme, an entry-less plan, and it started sessions
      // against a programme nobody had adopted. The plan branch is the only
      // source now, and a reader with no plan gets Home's no-plan state.
      assert.doesNotMatch(shellSource, /recommendedReadyTemplate\.splitType/);
      assert.match(heroCard, /focusLabel: getSessionBodyFocusLabel\(/);
      // The rotation reads the programme's history, not one template record's:
      // a copy made by editing a lift carries new day ids, and the rotation
      // found no match at all and offered day 1 to a reader who trained day 3
      // yesterday (2026-09-16).
      assert.match(
        heroCard,
        /const completedForTemplate = completedSessionsForTemplate\(firstEntry\.workoutTemplateId, completedPlanSessions\);\s*const nextSessionIndex = resolveNextPlanEntryIndex\(sortedEntries, completedForTemplate\);/,
      );
      // "Trained today" for the calendar forecast counts this plan's sessions
      // by the rotation's own match, not any workout logged today (recheck of
      // #224, 2026-09-28).
      assert.match(heroCard, /trainedToday: planTrainedOnDay\(sortedEntries, completedForTemplate, todayDayStart\),/);
      assert.match(heroCard, /equipmentLabel: buildSessionEquipmentLabel\(/);
      assert.match(heroCard, /totalSets: session\.exercises\.reduce/);
      assert.doesNotMatch(homeScreenSource, /planChartBars/);
      assert.doesNotMatch(homeScreenSource, /View plan/);
      assert.doesNotMatch(homeScreenSource, /VIEW PLAN/);
      assert.doesNotMatch(homeScreenSource, /yourPlanCard/);
      assert.doesNotMatch(homeScreenSource, /yourPlanProgressTrack/);
      assert.doesNotMatch(homeScreenSource, /yourPlanProgressFill/);
      assert.doesNotMatch(homeScreenSource, /yourPlanChartBar/);
      assert.doesNotMatch(homeScreenSource, /viewPlanButton/);
      // v3 is boxless: no full-bleed hero card; interactive rows get the
      // shared pressed-scale feedback.
      assert.doesNotMatch(homeScreenSource, /fullBleedCard/);
      assert.match(homeScreenSource, /pressed:\s*\{\s*transform: \[\{ scale: 0\.95 \}\]/);
      assert.match(homeScreenSource, /style=\{\(\{ pressed \}\) => \[styles\.emptyWorkoutRow, pressed && styles\.pressed\]\}/);
      // v3 kept the plan off Home entirely. That reversed once the active
      // program moved here from the Programs tab: the block above is today,
      // and this is the block today belongs to. Programs is for FINDING a
      // program; Home is for running one, and only one screen owns it.
      assert.match(homeScreenSource, /onPress=\{onOpenActivePlan\}/);
      assert.match(homeScreenSource, /t\(language, 'programs\.activeProgram'\)/);
      // The week's walk feeds the strip's accessibility line — the five day
      // cards became a compact week strip (design frame 15), and the line
      // reads the same days the chips draw (2026-09-26).
      assert.match(homeScreenSource, /accessibilityLabel=\{programWeek\s*\n?\s*\.flatMap/);
      // ONE action: see the plan. "Edit days" went with frame 04 — the
      // schedule editor lives on the plan screen this button opens.
      assert.match(homeScreenSource, /t\(language, 'programs\.viewPlan'\)/);
      assert.doesNotMatch(homeScreenSource, /programs\.editDays/);
      // The weekday rule is shared, not copied. Two screens with their own
      // opinion about the same week is the bug that rule exists to prevent.
      assert.match(homeScreenSource, /from '\.\.\/lib\/planWeekdays'/);
      assert.doesNotMatch(homeScreenSource, /const TRAINING_DAY_SPREAD/);
      assert.doesNotMatch(homeScreenSource, /<Text style=\{styles\.myRoutineLabel\}>My Routine<\/Text>/);
      assert.doesNotMatch(homeScreenSource, /style=\{styles\.myRoutineCard\}/);
      assert.match(homeScreenSource, /home\.emptyWorkout\.title/);
      assert.doesNotMatch(homeScreenSource, /Quick Access/);
      assert.doesNotMatch(homeScreenSource, /Recent Sessions/);
      assert.doesNotMatch(homeScreenSource, /recentSessions/);
      assert.doesNotMatch(homeScreenSource, /recentSessionsSection/);
      assert.doesNotMatch(homeScreenSource, /recentSessionCard/);
      assert.doesNotMatch(homeScreenSource, /No sessions yet/);
      assert.doesNotMatch(homeScreenSource, /recentSessionEmptyButton/);
      assert.doesNotMatch(homeScreenSource, /recentSessionEmptyButtonText/);
      assert.doesNotMatch(homeScreenSource, /onOpenSessionHistory/);
      assert.doesNotMatch(homeScreenSource, /onOpenRecentSession/);
      assert.doesNotMatch(homeScreenSource, /onOpenProgressOverview/);
      assert.doesNotMatch(homeScreenSource, /onOpenTrackedProgress/);
      assert.doesNotMatch(homeScreenSource, /onOpenBodyStats/);
      assert.doesNotMatch(homeScreenSource, /Body Stats/);
      assert.doesNotMatch(homeScreenSource, /PR Tracker/);
      assert.doesNotMatch(homeScreenSource, /<Text style=\{styles\.quickAccessText\}>History<\/Text>/);
      assert.doesNotMatch(homeScreenSource, /onOpenAICoach\('Open body stats'\)/);

      assert.doesNotMatch(homeScreenSource, /Weekly overview/);
      assert.doesNotMatch(homeScreenSource, /At a glance/);
      assert.doesNotMatch(homeScreenSource, /Daily tip/);
      assert.doesNotMatch(homeScreenSource, /HOME_RECOVERY_BACKGROUND_IMAGE/);
      assert.doesNotMatch(homeScreenSource, /HOME_TRAINING_BACKGROUND_IMAGE/);
      assert.doesNotMatch(homeScreenSource, /ImageBackground/);

      assert.ok(
        homeScreenSource.indexOf('styles.headerRow') < homeScreenSource.indexOf('styles.weekCard'),
        'header should render before the week card',
      );
      // 'styles.hero,' with the comma: bare 'styles.hero' would match the
      // heroProg counter, which lives up on the date row now.
      assert.ok(
        homeScreenSource.indexOf('styles.weekCard') < homeScreenSource.indexOf('styles.hero,'),
        'week card should render before the session hero',
      );
      assert.ok(
        homeScreenSource.indexOf('styles.hero,') < homeScreenSource.indexOf('styles.heroList'),
        'session hero should render before its flat exercise list',
      );
      // The CTA row renders BEFORE the exercise list (user report 2026-08-25):
      // below it, a tester never found the start button and tapped the first
      // exercise instead.
      assert.ok(
        homeScreenSource.indexOf('styles.btnRow') < homeScreenSource.indexOf('styles.heroList'),
        'the Adapt/Start row should render before the exercise list',
      );
      assert.ok(
        homeScreenSource.indexOf('styles.btnRow') < homeScreenSource.indexOf('styles.emptyWorkoutRow'),
        'Adapt/Start row should render before the empty workout row',
      );
      // The assembly layer may not abbreviate: a 20-char cap with hand-added
      // dots in formatHomeSessionTitle cut "Day 1: Full Body + H|IIT" at the
      // H, and the cut rode through translation onto every surface. Screens
      // own their own numberOfLines; the card hands over the full name.
      // The helper moved to src/app in the phase-A split (2026-08-26).
      const titleHelper = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'app', 'homeSessionTitle.ts'),
        'utf8',
      );
      assert.ok(titleHelper.includes('function formatHomeSessionTitle'), 'formatHomeSessionTitle should exist');
      assert.doesNotMatch(titleHelper, /slice\(0|\.\.\.`|…/, 'the session title must never be abbreviated at assembly');
      assert.match(shellSource, /activePlan=\{homeActivePlanCard\}/);
      // The recent-sessions memo, bounded to itself: an unbounded
      // [\s\S]* over the file could pair a spread here with a sort anywhere
      // below it. It left App.tsx for useRecentSessions (phase-C split,
      // 2026-10-01), so it is found in the shell.
      const recentSessionsMemo = between(
        shellSource,
        'const homeRecentSessions = useMemo',
        '[getSessionLogs, preferences.appLanguage, unitPreference, workoutSessions],',
      );
      assert.match(recentSessionsMemo, /\[\.\.\.workoutSessions\]\s*\.sort\(/);
      assert.match(recentSessionsMemo, /\.slice\(0, 3\)/);
      /*
       * The props Home must not be handed are read off the <HomeScreen element
       * alone, found in the one shell file that renders it (homeScreenElement).
       * A `<HomeScreen[\s\S]*` over the concatenation would run on past it into
       * the progress tab, where ProgressScreen is handed recentSessions on
       * purpose. The element is rendered once, and none of its props renders
       * JSX, so the first `/>` after the tag is its own; balanced braces say the
       * slice did not stop inside a prop.
       */
      const homeElement = homeScreenElement();
      assert.equal(homeElement.split('{').length, homeElement.split('}').length, 'the slice stopped inside a prop of <HomeScreen>');
      assert.match(homeElement, /activePlan=\{homeActivePlanCard\}/);
      assert.doesNotMatch(homeElement, /<HomeScreen[\s\S]*recentSessions=\{homeRecentSessions\}/);
      // The ProgressScreen call moved to src/app with the progress tab
      // (phase A) — the recent-sessions pin follows it there.
      assert.match(
        require('node:fs').readFileSync(
          require('node:path').join(__dirname, '..', '..', 'src', 'app', 'renderProgressTab.tsx'),
          'utf8',
        ),
        /<ProgressScreen[\s\S]*recentSessions=\{homeRecentSessions\}/,
      );
      assert.doesNotMatch(shellSource, /customTemplates=/);
      assert.match(
        shellSource,
        /onCreateWorkoutFromExercises=\{\(\) =>\s*guardStrengthStartOverCardio\(\(\) => navigate\(\{ tab: 'workout', screen: 'empty' \}\)\)\s*\}/,
      );
      assert.doesNotMatch(shellSource, /onCreateWorkoutFromExercises=\{\(\) => navigate\(\{ tab: 'workout', screen: 'editor' \}\)\}/);
      assert.doesNotMatch(shellSource, /onBrowseReadyPlans=/);
      assert.doesNotMatch(homeElement, /<HomeScreen[\s\S]*onOpenProgressOverview=/);
      assert.doesNotMatch(homeElement, /<HomeScreen[\s\S]*onOpenTrackedProgress=/);
      assert.doesNotMatch(homeElement, /<HomeScreen[\s\S]*onOpenBodyStats=/);
      // Wired in the progress module since phase A — read the whole wiring.
      const wiringSource = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(wiringSource, /onOpenSessionHistory=\{\(\) => navigate\(\{ tab: 'home', screen: 'history' \}\)\}/);
      assert.match(wiringSource, /onOpenRecentSession=\{\(sessionId\) => navigate\(\{ tab: 'home', screen: 'session', sessionId \}\)\}/);
      assert.doesNotMatch(shellSource, /onOpenAICoach=\{handleOpenAICoach\}/);

      assert.match(routesSource, /screen: 'empty'/);
      // workout/empty renders the dedicated HG freestyle screen; the editor
      // keeps its own branch and no longer has an emptyWorkout presentation.
      // The branches live in renderWorkoutTab since phase A, where the tab
      // guard is hoisted and each screen keeps its own if.
      const workoutTabSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'app', 'renderWorkoutTab.tsx'),
        'utf8',
      );
      assert.match(workoutTabSource, /if \(route\.screen === 'empty'\)/);
      // The editor is gone: nothing could reach it (audit 3, 2026-09-20).
      assert.doesNotMatch(workoutTabSource, /route\.screen === 'editor'/);
      assert.match(workoutTabSource, /<EmptyWorkoutScreen/);
      assert.doesNotMatch(shellSource, /presentation=/);
      assert.doesNotMatch(workoutTabSource, /presentation=/);
      // The inline tip is gone entirely. It used to be passed as null from both
      // call sites, which meant a dark-themed card that could never render —
      // this guard pinned the null; now it pins the absence.
      assert.doesNotMatch(shellSource, /inlineTip/);
      assert.doesNotMatch(shellSource, /Start with the main lift first/);
      assert.doesNotMatch(shellSource, /WORKOUT_EDITOR_TIP_ID/);
      // The freestyle screen speaks the HG/AW3 language: empty state, add
      // sheet, shared set table with plate readout and the floating rest bar.
      assert.match(emptyWorkoutScreenSource, /emptyWorkout\.empty\.title/);
      assert.match(emptyWorkoutScreenSource, /emptyWorkout\.stat\.tag/);
      assert.match(emptyWorkoutScreenSource, /emptyWorkout\.recent/);
      assert.match(emptyWorkoutScreenSource, /emptyWorkout\.popular/);
      assert.match(i18nSource, /'emptyWorkout\.empty\.title': 'Nothing logged yet'/);
      assert.match(i18nSource, /'emptyWorkout\.stat\.tag': 'freestyle session'/);
      assert.match(emptyWorkoutScreenSource, /getPopularExerciseLibraryItems/);
      assert.match(emptyWorkoutScreenSource, /<RestBar/);
      assert.match(emptyWorkoutScreenSource, /<PlatePop/);
      assert.match(emptyWorkoutScreenSource, /buildFreestyleFinish/);
      assert.match(emptyWorkoutScreenSource, /useKeepScreenAwake\(keepScreenAwake, 'empty-workout'\)/);
      assert.match(emptyWorkoutScreenSource, /emptyWorkout\.finishWorkout/);
      assert.match(i18nSource, /'emptyWorkout\.finishWorkout': 'Finish workout'/);
      // Save-truthfulness: the finish handler awaits App's onSave and resets
      // the saving flag on failure instead of showing success early.
      assert.match(emptyWorkoutScreenSource, /await onSave\(draft, summary, adoptSessionId\);/);
      assert.match(emptyWorkoutScreenSource, /setIsSaving\(false\);/);
      // App-side: template + session persist before the summary route swap.
      // Bounded to the save itself, wherever the shell keeps it (it leaves
      // VinhaApp in the phase-C split, 2026-10-01).
      assert.match(functionBody(shellSource.replace(/\r\n/g, '\n'), 'const finishLoggedWorkoutSave = async'), /const workoutTemplateId = await upsertWorkoutTemplate\(draft\);[\s\S]*await saveCompletedWorkoutSession\(\{[\s\S]*summaryExitRouteRef\.current = ROOT_ROUTES\.home;[\s\S]*replaceRoute\(\{ tab: 'workout', screen: 'summary' \}\);/);

      assert.match(routesSource, /section\?: 'overview' \| 'records' \| 'tracked' \| 'measures'/);
      assert.match(progressScreenSource, /initialSection\?: ProgressSection/);
      assert.match(progressScreenSource, /recentSessions\?: HomeRecentSessionItem\[\]/);
      assert.match(progressScreenSource, /onOpenSessionHistory\?: \(\) => void/);
      assert.match(progressScreenSource, /onOpenRecentSession\?: \(sessionId: string\) => void/);
      assert.match(
        progressScreenSource,
        /<Text style=\{styles\.referenceCardTitle\}>\{t\(language, 'progress\.history'\)\}<\/Text>/,
      );
      assert.match(progressScreenSource, /recentSessions\.slice\(0, 3\)\.map/);
      assert.match(progressScreenSource, /progressHistoryCard/);
      assert.match(progressScreenSource, /onOpenRecentSession\?\.\(session\.id\)/);
      assert.match(progressScreenSource, /useState<ProgressSection>\(initialSection \?\? 'overview'\)/);
      assert.match(progressScreenSource, /useEffect\(\(\) => \{[\s\S]*setProgressSection\(initialSection\);[\s\S]*\}, \[initialSection\]\)/);
      // Wired in the progress module since phase A.
      assert.match(
        require('../helpers/appWiringSource.cjs').readAppWiring(),
        /initialSection=\{route\.screen === 'list' \? route\.section : undefined\}/,
      );

      // Bottom bar EXPERIMENT (dark floating pill): absolutely positioned so it
      // floats low over the content (no backdrop strip), a dark pill, a circular
      // highlight that slides between tabs, and a smaller Start button with a
      // purple halo (motion-aware).
      //
      // The pill stays a designed dark surface in both themes, but the active
      // tint follows the theme (2026-08-01) — violet in light, orange in dark,
      // alongside every other interactive element.
      assert.match(bottomTabBarSource, /shell:\s*\{\s*[\s\S]*position: 'absolute'/);
      // The fill moved onto CutSurface when the bar took the A3 shape
      // (2026-08-11): left in the style it would paint a rectangle behind the
      // cut path. Same default, asserted where it now lives.
      // Two bars, one per theme (user 2026-09-02): white with a hairline in
      // light, the soft dark surface in dark.
      // theme.surface IS the light theme's white; the second hex for the same
      // colour came off (review 2026-09-03).
      assert.match(bottomTabBarSource, /const pillBackground = themeName === 'dark' \? theme\.surfaceSoft : theme\.surface/);
      assert.match(bottomTabBarSource, /const pillStroke = themeName === 'dark' \? undefined : theme\.border/);
      assert.doesNotMatch(bottomTabBarSource, /lightPill/);
      assert.match(bottomTabBarSource, /<CutSurface size="lg" fill=\{pillBackground\} stroke=\{pillStroke\} strokeWidth=\{1\}/);
      assert.match(bottomTabBarSource, /activeTab: RootTabKey \| null/);
      assert.match(bottomTabBarSource, /activeKey === tab\.key/);
      assert.match(shellSource, /activeTab=\{route\.tab === 'workout' && route\.screen === 'plans' \? null : route\.tab\}/);
      assert.match(bottomTabBarSource, /const stroke = active \? theme\.highlight/);
      assert.match(bottomTabBarSource, /const fill = active \? theme\.highlight/);
      assert.match(bottomTabBarSource, /indicator:\s*\{[\s\S]*backgroundColor: theme\.highlightSoft/);
      assert.match(bottomTabBarSource, /borderRadius: HIGHLIGHT \/ 2/);
      assert.match(bottomTabBarSource, /Animated\.spring\(indicatorX/);
      // Icon-only tabs (labels removed), larger icons, a11y label preserved.
      assert.doesNotMatch(bottomTabBarSource, /sideLabel/);
      assert.match(bottomTabBarSource, /const size = 26/);
      assert.match(bottomTabBarSource, /accessibilityLabel=\{label\}/);
      // Center "AI" button (design_handoff_ai_button): radial fill + "AI" label +
      // purple halo/glow. Sized down from the 48px spec. In light the orb is deep
      // violet with a white label (user 2026-09-03, inverted from near-white with
      // violet text); dark keeps its dark orb with the orange label.
      assert.match(bottomTabBarSource, /const AI_SIZE = 46/);
      assert.match(bottomTabBarSource, />AI<\/Text>/);
      assert.match(bottomTabBarSource, /url\(#aiFill\)/);
      assert.match(bottomTabBarSource, /: \[theme\.purpleBright, theme\.purple, theme\.purpleDark\]/);
      assert.match(bottomTabBarSource, /const aiCircleBackground = aiDark \? '#1B1530' : theme\.purpleDark/);
      assert.match(bottomTabBarSource, /const aiLabelColor = aiDark \? theme\.highlight : theme\.onHighlight/);
      assert.doesNotMatch(bottomTabBarSource, /aiText:\s*\{[^}]*color:/);
      assert.match(bottomTabBarSource, /centerGlow:\s*\{[\s\S]*shadowColor: theme\.purpleBright/);
      assert.match(bottomTabBarSource, /aiCircle:\s*\{[\s\S]*width: AI_SIZE/);
      assert.match(bottomTabBarSource, /queryReduceMotion\(\)/);
      assert.match(bottomTabBarSource, /fabPop\.setValue\(1\)/);
      assert.match(bottomTabBarSource, /Easing\.bezier\(0\.3, 1\.3, 0\.5, 1\)/);
      assert.match(bottomTabBarSource, /delay: 500/);
      assert.match(bottomTabBarSource, /delay: 240/);
    },
  },
  {
    /**
     * TÄNÄÄN is a claim about the calendar.
     *
     * The row computed `const isToday = activePlan.nextSession?.id ===
     * session.id` — a variable named for the calendar and meaning "is next".
     * No clock came near it, so the badge followed the rotation and was right
     * only by coincidence.
     */
    name: 'the TODAY badge reads the calendar and the outline reads the plan',
    run() {
      // The rows now read the SCHEDULE'S projection, the same source the
      // strip lights its dots from — not the plan's stored weekday labels,
      // which survive a switch to a cycle untouched and kept saying MON/THU
      // under a six-day rotation (user, 2026-08-25).
      // From today on the names follow the rotation the hero offers
      // (forecastSlotOn, break round 2026-09-28); which days train is still
      // the schedule's.
      assert.match(
        homeScreenSource,
        /sessionForSlot\(planSessions, forecastSlotOn\(trainingSchedule, date, activePlan\?\.sessionForecast \?\? null\)\)/,
      );
      assert.doesNotMatch(homeScreenSource, /resolveSessionWeekday|hasFixedWeekdays/);
      // The five day cards became a compact strip (design frame 15), and the
      // strip asks the SCHEDULE which session a date owns — the same walk the
      // calendars do — never the plan's stored weekday labels.
      assert.match(homeScreenSource, /styles\.programWeekStrip/);
      assert.match(homeScreenSource, /\{programWeek\.map\(\(\{ date: monday, session \}, offset\) => \{/);
      assert.doesNotMatch(homeScreenSource, /const isToday = activePlan\.nextSession/);
    },
  },
  {
    /**
     * "Today is legs, not upper."
     *
     * The rotation decides what comes next in the programme and cannot know
     * what happened to the reader's day. Before this, the only way to train
     * something else was to leave Home for the programme screen and start a
     * session from the list there.
     */
    name: "today's workout can be changed from the title, for one day only",
    run() {
      // The title is the switch: a reader looking at the wrong workout reaches
      // for its name first.
      assert.match(homeScreenSource, /onPress=\{\(\) => setTodaySheetVisible\(true\)\}/);
      // On the sheet kit the tap picks a DRAFT and the commit bar writes:
      // "Do this today" is the only press that calls the handler.
      assert.match(homeScreenSource, /onPickTodaySession\?\.\(todayPickDraft\)/);
      assert.match(homeScreenSource, /setTodayPickDraft\(\(current\)/);
      // One session is not a choice.
      assert.match(homeScreenSource, /planSessions\.length < 2/);

      // Dated, not sticky. A pick that outlived its day would quietly replace
      // the programme's rotation with one session forever. It carries the
      // instant too, which is what tells a stale pick from a deliberate
      // repeat — see lib/todaySessionPick and its suite.
      const handlerStart = appSource.indexOf('async function handlePickTodaySession(');
      assert.ok(handlerStart > 0, 'handlePickTodaySession not found');
      const handler = appSource.slice(handlerStart, handlerStart + 800);
      assert.match(handler, /todaySession: \{/);
      assert.match(handler, /dayStart:/);
      assert.match(handler, /pickedAt: now\.getTime\(\)/);

      // And the card asks the rule rather than restating it — the card
      // itself, wherever in the shell it is built.
      assert.match(heroCardSource(), /resolveTodaySessionPick\(\{/);

      // The pencil is offered only where a rename can actually land: the
      // catalog's templates are immutable at runtime.
      assert.match(
        shellSource,
        /homeActivePlanCard\?\.programType === 'custom'\s*\r?\n\s*\? \(sessionId, name\) =>/,
      );
    },
  },

  {
    /**
     * The week list carried two chips that predicted — TÄNÄÄN from the
     * calendar, SEURAAVAKSI from the rotation — and on any day those differ the
     * reader has to work out which one the row's outline meant. Asked for
     * 2026-08-21: show what was done instead.
     */
    name: 'the week list reports what happened rather than predicting',
    run() {
      assert.doesNotMatch(homeScreenSource, /'programs\.today'/);
      assert.doesNotMatch(homeScreenSource, /t\(language, 'plan\.upNext'\)\s*\}/);
      // The strip still REPORTS: a chip goes green only when its session was
      // trained this week — the fact the old "Tehty" pill stated, one glyph
      // smaller. (The pill's own key rendered nowhere once the chip replaced
      // it and left the dictionary on 2026-09-08.)
      assert.match(homeScreenSource, /doneThisWeekSessionIds\.includes\(session\.id\)/);
      assert.match(homeScreenSource, /programWeekDayDone/);

      // And the hero carries no label of its own: the answer to a name being
      // misread turned out to be fewer words, not better ones.
      assert.doesNotMatch(homeScreenSource, /'home\.hero\.nextUp'/);
      assert.doesNotMatch(homeScreenSource, /'home\.hero\.loggedToday'/);
    },
  },

  {
    name: 'an unknown training week asks for the days instead of guessing them',
    run() {
      // setupAvailableDays is only written when the user explicitly picks
      // weekdays: the ready-program path never asks, and neither does the
      // guided path when the app is left to decide. That left the calendar,
      // the week strip and the home widget blank with no route to fill them.
      // Four writers, on purpose: onboarding, the weekday picker, the reset,
      // and the rhythm strip on the programme screen — the last one added when
      // the two halves of the week were joined, so moving a day there moves the
      // reminders too. None of them fills an unknown week without being asked.
      // Counted over the whole shell (App.tsx and src/app), so a writer added
      // in a hook is counted too.
      const writes = shellSource.match(/setupAvailableDays: [^,\r\n]+/g) ?? [];
      assert.ok(
        writes.length <= 4,
        'a new setupAvailableDays writer appeared — check whether the empty-week prompt is still needed',
      );

      // The blank asks the question. It must never answer it: deriving
      // Mon/Wed/Fri from "3 a week" is the invention the dots exist to avoid.
      assert.match(homeScreenSource, /home\.calendar\.setDays/);
      assert.match(homeScreenSource, /onSetTrainingDays/);
      // editSchedule: true, because landing on a read-only schedule with an
      // Edit button is not what "Pick your training days" promised. The
      // receiving end moved to src/app with the profile tab (phase A), so it
      // is read from the whole wiring, not App.tsx alone. The sending end is
      // Home's own "Pick your training days" handler, read from the whole
      // shell too: phase C moved both App.tsx writers of this route (the
      // widget tap and the Home element) into src/app, and a pin on App.tsx
      // alone held only while one of them was still there.
      assert.match(
        shellSource,
        /onSetTrainingDays=\{\(\) =>\s*navigate\(\{ tab: 'profile', screen: 'training_plan', editSchedule: true \}\)\s*\}/,
      );
      assert.match(
        require('../helpers/appWiringSource.cjs').readAppWiring(),
        /startEditingSchedule=\{route\.editSchedule === true\}/,
      );

      // The dots themselves stay gated on real data in both calendar views.
      // The gate is a schedule now rather than a weekday count, because a
      // rhythm need not repeat every seven days — but it is still a gate.
      assert.match(homeScreenSource, /const scheduleKnown = isScheduleKnown\(trainingSchedule\)/);
      assert.match(homeScreenSource, /weekStripDotUnknown/);
    },
  },
  {
    name: 'the session lists every lift it has, and the list can be folded away',
    run() {
      // Home used to receive the first five lifts and a count of the rest, so
      // the header said "6 exercises" over five rows and a "+1 more" that did
      // nothing when tapped. The whole session comes through now.
      assert.doesNotMatch(shellSource, /exercises: session\.exercises\.slice\(0, 5\)/);
      // Read off the hero's own session rows: the same map is written in
      // other places in the shell, which would satisfy a whole-file match.
      assert.match(
        between(heroCardSource(), 'const homeSessions = orderedPlanSessions.map(', 'const completedForTemplate = '),
        /exercises: session\.exercises\.map\(\(exercise\) => \(\{/,
      );

      // One number, derived from the rows themselves rather than added back
      // from a second field that could disagree with them.
      assert.match(
        homeScreenSource,
        /const totalExerciseCount = plannedExercises\.length;/,
      );
      assert.doesNotMatch(homeScreenSource, /hiddenExerciseCount/);
      assert.doesNotMatch(homeScreenSource, /home\.section\.more/);

      // The fold: the meta line toggles, and it starts open because the lifts
      // are what the screen is for.
      assert.match(homeScreenSource, /const \[workoutListOpen, setWorkoutListOpen\] = useState\(true\)/);
      assert.match(homeScreenSource, /onPress=\{\(\) => setWorkoutListOpen\(\(open\) => !open\)\}/);
      assert.match(homeScreenSource, /\(workoutListOpen \? nextPlanSession\.exercises : \[\]\)\.map\(/);
      // Same affordance as the warmup and cooldown rows around it.
      assert.match(homeScreenSource, /accessibilityState=\{\{ expanded: workoutListOpen \}\}/);
    },
  },
  {
    /**
     * "Palautuminen" broke mid-word into "Palautuminen / n" beside its meta
     * (user 2026-09-07). `flex: 1` on the title is a basis of ZERO, so it took
     * only what the meta left over — and the meta had no shrink at all.
     */
    name: 'home: a section keeps its whole name and the meta gives way first',
    run() {
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const home = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'HomeScreen.tsx'),
        'utf8',
      );

      const title = home.slice(home.indexOf('  blockTitle: {'), home.indexOf('  blockMeta: {'));
      assert.ok(title.length > 40, 'blockTitle moved - recheck by hand');
      assert.doesNotMatch(title, /flex: 1,/, 'the section title is back to a zero basis');
      assert.match(title, /flexBasis: 'auto',/);
      assert.match(title, /flexShrink: 1,/);

      // Shrinking alone was not enough: at 17.5 the name still wrapped
      // (user 2026-09-08), so the title caps its own height with
      // numberOfLines={1} and the row's height is a constant again.
      //
      // Bigger again on 2026-09-09, at the user's request: the rules that
      // separated the three phases are gone, and the titles carry the
      // structure in their place. The wrap that 17.5 caused cannot come back
      // — the title is capped to one line — but the meta can now be clipped
      // instead, which is the trade the shrink order below was chosen for.
      assert.match(title, /fontSize: 20,/);
      assert.match(title, /lineHeight: 26,/);

      const meta = home.slice(home.indexOf('  blockMeta: {'), home.indexOf('  blockDrillRow: {'));
      assert.ok(meta.length > 40, 'blockMeta moved - recheck by hand');
      assert.match(meta, /flexShrink: 3,/, 'the meta no longer gives way before the name');
      assert.match(meta, /fontSize: 12\.5,/);
      // And it truncates rather than wrapping under the title it sits beside.
      assert.match(home, /<Text style=\{styles\.blockMeta\} numberOfLines=\{1\}>/);
      // Both section headers - the shared warmup/recovery one and the
      // workout row - hold their name to one line.
      assert.equal(
        (home.match(/styles\.blockTitle, [a-zA-Z]+ && styles\.sectTitleOpen\]\} numberOfLines=\{1\}/g) || []).length,
        2,
        'every section header caps its title at one line',
      );
    },
  },
];
