const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Nothing in src/lib may be written, tested and never wired up.
 *
 * This happened three times in one day. `weeklyTrainingStreak` computed the
 * streak the calendar is about and had no caller. `getProgramFocusQualityLabel`
 * existed while the screen printed the raw English identifier next to it.
 * `buildFirstRunCustomProgramName` takes a language that the caller never
 * passed, so Vinha named the program it builds for you in English on a Finnish
 * home screen. Each was found by looking at the phone, not by the suite: a
 * green test proves the function works, never that anything calls it.
 *
 * So the suite checks the wiring. Every exported name in src/lib must be
 * referenced somewhere outside its own module and outside tests — or be listed
 * below with the reason it is not.
 */

const ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(ROOT, 'src', 'lib');

/**
 * Exports that legitimately have no app caller. Each needs a reason; "it might
 * be useful later" is not one — git remembers deleted code.
 */
const ALLOWED = {
  I18N_KEYS: 'The key list behind the I18nKey type: used by types, not by calls.',
  TRANSLATED_EXERCISE_NAMES: 'The translation table, exposed for the coverage test.',
  PLAIN_EXERCISE_NAMES: 'The English display table, exposed for the sweep that keeps every entry the same lift.',
  LEGACY_LIBRARY_ID_TARGETS: 'The retired lib_* ids, exposed for the sweep that keeps every one of them remappable.',
  EXERCISE_INSTRUCTIONS_FI_TABLE: 'The Finnish instruction table, exposed for the test that keeps it paired with the English library step for step.',
  EXERCISE_TEACHING_TABLES: 'Both teaching tables, exposed for the sweep that keeps every swap pointing at a real library lift and never at itself.',
  EXERCISE_COLLECTION_TABLES: 'Both collection tables, exposed for the sweep that keeps every course entry pointing at a lift the reader can open.',
  HOLD_EXERCISE_NAME_LIST: 'The hold list, exposed for the test that keeps the catalog data and this list one truth in both directions.',
  MINUTES_EXERCISE_NAME_LIST: 'The minutes list, exposed for the same both-ways agreement test (tests/lib/minutesTracking.test.cjs).',
  EMPTY_SESSION_ADAPTATION: 'The empty value, pinned so its shape cannot drift.',
  fingerprintsMatch: 'Exposed for the test that keeps fingerprints distinct.',
  isCatalogExercise: 'Pool membership, pinned so the catalog and the filters cannot diverge.',
  GUIDED_LIBRARY_ALIASES: 'The alias table, exposed so a test can prove every target is a real library entry — a misspelled target resolves to nothing and says so nowhere.',
  getPlanWeekPhase: 'Plan phase wording, written ahead of the surface that will show it.',
  getProgramSeason: 'Season lookup by program, kept beside the seasons it answers for.',
  isSeasonActive: 'Season window predicate, kept beside resolveSeasonWindow.',
  emptyRatingPromptState: 'Rating prompt state machine, waiting for its post-workout wiring; the demo shelf that exercised it was removed 2026-08-22.',
  decideRatingPrompt: 'See emptyRatingPromptState.',
  recordRatingAsked: 'See emptyRatingPromptState.',
  recordRatingCompleted: 'See emptyRatingPromptState.',
  orderSeasons:
    'Parked with the season section on the Programs tab (2026-08-31). SeasonScreen and the season route still work and build their own numbers; this ordered the two cards the tab used to draw. Delete it only when seasons are decided against, not while they are parked.',
  isJoinWindowOpen: 'See orderSeasons — it decided whether the coming season\'s card was worth drawing.',
  UNLISTED_READY_PROGRAMS:
    'A declaration, not a call: the programmes deliberately kept out of the browse collections, read only by the guard that fails when a template is in neither. Wiring it to a screen would give it behaviour it must not have — it exists so that "not browsable" is always a decision someone wrote down.',
};

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm;

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // .claude holds worktree copies of the whole repo: a reference found there
    // is a reference to itself, and it hid five dead exports for a day.
    if (['node_modules', '.test-dist', '.git', '.claude', 'android', 'ios', 'tests'].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

module.exports = [
  {
    name: 'every src/lib export is wired to something, or says why not',
    run() {
      const libFiles = fs
        .readdirSync(LIB)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));

      const exports = new Map();
      for (const name of libFiles) {
        const source = fs.readFileSync(path.join(LIB, name), 'utf8');
        for (const match of source.matchAll(EXPORT_RE)) {
          exports.set(match[1], path.join('src', 'lib', name));
        }
      }

      // Scripts count as callers — export-legal.cjs is a real consumer, and
      // leaving .cjs out of the scan reported it as dead the first time.
      const callers = walk(ROOT, ['.ts', '.tsx', '.cjs', '.js']).map((file) => ({
        rel: path.relative(ROOT, file),
        text: fs.readFileSync(file, 'utf8'),
      }));

      const unwired = [];
      for (const [name, definedIn] of exports) {
        const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
        const used = callers.some((file) => {
          if (file.rel === definedIn) {
            // Used inside its own module is over-exported at worst, not dead.
            return pattern.test(file.text.replace(EXPORT_RE, ''));
          }
          return pattern.test(file.text);
        });
        if (!used && !(name in ALLOWED)) {
          unwired.push(`${name} (${definedIn})`);
        }
      }

      assert.deepEqual(
        unwired,
        [],
        'These src/lib exports have no caller outside their own module. Wire them, ' +
          'delete them, or add them to ALLOWED with a reason:\n  ' + unwired.join('\n  '),
      );
    },
  },
  {
    name: 'the allowlist does not outlive the things it excuses',
    run() {
      const libSource = fs
        .readdirSync(LIB)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => fs.readFileSync(path.join(LIB, name), 'utf8'))
        .join('\n');

      // An entry left behind after its export is deleted makes the list read
      // as considered when it is only stale.
      for (const name of Object.keys(ALLOWED)) {
        assert.match(
          libSource,
          new RegExp(`\\b${name}\\b`),
          `${name} is allowlisted but no longer exists in src/lib — drop the entry.`,
        );
      }
    },
  },
];
