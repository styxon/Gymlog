const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const { t } = require('../../src/lib/i18n');
const { affinityReasonKey, singularAffinityKey } = require('../../src/lib/programAffinity');
const { resolveProEntitlement } = require('../../src/lib/proEntitlement');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');

module.exports = [
  {
    name: 'singular counts: one-day program lines, one round, one swap and recency read right in both languages',
    run() {
      for (const lang of ['en', 'fi']) {
        for (const key of [
          'catalog.metaDayOne',
          'guided.runSheet.roundOne',
          'coachPreview.lastSession.nextSwapsOne',
          'goalFlow.agoToday',
          'goalFlow.agoDayOne',
          'goalFlow.agoWeekOne',
        ]) {
          assert.ok(!/\b1 (days|päivää|rounds|kierrosta|exercises|liikettä)\b/.test(t(lang, key)), `${lang} ${key}`);
        }
      }
      assert.equal(t('en', 'catalog.metaDayOne'), '1 day');
      assert.equal(t('fi', 'catalog.metaDayOne'), '1 päivä');
      assert.equal(t('fi', 'coachPreview.lastSession.nextSwapsOne').startsWith('Vaihdoit yhden liikkeen'), true);
      assert.equal(t('en', 'guided.runSheet.roundOne'), '1 round');

      // Affinity: the three day-carrying sentences have a one-day form, nextLevel is static.
      assert.equal(t('en', affinityReasonKey('lighterWeek', 1), { days: 1 }), 'Lighter week: 1 day');
      assert.equal(t('fi', affinityReasonKey('sameGoalOtherSplit', 1), { days: 1 }), 'Sama tavoite, 1 päivä viikossa');
      assert.equal(t('en', affinityReasonKey('sameDays', 1), { days: 1 }), 'Fits your 1 day');
      assert.equal(affinityReasonKey('lighterWeek', 3), 'programs.affinity.lighterWeek');
      assert.equal(affinityReasonKey('nextLevel', 1), 'programs.affinity.nextLevel');
      assert.equal(singularAffinityKey('programs.affinity.sameDays', 1), 'programs.affinity.sameDaysOne');
      assert.equal(singularAffinityKey('recExp.daysOne', 1), 'recExp.daysOne');

      // Call sites choose the singular keys.
      const preview = read('src', 'lib', 'aiCoachPreview.ts');
      assert.match(preview, /nextSwapsOne/);
      const catalog = read('src', 'screens', 'OnboardingReadyCatalogScreen.tsx');
      assert.match(catalog, /catalog\.metaDayOne/);
      assert.match(catalog, /catalog\.a11y\.cardOne/);
      const guided = readGuidedPlayerSource();
      assert.equal(guided.split('guided.runSheet.roundOne').length - 1, 2);
      const goal = read('src', 'screens', 'StrengthGoalFlowScreen.tsx');
      assert.match(goal, /goalFlow\.agoToday/);
      assert.match(goal, /goalFlow\.agoDayOne/);
      assert.match(goal, /goalFlow\.agoWeekOne/);
    },
  },
  {
    name: 'chart y-axis labels shrink to fit instead of ellipsizing at large text',
    run() {
      const chart = read('src', 'components', 'SimpleLineChart.tsx');
      assert.match(chart, /adjustsFontSizeToFit/);
      assert.match(chart, /minimumFontScale/);
    },
  },
  {
    name: 'a purchase that outlasts a leftover promo is reported as the purchase',
    run() {
      const now = new Date('2026-10-30T12:00:00.000Z');
      const base = {
        promoProUntil: '2027-03-01T00:00:00.000Z',
        proTrialUntil: null,
        mockSubscriptionPurchasedAt: '2026-10-29T00:00:00.000Z',
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: null,
      };
      assert.equal(resolveProEntitlement(base, now).source, 'purchase');
      // Cancelled and ending before the promo does: the promo stays the reason.
      const ending = {
        ...base,
        mockSubscriptionCancelledAt: '2026-10-30T00:00:00.000Z',
        mockSubscriptionEndsAt: '2026-11-29T00:00:00.000Z',
      };
      assert.equal(resolveProEntitlement(ending, now).source, 'promo');
      // No purchase at all: still promo.
      assert.equal(resolveProEntitlement({ ...base, mockSubscriptionPurchasedAt: null }, now).source, 'promo');
    },
  },
];
