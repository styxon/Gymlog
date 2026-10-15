const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  lifetimeInYears,
  storePriceText,
  yearlySavingPercent,
} = require('../../.test-dist/lib/storePrices.js');
const { t } = require('../../.test-dist/lib/i18n.js');

const ROOT = path.join(__dirname, '..', '..');

const plan = (price, priceString, pricePerMonthString = null, currencyCode = 'EUR') => ({
  price,
  priceString,
  currencyCode,
  pricePerMonthString,
});

// A price set that is not the dictionary's, so a fallback cannot pass for the store.
const STORE = {
  monthly: plan(7.99, '7,99 €', '7,99 €'),
  yearly: plan(59.99, '59,99 €', '5,00 €'),
  lifetime: plan(149, '149,00 €'),
};

module.exports = [
  {
    name: 'store prices: without the store every key is the dictionary text',
    run() {
      for (const key of [
        'paywall.plan.yearly.price',
        'pro.page.save',
        'pro.v6.sub.yearly',
        'pro.v6.sub.lifetime',
        'pro.sheet.fineLive',
        'pro.v2.ctaSubYearly',
      ]) {
        assert.equal(storePriceText('fi', key, null), t('fi', key));
      }
    },
  },
  {
    name: 'store prices: the plan prices are quoted as the store formatted them',
    run() {
      assert.equal(storePriceText('fi', 'paywall.plan.monthly.price', STORE), '7,99 €');
      assert.equal(storePriceText('en', 'paywall.plan.yearly.price', STORE), '59,99 €');
      assert.equal(storePriceText('fi', 'pro.page.perLifetime', STORE), '149,00 €');
      assert.equal(storePriceText('fi', 'pro.v6.sub.yearly', STORE), '5,00 € / kuukausi');
      assert.equal(storePriceText('en', 'pro.v2.ctaSubYearly', STORE), 'Then 59,99 € / year (5,00 €/mo). Cancel anytime.');
      assert.equal(storePriceText('fi', 'pro.v2.ctaSubMonthly', STORE), 'Sitten 7,99 € / kk. Peru milloin vain.');
      assert.equal(storePriceText('fi', 'pro.v2.ctaSubLifetime', STORE), 'Yksi maksu, 149,00 €. Sen jälkeen se on sinun.');
      assert.equal(storePriceText('en', 'pro.sheet.fineLive', STORE), 'Billed yearly, 5,00 €/mo. Cancel any time.');
      // Not a price key: untouched.
      assert.equal(storePriceText('fi', 'pro.page.yearly', STORE), t('fi', 'pro.page.yearly'));
    },
  },
  {
    name: 'store prices: the yearly saving is recomputed from the store, never carried over',
    run() {
      // 59,99 against 7,99 x 12 = 95,88 is 37.4% off.
      assert.equal(yearlySavingPercent(STORE), 37);
      assert.equal(storePriceText('en', 'pro.page.save', STORE), 'Save 37%');
      assert.equal(storePriceText('fi', 'pro.page.save', STORE), 'Säästä 37 %');
      // The dictionary's own prices give the dictionary's own figure.
      const dictionary = { monthly: plan(9.9, '9,90 €'), yearly: plan(79.9, '79,90 €') };
      assert.equal(storePriceText('fi', 'pro.page.save', dictionary), t('fi', 'pro.page.save'));
      // No saving to claim: no monthly to compare, two currencies, or no discount.
      assert.equal(storePriceText('en', 'pro.page.save', { yearly: STORE.yearly }), null);
      assert.equal(yearlySavingPercent({ monthly: plan(10, '$10', null, 'USD'), yearly: STORE.yearly }), null);
      assert.equal(yearlySavingPercent({ monthly: plan(5, '5 €'), yearly: plan(60, '60 €') }), null);
    },
  },
  {
    name: 'store prices: the lifetime-in-years line follows the store ratio',
    run() {
      // 149 against 59,99 a year is 2.48 years: still the dictionary's "two".
      assert.equal(lifetimeInYears(STORE), 2);
      assert.equal(storePriceText('fi', 'pro.v6.sub.lifetime', STORE), t('fi', 'pro.v6.sub.lifetime'));
      const three = { yearly: plan(50, '50 €'), lifetime: plan(149, '149 €') };
      assert.equal(storePriceText('fi', 'pro.v6.sub.lifetime', three), 'noin 3 vuoden tilaus');
      assert.equal(storePriceText('en', 'pro.v6.sub.lifetime', { lifetime: STORE.lifetime }), null);
      const one = { yearly: plan(100, '100 €'), lifetime: plan(120, '120 €') };
      assert.equal(storePriceText('en', 'pro.v6.sub.lifetime', one), null);
    },
  },
  {
    name: 'store prices: a missing package keeps the claim it can still make',
    run() {
      const yearlyOnly = { yearly: STORE.yearly };
      // A price the store did not give cannot be bought; its label stays.
      assert.equal(storePriceText('fi', 'paywall.plan.monthly.price', yearlyOnly), t('fi', 'paywall.plan.monthly.price'));
      // A sentence that would quote it falls back to the price-free line.
      assert.equal(storePriceText('fi', 'pro.v2.ctaSubMonthly', yearlyOnly), t('fi', 'pro.v3.fine.recurring'));
      assert.equal(storePriceText('fi', 'pro.v2.ctaSubLifetime', yearlyOnly), t('fi', 'pro.v3.fine.lifetime'));
      // A yearly product with no monthly figure loses the "/mo" half, not the price.
      const noPerMonth = { yearly: plan(59.99, '59,99 €') };
      assert.equal(storePriceText('en', 'pro.v2.ctaSubYearly', noPerMonth), 'Then 59,99 € / year. Cancel anytime.');
      assert.equal(storePriceText('en', 'pro.v6.sub.yearly', noPerMonth), null);
      assert.equal(storePriceText('en', 'pro.sheet.fineLive', noPerMonth), t('en', 'pro.v3.fine.recurring'));
    },
  },
  {
    name: 'store prices: the selling surfaces read prices through storePriceText',
    run() {
      // Written but not wired is the bug this module exists to prevent: a
      // screen that still calls t() on a price key quotes the dictionary
      // while the store charges something else.
      const surfaces = {
        'src/screens/PremiumScreen.tsx': [/t\(language, entry\.priceKey\)/, /t\(language, entry\.subKey\)/, /t\(language, entry\.badgeKey\)/, /t\(language, fineKey\)/],
        'src/components/ProMomentSheet.tsx': [/'pro\.sheet\.fineLive' : 'pro\.sheet\.fine'\)/],
      };
      for (const [file, raw] of Object.entries(surfaces)) {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.match(code, /storePriceText\(/, `${file} must quote the store's prices`);
        assert.match(code, /useStorePlanPrices\(/, `${file} must ask the store for them`);
        for (const shape of raw) {
          assert.doesNotMatch(code, shape, `${file} still reads a price straight from the dictionary`);
        }
      }
      const subs = fs.readFileSync(path.join(ROOT, 'src/screens/SubscriptionScreen.tsx'), 'utf8');
      assert.match(subs, /storePriceText\(language, term!\.priceKey, storePrices\)/, 'the store renewal line must quote the store price');
      // The receipt after a purchase names the price just charged: the store's.
      const unlock = fs.readFileSync(path.join(ROOT, 'src/screens/PremiumUnlockScreen.tsx'), 'utf8');
      assert.match(unlock, /useStorePlanPrices\(\)/, 'the unlock receipt must ask the store for its prices');
      assert.match(unlock, /storePriceText\(language, receipt\.priceKey, storePrices\)/, 'the unlock receipt must quote the store price');
      assert.doesNotMatch(unlock, /\{t\(language, receipt\.priceKey\)\}|price: t\(language, receipt\.priceKey\)/, 'the receipt still reads its price from the dictionary');
    },
  },
];
