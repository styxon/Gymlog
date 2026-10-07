const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Line endings normalised — git checks these out with CRLF on Windows while a
// tool that rewrites one leaves LF, and a multi-line anchor then matches or
// misses depending on which touched the file last.
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');
const sheet = read('src', 'components', 'AddExerciseSheet.tsx');
const dayScreen = read('src', 'screens', 'ProgramDayScreen.tsx');
const homeScreen = read('src', 'screens', 'HomeScreen.tsx');
const swapSearch = read('src', 'lib', 'swapPickerLists.ts');
const swapHook = read('src', 'hooks', 'useSwapPickerLists.ts');
const labels = read('src', 'lib', 'exerciseNameLabel.ts');

const { rankExerciseMatches } = require('../../.test-dist/lib/exerciseSearch.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');

/**
 * Slices between two anchors, failing loudly when one is missing.
 *
 * `slice(start, indexOf(missing))` is `slice(start, -1)` — the rest of the
 * file minus one character — so a stale end anchor silently widens the scope
 * instead of failing, and the assertions inside stop meaning what they say.
 */
function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

/**
 * The ranking has to REACH the list.
 *
 * PR #46 taught four pickers to rank matches and shipped; the review pointed
 * out — as a line comment nobody read — that the app's main picker threw the
 * ranking away again, so "ylätal" still answered alphabetically in the one
 * sheet the bug report was about.
 */
module.exports = [
  {
    name: 'search: a typed query keeps its ranked order instead of being re-sorted alphabetically',
    run() {
      // The alphabetical fallback belongs to a filtered-but-unsearched list.
      assert.match(sheet, /const hasQuery = search\.trim\(\)\.length > 0;/);
      assert.match(sheet, /const showSuggestedOrdering = !hasQuery && !hasCustomFilters;/);
      const ordering = between(sheet, 'const orderedItems = useMemo', 'const listTitle');
      assert.match(ordering, /if \(hasQuery\) \{\s*return base;/);
      // And the memo actually re-runs when the query appears or goes — this
      // has to be scoped to the dependency array, not the rest of the file.
      assert.match(ordering, /hasQuery,/);
    },
  },
  {
    name: 'search: every picker breaks ties by popularity, so the lift beats its variants',
    run() {
      // Four call sites passed the accessor and two did not; a tie then fell
      // through to shortest name.
      assert.match(sheet, /popularity: \(item\) => commonStarterOrder\.get\(item\.id\),/);
      // ...which every picker's list hands to the ranker (lib/exercisePicker).
      const shared = fs.readFileSync(path.join(__dirname, '../../src/lib/exercisePicker.ts'), 'utf8');
      assert.match(shared, /return rankExerciseMatches\(narrowed, typed, language, popularity\);/);
      // Every swap sheet hands the order to the shared swap list, and it hands
      // it on to every picker's list (2026-10-07: Home and the programme day
      // through useSwapPickerLists).
      assert.match(swapSearch, /popularity: \(item\) => popularOrder\.get\(item\.id\),/);
      assert.match(swapHook, /const popularOrder = useMemo\(\(\) => getPopularExerciseLibraryOrder\(exerciseLibrary \?\? \[\]\), \[exerciseLibrary\]\)/);
      assert.match(swapHook, /\n\s*popularOrder,\n/);
      for (const screen of [dayScreen, homeScreen]) {
        assert.match(screen, /useSwapPickerLists\(\{/);
      }

      // The behaviour the accessor buys, proved rather than asserted about.
      const library = [
        { id: 'dip', name: 'Bench Dip', bodyPart: 'triceps', category: 'compound', equipment: 'bodyweight' },
        { id: 'bench', name: 'Bench Press', bodyPart: 'chest', category: 'compound', equipment: 'barbell' },
      ];
      const popularity = new Map([['bench', 0]]);
      assert.equal(rankExerciseMatches(library, 'penkki', 'fi')[0].name, 'Bench Dip', 'the tie used to break by name length');
      assert.equal(
        rankExerciseMatches(library, 'penkki', 'fi', (item) => popularity.get(item.id))[0].name,
        'Bench Press',
      );
    },
  },
  {
    name: 'search: two catalog lifts in one substitution group do not share a Finnish label',
    run() {
      // 'Lat Pulldown (Wide Grip)' had been renamed onto "Ylätalja", which the
      // catalog's plain 'Lat Pulldown' already uses — the swap sheet then
      // offered what looked like the same exercise.
      assert.match(labels, /'Lat Pulldown \(Wide Grip\)': 'Leveä ylätalja'/);
      assert.notEqual(
        exerciseNameLabel('fi', 'Lat Pulldown (Wide Grip)'),
        exerciseNameLabel('fi', 'Lat Pulldown'),
        'two names in one substitution group read identically',
      );
      // The library row keeps the plain label — that was the intended fix.
      assert.equal(exerciseNameLabel('fi', 'Lat Pulldown'), 'Ylätalja');
    },
  },
  {
    name: 'programme day: Done discards an uncommitted rhythm draft instead of stranding it',
    run() {
      const detail = read('src', 'screens', 'ProgramDetailScreen.tsx');
      // Closing edit mode without committing left the chips inert while the
      // "pick another day" hint kept telling the reader to tap them.
      assert.match(detail, /setRhythmEditing\(\(open\) => \{[\s\S]*?if \(open\) \{\s*setDraftDays\(null\);/);
    },
  },
  {
    name: 'progress: the section tabs are the same selector as the metric bar, bright in both themes',
    run() {
      const progress = read('src', 'screens', 'ProgressScreen.tsx');
      const seg = read('src', 'components', 'Seg.tsx');
      // The tabs go through Seg with their glyphs. The hand-built shell — a
      // second cut surface inside the selected tab, its outline showing under
      // the row on the phone — is gone from the screen with its per-theme inks
      // ("leikkaus on jotenkin outo", user 2026-09-09, asking for the metric
      // bar's look).
      assert.match(progress, /<Seg\s+grow\s+options=\{PROGRESS_SECTIONS\.map\(\(section\) => \(\{[\s\S]*?icon: section\.icon,/);
      assert.doesNotMatch(progress, /tabActiveFill|tabActiveInk|tabIdleInk|<CutSurface/);
      // The dark-theme fix moved into Seg, where the metric bar gets it too:
      // dark inherited light's tokens and made the selected option the dimmest
      // thing in the row.
      assert.match(seg, /const dark = useThemeName\(\) === 'dark';/);
      assert.match(seg, /const activeInk = dark \? theme\.purpleBright : theme\.purpleDark;/);
      // And the idle glyphs stay in ink on light — the 2026-09-02 legibility
      // fix the move here briefly lost (bot review, PR #89).
      assert.match(seg, /const idleInk = dark \? theme\.muted : theme\.ink;/);
      assert.match(seg, /stroke=\{locked \? theme\.faint : active \? activeInk : idleInk\}/);
      assert.match(seg, /segItemActiveDark: \{[^}]*backgroundColor: theme\.purpleLight/);
      assert.match(seg, /segTextActiveDark: \{[^}]*color: theme\.purpleBright/);
    },
  },
];
