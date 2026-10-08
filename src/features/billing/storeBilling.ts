/**
 * The app's side of the store: Google Play (and later the App Store) through
 * RevenueCat. Thin on purpose — what an answer means is lib/storePurchase, and
 * this file only asks.
 *
 * Configured by EXPO_PUBLIC_REVENUECAT_ANDROID_KEY / _IOS_KEY, the public SDK
 * keys from the RevenueCat dashboard. Without one the store is absent and every
 * call answers 'unavailable', same rule as the coach and backup URLs.
 *
 * The SDK is required on first use, never at the top of a module: every module
 * is evaluated before the first frame, and nothing here is needed for it.
 */
import { Platform } from 'react-native';
import type { CustomerInfo, CustomerInfoUpdateListener, PurchasesPackage } from 'react-native-purchases';

import { storePackageForPlan, type StoreCustomerSnapshot } from '../../lib/storePurchase';
import type { SubscriptionTermKey } from '../../lib/subscriptionTerm';

type PurchasesModule = typeof import('react-native-purchases');

const ANDROID_KEY = (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '').trim();
const IOS_KEY = (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '').trim();

function storeApiKey(): string {
  if (Platform.OS === 'android') {
    return ANDROID_KEY;
  }
  if (Platform.OS === 'ios') {
    return IOS_KEY;
  }
  return '';
}

export function isStoreBillingConfigured(): boolean {
  return storeApiKey().length > 0;
}

let sdk: PurchasesModule | null = null;
let sdkFailed = false;

function loadStore(): PurchasesModule | null {
  if (sdk || sdkFailed) {
    return sdk;
  }
  const apiKey = storeApiKey();
  if (!apiKey) {
    return null;
  }
  try {
    const module = require('react-native-purchases') as PurchasesModule;
    module.default.configure({ apiKey });
    sdk = module;
  } catch (error) {
    // A build without the native module (Expo Go) or a refused key: the store
    // stays absent for this run rather than throwing on every tap.
    sdkFailed = true;
    console.error('Store billing could not start', error);
  }
  return sdk;
}

function snapshotOf(info: CustomerInfo): StoreCustomerSnapshot {
  return info;
}

/** The store's current answer, or null when there is no store or it could not be asked. */
export async function readStoreCustomer(): Promise<StoreCustomerSnapshot | null> {
  const store = loadStore();
  if (!store) {
    return null;
  }
  try {
    return snapshotOf(await store.default.getCustomerInfo());
  } catch (error) {
    console.error('Store billing: reading the purchase failed', error);
    return null;
  }
}

export type StorePurchaseOutcome =
  | { status: 'purchased'; customer: StoreCustomerSnapshot }
  | { status: 'cancelled' }
  /** The store took the order and the payment has not cleared (cash, slow bank). */
  | { status: 'pending' }
  /** No store in this build, or no product set up for the plan yet. */
  | { status: 'unavailable' }
  | { status: 'failed' };

export async function purchaseStorePlan(plan: SubscriptionTermKey): Promise<StorePurchaseOutcome> {
  const store = loadStore();
  if (!store) {
    return { status: 'unavailable' };
  }
  let selected: PurchasesPackage | null = null;
  try {
    const offerings = await store.default.getOfferings();
    selected = offerings.current?.[storePackageForPlan(plan)] ?? null;
  } catch (error) {
    console.error('Store billing: reading the offering failed', error);
    return { status: 'unavailable' };
  }
  if (!selected) {
    return { status: 'unavailable' };
  }
  try {
    const result = await store.default.purchasePackage(selected);
    return { status: 'purchased', customer: snapshotOf(result.customerInfo) };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === store.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { status: 'cancelled' };
    }
    if (code === store.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
      return { status: 'pending' };
    }
    // The store account already owns it (a reinstall, a second phone): that
    // is the reader's Pro, not a failed purchase, so read it back.
    if (code === store.PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
      const owned = await restoreStorePurchases();
      return owned ? { status: 'purchased', customer: owned } : { status: 'failed' };
    }
    console.error('Store billing: the purchase failed', error);
    return { status: 'failed' };
  }
}

/** Asks the store for every purchase on the reader's store account. Null when it could not. */
export async function restoreStorePurchases(): Promise<StoreCustomerSnapshot | null> {
  const store = loadStore();
  if (!store) {
    return null;
  }
  try {
    return snapshotOf(await store.default.restorePurchases());
  } catch (error) {
    console.error('Store billing: restoring failed', error);
    return null;
  }
}

/**
 * Every later answer the store pushes on its own: a renewal, a cancellation
 * made in Play, a refund. Returns the unsubscribe.
 */
export function onStoreCustomerChange(listener: (customer: StoreCustomerSnapshot) => void): () => void {
  const store = loadStore();
  if (!store) {
    return () => undefined;
  }
  const handler: CustomerInfoUpdateListener = (info) => listener(snapshotOf(info));
  store.default.addCustomerInfoUpdateListener(handler);
  return () => {
    store.default.removeCustomerInfoUpdateListener(handler);
  };
}
