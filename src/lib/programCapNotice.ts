import { placesToFree, resolveActiveProgramCap } from './activeProgramSet';
import { I18nKey, t } from './i18n';
import type { AppLanguage } from '../types/models';

/**
 * How full the set of running programmes is, for the line the programme list
 * shows above itself.
 *
 * The cap was enforced and never mentioned until the try that failed, so the
 * reader met it as a refusal rather than as a number they had been watching
 * (user 2026-08-26).
 *
 * This began as a toast on every adoption and was the wrong shape twice over.
 * A popup that says what the screen behind it already shows is exactly what the
 * reader keeps asking to be rid of ("otit ohjelman käyttöön", #bugs
 * 2026-08-26); and a count nobody is near is a sign about nothing, which
 * teaches people to stop reading signs. So it lives on the list it describes,
 * and appears only once there is one place left. The point was never to
 * report — it was to stop the cap arriving as news.
 *
 * Two caps exist and only this one belongs here. `FREE_CUSTOM_PROGRAM_LIMIT`
 * counts programmes you have BUILT; this one counts programmes you are
 * RUNNING, and it is the one adopting spends.
 */

export interface ProgramCapState {
  used: number;
  cap: number;
  /** Every place taken: the next choice means dropping something. */
  atCap: boolean;
  /** One place left. The last moment a warning can still be useful. */
  lastPlace: boolean;
  /**
   * Past the cap, not at it: a lapsed Pro keeps what it was running. Stopping
   * one is not enough to start another, and the line has to say how many.
   */
  over: boolean;
}

export interface ProgramCapStateInput {
  /** Ids running right now. */
  activePlanIds: readonly string[];
  proUnlocked: boolean;
}

export function describeProgramCap({ activePlanIds, proUnlocked }: ProgramCapStateInput): ProgramCapState {
  const cap = resolveActiveProgramCap(proUnlocked);
  // De-duplicated: the set is written that way everywhere, but a stored list
  // from an older build can still hold a repeat, and counting one twice would
  // tell a reader with one programme that they are full.
  const used = new Set(activePlanIds).size;
  return {
    used,
    cap,
    atCap: used >= cap,
    lastPlace: used === cap - 1,
    over: used > cap,
  };
}

/**
 * The i18n key for the line, or null when there is nothing worth saying.
 *
 * Null is the common answer, and it is the whole design: a reader with one
 * programme of five places is not being warned about anything.
 */
export function programCapLineKey(state: ProgramCapState): 'over' | 'atCap' | 'lastPlace' | null {
  if (state.over) {
    return 'over';
  }
  if (state.atCap) {
    return 'atCap';
  }
  return state.lastPlace ? 'lastPlace' : null;
}

/**
 * The refusal toast for a full set (a Pro reader at five, who has no sheet to
 * be sent to). "You are running {cap}" was only true AT the cap; past it, it
 * named the wrong number and a drop of one was not enough.
 */
export function programCapFullMessage(language: AppLanguage, used: number, cap: number): string {
  return used > cap
    ? t(language, 'programs.cap.fullOver', { used, cap, count: placesToFree(used, cap) })
    : t(language, 'programs.cap.full', { cap });
}

/**
 * A running-cap refusal, in the numbers the reader can see.
 *
 * Start next measures the cap without the finished programme it replaces
 * (runningSetWithout), and the sheet and the toast were handed that reduced
 * count: a lapsed Pro reader running five read "4 are running" while the
 * Programs tab said 5/2, and at three, "full 2/2" (hunt 10, #20). The count
 * shown is the set running now; when it is larger than the one the decision
 * measured, a replacement is pending, and `replacingStop` is how many of the
 * others to stop — measured on the set without the finished one.
 */
export interface RunningCapRefusal {
  used: number;
  cap: number;
  /** Null unless the refused start replaces a finished programme. */
  replacingStop: number | null;
}

export function runningCapRefusal(
  runningNow: readonly string[],
  decision: { used: number; cap: number },
): RunningCapRefusal {
  const now = new Set(runningNow).size;
  return now > decision.used
    ? { used: now, cap: decision.cap, replacingStop: placesToFree(decision.used, decision.cap) }
    : { used: decision.used, cap: decision.cap, replacingStop: null };
}

/** The refusal toast (programCapFullMessage), with the replacement said. */
export function runningCapRefusalMessage(language: AppLanguage, refusal: RunningCapRefusal): string {
  return refusal.replacingStop !== null
    ? t(language, 'programs.cap.fullReplace', {
        used: refusal.used,
        cap: refusal.cap,
        count: refusal.replacingStop,
      })
    : programCapFullMessage(language, refusal.used, refusal.cap);
}

/**
 * The limit sheet's words for how full the set is.
 *
 * The same sheet for both limits (own programmes, programmes running), and for
 * both a reader AT the limit and one past it. Past it the title and body name
 * how many to give up before one more fits; "stop one" was a promise the
 * second refusal broke.
 */
export function programLimitSheetCopy(
  kind: 'own' | 'running',
  used: number,
  limit: number,
  /** RunningCapRefusal's: how many others to stop when a finished one makes way. */
  replacingStop: number | null = null,
): { titleKey: I18nKey; bodyKey: I18nKey; vars: { used: number; limit: number; count: number } } {
  const over = used > limit;
  const vars = { used, limit, count: placesToFree(used, limit) };
  if (kind === 'running' && replacingStop !== null) {
    return {
      titleKey: 'programLimit.running.overTitle',
      bodyKey: 'programLimit.running.replaceBody',
      vars: { used, limit, count: replacingStop },
    };
  }
  if (kind === 'running') {
    return over
      ? { titleKey: 'programLimit.running.overTitle', bodyKey: 'programLimit.running.overBody', vars }
      : { titleKey: 'programLimit.running.title', bodyKey: 'programLimit.running.body', vars };
  }
  return over
    ? { titleKey: 'programLimit.overTitle', bodyKey: 'programLimit.overBody', vars }
    : { titleKey: 'programLimit.title', bodyKey: 'programLimit.body', vars };
}
