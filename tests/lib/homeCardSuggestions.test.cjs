const assert = require('node:assert/strict');

const { suggestHomeStatCardKeys } = require('../../src/lib/homeCardSuggestions');

const base = { focusAreas: [], goals: [], pinnedKeys: [], dismissedKeys: [] };

module.exports = [
  {
    // Onboarding asks which areas the reader cares about and then nothing on
    // Home ever used the answer.
    name: 'a named focus area becomes its measurement',
    run() {
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, focusAreas: ['chest'] }), ['chest']);
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, focusAreas: ['glutes'] }), ['hips']);
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, focusAreas: ['quads'] }), ['thighs']);
    },
  },
  {
    name: 'two focus areas on the same tape suggest it once',
    run() {
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, focusAreas: ['quads', 'hamstrings'] }), ['thighs']);
    },
  },
  {
    name: 'a growth goal adds the scale, after the areas they named',
    run() {
      assert.deepEqual(
        suggestHomeStatCardKeys({ ...base, focusAreas: ['chest'], goals: ['muscle'] }),
        ['chest', 'bodyweight'],
      );
    },
  },
  {
    // A stronger squat shows in the lift's own card; telling a strength
    // trainee to watch the scale suggests a relationship the app cannot
    // stand behind.
    name: 'strength does not get told to watch the scale',
    run() {
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, goals: ['strength'] }), []);
    },
  },
  {
    name: 'nothing already on Home, and nothing already declined, is offered',
    run() {
      assert.deepEqual(
        suggestHomeStatCardKeys({ ...base, focusAreas: ['chest'], pinnedKeys: ['chest'] }),
        [],
      );
      assert.deepEqual(
        suggestHomeStatCardKeys({ ...base, focusAreas: ['chest'], dismissedKeys: ['chest'] }),
        [],
      );
    },
  },
  {
    name: 'an area with no tape measure suggests nothing rather than guessing',
    run() {
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, focusAreas: ['mobility', 'conditioning'] }), []);
      assert.deepEqual(suggestHomeStatCardKeys({ ...base, goals: [null] }), []);
    },
  },
  {
    /**
     * Every area the reader named gets an offer, not just the first.
     *
     * Home showed one suggestion at a time, on the reasoning that a stack of
     * offers is a to-do list nobody asked for. The reader picked back,
     * glutes, hamstrings and abs, saw one card, and asked why only one of
     * their four answers had been used (#bugs 2026-08-31) — an offer they
     * never see reads as an answer that was thrown away.
     */
    name: 'the section offers every suggestion at once, not one at a time',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'HomeStatCardsSection.tsx'),
        'utf8',
      );
      // A list, and every member of it rendered.
      assert.match(source, /const suggestions = useMemo\(/);
      assert.match(source, /suggestions\.map\(\(suggestion, suggestionIndex\) => \(/);
      // Not the old `.find` that kept the rest of them off the screen.
      assert.doesNotMatch(source, /const suggestion = useMemo\(/);
      // The identical sentence appears once: under every card it stops being
      // an explanation and becomes wallpaper.
      assert.match(source, /suggestionIndex === 0 \? \(/);
      // And the suggester itself still hands over every area that has a tape.
      assert.deepEqual(
        suggestHomeStatCardKeys({
          focusAreas: ['back', 'glutes', 'hamstrings', 'core'],
          goals: [],
          pinnedKeys: [],
          dismissedKeys: [],
        }),
        ['back', 'hips', 'thighs', 'waist'],
      );
    },
  },
];
