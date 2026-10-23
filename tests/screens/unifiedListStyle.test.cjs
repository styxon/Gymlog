const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/**
 * The unified list style (owner, 2026-10-19): a list is one rounded card, a
 * row is a ListRow, the label is the shared SectionLabel.
 */
const LIST_SCREENS = [
  ['src', 'screens', 'HistoryScreen.tsx'],
  ['src', 'screens', 'RecordsScreen.tsx'],
];

module.exports = [
  {
    name: 'unifiedListStyle: list screens carry no hardcoded light-only hairline',
    run() {
      for (const file of LIST_SCREENS) {
        assert.doesNotMatch(read(...file), /#EEEAF7/i, `${file.join('/')} hardcodes the light hairline`);
      }
    },
  },
  {
    name: 'unifiedListStyle: Records renders no fresh badge and no purple row border',
    run() {
      const source = read('src', 'screens', 'RecordsScreen.tsx');
      assert.doesNotMatch(source, /freshTag|rowFresh|pr\.new|record\.fresh\s*&&/);
      assert.doesNotMatch(source, /formatDateNumeric/);
      assert.match(source, /splitLastSessionRecords/);
      assert.match(source, /pr\.lastSession/);
    },
  },
  {
    name: 'unifiedListStyle: History uses the shared label, rows and header, with no subtitle or stripe',
    run() {
      const source = read('src', 'screens', 'HistoryScreen.tsx');
      assert.doesNotMatch(source, /function SectionLabel/);
      assert.doesNotMatch(source, /history\.subtitle|sessionFeelStripe/);
      assert.match(source, /<PageHeader/);
      assert.match(source, /<ListCard>/);
      assert.match(source, /metaDot=/);
      assert.match(source, /formatListDate\(/);
    },
  },
  {
    name: 'unifiedListStyle: the shared card is rounded 18, hairlined and clipped',
    run() {
      const source = read('src', 'components', 'ListCard.tsx');
      assert.match(source, /borderRadius: 18/);
      assert.match(source, /overflow: 'hidden'/);
      assert.match(source, /minHeight: 56/);
      assert.doesNotMatch(source, /CutSurface/);
      const back = read('src', 'components', 'BackButton.tsx');
      assert.match(back, /width: 40/);
      assert.match(back, /borderRadius: 999/);
      assert.match(back, /theme\.controlFill/);
      assert.match(back, /theme\.controlBorder/);
      assert.doesNotMatch(back, /theme\.surfaceSoft/);
    },
  },
  {
    name: 'unifiedListStyle: no screen keeps its own SectionLabel, and pushed screens use the round back button',
    run() {
      const dir = path.join(ROOT, 'src', 'screens');
      for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
        assert.doesNotMatch(read('src', 'screens', name), /function SectionLabel/, `${name} has a local SectionLabel`);
      }
      for (const name of [
        'Settings', 'Notifications', 'MyData', 'ExportPlan', 'TrainingPlan', 'Milestones', 'Subscription', 'TrainingBreak',
        'EditProfile', 'ExerciseDetail', 'SessionAnalysis', 'LegalDocument', 'MembershipEnd', 'CreateTemplate',
      ]) {
        const source = read('src', 'screens', `${name}Screen.tsx`);
        assert.match(source, /<PageHeader/, `${name} lost the shared header`);
        assert.doesNotMatch(source, /<ScreenHeader\b|<ScreenHeaderTitle/, `${name} draws an old header beside the shared one`);
      }
      for (const name of ['ProgramDetail', 'ProgramDay', 'Catalog', 'LearnIndex']) {
        assert.match(read('src', 'screens', `${name}Screen.tsx`), /<BackButton/, `${name} lost the shared back button`);
      }
      // The library draws it on its own title row, inside the browser.
      assert.match(read('src', 'components', 'ExerciseLibraryBrowser.tsx'), /<BackButton/);
      // The two backs over a painted hero keep their scrim, in the shared shape.
      const history = read('src', 'screens', 'HistoryScreen.tsx');
      assert.match(history, /heroBack: \{\s*width: 40,\s*height: 40,\s*borderRadius: 999/);
      assert.match(read('src', 'screens', 'CollectionScreen.tsx'), /coverBack: \{[^}]*width: 40,\s*height: 40,\s*borderRadius: 999/);
    },
  },
  {
    name: 'unifiedListStyle: the recovery row draws no single-bar meter; Progress tabs show icon and label',
    run() {
      assert.match(read('src', 'lib', 'proInsights.ts'), /bars: \[\],/);
      assert.doesNotMatch(read('src', 'lib', 'proInsights.ts'), /normalizedBars\(\[fatigue/);
      assert.match(read('src', 'screens', 'ProgressScreen.tsx'), /<Seg\s+grow\s+showLabels/);
    },
  },
  {
    name: 'unifiedListStyle: labelled Seg tabs shrink to fit, list titles wrap, back button sits in padding',
    run() {
      const seg = read('src', 'components', 'Seg.tsx');
      assert.match(seg, /segItemLabelled: \{\s*flexDirection: 'column'/);
      assert.match(seg, /segTextLabelled: \{[^}]*flexShrink: 1[^}]*minWidth: 0/);
      assert.match(seg, /minimumFontScale=\{showLabels \? 0\.7/);
      const row = read('src', 'components', 'ListCard.tsx');
      assert.doesNotMatch(row, /styles\.title, muted && styles\.titleMuted\]\} numberOfLines=\{1\}/);
      // The figure keeps its size (no auto-shrink, no cap); the title wraps by word.
      assert.doesNotMatch(row, /adjustsFontSizeToFit/);
      assert.match(row, /titleLine: \{[^}]*flexWrap: 'wrap'/);
      const trailing = row.slice(row.indexOf('  trailing: {'), row.indexOf('  delta: {'));
      assert.doesNotMatch(trailing, /fontWeight/);
      const header = read('src', 'components', 'BackButton.tsx');
      assert.match(header, /adjustsFontSizeToFit/);
      assert.match(header, /minimumFontScale=\{0\.7\}/);
      const ex = read('src', 'screens', 'ExercisesScreen.tsx');
      assert.doesNotMatch(ex, /styles\.backRow/);
      assert.match(ex, /onBack=\{onBack\}/);
      assert.doesNotMatch(ex, /backText|paddingTop: 52/);
      for (const name of ['Catalog', 'LearnIndex']) {
        assert.doesNotMatch(read('src', 'screens', name + 'Screen.tsx'), /paddingTop: 52/);
      }
    },
  },
  {
    name: 'unifiedListStyle: Lifts and Measures are one ListCard each, the new-best pill takes theme tokens',
    run() {
      const source = read('src', 'screens', 'ProgressScreen.tsx');
      const tracked = source.slice(source.indexOf('function renderTracked()'), source.indexOf('function renderMeasures()'));
      assert.match(tracked, /<ListCard>/);
      assert.match(tracked, /<ListRow/);
      assert.doesNotMatch(tracked, /trackedCard|trackedList/);
      const measures = source.slice(source.indexOf('function renderMeasureList()'), source.indexOf('<KitSheet'));
      assert.match(measures, /<ListCard>/);
      assert.match(measures, /<ListRow/);
      assert.doesNotMatch(measures, /measureRowLogged|measureList|purpleBright/);
      assert.doesNotMatch(source, /SIGNAL_STYLES|#E4F6EA|#E7F6EC|#FBEFDD/);
      assert.match(source, /greenSoft/);
      assert.match(source, /greenInk/);
    },
  },
  {
    name: 'unifiedListStyle: the calendar marks only done days solid; the switch and back button use visible tokens',
    run() {
      const source = read('src', 'screens', 'ProgressScreen.tsx');
      assert.match(source, /const training = status === 'done'/);
      assert.match(source, /calendarBubblePlanned/);
      assert.match(read('src', 'components', 'SettingsUi.tsx'), /backgroundColor: theme\.switchOff/);
      assert.doesNotMatch(read('src', 'components', 'SettingsUi.tsx'), /#E4DBF5/);
      const light = read('src', 'lightTheme.ts');
      assert.match(light, /controlFill: '#FFFFFF'/);
      assert.match(light, /controlBorder:/);
    },
  },
  {
    name: 'unifiedListStyle: one gutter and header offset, section labels spaced under cards',
    run() {
      assert.match(read('src', 'theme.ts'), /screenGutter: 20/);
      for (const name of ['History', 'Milestones', 'Settings', 'Notifications', 'MyData', 'ExportPlan', 'Subscription']) {
        const source = read('src', 'screens', `${name}Screen.tsx`);
        assert.doesNotMatch(source, /paddingHorizontal: 18,/, `${name} keeps its own 18 gutter`);
        assert.match(source, /layout\.screenGutter/, `${name} lost the shared gutter`);
      }
      assert.match(read('src', 'screens', 'HistoryScreen.tsx'), /paddingTop: layout\.pageHeaderTop/);
      const sub = read('src', 'screens', 'SubscriptionScreen.tsx');
      assert.match(sub, /<SectionLabel spaced label=\{t\(language, 'subs\.section\.yours'\)\}/);
      assert.match(read('src', 'screens', 'ExportPlanScreen.tsx'), /<SectionLabel spaced/);
      assert.match(read('src', 'components', 'SettingsUi.tsx'), /sectionSpaced: \{\s*marginTop: 22/);
    },
  },
  {
    name: 'unifiedListStyle: Home dates through the shared formatter; coach opening is top-anchored; library has one search',
    run() {
      assert.match(read('src', 'screens', 'HomeScreen.tsx'), /formatListDate\(new Date\(\), language, \{ weekday: true \}\)/);
      const coach = read('src', 'screens', 'AICoachChatScreen.tsx');
      assert.match(coach, /messages\.length === 0 && styles\.threadOpening/);
      const lib = read('src', 'components', 'ExerciseLibraryBrowser.tsx');
      assert.doesNotMatch(lib, /onPress=\{\(\) => searchRef\.current\?\.focus\(\)\}/);
    },
  },
  {
    name: 'unifiedListStyle: the exercise page goes back through the shared, labelled BackButton',
    run() {
      // Its own square chevron had no accessibility label: VoiceOver read
      // nothing and the ui-check walk could not find it (2026-10-20).
      const detail = read('src', 'screens', 'ExerciseDetailScreen.tsx');
      assert.ok(detail.includes("backLabel={t(language, 'common.back')}") && detail.includes('<PageHeader'));
      assert.ok(detail.includes('backTestID="exercise-detail-back"'));
      assert.doesNotMatch(detail, /ChevronLeftIcon/);
    },
  },
];
