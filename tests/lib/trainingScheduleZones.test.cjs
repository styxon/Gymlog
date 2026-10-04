const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * A cycle's anchor and the reader's rest days are stored as the instant of
 * local midnight, with no zone. Read in another zone they were re-snapped to
 * the day before (Helsinki midnight is 21:00 the evening before in London),
 * which shifted the cycle a day and made rest days stop applying
 * (bug hunt, 2026-10-04).
 *
 * TZ is read when the process starts, so each zone runs in its own child.
 */
const SCHEDULE_MODULE = path.join(__dirname, '..', '..', '.test-dist', 'lib', 'trainingSchedule.js');

const CHILD = `
const { cycleSchedule, trainsOn, withRestDays } = require(${JSON.stringify(SCHEDULE_MODULE)});
const [mode, anchorArg, restArg] = process.argv.slice(1);
if (mode === 'stamp') {
  // Helsinki midnights of Mon 5 Oct 2026 (anchor) and Thu 8 Oct 2026 (rest day).
  console.log(JSON.stringify([new Date(2026, 9, 5).getTime(), new Date(2026, 9, 8).getTime()]));
} else {
  const schedule = withRestDays(cycleSchedule([true, true, false], Number(anchorArg)), [Number(restArg)]);
  const days = [];
  for (let day = 5; day <= 16; day += 1) {
    days.push(trainsOn(schedule, new Date(2026, 9, day, 12)) ? 'T' : '-');
  }
  console.log(days.join(''));
}
`;

function run(zone, ...args) {
  const result = spawnSync(process.execPath, ['-e', CHILD, ...args], {
    env: { ...process.env, TZ: zone },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

module.exports = [
  {
    name: 'a stored cycle anchor and rest day keep their calendar date in every zone',
    run() {
      const [anchor, rest] = JSON.parse(run('Europe/Helsinki', 'stamp'));
      // Oct 5..16 from a Monday anchor, two on one off; Thu 8 Oct (the second
      // day of the second turn: off... i.e. 8 trains) is taken off as a rest day.
      const home = run('Europe/Helsinki', 'walk', String(anchor), String(rest));
      // 5 T, 6 T, 7 -, 8 rest(-), 9 T, 10 -, 11 T, 12 T, 13 -, 14 T, 15 T, 16 -
      assert.equal(home, 'TT--T-TT-TT-');
      for (const zone of ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland']) {
        assert.equal(run(zone, 'walk', String(anchor), String(rest)), home, zone);
      }
    },
  },
];
