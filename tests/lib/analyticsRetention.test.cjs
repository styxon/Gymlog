const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ANALYTICS_RETENTION_MONTHS,
  analyticsRetentionCutoffDay,
  eventBlobDay,
  selectExpiredEventBlobs,
} = require('../../src/lib/analyticsRetention');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

module.exports = [
  {
    name: 'retention: the cutoff steps by calendar month, not by milliseconds',
    run() {
      // Two years back on the same calendar day, whatever the clocks did.
      assert.equal(analyticsRetentionCutoffDay(new Date('2028-09-04T12:00:00Z')), '2026-09-04');
      assert.equal(analyticsRetentionCutoffDay(new Date('2027-01-15T00:00:00Z')), '2025-01-15');
      // A shorter window, for the arithmetic itself.
      assert.equal(analyticsRetentionCutoffDay(new Date('2026-03-31T10:00:00Z'), 1), '2026-03-03');
      // 29 February two years back does not exist: roll forward, never back —
      // a day kept longer is fine, a day deleted early is a broken promise.
      assert.equal(analyticsRetentionCutoffDay(new Date('2028-02-29T10:00:00Z')), '2026-03-01');
      // The day is read in UTC, the same clock the batch names use.
      assert.equal(analyticsRetentionCutoffDay(new Date('2028-03-26T23:30:00Z')), '2026-03-26');
    },
  },
  {
    name: 'retention: a batch from before the cutoff day expires, the cutoff day itself is kept',
    run() {
      const now = new Date('2028-09-04T04:00:00Z');
      const stored = [
        'events/2026-09-03/2026-09-03T10-00-00-000Z-abc123.json',
        'events/2026-09-04/2026-09-04T10-00-00-000Z-abc124.json',
        'events/2028-09-04/2028-09-04T03-59-00-000Z-abc125.json',
        'events/2020-01-01/2020-01-01T00-00-00-000Z-old000.json',
      ];
      assert.deepEqual(selectExpiredEventBlobs(stored, now), [
        'events/2026-09-03/2026-09-03T10-00-00-000Z-abc123.json',
        'events/2020-01-01/2020-01-01T00-00-00-000Z-old000.json',
      ]);
    },
  },
  {
    name: 'retention covers the two prefixes it promised, and nothing else',
    run() {
      const now = new Date('2028-09-04T04:00:00Z');
      assert.equal(eventBlobDay('events/2026-01-01/x.json'), '2026-01-01');
      // Transcripts joined the window on 2026-09-10, when the coach log became
      // something a reader can consent to. The 24 months were one number for
      // one prefix until then, which made it two promises wearing one number.
      assert.equal(eventBlobDay('transcripts/2020-01-01/x.json'), '2020-01-01');
      // Backups are not on this clock: they are kept until their owner deletes
      // them, which is a different promise and must not be swept by this cron.
      assert.equal(eventBlobDay('backups/abc.json'), null);
      assert.equal(eventBlobDay('events/index.json'), null);
      assert.equal(eventBlobDay('transcripts/index.json'), null);
      // A prefix that merely starts with a covered one is not covered.
      assert.equal(eventBlobDay('events-archive/2020-01-01/x.json'), null);
      assert.deepEqual(
        selectExpiredEventBlobs(['backups/abc.json', 'events/index.json', 'events-archive/2020-01-01/x.json'], now),
        [],
      );
      assert.deepEqual(selectExpiredEventBlobs(['transcripts/2020-01-01/x.json'], now), [
        'transcripts/2020-01-01/x.json',
      ]);
      // And a transcript inside the window survives, same as an event does.
      assert.deepEqual(selectExpiredEventBlobs(['transcripts/2028-09-01/x.json'], now), []);
    },
  },
  {
    name: 'retention: the policy states the same number the code enforces, in both languages',
    run() {
      const legal = read('src/lib/legalDocuments.ts');
      const months = ANALYTICS_RETENTION_MONTHS;
      assert.match(legal, new RegExp(`up to ${months} months`), 'the English policy must state the retention the cron enforces');
      assert.match(legal, new RegExp(`enintään ${months} kuukautta`), 'the Finnish policy must state the retention the cron enforces');
      // And it says the deletion is automatic, because now it is.
      assert.match(legal, /deleted automatically/);
      assert.match(legal, /poistetaan automaattisesti/);
    },
  },
  {
    name: 'retention: the daily cron is wired end to end',
    run() {
      // A retention period in a policy is a promise; this is the chain that
      // keeps it without anyone remembering. Each link is checked because
      // each one has a way of going quietly missing: the config not deployed,
      // the path pointing at nothing, a schedule the plan refuses.
      const config = JSON.parse(read('vercel.json'));
      const cron = (config.crons ?? []).find((entry) => entry.path === '/api/prune-events');
      assert.ok(cron, 'vercel.json must schedule /api/prune-events');
      // Once a day, every day: minute and hour fixed, the rest `*`. Daily is
      // the most the Hobby plan allows, and it is also the least the policy
      // can bear — a monthly run let a batch live up to 25 months against a
      // promise of "up to 24" (review, PR #58).
      assert.match(cron.schedule, /^\d{1,2} \d{1,2} \* \* \*$/, `schedule "${cron.schedule}" is not a fixed daily run`);
      assert.ok(fs.existsSync(path.join(root, 'api', 'prune-events.ts')), 'the cron path has no function behind it');

      // The deploy uploads only what .vercelignore allows; vercel.json is
      // outside api/ and src/, so it has to be let through by name.
      const ignore = read('.vercelignore');
      assert.ok(
        ignore.split(/\r?\n/).some((line) => line.trim() === '!/vercel.json'),
        '.vercelignore must allow vercel.json, or the cron never reaches Vercel',
      );

      const endpoint = read('api/prune-events.ts');
      assert.match(endpoint, /from '\.\.\/src\/lib\/analyticsRetention'/, 'the endpoint must use the shared retention rule');
      assert.match(endpoint, /CRON_SECRET/, 'the endpoint must verify the cron secret');
      assert.match(endpoint, /timingSafeEqual/, 'secrets are compared in constant time');
      // Both prefixes, listed from the same constant the matcher uses. A cron
      // that swept one folder while the rule named two would have deleted the
      // events and kept the transcripts forever.
      assert.match(endpoint, /for \(const prefix of RETAINED_PREFIXES\)/, 'the prune must sweep every retained prefix');
      assert.match(endpoint, /prefix: `\$\{prefix\}\/`/, 'the prune must scope its listing to that prefix');
      assert.doesNotMatch(endpoint, /prefix: 'events\/'/, 'the prune is hardcoded to one prefix again');
      assert.doesNotMatch(endpoint, /console\.log/, 'the prune logs counts only, never a batch');
    },
  },
];
