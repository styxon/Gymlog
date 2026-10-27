import { useState } from 'react';

import type { RunningCapRefusal } from '../lib/programCapNotice';

/**
 * The shell's sheet flags, moved out of App.tsx verbatim (app-split step 8):
 * the programme-limit wall, the running-programme wall, the update dialog and
 * Settings' CSV import sheet. Plain `useState`s, so where the hook is called
 * does not change any effect order.
 */
export function useShellSheets() {
  // Settings' "Import plan (CSV)" opens the same sheet the Programs tab uses,
  // straight into its paste view. One importer, two doors.
  const [settingsImportVisible, setSettingsImportVisible] = useState(false);
  // Shown when a create is blocked, from wherever it was attempted. Not a
  // route: the user was in the middle of something, and a screen change
  // would lose the thing they were doing to a wall they may dismiss.
  const [programLimitVisible, setProgramLimitVisible] = useState(false);
  // The running-programme wall on the free tier. The numbers outlive `visible`
  // so the title does not read 0/0 while the sheet fades out.
  const [runningCapSheet, setRunningCapSheet] = useState<{ visible: boolean } & RunningCapRefusal>({
    visible: false,
    used: 0,
    cap: 0,
    replacingStop: null,
  });
  // Whether the update dialog is up. Home's sign-in dialog waits for it, with
  // the walls above: iOS presents one modal at a time (iOS hunt 2026-10-17).
  const [appUpdateShown, setAppUpdateShown] = useState(false);

  return {
    settingsImportVisible,
    setSettingsImportVisible,
    programLimitVisible,
    setProgramLimitVisible,
    runningCapSheet,
    setRunningCapSheet,
    appUpdateShown,
    setAppUpdateShown,
  };
}
