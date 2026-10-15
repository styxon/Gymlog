import { useEffect, useState } from 'react';

import type { StorePlanPrices } from '../../lib/storePrices';
import { readStorePlanPrices } from './storeBilling';

/**
 * The current offering's prices, for the screens that quote one.
 *
 * Asked each time such a screen opens — an offering changed by an experiment
 * or a targeting rule shows on the next open, not the next launch — and
 * shared: a screen opened while a read runs joins it. The SDK answers
 * getOfferings from its own cache, filled when it was configured at launch,
 * so the read is local and immediate in the usual case. The last answer is
 * the starting state, so a reopened screen does not flash the dictionary
 * prices. Null until the store answers, and for good in a build without one;
 * lib/storePrices falls back to the dictionary then.
 */
let answered: StorePlanPrices | null = null;
let asking: Promise<StorePlanPrices | null> | null = null;

function askShared(): Promise<StorePlanPrices | null> {
  if (!asking) {
    asking = readStorePlanPrices().then((prices) => {
      // A failed read keeps the last good answer rather than dropping the
      // page back to the dictionary.
      if (prices) {
        answered = prices;
      }
      asking = null;
      return prices;
    });
  }
  return asking;
}

export function useStorePlanPrices(): StorePlanPrices | null {
  const [prices, setPrices] = useState<StorePlanPrices | null>(answered);
  useEffect(() => {
    let live = true;
    void askShared().then((next) => {
      if (live && next) {
        setPrices(next);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return prices;
}
