const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getBodyweightProgress } = require('../../.test-dist/lib/progression.js');
const { popRoute, pushRoute } = require('../../.test-dist/navigation/routeHistory.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The JSX element opened by `<Name`, up to its own self-closing `/>` at the same indent. */
function elementBlock(source, name) {
  const start = source.indexOf(`<${name}\n`);
  assert.ok(start >= 0, `<${name}> not found`);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const end = source.indexOf(`\n${indent}/>`, start);
  assert.ok(end > start, `<${name}> has no closing />`);
  return source.slice(start, end);
}

/**
 * Screens no audit round had named (audit 7, 2026-09-26).
 */
module.exports = [
  {
    name: 'audit 7: My Data shows the newest weigh-in and opens the log, never a setting nothing reads',
    run() {
      // The row showed and edited `setupCurrentWeightKg`; Home and Progress
      // read the weigh-in log, so 75 → 82 here left both saying 75.
      const screen = strip(read('src', 'screens', 'MyDataScreen.tsx').replace(/\r\n/g, '\n'));
      assert.doesNotMatch(screen, /setupCurrentWeightKg/);
      assert.match(screen, /value: latestWeighInKg !== null \? formatWeight\(latestWeighInKg\) : null,\s*edits: false,\s*onPress: onOpenWeighIns,/);

      const tab = strip(read('src', 'app', 'renderProfileTab.tsx').replace(/\r\n/g, '\n'));
      const myData = elementBlock(tab, 'MyDataScreen');
      assert.match(myData, /latestWeighInKg=\{latestWeighInKg\}/);
      // The whole shell, App.tsx and src/app: the setup readings left
      // VinhaApp for a hook in the phase-C split (2026-10-01).
      const shell = strip(readAppWiring().replace(/\r\n/g, '\n'));
      assert.match(shell, /const latestWeighInKg = bodyweightProgress\.latest\?\.weight \?\? null;/);
      assert.match(myData, /onOpenWeighIns=\{\(\) => navigate\(\{ tab: 'progress', screen: 'bodyweight' \}\)\}/);

      // Newest by date, whatever order the log is stored in — the same entry
      // Home's weight card reads.
      const entries = [
        { id: 'b', recordedAt: '2026-09-20T07:00:00.000Z', weight: 82 },
        { id: 'a', recordedAt: '2026-08-01T07:00:00.000Z', weight: 75 },
        { id: 'c', recordedAt: '2026-09-25T07:00:00.000Z', weight: 81.4 },
      ];
      assert.equal(getBodyweightProgress({ bodyweightEntries: entries }).latest.weight, 81.4);
      assert.equal(getBodyweightProgress({ bodyweightEntries: [] }).latest, undefined);
    },
  },
  {
    name: 'audit 7: re-running setup opens on the newest weigh-in; the running programme does not move with it',
    run() {
      const {
        buildSetupBasicsFromPreferences,
        buildSetupSelectionFromPreferences,
      } = require('../../.test-dist/app/onboardingHandoff.js');
      const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');
      const base = createEmptyDatabase('fi').preferences;
      const told = { ...base, setupCurrentWeightKg: 75 };
      assert.equal(buildSetupBasicsFromPreferences(told, 82).currentWeightKg, 82);
      // An empty log keeps what setup was told.
      assert.equal(buildSetupBasicsFromPreferences(told, null).currentWeightKg, 75);
      assert.equal(buildSetupBasicsFromPreferences(told).currentWeightKg, 75);
      const completed = {
        ...told,
        setupCompleted: true,
        setupGoal: 'strength',
        setupGoals: ['strength'],
        setupDaysPerWeek: 3,
        setupEquipment: 'gym',
      };
      assert.equal(buildSetupSelectionFromPreferences(completed, 82).currentWeightKg, 82);
      assert.equal(buildSetupSelectionFromPreferences(completed).currentWeightKg, 75);

      // Only the questionnaire reads the log's weight. The recommendation and
      // the composed onboarding week stay on the stored answers.
      const shell = strip(readAppWiring().replace(/\r\n/g, '\n'));
      assert.match(shell, /const setupSelection = useMemo\(\s*\(\) => buildSetupSelectionFromPreferences\(preferences, null, leadTrainingCycle\),\s*\[setupSelectionKey\],\s*\);/);
      assert.match(shell, /buildSetupSelectionFromPreferences\(preferences, latestWeighInKg, leadTrainingCycle\),\s*\[setupSelectionKey, latestWeighInKg\],/);
      const app = strip(read('App.tsx').replace(/\r\n/g, '\n'));
      // The setup route's render moved to src/app/renderOnboarding.tsx
      // (phase C, 2026-10-01), so the editor is looked for over the shell.
      const editor = shell.match(/<OnboardingScreen\s[^>]*?mode="edit"[\s\S]*?\/>/);
      assert.ok(editor, 'the setup route renders the questionnaire in edit mode');
      assert.match(editor[0], /initialSelection=\{setupEditSelection\}/);
      assert.match(editor[0], /basicsSeed=\{setupEditSelection \? null : setupBasics\}/);
    },
  },
  {
    name: 'audit 7: "Ask the coach" on the analysis returns to the chat instead of stacking a second one',
    run() {
      const home = strip(read('src', 'app', 'renderHomeScreens.tsx').replace(/\r\n/g, '\n'));
      const analysis = elementBlock(home, 'SessionAnalysisScreen');
      assert.match(analysis, /onAskCoach=\{\(\) => navigateBack\(\{ tab: 'home', screen: 'ai_chat' \}\)\}/);
      assert.doesNotMatch(analysis, /onAskCoach=\{\(\) => navigate\(/);

      // The analysis is opened from the chat, so one pop lands on it and the
      // next on Home. A push had left chat → analysis → chat: three presses.
      const dashboard = { tab: 'home', screen: 'dashboard' };
      const chat = { tab: 'home', screen: 'ai_chat' };
      const history = pushRoute(pushRoute([], dashboard, chat), chat, { tab: 'home', screen: 'analysis', sessionId: 's1' });
      const back = popRoute(history);
      assert.deepEqual(back.route, chat);
      assert.deepEqual(popRoute(back.history).route, dashboard);
    },
  },
  {
    name: 'audit 7: list and map toggles in preferences are computed from the stored value, not the render',
    run() {
      // Two quick ticks on the technique checklist both built their patch from
      // the same render's map; the second replaced the first.
      const provider = strip(read('src', 'state', 'AppProvider.tsx').replace(/\r\n/g, '\n'));
      assert.match(
        provider,
        /const current = databaseRef\.current;[\s\S]{0,200}\.\.\.\(typeof patch === 'function' \? patch\(current\.preferences\) : patch\),/,
      );

      const sources = [
        ['App.tsx', read('App.tsx')],
        ...fs
          .readdirSync(path.join(root, 'src', 'app'))
          .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
          .map((name) => [`src/app/${name}`, read('src', 'app', name)]),
      ];
      const offenders = [];
      let functional = 0;
      for (const [file, raw] of sources) {
        const source = strip(raw.replace(/\r\n/g, '\n'));
        const stale = source.match(/updatePreferences\(\{\s*(exerciseTechniqueChecks|learnedExerciseLibraryItemIds):/g) ?? [];
        stale.forEach((hit) => offenders.push(`${file}: ${hit.replace(/\s+/g, ' ')}`));
        functional += (
          source.match(/updatePreferences\(\((current|\{ learnedExerciseLibraryItemIds: current \})\) => \(\{\s*(exerciseTechniqueChecks|learnedExerciseLibraryItemIds):/g) ?? []
        ).length;
      }
      assert.deepEqual(offenders, [], 'a toggle builds its patch from render-time preferences');
      // The four known toggles: checklist and learned, on the detail page and in the player.
      assert.equal(functional, 4);
    },
  },
];
