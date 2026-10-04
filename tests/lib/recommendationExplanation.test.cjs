const assert = require('node:assert/strict');

const { buildRecommendationReasonLines } = require('../../.test-dist/lib/recommendationExplanation.js');
const { buildRecommendationInput } = require('../../.test-dist/lib/recommendationInput.js');
const { recommendPrograms } = require('../../.test-dist/lib/recommendationScoring.js');

module.exports = [
  {
    name: 'recommendation explanation builds concise reasons from onboarding inputs',
    run() {
      const reasons = buildRecommendationReasonLines(
        {
          goal: 'muscle',
          level: 'advanced',
          daysPerWeek: 4,
          equipment: 'gym',
          secondaryOutcomes: ['strength'],
          focusAreas: ['arms'],
          guidanceMode: 'guided_editable',
          scheduleMode: 'self_managed',
          weeklyMinutes: 220,
          availableDays: ['mon', 'tue', 'thu', 'sat'],
          unitPreference: 'kg',
        },
        {
          projectedDaysPerWeek: 4,
          estimatedSessionDuration: 55,
          mismatchNote: null,
        },
      );

      assert.equal(reasons.length >= 3, true);
      assert.match(reasons[0], /muscle/i);
      assert.match(reasons[1], /220 minutes|220/i);
      assert.match(reasons[2], /Arms|focus/i);
    },
  },
  {
    // Bug hunt, 2026-10-04: the line named Mon/Wed/Fri for a reader who offered
    // Tue + Wed, said "1 days", had no rhythm for 6, and was English only.
    name: 'why-it-fits names only days the reader gave, pluralises, and speaks the app language',
    run() {
      const base = {
        goal: 'strength',
        level: 'advanced',
        daysPerWeek: 3,
        equipment: 'gym',
        secondaryOutcomes: [],
        focusAreas: [],
        guidanceMode: 'guided_editable',
        scheduleMode: 'self_managed',
        weeklyMinutes: 150,
        availableDays: ['tue', 'wed'],
        unitPreference: 'kg',
      };
      const lines = (selection, projectedDaysPerWeek, language) =>
        buildRecommendationReasonLines(selection, { projectedDaysPerWeek, language });

      // Fewer days offered than the programme needs: no weekday is invented.
      const fewer = lines(base, 3, 'en');
      assert.ok(!fewer.some((line) => /Mon|Fri/.test(line)), fewer.join(' | '));
      assert.equal(fewer[1], 'About 150 min this week.');

      // Exactly the offered days, and a best spread when more are offered.
      assert.equal(lines({ ...base, availableDays: ['tue', 'thu', 'sat'] }, 3, 'en')[1], '150 min across Tue, Thu, and Sat.');
      const spread = lines({ ...base, availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, 6, 'en');
      assert.match(spread[1], /^150 min across (Mon|Tue|Wed|Thu|Fri|Sat|Sun)(, (Mon|Tue|Wed|Thu|Fri|Sat|Sun)){4}, and /);
      const six = lines({ ...base, availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }, 6, 'en');
      assert.equal(six[1], '150 min across Mon, Tue, Wed, Thu, Fri, and Sat.');
      const one = lines({ ...base, availableDays: ['wed'] }, 1, 'en');
      assert.equal(one[0], '1 day for strength.');
      assert.equal(one[1], '150 min across Wed.');

      // Finnish: no English left in the lines this function writes.
      const fi = lines({ ...base, availableDays: ['tue', 'thu', 'sat'] }, 3, 'fi');
      assert.equal(fi[0], '3 päivää viikossa, tavoite: voima.');
      assert.equal(fi[1], '150 min, Ti, To ja La.');
      assert.equal(lines({ ...base, availableDays: ['wed'] }, 1, 'fi')[0], '1 päivä viikossa, tavoite: voima.');
      for (const language of ['en', 'fi']) {
        for (const line of lines({ ...base, goal: 'run_mobility', equipment: 'home', focusAreas: ['arms'] }, 3, language)) {
          assert.ok(!/\b1 days\b/.test(line), line);
        }
      }
      assert.ok(!/[A-Za-z]{4,} (for|across|this week)/.test(fi.join(' ')), fi.join(' | '));
    },
  },
];
