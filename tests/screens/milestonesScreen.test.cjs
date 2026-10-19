const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * Line endings normalised.
 *
 * Git checks these files out with CRLF on Windows while a tool that rewrites
 * one leaves LF, so a multi-line anchor below matched or missed depending on
 * which had touched the file last — the guard passed and failed on identical
 * code.
 */
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');
const screen = read('src', 'screens', 'MilestonesScreen.tsx');
const profile = read('src', 'screens', 'ProfileScreen.tsx');
const tab = read('src', 'app', 'renderProfileTab.tsx');
const app = read('App.tsx');
/** App.tsx and the src/app modules its blocks moved into, line endings normalised like read(). */
const wiring = readAppWiring().split('\r\n').join('\n');
const routes = read('src', 'navigation', 'routes.ts');
const bar = read('src', 'components', 'BottomTabBar.tsx');

/** Slices between two anchors, failing loudly when one is missing. */
function between(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

/**
 * The milestones page (user 2026-09-03): the reached rungs collected on a
 * page of their own, opened from the Profile's NEXT MILESTONE card.
 */
module.exports = [
  {
    name: 'milestones: the route exists, the tab renders it, and back returns to the Profile',
    run() {
      assert.match(routes, /tab: 'profile';\s*\/\*\*[^*]*\*\/\s*screen: 'milestones';/);
      assert.match(tab, /import \{ MilestonesScreen \} from '\.\.\/screens\/MilestonesScreen'/);
      // The next branch was the promo screen until the codes left the bundle (2026-09-15).
      const branch = between(tab, "if (route.screen === 'milestones')", "if (route.screen === 'subscription')");
      assert.match(branch, /<MilestonesScreen/);
      assert.match(branch, /ledger=\{milestoneLedger\}/);
      assert.match(branch, /lifetime=\{lifetimeSummary\}/);
      assert.match(branch, /onBack=\{\(\) => navigateBack\(\{ tab: 'profile', screen: 'list' \}\)\}/);
    },
  },
  {
    name: 'milestones: the facts are read once in App and the ledger is built from them in the unit the reader lifts in',
    run() {
      // From App.tsx or from the src/app module the memos moved into.
      assert.match(wiring, /import \{ buildMilestoneLedger, getMilestoneFacts \} from '(?:\.\/src|\.\.)\/lib\/milestoneFacts'/);
      assert.match(wiring, /const milestoneFacts = useMemo\(\s*\(\) => getMilestoneFacts\(database, lifetimeSummary, recordDates\)/);
      // Keyed on the tables it reads, not the database object a preference
      // toggle replaces.
      const factsMemo = between(wiring, 'const milestoneFacts = useMemo', 'const milestoneLedger');
      // The summary is itself keyed on the whole database, so depending on the
      // object would undo the narrowing — only the field this reads counts.
      assert.match(factsMemo, /database\.workoutSessions,\s*database\.exerciseLogs,\s*database\.cardioSessions,\s*database\.bodyweightEntries,\s*lifetimeSummary\.currentWeekStreak,\s*recordDates,/);
      assert.match(wiring, /const milestoneLedger = useMemo\(\(\) => buildMilestoneLedger\(milestoneFacts, unitPreference\), \[milestoneFacts, unitPreference\]\)/);
      // The record dates are the lib's (firstAt, which never moves), not a walk in the shell.
      assert.match(wiring, /const recordDates = useMemo\(\(\) => firstRecordDates\(personalRecords\), \[personalRecords\]\)/);
      // The ledger travels to the tab; the facts stop at it, because the card
      // no longer takes a second model of the same log.
      // Matched at any indent; lazy, so it ends at the first close after it.
      const depsMatch = app.match(/lifetimeSummary,\n[ \t]*milestoneLedger,[\s\S]*?distinctRecordCount,\n[ \t]*\}\);/);
      assert.ok(depsMatch, 'the deps block moved — recheck by hand');
      const deps = depsMatch[0];
      assert.ok(deps.length > 10 && deps.length < 400, 'the deps block moved — recheck by hand');
      assert.match(tab, /milestoneLedger: React\.ComponentProps<typeof MilestonesScreen>\['ledger'\]/);
      assert.doesNotMatch(tab, /milestoneFacts/);
    },
  },
  {
    name: 'milestones: the Profile card presses through to the page and its footer counts the fallen rungs',
    run() {
      assert.match(tab, /milestoneLedger=\{milestoneLedger\}/);
      assert.match(tab, /onOpenMilestones=\{\(\) => navigate\(\{ tab: 'profile', screen: 'milestones' \}\)\}/);
      const block = between(profile, "t(language, 'profile.section.nextMilestone')", '{/* PERSONAL RECORDS');
      // Only the footer presses: a Pressable around the card would fold the
      // rows into one screen-reader node.
      assert.match(block, /<Pressable\s+accessibilityRole="button"\s+accessibilityLabel=\{t\(language, 'milestones\.title'\)\}\s+onPress=\{onOpenMilestones\}/);
      assert.ok(block.indexOf('<Pressable') > block.indexOf('milestoneRows.map'), 'the Pressable is the footer, after the rows');
      assert.match(block, /milestoneCardFooter\(milestoneLedger\.reachedCount, language\)/);
      // One reading of the log: the card slices the ledger's own front row.
      assert.match(profile, /milestoneCardRows\(\{ ledger: milestoneLedger/);
      // The label keeps no right action: the card itself is the door.
      assert.match(profile, /<SectionLabel label=\{t\(language, 'profile\.section\.nextMilestone'\)\} \/>/);
    },
  },
  {
    name: 'milestones: the page lists the reached rungs first, with a day each, and the ladder\'s front row below',
    run() {
      assert.match(screen, /import \{ PageHeader \} from '\.\.\/components\/BackButton'/);
      assert.match(screen, /title=\{t\(language, 'milestones\.title'\)\}/);
      assert.match(screen, /buildMilestoneLedgerRows\(\{ ledger, lifetime, unitPreference, language \}\)/);
      const reached = screen.indexOf("'milestones.section.reached'");
      const upNext = screen.indexOf("'milestones.section.upNext'");
      assert.ok(reached > 0 && upNext > reached, 'reached before up next');
      const reachedBlock = screen.slice(reached, upNext);
      assert.match(reachedBlock, /rows\.reached\.length === 0/);
      assert.match(reachedBlock, /'milestones\.emptyTitle'/);
      assert.match(reachedBlock, /rows\.reached\.map/);
      // No speed line across the dates (user 2026-09-03).
      assert.doesNotMatch(screen, /speedLine/);
      // Nothing on the page is greyed out, locked, or a badge.
      assert.doesNotMatch(screen, /locked|opacity: 0\.[0-4]|badge|trophy/i);
      // Same bar rule as the card: nearest in the accent, the rest violet.
      assert.match(screen, /index === 0 \? theme\.highlight : theme\.purpleBright/);
      assert.match(screen, /paddingBottom: layout\.bottomTabBarReserve/);
    },
  },
  {
    name: 'tab bar: in light the AI orb is deep violet with a white label; dark keeps its dark orb',
    run() {
      // User 2026-09-03: "tumma purppura ympyrä ja ai teksti olisi vaalea".
      assert.match(bar, /: \[theme\.purpleBright, theme\.purple, theme\.purpleDark\]/);
      assert.match(bar, /const aiCircleBackground = aiDark \? '#1B1530' : theme\.purpleDark/);
      assert.match(bar, /const aiLabelColor = aiDark \? theme\.highlight : theme\.onHighlight/);
      assert.doesNotMatch(bar, /'#6D28D9'|'#E3D4FF'|'#F2ECFF'/);
    },
  },
];
