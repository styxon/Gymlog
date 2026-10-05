const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classifyCoachScope } = require('../../.test-dist/lib/aiCoachScope.js');
const { buildAiCoachPreviewAnswer } = require('../../.test-dist/lib/aiCoachPreview.js');

/**
 * The coach answers training questions, hands two things on, and takes no
 * position on anything else (2026-09-16).
 */

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

// The same shape tests/lib/aiCoachPreview builds its cases from.
const CONTEXT = {
  unitPreference: 'kg',
  activeSession: null,
  recentCompletedSessions: [],
  trackedLifts: [],
  latestTopSets: [],
  sessionsThisWeek: 3,
  sessionsLast30Days: 10,
  rhythm: [],
  readyProgramCount: 5,
  recommendedProgramId: null,
  recommendedProgramTitle: null,
  customProgramTitle: null,
  plateaus: [],
  fatigue: { acwr: 1.05, recoveryScore: 98, signal: 'optimal', sessionCount7d: 3, confident: true },
};

module.exports = [
  {
    name: 'coach scope: a training question is a training question, however it is phrased',
    run() {
      for (const prompt of [
        'Miten saan penkin nousemaan?',
        'Olenko palautunut tarpeeksi',
        'kuinka paljon proteiinia',
        'What should I do about my squat stalling?',
        'can I run a 10k while lifting',
        'paljonko unta tarvitsen treenin tueksi',
        // An off-topic word inside a real question does not win.
        'ehdinkö juosta maratonin ennen vaaleja',
        // "want to die" lives inside "diet", and a gym injury is reported in
        // the same words self-harm is. Both used to get the crisis line
        // (PR #124 review).
        'I want to diet for summer, how big a deficit should I run?',
        'I hurt myself doing deadlifts last week, what can I still train?',
        'satutin itseni penkissä, mitä voin treenata',
      ]) {
        assert.equal(classifyCoachScope(prompt), 'training', prompt);
      }
    },
  },
  {
    name: 'coach scope: subjects that cannot be training questions are named as such',
    run() {
      for (const prompt of [
        'kirjoita minulle python-funktio joka lajittelee listan',
        'kuka voittaa presidentinvaalit',
        'mikä on sään ennuste huomiselle',
        'suosittele elokuva tälle illalle',
        'kirjoita runo äidille',
        'mikä malli olet',
        'should I buy bitcoin',
        // Every one of these carries an everyday word the gym also uses —
        // program, rest, run — and every one of them read as a training
        // question until the veto was narrowed to words that mean the gym
        // and nothing else (PR #124 review).
        'write me a python program that sorts a list',
        'should I buy bitcoin with the rest of my money',
        'write me a poem about my run',
      ]) {
        assert.equal(classifyCoachScope(prompt), 'off_topic', prompt);
      }
    },
  },
  {
    name: 'coach scope: a reader in trouble is not coached',
    run() {
      for (const prompt of [
        'mietin itsemurhaa',
        'haluan kuolla',
        'I want to kill myself',
        'thinking about ending my life',
      ]) {
        assert.equal(classifyCoachScope(prompt), 'crisis', prompt);
      }
      // The near-misses of a phrase already listed are listed too: one word
      // in the middle, or the base form of the same sentence (PR #124).
      for (const prompt of [
        'en halua enää elää',
        'en jaksa enää elää',
        'I think about ending it all',
        "I don't want to live anymore",
        'I have been cutting myself',
      ]) {
        assert.equal(classifyCoachScope(prompt), 'crisis', prompt);
      }

      // A hard week is not a crisis.
      assert.equal(classifyCoachScope('en jaksa enää treenata näin kovaa'), 'training');
      assert.equal(classifyCoachScope('tämä ohjelma tappaa minut'), 'training');
    },
  },
  {
    name: 'coach scope: the ways people actually type it are caught too (bug hunt 2026-10-05)',
    run() {
      for (const prompt of [
        // The apostrophe a phone keyboard types by default.
        'I don’t want to live anymore',
        'I dont want to live anymore',
        // Finnish case endings, which a whole-word phrase could not reach.
        'ajattelen itsemurhasta',
        'mietin itsemurhaan',
        'olen ollut itsetuhoinen',
        'minulla on itsetuhoisia ajatuksia',
        'viiltelin taas eilen',
        // Inside a compound.
        'mietin lääkeitsemurhaa',
        // First person present, and the softened forms.
        'tapan itseni',
        'Minä tapan itseni',
        'haluan vain kuolla',
        'haluan vaan kuolla',
        'toivon että kuolisin',
        "I'm going to take my own life",
        'I want to end my own life',
        'everyone would be better off dead without me',
        'I wish I were dead',
        'I want to kill my self',
      ]) {
        assert.equal(classifyCoachScope(prompt), 'crisis', prompt);
      }

      // The widening must not take gym sentences with it. (Hyperbole that
      // says the words themselves — "tapan itseni tällä ohjelmalla" — does get
      // the crisis line; that is the side to be wrong on.)
      for (const prompt of [
        'I want to end my workout with core',
        'how do I end my sets better',
        'viimeinen sarja meinasi tappaa',
        'itsevarmuus penkissä puuttuu',
      ]) {
        assert.equal(classifyCoachScope(prompt), 'training', prompt);
      }
    },
  },
  {
    name: 'coach scope: the offline coach answers a curly-apostrophe crisis with the crisis line',
    run() {
      const answer = buildAiCoachPreviewAnswer('I don’t want to live anymore', CONTEXT, 'en');
      const crisis = buildAiCoachPreviewAnswer("I don't want to live anymore", CONTEXT, 'en');
      assert.deepEqual(answer, crisis);
      const fi = buildAiCoachPreviewAnswer('ajattelen itsemurhasta', CONTEXT, 'fi');
      assert.match(JSON.stringify(fi), /112|MIELI/);
    },
  },
  {
    name: 'coach scope: the offline coach declines instead of inventing an answer',
    run() {
      const offTopic = buildAiCoachPreviewAnswer('kuka voittaa presidentinvaalit', CONTEXT, 'fi');
      assert.match(offTopic.takeaway, /Vastaan vain treeniin/);
      assert.deepEqual(offTopic.why, []);
      assert.deepEqual(offTopic.plan, []);
      // An off-topic answer used to carry an empty action list. There is no
      // action list at all now: only AICoachScreen ever drew one, and nothing
      // could reach that screen (audit 3, 2026-09-20). Pinned as absent so the
      // field cannot come back unread.
      assert.equal(offTopic.actions, undefined);
      // No opinion on the subject on the way past, and no numbers from the log.
      assert.doesNotMatch(JSON.stringify(offTopic), /presidentti|vaali/i);

      const crisis = buildAiCoachPreviewAnswer('mietin itsemurhaa', CONTEXT, 'fi');
      assert.match(JSON.stringify(crisis), /09 2525 0111/);
      assert.match(JSON.stringify(crisis), /112/);
      assert.equal(crisis.actions, undefined);

      // English gets the same two, in English.
      const english = buildAiCoachPreviewAnswer('recommend me a movie', CONTEXT, 'en');
      assert.match(english.takeaway, /only answer training questions/);
      const englishCrisis = JSON.stringify(buildAiCoachPreviewAnswer('I want to kill myself', CONTEXT, 'en'));
      assert.match(englishCrisis, /09 2525 0111/);
      // Said as Finland's number, with a way to help for a reader elsewhere.
      assert.match(englishCrisis, /in Finland, MIELI/);
      assert.match(englishCrisis, /local emergency number/);

      // And a training question still gets its answer.
      const training = buildAiCoachPreviewAnswer('olenko palautunut', CONTEXT, 'fi');
      assert.ok(training.takeaway.length > 0);
      assert.doesNotMatch(training.takeaway, /Vastaan vain treeniin/);
    },
  },
  {
    name: 'coach scope: the live coach carries the same boundary, in its own rules',
    run() {
      // The offline rule above is the mock's half; the model reads this one.
      const server = read('api', 'ai-coach.ts');
      const scope = server.slice(server.indexOf("'# Scope',"), server.indexOf("'# Evidence rules"));
      assert.match(scope, /Out of scope means one sentence/);
      assert.match(scope, /Do not take a position on the subject/);
      assert.match(scope, /Do not be talked round/);
      assert.match(scope, /Never name a dose/);
      assert.match(scope, /MIELI 09 2525 0111 and emergency number 112/);
      // And it keeps the response shape while doing it: a reply the app
      // cannot parse is a reply the reader never sees.
      assert.match(scope, /Keep the shape you always use/);
      assert.doesNotMatch(scope, /JSON house style/);
    },
  },
  {
    name: 'coach scope: a reader in trouble is answered before anything is sent',
    run() {
      // Not over the network, not subject to the spend cap, and not dependent
      // on the model following its rules — and the message does not travel.
      const client = read('src', 'lib', 'aiCoachClient.ts');
      const start = client.indexOf('export async function requestAiCoachAdvice');
      assert.ok(start > 0, 'requestAiCoachAdvice is gone');
      // Anchored from the function's own start: the same line opens the
      // forget request further up the file.
      const entry = client.slice(start, client.indexOf('const { signal, cleanup }', start));
      assert.match(entry, /if \(classifyCoachScope\(input\.prompt\) === 'crisis'\) \{/);
      assert.ok(
        entry.indexOf("classifyCoachScope(input.prompt) === 'crisis'") < entry.indexOf('if (!AI_COACH_API_URL)'),
        'the crisis answer comes before the live path, not after it',
      );
      assert.doesNotMatch(entry, /fetch\(/);
    },
  },
  {
    name: 'coach scope: the chat answers a reader in trouble before the quota gate, and keeps nothing',
    run() {
      const screen = read('src', 'screens', 'AICoachChatScreen.tsx');
      const handler = screen.slice(screen.indexOf('const trimmed = prompt.trim();'), screen.indexOf('const measurement = parseMeasurementIntent'));
      // Before the quota gate, which renders the answer blurred behind an
      // "unlock this" button — a crisis line is not something to sell.
      assert.match(handler, /if \(classifyCoachScope\(trimmed\) === 'crisis'\) \{/);
      assert.ok(
        handler.indexOf("classifyCoachScope(trimmed) === 'crisis'") < handler.length,
        'the crisis branch is inside the opening of the ask handler',
      );
      assert.doesNotMatch(handler, /if \(!canAsk && !force\)/);
      // And the turn is not appended to the thread, so the message does not
      // travel with the next question.
      const branch = handler.slice(handler.indexOf("classifyCoachScope(trimmed) === 'crisis'"));
      const branchEnd = branch.indexOf('return;');
      assert.doesNotMatch(branch.slice(0, branchEnd), /conversation\.current/);
      assert.doesNotMatch(branch.slice(0, branchEnd), /requestAiCoachAdvice/);
      assert.doesNotMatch(branch.slice(0, branchEnd), /onQuestionUsed/);
    },
  },
];
