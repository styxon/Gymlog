import { t } from '../lib/i18n';
import type { AppLanguage } from '../types/models';
import { haptics } from '../utils/haptics';

/**
 * A programme write the store refused: logged, felt, and said out loud.
 *
 * Every programme edit that used to spring back unsaid (the day and programme
 * renames, the rhythm, the added and removed days, the picked session, the
 * start) answers a refusal the same three ways, and each call site wrote the
 * three lines itself. One place now, so a fourth cannot be left out of one of
 * them. `what` is the log line; the toast is the reader's.
 */
export function reportPlanSaveFailed(
  what: string,
  error: unknown,
  language: AppLanguage,
  showToast: (message: string) => void,
): void {
  console.error(what, error);
  void haptics.error();
  showToast(t(language, 'toast.planSaveFailed'));
}
