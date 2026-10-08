/**
 * What the training plan's schedule editor may do with its draft when the
 * reader presses Done.
 *
 * The editor holds two drafts: the weekdays and the rhythm. The weekdays must
 * be 2–6 to be written, and a weekday draft outside that range hid Done. It hid
 * it on the rhythm tab too, where the weekday chips are not shown and the
 * caption speaks of the rhythm: a reader who tapped down to one day and then
 * chose "3 on, 1 off" could not save the rhythm, and nothing on screen said
 * why (re-hunt, 2026-10-07). While the rhythm is on, the weekday draft stays
 * unwritten instead and the stored weekdays stand.
 *
 * Nothing is written when Done cannot finish: the rhythm used to be written
 * before the weekday check, so a refused Done still changed the plan behind an
 * editor that stayed open.
 */
export interface ScheduleDraftState {
  /** The weekday draft differs from the stored weekdays. */
  daysDirty: boolean;
  /** The weekday draft holds an allowed number of days. */
  daysValid: boolean;
  /** The rhythm tab is the one chosen. */
  cycleOn: boolean;
  /** The rhythm draft differs from the stored rhythm. */
  cycleDirty: boolean;
}

export interface ScheduleDraftSave {
  /** Done is offered, and pressing it closes the editor. */
  canFinish: boolean;
  writeCycle: boolean;
  writeDays: boolean;
}

export function scheduleDraftSave(draft: ScheduleDraftState): ScheduleDraftSave {
  const daysBlocking = draft.daysDirty && !draft.daysValid;
  if (daysBlocking && !draft.cycleOn) {
    return { canFinish: false, writeCycle: false, writeDays: false };
  }
  return {
    canFinish: true,
    writeCycle: draft.cycleDirty,
    writeDays: draft.daysDirty && draft.daysValid,
  };
}
