const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const swapLists = require('../../.test-dist/lib/swapPickerLists.js');
const { buildSwapPickerLibrary } = swapLists;
const { movementHead, identityKey } = require('../../.test-dist/lib/swapShortlist.js');
const { buildSwapOptionsForSlot } = require('../../.test-dist/lib/tailoringFit.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { effectiveSwapBodyPart, effectiveSwapCategory } = require('../../.test-dist/lib/swapBrowsePrefilter.js');

/**
 * One swap list, wherever the swap was opened (owner, 2026-10-07).
 *
 * The player listed every member of the slot's pool as a card, in tailoring
 * order; Home and the programme day cut the same pool to three variations and
 * three related lifts, so a lift could be a top card in the workout and a
 * library row, or nowhere, on Home (hunt finding 11). The owner's answer: no
 * cap anywhere, the same order everywhere — same-movement variations, then
 * the related lifts, then the library — and a search that reaches any lift.
 */
const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const SCREENS = ['src/screens/GuidedPlayerScreen.tsx', 'src/screens/HomeScreen.tsx', 'src/screens/ProgramDayScreen.tsx'];

/** The pool's members a reader could be offered: not the lift itself, one per name shown. */
function offerablePool(group, current, language) {
  const currentLabel = exerciseNameLabel(language, current);
  const identities = new Set([identityKey(current)]);
  const labels = new Set([currentLabel]);
  const names = [];
  for (const { exerciseName } of buildSwapOptionsForSlot(group, current, null)) {
    const label = exerciseNameLabel(language, exerciseName);
    if (identities.has(identityKey(exerciseName)) || labels.has(label)) continue;
    identities.add(identityKey(exerciseName));
    labels.add(label);
    names.push(exerciseName);
  }
  return names;
}

/** The argument object of the screen's one buildSwapAlternatives call, as `key: value` text. */
function alternativesCallArguments(source, screen) {
  const calls = source.split('buildSwapAlternatives({').length - 1;
  assert.equal(calls, 1, `${screen} builds its swap cards through buildSwapAlternatives exactly once (found ${calls})`);
  const start = source.indexOf('buildSwapAlternatives({') + 'buildSwapAlternatives('.length;
  let depth = 0;
  let end = start;
  for (; end < source.length; end += 1) {
    if (source[end] === '{' || source[end] === '(' || source[end] === '[') depth += 1;
    if (source[end] === '}' || source[end] === ')' || source[end] === ']') depth -= 1;
    if (depth === 0) break;
  }
  const body = source.slice(start + 1, end);
  // Top-level entries only: split on commas outside brackets.
  const entries = [];
  let level = 0;
  let current = '';
  for (const char of body) {
    if ('{(['.includes(char)) level += 1;
    if ('})]'.includes(char)) level -= 1;
    if (char === ',' && level === 0) {
      entries.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  entries.push(current);
  const args = {};
  for (const entry of entries.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const colon = entry.indexOf(':');
    const key = colon === -1 ? entry : entry.slice(0, colon).trim();
    args[key] = colon === -1 ? key : entry.slice(colon + 1).trim();
  }
  return args;
}

module.exports = [
  {
    name: 'swap cards: the whole pool, variations first, no cap — for every big group',
    run() {
      assert.equal(typeof swapLists.buildSwapAlternatives, 'function', 'lib/swapPickerLists has no buildSwapAlternatives');
      const lifts = [
        ['hip_mobility', 'Pigeon Pose'],
        ['hip_thrust_bridge', 'Barbell Hip Thrust'],
        ['squat_pattern', 'Back Squat'],
        ['horizontal_press', 'Bench Press'],
        ['accessory_delts', 'Lateral Raise'],
      ];
      for (const language of ['fi', 'en']) {
        for (const [group, current] of lifts) {
          const cards = swapLists.buildSwapAlternatives({
            currentName: current,
            substitutionGroup: group,
            preferences: null,
            sessionLifts: [current],
            query: '',
            language,
          });
          const pool = offerablePool(group, current, language);
          assert.ok(pool.length > 6, `${group} is one of the big pools (${pool.length})`);
          // Every member reaches the cards: the player showed 11 for the
          // pigeon pose where Home showed 4.
          assert.deepEqual([...cards].sort(), [...pool].sort(), `${group} (${language}): the cards are the pool, uncut`);
          // Same movement first, then the rest of the pool.
          const head = movementHead(current);
          const isVariation = cards.map((name) => Boolean(head) && movementHead(name) === head);
          const firstRelated = isVariation.indexOf(false);
          assert.ok(
            firstRelated === -1 || !isVariation.slice(firstRelated).includes(true),
            `${group}: a variation sits after a related lift: ${cards.join(', ')}`,
          );
        }
      }
    },
  },
  {
    name: 'swap cards: a lift already in the session is not a card, and a query narrows the cards',
    run() {
      const cards = swapLists.buildSwapAlternatives({
        currentName: 'Barbell Hip Thrust',
        substitutionGroup: 'hip_thrust_bridge',
        preferences: null,
        sessionLifts: ['Barbell Hip Thrust', 'Machine Hip Thrust'],
        query: '',
        language: 'fi',
      });
      assert.ok(!cards.includes('Machine Hip Thrust'), 'offers a lift two rows down');
      assert.ok(!cards.includes('Barbell Hip Thrust'), 'offers the lift being swapped');
      const searched = swapLists.buildSwapAlternatives({
        currentName: 'Barbell Hip Thrust',
        substitutionGroup: 'hip_thrust_bridge',
        preferences: null,
        sessionLifts: ['Barbell Hip Thrust'],
        query: 'machine',
        language: 'en',
      });
      assert.deepEqual(searched, ['Machine Hip Thrust']);
    },
  },
  {
    name: 'swap cards: the player, Home and the programme day draw them through one identical call',
    run() {
      const calls = SCREENS.map((screen) => [screen, read(screen)]);
      const argsByScreen = calls.map(([screen, source]) => [screen, alternativesCallArguments(source, screen)]);
      for (const [screen, source] of calls) {
        // No screen keeps a pool or a cut of its own beside the shared call.
        assert.doesNotMatch(source, /buildSwapShortlist\(/, `${screen} cuts the pool itself`);
        assert.doesNotMatch(source, /buildSwapOptionsForSlot\(/, `${screen} reads the pool itself`);
      }
      const [first, ...rest] = argsByScreen;
      for (const [screen, args] of rest) {
        assert.deepEqual(Object.keys(args).sort(), Object.keys(first[1]).sort(), `${screen} and ${first[0]} pass different inputs`);
      }
      for (const [screen, args] of argsByScreen) {
        assert.equal(args.preferences, 'tailoringPreferences', `${screen}: tailoring preferences`);
        assert.equal(args.sessionLifts, 'swapSessionLifts', `${screen}: the day's lifts`);
        assert.equal(args.query, 'swapQuery', `${screen}: the sheet's query`);
        assert.equal(args.language, 'language', `${screen}: the app language`);
      }
      // Home and the programme day hand the cards to the shared sheet hook;
      // the player draws the same cards as its swapSuggestions.
      for (const screen of SCREENS.slice(1)) {
        assert.match(read(screen), /useSwapPickerLists\(\{[\s\S]{0,200}alternatives: swapAlternatives,/, `${screen}: cards not the hook's alternatives`);
      }
      assert.match(
        read(SCREENS[0]),
        /const swapSuggestions = useMemo\(\s*\(\) =>\s*actionExercise\s*\?\s*buildSwapAlternatives\(\{/,
        'the player: cards not built by buildSwapAlternatives',
      );
    },
  },
  {
    name: 'swap search: any library lift can be reached by typing its name, from every swap sheet',
    run() {
      // Every sheet's library list is buildSwapPickerLibrary (pinned in
      // tests/screens/pickerWiring); typing lifts the lift's own chips.
      const library = createSeedExerciseLibrary();
      const current = library.find((item) => item.name === 'Barbell Full Squat');
      assert.ok(current);
      for (const language of ['fi', 'en']) {
        // A spread across the library: every lift would take seconds.
        for (let index = 0; index < library.length; index += 31) {
          const item = library[index];
          const label = exerciseNameLabel(language, item.name);
          if (label === exerciseNameLabel(language, current.name)) continue;
          const filters = {
            category: effectiveSwapCategory(null, current, label),
            bodyPart: effectiveSwapBodyPart(null, 'quadriceps', label),
            equipment: 'all',
          };
          const rows = buildSwapPickerLibrary(library, {
            query: label,
            filters,
            language,
            currentName: current.name,
            currentItem: current,
            excludeNames: [current.name],
            popularOrder: new Map(),
          });
          assert.ok(
            rows.some((row) => exerciseNameLabel(language, row.name) === label),
            `"${label}" (${language}) cannot be found by its own name`,
          );
        }
      }
    },
  },
];
