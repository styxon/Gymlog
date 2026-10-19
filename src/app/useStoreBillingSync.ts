import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { onStoreCustomerChange, readStoreCustomer } from '../features/billing/storeBilling';
import { isDemoBuild } from '../lib/demoMode';
import { shouldRefreshStoreOnForeground } from '../lib/storeRefreshPolicy';
import { purchaseRecordFromStore, samePurchaseRecord, type StoreCustomerSnapshot } from '../lib/storePurchase';
import type { PreferencesPatch } from '../state/AppProvider';
import { AppPreferences } from '../types/models';

export interface StoreBillingSyncDeps {
  /** The database store has loaded: `useAppContext().hydrated`. */
  hydrated: boolean;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
}

/**
 * Keeps the purchase record in step with the store, in a release build.
 *
 * Once after the stored preferences land, and again whenever the store pushes
 * an answer of its own — a renewal, a cancellation made in Play, a refund.
 * The store is the authority: an answer with no Pro clears the record, which
 * is also what retires a purchase the demo build invented.
 *
 * A failed or absent store changes nothing. The last answer stands until the
 * next one arrives, so a payer who is offline keeps Pro.
 *
 * The demo build never asks: its purchase record is the invented one, and the
 * store would rightly say it does not exist.
 */
export function useStoreBillingSync(deps: StoreBillingSyncDeps): void {
  const { hydrated } = deps;
  // Both through refs: AppProvider hands out a new updatePreferences every
  // render, and the subscription must not be torn down and the store asked
  // again each time.
  const preferencesRef = useRef(deps.preferences);
  preferencesRef.current = deps.preferences;
  const updateRef = useRef(deps.updatePreferences);
  updateRef.current = deps.updatePreferences;

  useEffect(() => {
    if (!hydrated || isDemoBuild()) {
      return;
    }
    let live = true;
    const apply = (customer: StoreCustomerSnapshot) => {
      if (!live) {
        return;
      }
      const next = purchaseRecordFromStore(customer, preferencesRef.current);
      if (samePurchaseRecord(preferencesRef.current, next)) {
        return;
      }
      void updateRef.current(next).catch((error) => {
        console.error('Failed to save the store purchase', error);
      });
    };
    // After the first frame has had its turn: the SDK and its native bridge
    // start here, and none of it is needed to draw Home.
    let unsubscribe: () => void = () => undefined;
    let appStateSubscription: { remove: () => void } | null = null;
    let reading = false;
    const read = () => {
      if (reading) {
        return;
      }
      reading = true;
      void readStoreCustomer()
        .then((customer) => {
          if (customer) {
            apply(customer);
          }
        })
        .finally(() => {
          reading = false;
        });
    };
    const timer = setTimeout(() => {
      unsubscribe = onStoreCustomerChange(apply);
      read();
      // A renewal that went through while the app was closed (a billing-retry
      // payer whose card cleared) reaches us only by asking. Once per return
      // to the front, one read at a time, and only for a record whose answer
      // could differ (storeRefreshPolicy). The store is RevenueCat's SDK.
      appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state === 'active' && shouldRefreshStoreOnForeground(preferencesRef.current)) {
          read();
        }
      });
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
      unsubscribe();
      appStateSubscription?.remove();
    };
  }, [hydrated]);
}
