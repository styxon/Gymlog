const assert = require('node:assert/strict');

const {
  COACH_ADVICE_MEMORY_DAYS,
  MAX_COACH_ADVICE_MEMORY_ENTRIES,
  MAX_TAKEAWAY_CHARS,
  activeCoachAdviceMemory,
  buildCoachAdviceLines,
  coachAdviceDateLabel,
  mergeCoachAdviceMemory,
  parseCoachAdviceLines,
  parseCoachAdviceMemory,
  rememberCoachAdvice,
} = require('../../src/lib/coachAdviceMemory');
const { buildAiCoachSystemContext } = require('../../src/lib/aiCoachSystemContext');
const { normalizeAiCoachTrainingContext } = require('../../src/lib/aiTrainingContext');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const NOW = '2026-09-05T09:00:00.000Z';

function entry(at, takeaway) {
  return { at, takeaway };
}

module.exports = [
  {
    /**
     * The reason the module exists: ask about the same stalled lift a week
     * apart and the second answer should know the first one happened.
     */
    name: 'an answer is remembered and comes back with its date',
    run() {
      const memory = rememberCoachAdvice([], 'Lisää penkkiin kolmas sarja.', NOW);
      assert.equal(memory.length, 1);
      assert.equal(memory[0].takeaway, 'Lisää penkkiin kolmas sarja.');
      assert.equal(memory[0].at, NOW);
    },
  },
  {
    name: 'an empty or blank takeaway is not stored',
    run() {
      assert.equal(rememberCoachAdvice([], '', NOW).length, 0);
      assert.equal(rememberCoachAdvice([], '   \n  ', NOW).length, 0);
    },
  },
  {
    /**
     * The block rides in the cached prefix and is paid for on every request,
     * so its size is a promise rather than a hope.
     */
    name: 'a long takeaway is cut at a word boundary and stays under the cap',
    run() {
      const long = 'sana '.repeat(60).trim();
      const memory = rememberCoachAdvice([], long, NOW);
      assert.ok(memory[0].takeaway.length <= MAX_TAKEAWAY_CHARS + 1, memory[0].takeaway);
      assert.ok(memory[0].takeaway.endsWith('…'));
      assert.ok(!memory[0].takeaway.includes('  '));
    },
  },
  {
    name: 'a single unbroken word is still cut rather than stored whole',
    run() {
      const memory = rememberCoachAdvice([], 'x'.repeat(400), NOW);
      assert.ok(memory[0].takeaway.length <= MAX_TAKEAWAY_CHARS + 1);
    },
  },
  {
    name: 'the same advice twice is stored once, at the newer date',
    run() {
      const first = rememberCoachAdvice([], 'Lisää penkkiin kolmas sarja.', '2026-09-01T09:00:00.000Z');
      const second = rememberCoachAdvice(first, 'lisää penkkiin kolmas sarja.', NOW);
      assert.equal(second.length, 1);
      assert.equal(second[0].at, NOW);
    },
  },
  {
    name: 'the memory never grows past its cap, and drops the oldest first',
    run() {
      let memory = [];
      for (let index = 0; index < MAX_COACH_ADVICE_MEMORY_ENTRIES + 4; index += 1) {
        memory = rememberCoachAdvice(memory, `neuvo numero ${index}`, NOW);
      }
      assert.equal(memory.length, MAX_COACH_ADVICE_MEMORY_ENTRIES);
      assert.equal(memory[0].takeaway, 'neuvo numero 4');
      assert.equal(memory[memory.length - 1].takeaway, `neuvo numero ${MAX_COACH_ADVICE_MEMORY_ENTRIES + 3}`);
    },
  },
  {
    /**
     * A progression cue must not outlive the progression. Twenty-one days is
     * the window, and the edge is still inside it.
     */
    name: 'advice expires after the window, and the edge day still counts',
    run() {
      const edge = activeCoachAdviceMemory([entry('2026-08-15T09:00:00.000Z', 'reunalla')], NOW);
      assert.equal(COACH_ADVICE_MEMORY_DAYS, 21);
      assert.equal(edge.length, 1);

      const stale = activeCoachAdviceMemory([entry('2026-08-14T09:00:00.000Z', 'vanhentunut')], NOW);
      assert.equal(stale.length, 0);
    },
  },
  {
    /**
     * The age is counted in calendar days, not in elapsed milliseconds — the
     * repo's date rule, and here it is load-bearing rather than decorative.
     *
     * Two answers given on the same day have to expire on the same day. Divide
     * elapsed time by 24 hours instead and the morning one is a day older than
     * the evening one, so the pair straddles the edge and one survives the
     * other by a day for no reason a reader could ever see.
     */
    name: 'two answers from the same day expire on the same day',
    run() {
      // Pinned to the timezone the app ships into, and written in local terms:
      // Helsinki is UTC+3 in August, so an instant late on a UTC day is already
      // the next day here. That is the whole point — a fixture written in UTC
      // would be testing a different pair of days than the reader ever sees.
      withHelsinkiClocks(() => {
        // Local 14.8., which is 22 days before 5.9. — both past the window.
        const sameDay = [
          entry('2026-08-14T01:00:00.000Z', 'aamulla'), // 04:00 local
          entry('2026-08-14T20:00:00.000Z', 'illalla'), // 23:00 local
        ];
        assert.deepEqual(activeCoachAdviceMemory(sameDay, NOW), []);

        // Local 15.8., 21 days out: inside the window, so both stay.
        const dayLater = [
          entry('2026-08-15T01:00:00.000Z', 'aamulla'),
          entry('2026-08-15T20:00:00.000Z', 'illalla'),
        ];
        assert.equal(activeCoachAdviceMemory(dayLater, NOW).length, 2);
      });
    },
  },
  {
    name: 'expired advice is pruned on write as well as on read',
    run() {
      const memory = rememberCoachAdvice(
        [entry('2026-07-01T09:00:00.000Z', 'kauan sitten'), entry('2026-09-04T09:00:00.000Z', 'eilen')],
        'tänään',
        NOW,
      );
      assert.deepEqual(
        memory.map((item) => item.takeaway),
        ['eilen', 'tänään'],
      );
    },
  },
  {
    /**
     * Same rule as the database loader: what is on the disk was written by an
     * older build, and a loader that trusts it is a crash on someone's install.
     */
    name: 'a damaged stored file loads as the entries that are still usable',
    run() {
      assert.deepEqual(parseCoachAdviceMemory(null), []);
      assert.deepEqual(parseCoachAdviceMemory('not an array'), []);
      assert.deepEqual(parseCoachAdviceMemory([{ at: 'not a date', takeaway: 'x' }]), []);
      assert.deepEqual(parseCoachAdviceMemory([{ at: NOW }]), []);
      assert.deepEqual(parseCoachAdviceMemory([{ at: NOW, takeaway: 42 }]), []);
      assert.deepEqual(parseCoachAdviceMemory([null, { at: NOW, takeaway: 'kelpaa' }]), [
        { at: NOW, takeaway: 'kelpaa' },
      ]);
    },
  },
  {
    name: 'a file written by a future build cannot send more than the cap',
    run() {
      const oversized = Array.from({ length: MAX_COACH_ADVICE_MEMORY_ENTRIES + 5 }, (_unused, index) =>
        entry(NOW, `rivi ${index}`),
      );
      assert.equal(parseCoachAdviceMemory(oversized).length, MAX_COACH_ADVICE_MEMORY_ENTRIES);
    },
  },
  {
    /**
     * The endpoint is where the payload is whatever was posted. The bound the
     * device applies has to hold for a request the device did not write.
     */
    name: 'the endpoint re-parses the memory instead of trusting the payload',
    run() {
      const context = normalizeAiCoachTrainingContext({
        coachMemory: [
          { day: '2026-09-05', takeaway: 'x'.repeat(5000) },
          { day: 'roskaa', takeaway: 'ohitetaan' },
          { day: '2026-09-05' },
          'ei objekti',
        ],
      });
      assert.equal(context.coachMemory.length, 1);
      assert.ok(context.coachMemory[0].takeaway.length <= MAX_TAKEAWAY_CHARS + 1);
    },
  },
  {
    name: 'a context with no memory renders no block at all',
    run() {
      const context = normalizeAiCoachTrainingContext({});
      const text = buildAiCoachSystemContext(context);
      assert.ok(!text.includes('Advice you have already given'), text.slice(0, 400));
    },
  },
  {
    /**
     * The heading has to say what the lines are. Read as current facts they
     * make answers worse, not better.
     */
    name: 'the rendered block is dated and marked as past advice, not as fact',
    run() {
      const context = normalizeAiCoachTrainingContext({
        coachMemory: buildCoachAdviceLines([entry('2026-09-01T09:00:00.000Z', 'Lisää penkkiin kolmas sarja.')], NOW),
      });
      const text = buildAiCoachSystemContext(context);
      assert.ok(text.includes('Advice you have already given this reader'));
      assert.ok(text.includes('not current facts'));
      assert.ok(text.includes('- 2026-09-01: Lisää penkkiin kolmas sarja.'));
    },
  },
  {
    /**
     * The whole block is paid for on every request. Ten full-length lines is
     * the worst case, and it has to stay near a kilobyte — the size the cost
     * simulation in scripts/simulate-coach-cost.cjs was run against.
     */
    name: 'a full memory renders under 1.4 kB',
    run() {
      let memory = [];
      for (let index = 0; index < MAX_COACH_ADVICE_MEMORY_ENTRIES; index += 1) {
        memory = rememberCoachAdvice(memory, `${index} ${'sana '.repeat(40)}`, NOW);
      }
      const context = normalizeAiCoachTrainingContext({ coachMemory: buildCoachAdviceLines(memory, NOW) });
      const rendered = buildAiCoachSystemContext(context);
      const block = rendered.slice(rendered.indexOf('## Advice you have already given'));
      assert.ok(block.length < 1400, `memory block is ${block.length} chars`);
    },
  },
  {
    /**
     * A pure module nothing calls is a pure module that does nothing. These
     * assert the wiring the screen and the shell provide.
     */
    name: 'the app loads the memory, feeds it to the coach, and writes it back',
    run() {
      const wiring = readAppWiring();
      assert.ok(wiring.includes('loadCoachAdviceMemory()'), 'App must read the stored memory on start');
      assert.ok(wiring.includes('rememberCoachAdvice('), 'App must record an answer');
      assert.ok(wiring.includes('saveCoachAdviceMemory('), 'App must persist it');
      assert.ok(wiring.includes('coachMemory: coachAdviceMemory'), 'the coach context must carry it');
      assert.ok(wiring.includes('onCoachAdviceGiven'), 'the chat screen must be handed the recorder');
    },
  },
  {
    /**
     * Only answers that reached the model count. The offline preview text is
     * something the coach never said, and the clarifying reply is not advice.
     */
    name: 'the chat screen records only real, answered advice',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'AICoachChatScreen.tsx'),
        'utf8',
      );
      assert.ok(
        screen.includes("if (result.source !== 'preview' && !answer.unanswered) {"),
        'the recorder must be gated on a live, answered reply',
      );
    },
  },
  {
    /**
     * "Delete my data" cannot leave behind what the coach was told to remember
     * about the person asking.
     */
    name: 'a data reset erases the memory too',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const database = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'),
        'utf8',
      );
      const reset = database.slice(database.indexOf('export async function resetDatabase'));
      assert.ok(reset.includes('clearCoachAdviceMemory()'), 'resetDatabase must clear the coach memory');
    },
  },
  {
    /**
     * The memory stays out of AppDatabase on purpose: lib/accountBackup uploads
     * the database, and a takeaway carries the substance of the question that
     * produced it.
     */
    name: 'the memory is not part of the cloud backup payload',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const models = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'types', 'models.ts'), 'utf8');
      assert.ok(
        !models.includes('coachAdviceMemory'),
        'the memory must not become a field on AppDatabase — the backup would carry it',
      );
    },
  },
  {
    /**
     * buildAiCoachSystemContext runs on the endpoint, where the timezone is the
     * server's. An instant turned into a date there is a UTC date, so a
     * Helsinki answer given after local midnight would be shown to the coach
     * dated the previous day — while the window that retires it counts local
     * calendar days. The date has to be resolved on the phone.
     */
    name: 'the date shown to the coach is the reader\'s local date, not UTC',
    run() {
      withHelsinkiClocks(() => {
        // 22:30 UTC on 4.9. is 01:30 local on 5.9. — Helsinki is on EEST.
        const at = '2026-09-04T22:30:00.000Z';
        assert.equal(at.slice(0, 10), '2026-09-04', 'the UTC date is the day before, which is the trap');
        assert.equal(coachAdviceDateLabel(at), '2026-09-05');

        const lines = buildCoachAdviceLines([entry(at, 'myöhään illalla')], '2026-09-05T09:00:00.000Z');
        assert.deepEqual(lines, [{ day: '2026-09-05', takeaway: 'myöhään illalla' }]);
      });
    },
  },
  {
    name: 'a line whose date is not a date is dropped on the way in',
    run() {
      assert.deepEqual(parseCoachAdviceLines([{ day: '5.9.2026', takeaway: 'x' }]), []);
      assert.deepEqual(parseCoachAdviceLines([{ takeaway: 'x' }]), []);
      assert.deepEqual(parseCoachAdviceLines('ei taulukko'), []);
      assert.deepEqual(parseCoachAdviceLines([{ day: '2026-09-05', takeaway: 'kelpaa' }]), [
        { day: '2026-09-05', takeaway: 'kelpaa' },
      ]);
    },
  },
  {
    /**
     * The race the merge exists for: an answer recorded before the stored file
     * has finished loading. Assigning either side over the other loses one.
     */
    name: 'a load that lands after an answer keeps both',
    run() {
      const stored = [entry('2026-09-01T09:00:00.000Z', 'vanha neuvo')];
      const recorded = [entry(NOW, 'juuri annettu')];
      assert.deepEqual(
        mergeCoachAdviceMemory(stored, recorded, NOW).map((item) => item.takeaway),
        ['vanha neuvo', 'juuri annettu'],
      );
    },
  },
  {
    name: 'merging dedupes, expires and caps like a normal write',
    run() {
      const stored = [
        entry('2026-07-01T09:00:00.000Z', 'vanhentunut'),
        entry('2026-09-01T09:00:00.000Z', 'sama neuvo'),
      ];
      const recorded = [entry(NOW, 'Sama neuvo')];
      const merged = mergeCoachAdviceMemory(stored, recorded, NOW);
      assert.deepEqual(merged, [{ at: NOW, takeaway: 'Sama neuvo' }]);

      const many = Array.from({ length: 20 }, (_unused, index) => entry(NOW, `rivi ${index}`));
      assert.equal(mergeCoachAdviceMemory(many, [], NOW).length, MAX_COACH_ADVICE_MEMORY_ENTRIES);
    },
  },
  {
    /**
     * The endpoint caches the training context (api/ai-coach.ts puts a
     * cache_control breakpoint on it). Letting the answer just given into that
     * text would make every same-conversation follow-up rewrite the whole
     * prefix instead of reading it — the expensive half of the request, paid
     * again for one added line.
     */
    name: 'the open conversation sends the memory it started with, not the answer just given',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'AICoachChatScreen.tsx'),
        'utf8',
      );
      assert.ok(
        screen.includes('const pinnedCoachMemory = useRef(trainingContext.coachMemory ?? []).current;'),
        'the memory must be pinned for the life of the thread',
      );
      assert.ok(
        screen.includes('context: sentTrainingContext,'),
        'the request must send the pinned context, not the live one',
      );
    },
  },
  {
    /**
     * resetDatabase clears the key on disk, but the shell is not remounted by a
     * reset: without clearing the state too, the next question hands over every
     * takeaway and writes them all straight back.
     */
    name: 'a data reset clears the memory held in state, not only the file',
    run() {
      const wiring = readAppWiring();
      assert.ok(
        /const handleResetAllData[\s\S]{0,400}setCoachAdviceMemory\(\[\]\)/.test(wiring),
        'the reset handler must clear the in-memory copy',
      );
      assert.ok(
        wiring.includes('resetAllData: handleResetAllData'),
        'and the screens must be handed that handler rather than the raw reset',
      );
    },
  },
  {
    /**
     * Expiry runs on write, so a phone that has not asked the coach anything in
     * a month still carries the whole file. The policy promises deletion after
     * three weeks for the reader who stopped asking too.
     */
    name: 'the stored file is pruned when the app starts',
    run() {
      const wiring = readAppWiring();
      assert.ok(
        /mergeCoachAdviceMemory\(stored, current, at\)[\s\S]{0,1600}saveCoachAdviceMemory\(merged\)/.test(wiring),
        'the start-up load must write back what it pruned',
      );
    },
  },
  {
    /**
     * The write-back must not be gated on a length comparison.
     *
     * `merged.length !== stored.length` reads like a cheap way to skip a no-op
     * write, and it is wrong: merging changes content without changing length
     * whenever the list is at the cap, or one entry expires as another is
     * added, or two takeaways dedupe. Each of those skips the write that
     * recovers the load/record race — and because the race already overwrote
     * the file with its single entry, the rest is then lost for good, visible
     * only on the next cold start (PR #62 review).
     */
    name: 'the start-up write-back is unconditional, not gated on length',
    run() {
      const wiring = readAppWiring();
      assert.doesNotMatch(
        wiring,
        /merged\.length\s*!==\s*stored\.length/,
        'a length comparison cannot decide whether the merged memory is written back',
      );
    },
  },
];
