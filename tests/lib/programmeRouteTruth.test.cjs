const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

/**
 * Programme audit, 2026-09-16: a programme row opens the programme it names,
 * and the page under it counts the programme's own weeks.
 *
 * Source-level because all three live in React wiring. The rules themselves
 * are tested where they are pure — composedWeekMatchesPlan in programDetails,
 * getReadyProgramBlockWeeks in readyProgramDuration.
 */

const wiring = readAppWiring();
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const code = strip(wiring);

module.exports = [
  {
    name: 'route truth: Home opens an adopted programme as what it is, not always as a ready one',
    run() {
      // The list holds whatever the reader adopted, their own programmes
      // included. Opening every row as 'ready' sent the route guard looking
      // for a catalog template that was never there, and the reader landed on
      // the programme list instead of the programme they tapped.
      assert.match(
        code,
        /onOpenOtherProgram=\{\(planId\) => \{[\s\S]{0,320}handleOpenProgramDetail\(templateId\);/,
      );
      // And no door forces the type any more: the one that did is gone.
      assert.doesNotMatch(code, /handleOpenReadyProgramDetail/);
      assert.doesNotMatch(code, /screen: 'program', programType: 'ready', workoutTemplateId \}\);/);
      // Stored template first, the same order Home resolves its own hero in:
      // an id both stores know is custom on both screens or on neither.
      assert.match(
        code,
        /function resolveProgramTypeForTemplate\(workoutTemplateId: string\): 'ready' \| 'custom' \{\s*return workoutTemplates\.some\(\(template\) => template\.id === workoutTemplateId\) \? 'custom' : 'ready';/,
      );
      assert.match(
        code,
        /function handleOpenProgramDetail\(workoutTemplateId: string\) \{[\s\S]{0,240}programType: resolveProgramTypeForTemplate\(workoutTemplateId\),/,
      );
    },
  },
  {
    name: 'route truth: Home counts an adopted ready programme over the weeks the programme prescribes',
    run() {
      // Twelve-week programmes were counted as eight — the generic default —
      // so the hero said "week 1/8" beside a programme page saying 12, and
      // the session total under it was a third short.
      //
      // Rewritten 2026-09-21: this pinned the block to `readyPlanTemplate`,
      // which exists only while the plan points at the catalog itself. The
      // copy made by changing one lift fell back to eight weeks — "week 8/8"
      // and a completion card sixteen sessions into a 24-session block. The
      // block is asked of the programme, lineage included.
      assert.match(
        code,
        /const programmeBlockWeeks = getProgrammeBlockWeeks\(activeTemplate\.id, workoutTemplates, getWorkoutTemplateById\);/,
      );
      assert.match(code, /totalWeeks: demoBlockWeeks \?\? onboardingBlockWeeks \?\? programmeBlockWeeks,/);
      assert.doesNotMatch(code, /readyPlanTemplate \? getReadyProgramBlockWeeks\(readyPlanTemplate\)/);
    },
  },
  {
    name: 'route truth: the composed week stands in on both programme pages or on neither',
    run() {
      // The programme page and its day page read the same resolver, so a day
      // row from Home cannot find its day on one page and an empty screen on
      // the other.
      const uses = code.match(/resolveComposedWeekForRoute\(route\.workoutTemplateId\)/g) ?? [];
      assert.equal(uses.length, 2, 'both the programme page and the day page ask the resolver');
      // The resolver is programDetails' rule, the one the Programs cards ask
      // too (#37), and the rule passes the plan gate.
      assert.match(
        code,
        /const resolveComposedWeekForRoute = \(workoutTemplateId: string\) =>\s*resolveReaderComposedWeek\(workoutTemplateId, \{/,
      );
      const details = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'programDetails.ts'), 'utf8'));
      assert.match(
        details,
        /export function resolveReaderComposedWeek\([\s\S]{0,900}composedWeekMatchesPlan\(composed\.sessions\.map\(\(session\) => session\.id\), planSessionIds\)/,
      );
      // And nothing composes a week for a page without passing that gate.
      assert.doesNotMatch(
        code,
        /preferences\.recommendedProgramId === route\.workoutTemplateId && setupSelection\s*\?\s*composeProgramWeekForSelection/,
      );
    },
  },
  {
    name: 'route truth: the summary and the finish view read different sides of the save',
    run() {
      // The finish view renders before the write and counts the session in
      // hand; the summary renders after it, where the log already holds it.
      //
      // Rewritten 2026-09-21: this pinned `savedThisWeek`, a Monday-to-Sunday
      // count, under a week label taken from the block — "VIIKKO 1 · 1/3"
      // for the session that finished week 1 of a plan started on a
      // Thursday. Both sides now read one block tally, from Home's count.
      assert.match(code, /beforeSave: reading\(homeActivePlanCard\.sessionsDone \+ 1\),/);
      assert.match(code, /afterSave: reading\(homeActivePlanCard\.sessionsDone\),/);
      assert.match(code, /const guidedWeekProgress = weekProgressBase\?\.beforeSave \?\? null;/);
      assert.match(code, /const completionWeekProgress = weekProgressBase\?\.afterSave \?\? null;/);
      assert.doesNotMatch(code, /savedThisWeek/);
    },
  },
  {
    name: 'route truth: an edit the programme refused does not confirm itself',
    run() {
      // runProgramExerciseEdit answers whether the programme changed, so
      // nothing downstream has to assume it did.
      assert.match(code, /async function runProgramExerciseEdit\([\s\S]{0,260}\): Promise<boolean> \{/);
      // And an edit aimed at a programme the reader has their own copy of
      // opens that copy instead of editing rows they cannot see.
      assert.match(
        code,
        // Unless the copy was made by an edit queued ahead of this one: that
        // edit has already carried the reader to the copy (double-tap audit,
        // 2026-09-21), and the rows this one was aimed at are gone.
        /const existingCopyId = await findWorkoutTemplateIdBySource\(programId\);\s*if \(existingCopyId && copiedInThisEditBurst\.current\.has\(programId\)\) \{\s*return false;\s*\}\s*if \(existingCopyId\) \{[\s\S]{0,400}programType: 'custom',\s*workoutTemplateId: existingCopyId,\s*\}\);\s*return false;/,
      );
    },
  },
  {
    name: 'route truth: a copy made by editing a lift keeps the block, the lead and the history',
    run() {
      // The copy IS the programme the reader has been training. Stamping the
      // new plan with today turned "week 3, 7 of 24" into "week 1, 0 of 24"
      // for changing one lift.
      // Off the plan RECORD, not the running set: a programme the reader
      // switched off still has its plan and its weeks, and its copy inherits
      // them (CI review of #161).
      assert.match(code, /const replacedPlan = wasHeld\s*\? database\.workoutPlans\.find\(\(item\) => item\.id === readyPlanId\) \?\? null\s*: null;/);
      assert.match(code, /now: replacedPlan\?\.updatedAt \?\? new Date\(\)\.toISOString\(\),/);
      // Taking the ready programme's place is not the same as taking the
      // lead: editing a lift in a programme the reader holds but does not
      // lead with used to promote it over the one Home was running.
      assert.match(
        code,
        /activePlanId:\s*preferences\.activePlanId === readyPlanId \? plan\.id : preferences\.activePlanId \?\? plan\.id,/,
      );
      // And every counter reads the programme, not the record holding it.
      assert.match(
        code,
        /programmeHistoryIds\(activeTemplate\.id, workoutTemplates, templatesRunByOtherPlans\(activeTemplate\.id\)\)/,
      );
    },
  },
  {
    name: 'route truth: the completion card is answered once per round, not once per plan',
    run() {
      // The step-up used to put the card away before it tried to adopt, so a
      // reader at the free cap saw the paywall, said no, and lost the offer.
      assert.match(
        code,
        /adopted = await handleAdoptReadyProgram\(nextTemplateId, \{ lead: true, replacingPlanId: planId \}\);[\s\S]*?if \(adopted\) \{\s*await dismissCompletionCard\(planId\);/,
      );
      // And a restart clears the dismissal rather than adding one: the card
      // hides because the block is no longer finished, and the list it was
      // added to is never cleared — so finishing the same programme a second
      // time was never acknowledged.
      // To its own closing brace: the memo that stood next stays in App.tsx
      // while the restart moves to src/app (phase C, 2026-10-01).
      const restart = functionBody(code, 'async function handleCompletionRestart(');
      assert.match(restart, /dismissedCompletionPlanIds: preferences\.dismissedCompletionPlanIds\.filter\(\(id\) => id !== planId\)/);
      assert.doesNotMatch(restart, /await dismissCompletionCard\(planId\);/);
    },
  },
  {
    name: 'route truth: today moves on under an app that was left open',
    run() {
      // "Today" was read from new Date() inside memos whose dependencies hold
      // no time at all, so a phone left open overnight kept yesterday's
      // picked session, dots and rows until it was closed.
      assert.match(code, /const \[todayKey, setTodayKey\] = useState\(\(\) => localDateKey\(new Date\(\)\)\);/);
      // Both triggers: the app coming back, and a timer set for the next
      // local midnight — a calendar date, not 24 hours on, so the clock
      // change cannot push it into the wrong day.
      assert.match(code, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) \{\s*sync\(\);/);
      assert.match(code, /new Date\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\) \+ 1, 0, 0, 5\)\.getTime\(\)/);
      // And the memos read it, rather than the clock.
      assert.match(code, /const todayDayStart = todayStartMs;/);
      // The timer re-arms itself rather than being re-armed by the state it
      // sets: a fire that finds the same date leaves the state untouched, and
      // an effect keyed on it would never set another timer (PR #125 review).
      assert.match(code, /timer = setTimeout\(\(\) => \{\s*sync\(\);\s*arm\(\);\s*\}/);
      assert.match(code, /\}, \[[^\]]*todayStartMs[^\]]*\]\);/);
    },
  },
  {
    name: 'route truth: active and deleted are two different things',
    run() {
      // The Active switch was a one-way door that also read as a delete, and
      // a ready programme had no delete at all (device, 2026-09-16).
      assert.match(
        code,
        /onSetActive=\{\(next\) => \{\s*void \(next \? onResumeProgram\(route\.workoutTemplateId\) : onStopProgram\(route\.workoutTemplateId\)\);/,
      );
      assert.match(code, /held=\{programIsHeld\}/);
      // A held ready programme can be deleted, apart from the switch.
      assert.match(
        code,
        /: programIsHeld\s*\? \(\) => void onForgetHeldProgram\(route\.workoutTemplateId\)/,
      );
      assert.match(code, /const canDeleteProgram = route\.programType === 'custom' \|\| programIsHeld;/);
      // And the list keeps what the switch turned off.
      assert.match(code, /const runningRows = listHeldProgrammes\(\{/);
    },
  },
];
