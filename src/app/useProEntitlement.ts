import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import {
  ProEntitlement,
  entitlementRecheckDelayMs,
  proEntitlementEndsAtMs,
  resolveProEntitlement,
} from '../lib/proEntitlement';
import type { AppPreferences } from '../types/models';

/**
 * The Pro entitlement as of now, read again the moment it runs out.
 *
 * `resolveProEntitlement` reads the clock, but only when something renders.
 * An app left open past a promo's, trial's or cancelled purchase's end kept
 * Pro on until the next unrelated render: the coach took one more billed
 * question and the Programs line counted Pro's cap (bug hunt, 2026-10-29).
 *
 * Two triggers, like `useTodayKey`: a timer for a second past the end, and a
 * return to the foreground for the phone that slept through it. `checkedAt`
 * changes on each, so a memo that reads the entitlement can depend on it.
 */
export function useProEntitlement(preferences: AppPreferences) {
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  // Read at the real now, not at `checkedAt`: a preferences change hours after
  // the last check must not resolve against that older instant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const proEntitlement = useMemo(() => resolveProEntitlement(preferences), [preferences, checkedAt]);

  useEffect(() => {
    const delay = entitlementRecheckDelayMs(proEntitlementEndsAtMs(proEntitlement), Date.now());
    // The timer is re-armed by the entitlement it re-reads, so a fire capped
    // short of a far end simply arms the next one.
    const timer = delay === null ? undefined : setTimeout(() => setCheckedAt(Date.now()), delay);
    const subscription = AppState.addEventListener('change', (state) => {
      // Only when the answer moved: a return to the app redraws all of it, and
      // most returns change nothing.
      if (state === 'active' && !sameEntitlement(resolveProEntitlement(preferences), proEntitlement)) {
        setCheckedAt(Date.now());
      }
    });
    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
    // preferences is read through proEntitlement, which is rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proEntitlement]);

  return { proEntitlement, entitlementCheckedAt: checkedAt };
}

function sameEntitlement(a: ProEntitlement, b: ProEntitlement): boolean {
  return (
    a.unlocked === b.unlocked &&
    a.source === b.source &&
    a.promoUntil === b.promoUntil &&
    a.purchaseEndsAt === b.purchaseEndsAt
  );
}
