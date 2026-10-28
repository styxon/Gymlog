const assert = require('node:assert/strict');
const { parseGoalIntent } = require('../../src/lib/goalIntent');
const { parseMeasurementIntent } = require('../../src/lib/measurementIntent');

module.exports = [
  {
    name: 'goalIntent: a stated goal parses, with and without a target number',
    run() {
      const plain = parseGoalIntent('Yritän kasvattaa rinnanympärystä', 'fi');
      assert.ok(plain, 'goal without a number should parse');
      assert.equal(plain.kind, 'chest');
      assert.equal(plain.targetValue, null);
      assert.equal(plain.unit, null);

      const withTarget = parseGoalIntent('tavoite rinnanympärys 104 cm', 'fi');
      assert.ok(withTarget);
      assert.equal(withTarget.kind, 'chest');
      assert.equal(withTarget.targetValue, 104);
      assert.equal(withTarget.unit, 'cm');

      // "laskea painoa 78 kg" lowers by 78 kg, not to it — a relative
      // phrasing, so the number is not kept (was pinned at 78 kg before the
      // relative/absolute fix; see the suite below).
      const weight = parseGoalIntent('haluan laskea painoa 78 kg', 'fi');
      assert.ok(weight);
      assert.equal(weight.kind, 'bodyweight');
      assert.equal(weight.targetValue, null);
      assert.equal(weight.unit, null);

      const english = parseGoalIntent('I want to grow my chest to 104 cm', 'en');
      assert.ok(english);
      assert.equal(english.kind, 'chest');
      assert.equal(english.targetValue, 104);
    },
  },
  {
    name: 'goalIntent: questions, plain statements and unit mismatches do not become goals',
    run() {
      assert.equal(parseGoalIntent('Onko tavoitteeni kasvattaa rintaa hyvä?', 'fi'), null, 'question mark kills it');
      assert.equal(parseGoalIntent('rinnanympärys on 98 cm', 'fi'), null, 'a reading is not a goal');
      assert.equal(parseGoalIntent('haluan tietää rinnanympärykseni', 'fi'), null, 'no direction word');
      assert.equal(parseGoalIntent('tavoitteena on jaksaa paremmin', 'fi'), null, 'no body-part word');

      // "tavoite rinta 104 kg" is a bench dream: the goal survives, the number does not.
      const mismatch = parseGoalIntent('tavoite on kasvattaa rintaa 104 kg', 'fi');
      assert.ok(mismatch);
      assert.equal(mismatch.targetValue, null);
    },
  },
  {
    name: 'goalIntent: a goal the coach declared is read from its own words, not held to the sniffer',
    run() {
      // The reader wrote "haluisin painaa 80kg"; the coach offered to save
      // "painaa 80 kg". The trim dropped the goal word the sniffer demands, so
      // the offer was discarded while the answer kept telling them to press a
      // button ("En nää nappia", log 2026-08-25).
      assert.equal(parseGoalIntent('painaa 80 kg', 'fi'), null, 'unprompted, this is still not a stated goal');

      const declared = parseGoalIntent('painaa 80 kg', 'fi', { declared: true });
      assert.ok(declared, 'the coach already said this is a goal');
      assert.equal(declared.kind, 'bodyweight');
      assert.equal(declared.targetValue, 80);
      assert.equal(declared.unit, 'kg');

      // Declared or not, a goal still has to name something the app can track,
      // or the button saves a sentence nothing can ever measure against.
      assert.equal(parseGoalIntent('jaksaa paremmin', 'fi', { declared: true }), null);
      assert.equal(parseGoalIntent('onko tämä hyvä', 'fi', { declared: true }), null, 'a question is never a goal');

      // The reader's full sentence must keep working — it is what the coach is
      // now told to pass through unchanged.
      const verbatim = parseGoalIntent('haluisin painaa 80 kg', 'fi', { declared: true });
      assert.equal(verbatim.kind, 'bodyweight');
      assert.equal(verbatim.targetValue, 80);
    },
  },
  {
    // A relative phrasing states a change from wherever the reader is now,
    // not the goal's own number: "nosta painoa 5 kg" from an 85 kg reader is
    // not a 5 kg goal. The goal survives; the number does not — the same
    // conservative call a unit mismatch already gets.
    name: 'goalIntent: a number phrased as a change from now, not as the target, is kept as a goal without a number',
    run() {
      const relativeCases = [
        'haluan lisätä painoa 10 kg',
        'haluan pudottaa painoa 8 kg',
        'nosta painoa 5 kg',
        'I want to gain 10 kg of weight',
        'I want to lose 10 kg of weight',
      ];
      for (const text of relativeCases) {
        const goal = parseGoalIntent(text, 'fi', { declared: true });
        assert.ok(goal, `${text} should still be a goal`);
        assert.equal(goal.targetValue, null, `${text} kept a relative amount as an absolute target`);
        assert.equal(goal.unit, null, `${text}`);
      }

      const absoluteCases = [
        { text: 'tavoite paino 95 kg', kind: 'bodyweight', value: 95 },
        { text: 'haluan painaa 80 kg', kind: 'bodyweight', value: 80 },
        { text: 'rinnanympärys 104 cm', kind: 'chest', value: 104 },
        // "kasvattaa" is also a change verb ("kasvattaa painoa 10 kg" reads
        // as a delta), but it is left out of RELATIVE_WORDS on purpose: it is
        // also the ordinary way to name a measurement target itself, and
        // "haluan kasvattaa rinnanympärystä 104 cm" has always kept its
        // number (see the suite below). Matching "kasvat" as relative would
        // silently drop that number — the regression this suite guards.
        { text: 'haluan kasvattaa rinnanympärystä 104 cm', kind: 'chest', value: 104 },
      ];
      for (const { text, kind, value } of absoluteCases) {
        const goal = parseGoalIntent(text, 'fi', { declared: true });
        assert.ok(goal, `${text} should be a goal`);
        assert.equal(goal.kind, kind, text);
        assert.equal(goal.targetValue, value, `${text} dropped an absolute target`);
      }
    },
  },
  {
    // Recheck round, 2026-09-29: RELATIVE_WORDS treated "nosta"/"nostaa"/
    // "laske"/"laskea" as relative even when the sentence names the number as
    // its own destination rather than a change from now — the illative/
    // allative case on the unit ("90 kg:aan", "90 kiloon"), the "asti"
    // postposition, or English "to 90 kg" all say so, and none of them
    // changed RELATIVE_WORDS' answer before this fix.
    name: 'goalIntent: a destination the number itself names overrides a growth/shrink verb that would otherwise drop it',
    run() {
      const absoluteDestinationCases = [
        { text: 'Tavoitteeni on nostaa painoni 90 kg:aan', kind: 'bodyweight', value: 90 },
        { text: 'haluan nostaa painon 90 kiloon', kind: 'bodyweight', value: 90 },
        { text: 'laskea painoni 80 kg:aan', kind: 'bodyweight', value: 80 },
        { text: 'haluan nostaa painoni 90 kg:aan asti', kind: 'bodyweight', value: 90 },
        { text: 'I want to raise my weight to 90 kg', kind: 'bodyweight', value: 90 },
      ];
      for (const { text, kind, value } of absoluteDestinationCases) {
        const goal = parseGoalIntent(text, 'fi', { declared: true });
        assert.ok(goal, `${text} should be a goal`);
        assert.equal(goal.kind, kind, text);
        assert.equal(goal.targetValue, value, `${text} dropped a destination the sentence named`);
        assert.equal(goal.unit, 'kg', text);
      }

      // The same verbs, with no destination marker, stay relative — the fix
      // must not swallow the cases it was already getting right. (A body or
      // weight word is required for any of these to be read as a goal at
      // all, so "lisää 10 kg" and "5 kg lisää" carry "painoa" the way the
      // existing relative cases above do.)
      const stillRelativeCases = [
        'nosta painoa 5 kg',
        'haluan lisää painoa 10 kg',
        'I want to gain 10 kg of weight',
        'I want to lose 5 kg of weight',
        'haluan painoa 5 kg lisää',
      ];
      for (const text of stillRelativeCases) {
        const goal = parseGoalIntent(text, 'fi', { declared: true });
        assert.ok(goal, `${text} should still be a goal`);
        assert.equal(goal.targetValue, null, `${text} should stay relative (no target)`);
      }
    },
  },
  {
    // Recheck round, 2026-09-29: the destination check above was matched
    // against the whole message, not anchored to the number it was overriding
    // RELATIVE_WORDS for. "asti" ("kesäkuuhun asti", until June — a date, not
    // a weight) and English "to" ("1 to 10", a scale, not the number being
    // lost) both said "destination" for a number they had nothing to do
    // with, flipping a genuinely relative delta into a false absolute target.
    name: 'goalIntent: a destination word elsewhere in the sentence does not turn an unrelated relative number absolute',
    run() {
      const stillRelativeCases = [
        // "asti" belongs to "kesäkuuhun" (until June), not to "5 kg" — the
        // number stays a relative delta, exactly like "nosta painoa 5 kg".
        { text: 'nosta painoa 5 kg asti kesäkuuhun', language: 'fi' },
        // "to 10" is an unrelated scale reference; the number actually named
        // is "5 kg", stated as a loss with no destination marker on it.
        { text: 'on a scale of 1 to 10 I want to lose 5 kg of my weight', language: 'en' },
      ];
      for (const { text, language } of stillRelativeCases) {
        const goal = parseGoalIntent(text, language, { declared: true });
        assert.ok(goal, `${text} should still be a goal`);
        assert.equal(goal.targetValue, null, `${text} read an unrelated destination word as the number's own`);
        assert.equal(goal.unit, null, text);
      }

      // The same markers still work when they actually sit on the number.
      const stillAbsoluteCases = [
        { text: 'haluan nostaa painoni 90 kg:aan asti kesäkuuhun', language: 'fi', value: 90 },
        { text: 'I want to raise my weight to 90 kg by June', language: 'en', value: 90 },
      ];
      for (const { text, language, value } of stillAbsoluteCases) {
        const goal = parseGoalIntent(text, language, { declared: true });
        assert.ok(goal, `${text} should be a goal`);
        assert.equal(goal.targetValue, value, `${text} dropped a destination the sentence actually named`);
      }
    },
  },
  {
    name: 'goalIntent: a goal with a number never leaks into the measurement logger',
    run() {
      // Was swapped to "tavoite rinnanympärys 104 cm" during the
      // relative/absolute fix, worked around a regression instead of fixing
      // it (caught in review, 2026-09-29): with "kasvat" ever treated as a
      // relative word this exact sentence loses its number. Restored to the
      // original growth-verb phrasing so this suite still guards it.
      const text = 'haluan kasvattaa rinnanympärystä 104 cm';
      assert.equal(parseMeasurementIntent(text, 'fi'), null, 'measurement parser must reject goal sentences');
      const goal = parseGoalIntent(text, 'fi');
      assert.ok(goal);
      assert.equal(goal.targetValue, 104);
    },
  },
];
