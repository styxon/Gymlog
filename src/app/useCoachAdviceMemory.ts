import { Dispatch, SetStateAction, useCallback, useEffect } from 'react';

import { CoachAdviceMemoryEntry, mergeCoachAdviceMemory, rememberCoachAdvice } from '../lib/coachAdviceMemory';
import { HeldSessionAdaptations, NO_HELD_SESSION_ADAPTATIONS } from '../lib/sessionAdaptation';
import { loadCoachAdviceMemory, saveCoachAdviceMemory } from '../storage/coachAdviceMemoryStore';

/**
 * The coach's long memory: read once at startup and merged with whatever was
 * recorded before the read landed, erased with everything else on a reset,
 * and added to one answer at a time.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30),
 * as one block in its original byte order — the "Remember one answer" doc
 * still sits above the reset's doc, where it stood, rather than being moved
 * to the recorder it describes. A hook, not a helper: the load is an effect
 * with the shell's lifetime and the two handlers are callbacks whose identity
 * the screens receive. VinhaApp calls this exactly where the lines stood —
 * after coachDemoQuestion, before premiumTrialEndsAt — so every hook keeps its
 * slot and the load still registers in the same place among the shell's
 * effects.
 *
 * The memory and the coach thread stay VinhaApp state: a restore writes them
 * too. In the moved comments below, "this component" is VinhaApp.
 */
interface CoachAdviceMemoryDeps {
  /** The app context's reset; the handler keeps the name, and the deps entry reads [resetAllData]. */
  resetAllData: () => Promise<void>;
  /** VinhaApp's setter for the coach's long memory. */
  setCoachAdviceMemory: Dispatch<SetStateAction<CoachAdviceMemoryEntry[]>>;
  /**
   * VinhaApp's setter for the open coach thread. The only call here is
   * setCoachChatMemory(null), and this type keeps the thread's message type,
   * which belongs to the chat screen, out of a .ts file.
   */
  setCoachChatMemory: (value: null) => void;
  /** VinhaApp's setter for today's held swaps and left-out slots. */
  setHeldSessionAdaptations: Dispatch<SetStateAction<HeldSessionAdaptations>>;
}

export function useCoachAdviceMemory(deps: CoachAdviceMemoryDeps) {
  const { resetAllData, setCoachAdviceMemory, setCoachChatMemory, setHeldSessionAdaptations } = deps;

  /**
   * The coach's long memory, read once at startup.
   *
   * Failures are already swallowed by the store, so this cannot reject: the
   * worst case is an empty list, which is exactly what a reader who has never
   * asked a question has.
   */
  useEffect(() => {
    let cancelled = false;
    loadCoachAdviceMemory().then((stored) => {
      if (cancelled) {
        return;
      }
      const at = new Date().toISOString();
      setCoachAdviceMemory((current) => {
        // Merged, not assigned. An answer recorded before this read resolves
        // would otherwise be overwritten by the older stored list — and the
        // list it overwrote would already have been written back over the
        // stored one, losing both halves.
        const merged = mergeCoachAdviceMemory(stored, current, at);
        // Always written back, never gated on a length comparison.
        //
        // Two things need this write. Expiry runs on write, so a phone that has
        // not asked the coach anything in a month still carries the whole file,
        // and pruning it here is what makes "deleted as it ages past three
        // weeks" true for a reader who stopped asking rather than kept asking.
        // And the race above already overwrote the file with the single entry
        // it recorded, so the merged list has to go back or the rest is lost.
        //
        // Comparing the merged list's length against the stored one looked
        // like a cheap way to skip a no-op write and was wrong: merging
        // changes content without changing length whenever the list is at the
        // ten-entry cap, or one entry expires as another is added, or two
        // takeaways dedupe. Each of those skipped the write that recovers the
        // race, and the loss only appeared on the next cold start
        // (PR #62 review).
        void saveCoachAdviceMemory(merged);
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Remember one answer.
   *
   * State and disk are written from the same computed value rather than the
   * write being derived from state again, so two answers in quick succession
   * cannot store a list that skips the first. Pruning of expired lines happens
   * inside rememberCoachAdvice, on every write.
   */
  /**
   * Erase everything, the coach's memory included.
   *
   * resetDatabase clears the memory's key on disk, but this component is not
   * remounted by a reset: without this the state would still hold every
   * takeaway, hand them to the next question, and write them straight back.
   *
   * The open conversation too, for the same reason. It was never on disk, so
   * the reset never touched it: chat, reset, onboard again and open the coach
   * inside eight hours, and the old thread was back on screen — and in live
   * mode sent to the model as the history of a reader who had just asked for
   * all of it to go (audit, 2026-09-20).
   */
  const handleResetAllData = useCallback(async () => {
    await resetAllData();
    setCoachAdviceMemory([]);
    setCoachChatMemory(null);
    // Same reason: today's swaps outlive the reset in this component's state,
    // and would reappear on the first programme adopted after it.
    setHeldSessionAdaptations(NO_HELD_SESSION_ADAPTATIONS);
  }, [resetAllData]);

  const handleCoachAdviceGiven = useCallback((takeaway: string) => {
    // Stamped once, outside the updater: React may invoke an updater more than
    // once, and a clock read inside it would make two invocations disagree.
    const at = new Date().toISOString();
    setCoachAdviceMemory((current) => {
      const next = rememberCoachAdvice(current, takeaway, at);
      void saveCoachAdviceMemory(next);
      return next;
    });
  }, []);

  return { handleResetAllData, handleCoachAdviceGiven };
}
