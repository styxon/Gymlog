# The never list: what makes a reader uninstall Vinha

Each line is an invariant a test must hold on every PR. The owner test is in
brackets. A new feature that touches one of these areas extends the owner test
rather than adding a parallel check.

## N1 A logged set is never lost

- A set the reader logged (reps/weight/seconds entered and ticked) survives:
  the app killed at any point, a phone restart, an app update, a failed save,
  resume, swap, superset edits, add/remove exercise mid-workout, correction of
  a logged set, finishing, and discarding only by explicit discard.
- After a successful save the session is in history with exactly the logged
  sets; after a failed save the session is still resumable and nothing is shown
  as saved.
  [workout lifecycle invariant: `tests/features/workout/workoutLifecycleInvariant.test.cjs`]

## N2 A workout can always be started and saved

- Starting any ready/custom programme day, freestyle or cardio never throws and
  never produces an unsaveable session; a save that fails says so and can be
  retried.
  [workout lifecycle invariant: `tests/features/workout/workoutLifecycleInvariant.test.cjs`;
  every ready programme day is also walked start to save in the same file]

## N3 The app opens on any data it ever wrote

- Every stored shape any released version wrote (both AsyncStorage keys,
  chunked via largeItem) loads without crashing; malformed/partial/truncated
  values degrade to safe defaults for that field only and never wipe readable
  data (the 273-workout "opened like a fresh install" class).
  [storage load invariant]

## N4 Sign-in never loops, locks out or leaks

- No account's data reaches another account's cloud copy without a yes; a
  revoked/deleted account has no access; INVALID_TOKEN/5xx/network never sign
  out; a fresh sign-in after deletion works.
  [account-safety invariant: `tests/features/account/accountSafetyInvariant.test.cjs`]

## N5 A backup restores what was backed up

- export, upload, download, restore gives back the same workouts, programmes,
  bodyweight, measurements, cardio, name book and settings (device-only fields
  excepted), across versions; a restore never silently drops newer local data
  without the reader choosing it.
  [backup round-trip invariant: `tests/features/account/backupRoundTripInvariant.test.cjs`]

## N6 Success is never claimed before it happened

- Saved / backed up / deleted / restored states appear only after the write
  resolved (CLAUDE.md rule). Covered inside each invariant above; for the
  workout save, the lifecycle invariant checks that the finished mark, the
  completion summary and the summary route only appear once the session is on
  disk. For the backup, the round-trip invariant checks that "backed up" means
  the store holds the copy (and that a refused or over-size upload leaves the
  old copy untouched and says nothing of success) and that "restored" means both
  stores are on disk.

## Running the workout lifecycle invariant

```powershell
node tests/run-tests.cjs
```

To reproduce a failure the test prints the shortest sequence and the
`WORKOUT_INVARIANT_SEED` / `WORKOUT_INVARIANT_SEQUENCES` / `WORKOUT_INVARIANT_REPLAY`
values that rerun it. `WORKOUT_INVARIANT_STATS=1` prints what the sequences
reached. There are no relaxations: the two behaviours the first run found (a
finished session blocking Start, and a free workout board saved twice) are
fixed and held as invariants.

## Running the backup round-trip invariant

```powershell
node tests/run-tests.cjs
```

1000 random databases plus the 16 past releases are backed up through the real
client and endpoint and restored on the same phone, a new one, one holding other
data and one last signed in to another account; older releases' own payload
builders (`tests/fixtures/backup-history`, rebuilt with `build-payloads.cjs`) and
payloads at the gzip threshold and the 4 MiB cap are run too. A failure prints the
shortest case and the `BACKUP_ROUNDTRIP_REPLAY` that reruns it; also
`BACKUP_ROUNDTRIP_SEED`, `BACKUP_ROUNDTRIP_SEQUENCES`, `BACKUP_ROUNDTRIP_STATS=1`.

The first run found two behaviours on main, both fixed and held as fixed cases: a restore whose
history write is refused is rolled back exactly (not through the restore merge), and a name book,
strength goals or coach goals the reader wrote count as data worth keeping, so a restore over them asks.
