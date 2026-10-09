/**
 * Whether the app can say money moves.
 *
 * Two lines of Pro copy were written while the app had no billing: "Payments
 * are not live yet" on the receipt, and "Billing is not live yet - nothing is
 * charged" under the buy button. They are true of the demo build and of a
 * build without a store key, and false the moment a configured release build
 * buys from the store (hunt 9, 2026-10-09). One predicate, so the copy follows
 * the same two facts the purchase itself branches on (renderProfileTab):
 * isDemoBuild and isStoreBillingConfigured.
 */
export function paymentsAreLive(demoBuild: boolean, storeConfigured: boolean): boolean {
  return !demoBuild && storeConfigured;
}
