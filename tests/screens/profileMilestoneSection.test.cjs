const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const profile = read('src', 'screens', 'ProfileScreen.tsx');
const tab = read('src', 'app', 'renderProfileTab.tsx');
const i18n = read('src', 'lib', 'i18n.ts');

/**
 * Profile: TRAINING PLAN → NEXT MILESTONE (user 2026-09-02, design "Vinha
 * Profile — Training planin tilalle", frame A). The plan card is gone —
 * programme management lives on the Programs tab — and the reward surface
 * sits where it was, between the Rate card and the records card.
 */
module.exports = [
  {
    name: 'profile: the plan card is gone, and nothing still asks for its props',
    run() {
      assert.doesNotMatch(profile, /TRAINING PLAN|profile\.section\.trainingPlan|onManagePlan|planSessionNames|planWeekdayIndexes|WEEKDAY_CHIPS/);
      assert.doesNotMatch(profile, /function (SparkIcon|CalendarIcon|DumbbellIcon|Badge)\(/);
      assert.doesNotMatch(profile, /\n  (planCard|planTop|badgeRow|weekdayChip|planDayList): \{/);
      // The wiring dropped the props too; the training_plan ROUTE stays, the
      // Programs tab still opens it.
      assert.doesNotMatch(tab, /onManagePlan=|planSessionNames=\{profilePlanSummary/);
      assert.match(tab, /route\.screen === 'training_plan'/);
      for (const key of ['profile.section.trainingPlan', 'profile.manage', 'profile.noPlan', 'profile.badge.perWeek']) {
        assert.equal(i18n.includes(`'${key}'`), false, `${key} still in i18n`);
      }
    },
  },
  {
    name: 'profile: NEXT MILESTONE sits between Rate and the records card, in the records card\'s shell',
    run() {
      const section = profile.indexOf("t(language, 'profile.section.nextMilestone')");
      const records = profile.indexOf('{/* PERSONAL RECORDS');
      const rate = profile.indexOf('onOpenRating');
      assert.ok(section > 0 && records > section && rate < section, 'order: rate, milestone, records');
      const block = profile.slice(section, records);
      // The speed line came off (user 2026-09-03): it crossed the row copy.
      assert.match(block, /<ListCard>/);
      assert.doesNotMatch(block, /speedLine/);
      // Rows: ListCard draws the hairline between them; the nearest one in the
      // accent, the rest in violet, the fill clamped by the rule.
      assert.doesNotMatch(block, /milestoneRowDivider/);
      assert.match(block, /index === 0 \? theme\.highlight : theme\.purpleBright/);
      assert.match(block, /width: `\$\{row\.fillPercent\}%`/);
      // The card is the ladder's front row, not a second reading of the log.
      assert.match(profile, /milestoneCardRows\(\{ ledger: milestoneLedger, lifetime, unitPreference, language \}\)/);
      // No right action on the label.
      assert.match(profile, /<SectionLabel label=\{t\(language, 'profile\.section\.nextMilestone'\)\} \/>/);
      // Routes untouched.
      assert.match(tab, /screen: 'settings'/);
      assert.match(tab, /tab: 'progress', screen: 'list', section: 'records'/);
    },
  },
];
