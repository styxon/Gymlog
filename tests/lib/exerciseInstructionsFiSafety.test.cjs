const assert = require('node:assert/strict');

/**
 * Advice the Finnish steps must not give.
 *
 * The 708 steps added in #408 were translated from a public English database,
 * and a review found old advice carried over with them: knees held behind the
 * toes, "arch your back" turned into a phrase a Finnish reader takes as a ROUNDED
 * back, a hard lockout of the elbows, and a chin-high upright row. Each of those
 * hurts someone if the app says it, so each is a guard here, over every step in
 * both tables, in the shape the text actually has.
 *
 * Every guard is run against a sentence that breaks it (the "MUTATION" cases),
 * so a pattern that stopped matching would fail this suite instead of passing
 * quietly.
 */
// The table #408 added. The first 245 entries are a separate file with their own
// review; this suite guards the 708 that came from the public database.
const { EXERCISE_INSTRUCTIONS_FI_MORE: TABLE } = require('../../.test-dist/data/exerciseInstructionsFiMore.js');

function allSteps() {
  const rows = [];
  for (const [name, steps] of Object.entries(TABLE)) {
    steps.forEach((step, index) => rows.push({ name, step, index: index + 1 }));
  }
  return rows;
}

/** The knee is told to stay behind, or to be wrong in front of, the toes. */
const KNEES_PAST_TOES = /(polv\S*[^.]{0,60}(varpaiden|varpaitten) (edelle|ohi|yli))|((varpaiden|varpaitten) (edelle|ohi|yli)[^.]{0,40}polv)|(mene\S* niiden edelle)|(liike on tehty väärin)/i;

/** Reps to failure, which no ready program prescribes. */
const TO_FAILURE = /uupumukseen/i;

/**
 * "Arch the back" in Finnish reads as a rounded back. Bench-press set-up cues
 * are the one place an arch is deliberate, and they are worded without the
 * word. The allow-list is empty on purpose: add an exercise here only with a
 * sentence that cannot be read as rounding.
 */
const ARCH_ALLOWED = new Set([]);
// "kaarella" alone is also a path ("laske painoa kaarella"), so it counts only
// beside the back.
const ARCH_WORDING = /(selkä|alaselkä|selän|alaselän|selkää)\S*[^.]{0,40}\bkaarella\b|\bkaarella\b[^.]{0,20}\bselkä|kaarra (alaselkää|selkää)/i;

/** A hard lockout of the arms at the top of a press. */
const ARM_LOCKOUT = /(?<!älä )lukitse (kädet|käsi|kyynärpää|kyynärpäät|kyynärpäitä|ne kyynärpäät)|(kädet|kyynärpäät|käsi|kyynärpää)\b[^.,]{0,30}\blukittuina?\b/i;

/** The chin as the end of an upright row. */
const UPRIGHT_ROW = /upright.*row|^dumbbell raise$/i;
const TO_THE_CHIN = /leuka|leuan(?!veto)/i;

function violations(rows, test) {
  return rows.filter(test).map((row) => `${row.name} #${row.index}: ${row.step.slice(0, 90)}`);
}

module.exports = [
  {
    name: 'no Finnish step tells the knee to stay behind the toes',
    run() {
      const bad = violations(allSteps(), (row) => KNEES_PAST_TOES.test(row.step));
      assert.deepEqual(bad, []);
    },
  },
  {
    name: 'no Finnish step asks for reps to failure',
    run() {
      const bad = violations(allSteps(), (row) => TO_FAILURE.test(row.step));
      assert.deepEqual(bad, []);
    },
  },
  {
    name: 'no Finnish step says the back "kaarella" or "kaarra selkää" outside the bench-press allow-list',
    run() {
      const bad = violations(allSteps(), (row) => !ARCH_ALLOWED.has(row.name) && ARCH_WORDING.test(row.step));
      assert.deepEqual(bad, []);
    },
  },
  {
    name: 'no Finnish step locks the arms out at the top of a press',
    run() {
      const bad = violations(allSteps(), (row) => ARM_LOCKOUT.test(row.step));
      assert.deepEqual(bad, []);
      // "lukitse tanko telineeseen" is the Smith rack and stays.
      assert.ok(allSteps().some((row) => /lukitse tanko takaisin telineeseen/i.test(row.step)));
    },
  },
  {
    name: 'no upright row ends at the chin',
    run() {
      const rows = allSteps().filter((row) => UPRIGHT_ROW.test(row.name));
      assert.ok(new Set(rows.map((row) => row.name)).size >= 7, 'the upright-row family is present');
      const bad = violations(rows, (row) => TO_THE_CHIN.test(row.step));
      assert.deepEqual(bad, []);
    },
  },
  {
    name: 'the neck lifts carry their caution',
    run() {
      // Neck Press and Barbell Guillotine Bench Press are checked in both
      // languages in exerciseInstructionsGuards.test.cjs, against the audit's wording.
      for (const name of [
        'Push Press - Behind the Neck',
        'Standing Barbell Press Behind Neck',
        'Seated Barbell Military Press',
        'Wide-Grip Pulldown Behind The Neck',
        'Wide-Grip Rear Pull-Up',
        'Bradford/Rocky Presses',
        'Standing Bradford Press',
        'Rocky Pull-Ups/Pulldowns',
      ]) {
        assert.match(TABLE[name].join(' '), /Varoitus: .*(hartioiden liikkuvuu|hartioiden liikkuvuus)/, name);
      }
    },
  },
  {
    name: 'rep counts follow the programme, not a guess',
    run() {
      const bad = violations(allSteps(), (row) => /(suositeltu|haluttu) määrä toistoja|(suositellun|halutun) määrän toistoja/i.test(row.step));
      assert.deepEqual(bad, []);
    },
  },
  {
    name: 'the guards catch the sentences they exist for (MUTATION)',
    run() {
      assert.match('Jos polvet menevät varpaiden edelle, liike on tehty väärin.', KNEES_PAST_TOES);
      assert.match('Älä anna polven kulkea varpaiden edelle.', KNEES_PAST_TOES);
      assert.match('Varmista, ettei polvi mene varpaiden edelle.', KNEES_PAST_TOES);
      assert.match('Polvet kulkevat varpaiden suuntaisesti eivätkä mene niiden edelle.', KNEES_PAST_TOES);
      assert.doesNotMatch('Polvet seuraavat varpaiden suuntaa.', KNEES_PAST_TOES);
      assert.match('Toista uupumukseen asti.', TO_FAILURE);
      assert.match('pidä rinta ylhäällä ja selkä kaarella', ARCH_WORDING);
      assert.match('Vedä jalat altasi ja kaarra selkää.', ARCH_WORDING);
      assert.doesNotMatch('pidä selkä suorana ja alaselän luonnollinen kaari', ARCH_WORDING);
      assert.match('nosta tanko pään yläpuolelle ja lukitse kädet.', ARM_LOCKOUT);
      assert.match('Lukitse kyynärpäät ylhäällä.', ARM_LOCKOUT);
      assert.match('Pidä kädet ojennettuina ja lukittuina.', ARM_LOCKOUT);
      assert.doesNotMatch('Kun olet valmis, lukitse tanko takaisin telineeseen.', ARM_LOCKOUT);
      assert.match('Jatka, kunnes tanko melkein koskettaa leukaa.', TO_THE_CHIN);
      assert.match('kunnes käsipainot ovat lähes leuan kohdalla', TO_THE_CHIN);
      assert.doesNotMatch('Tartu leuanvetotankoon.', TO_THE_CHIN);
    },
  },
];
