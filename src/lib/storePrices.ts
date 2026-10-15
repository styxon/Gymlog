import { I18nKey, t } from './i18n';
import type { SubscriptionTermKey } from './subscriptionTerm';
import type { AppLanguage } from '../types/models';

/**
 * The prices the store will actually charge, in place of the dictionary's.
 *
 * The dictionary's price set (i18n `paywall.plan.*.price` and the sentences
 * that quote it) is what the page says when the store has not answered: a
 * demo build, no network, no offering yet. Once RevenueCat hands over the
 * current offering, its packages are the truth — a price experiment, a
 * targeted offering and Play's per-country prices all change what is charged
 * without a new build, and a page that kept quoting the dictionary would sell
 * one price and charge another.
 *
 * So every price-bearing key goes through `storePriceText`: a price the store
 * gave is quoted as the store formatted it, a figure derived from two prices
 * (the yearly saving, "about two years") is recomputed from the store's own
 * numbers, and a derived claim whose inputs the store did not give is dropped
 * (null) rather than carried over from the dictionary, where it would describe
 * prices that are no longer the ones on screen.
 *
 * Pure: the billing service hands in a plain snapshot of each package's
 * product, so this runs in Node.
 */

/** The fields of RevenueCat's PurchasesStoreProduct this reads. */
export interface StorePlanPrice {
  price: number;
  /** Formatted by the store for the device's locale, currency sign included. */
  priceString: string;
  currencyCode: string;
  /** Null for a one-time product. */
  pricePerMonthString: string | null;
}

export type StorePlanPrices = Partial<Record<SubscriptionTermKey, StorePlanPrice>>;

/** Whole percent the yearly plan saves against twelve months, or null when it cannot be said. */
export function yearlySavingPercent(prices: StorePlanPrices): number | null {
  const { monthly, yearly } = prices;
  if (!monthly || !yearly || monthly.currencyCode !== yearly.currencyCode || monthly.price <= 0) {
    return null;
  }
  const percent = Math.round((1 - yearly.price / (monthly.price * 12)) * 100);
  return percent >= 1 ? percent : null;
}

/** How many years of the yearly plan the lifetime price is, rounded, or null. */
export function lifetimeInYears(prices: StorePlanPrices): number | null {
  const { yearly, lifetime } = prices;
  if (!yearly || !lifetime || yearly.currencyCode !== lifetime.currencyCode || yearly.price <= 0) {
    return null;
  }
  const years = Math.round(lifetime.price / yearly.price);
  return years >= 1 ? years : null;
}

const PLAN_PRICE_KEYS: Partial<Record<I18nKey, SubscriptionTermKey>> = {
  'paywall.plan.monthly.price': 'monthly',
  'paywall.plan.yearly.price': 'yearly',
  'pro.page.perLifetime': 'lifetime',
};

/**
 * The text for a price-bearing key. Without store prices it is the dictionary
 * text; with them, the store's. Null means "say nothing here": a derived claim
 * the store's prices do not support.
 */
export function storePriceText(
  language: AppLanguage,
  key: I18nKey,
  prices: StorePlanPrices | null,
  vars?: Record<string, string | number>,
): string | null {
  if (!prices) {
    return t(language, key, vars);
  }
  const plan = PLAN_PRICE_KEYS[key];
  if (plan) {
    // A plan the offering does not carry cannot be bought either; the
    // dictionary price is the label of a button that will say "unavailable".
    return prices[plan]?.priceString ?? t(language, key, vars);
  }
  const { monthly, yearly, lifetime } = prices;
  switch (key) {
    case 'pro.v6.sub.yearly':
      return yearly?.pricePerMonthString ? t(language, 'pro.store.perMonth', { price: yearly.pricePerMonthString }) : null;
    case 'pro.sheet.fineLive':
      return yearly?.pricePerMonthString
        ? t(language, 'pro.store.fineLive', { perMonth: yearly.pricePerMonthString })
        : t(language, 'pro.v3.fine.recurring');
    case 'pro.page.save': {
      const percent = yearlySavingPercent(prices);
      return percent === null ? null : t(language, 'pro.store.save', { percent });
    }
    case 'pro.v6.sub.lifetime': {
      const years = lifetimeInYears(prices);
      // Under two years the line is no argument for the plan, and "about 1
      // years" is not a sentence.
      if (years === null || years < 2) {
        return null;
      }
      // The dictionary's wording is the two-year case; any other ratio gets
      // the number.
      return years === 2 ? t(language, key) : t(language, 'pro.store.lifetimeYears', { years });
    }
    case 'pro.v2.ctaSubYearly':
      if (!yearly) {
        return t(language, 'pro.v3.fine.recurring');
      }
      return yearly.pricePerMonthString
        ? t(language, 'pro.store.thenYearly', { price: yearly.priceString, perMonth: yearly.pricePerMonthString })
        : t(language, 'pro.store.thenYearlyBare', { price: yearly.priceString });
    case 'pro.v2.ctaSubMonthly':
      return monthly ? t(language, 'pro.store.thenMonthly', { price: monthly.priceString }) : t(language, 'pro.v3.fine.recurring');
    case 'pro.v2.ctaSubLifetime':
      return lifetime ? t(language, 'pro.store.once', { price: lifetime.priceString }) : t(language, 'pro.v3.fine.lifetime');
    default:
      return t(language, key, vars);
  }
}
