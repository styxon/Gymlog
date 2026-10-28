const assert = require('node:assert/strict');

/**
 * Advice no exercise instruction may give, in either language.
 *
 * An audit of all 959 exercises (2026-10-19) found steps that told the reader to
 * push the knees past the toes, lock the elbows out, train to failure, row to the
 * chin, rest the bar on the neck, load in pounds, and steps that were menu text
 * or marketing instead of coaching. The English comes from a public database and
 * the corrections live in src/data/exerciseInstructionsEn.ts, so this suite reads the
 * text the READER gets: the effective English (correction or library row) for
 * every library entry, and both Finnish tables.
 *
 * Each guard names the sentences it exists for in the MUTATION case at the
 * bottom, so a pattern that stopped matching fails this suite instead of passing
 * quietly. An allow-list entry needs the exercise, the step number and a reason.
 */
const { finnishInstructionTable, effectiveEnglishInstructions } = require('../../.test-dist/lib/exerciseInstructions.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary.js');

function englishRows() {
  const rows = [];
  for (const item of [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]) {
    effectiveEnglishInstructions(item.name, item.instructions).forEach((step, index) =>
      rows.push({ lang: 'en', name: item.name, step, index: index + 1 }),
    );
  }
  return rows;
}

function finnishRows() {
  const rows = [];
  for (const [name, steps] of Object.entries(finnishInstructionTable())) {
    steps.forEach((step, index) => rows.push({ lang: 'fi', name, step, index: index + 1 }));
  }
  return rows;
}

const EN = englishRows();
const FI = finnishRows();

// ── patterns ────────────────────────────────────────────────────────────────

/** The knee is told to stay behind, or is warned about being past, the toes. */
const KNEES_PAST_TOES_EN = /\b(knees?|kneecaps?)\b[^.]{0,60}\b(past|beyond|over|in front of|ahead of|forward of)\b[^.]{0,15}\btoes?\b|\b(toes?)\b[^.]{0,30}\b(past|beyond)\b[^.]{0,20}\bknees?\b/i;
const KNEES_PAST_TOES_FI = /(polv\S*[^.]{0,60}(varpaiden|varpaitten) (edelle|ohi|yli))|((varpaiden|varpaitten) (edelle|ohi|yli)[^.]{0,40}polv)|(mene\S* niiden edelle)|(liike on tehty väärin)/i;

/** Reps taken to failure or exhaustion. */
const TO_FAILURE_EN = /\b(to|until|till|toward|towards|near|past)\s+(muscular |muscle |complete |total )?(failure|exhaustion|fatigue)\b|\bexhaustion\b|\bto failure\b/i;
const TO_FAILURE_FI = /uupumukseen|uupumuksen|uupumuspisteeseen|epäonnistumiseen|väsymykseen asti/i;

/** A hard lockout of the arms or legs. "Lock the bar in the rack" is not one. */
const LOCKOUT_NEGATED_EN = /\b(?:without|not|never|don't|do not|avoid|instead of|rather than|no)\b[^.]{0,40}\block/i;
const LOCKOUT_EN = /\block(?:ing|ed|s)?[ -]?out\b|\block(?:ing|ed|s)?\s+(?:your\s+|the\s+|both\s+)?(?:arms?|elbows?|knees?|legs?|hips?)\b|\b(?:arms?|elbows?|knees?|legs?)\b[^.,]{0,25}\blocked\b/i;
const LOCKOUT_NEGATED_FI = /(?:^|\s)(?:ei|älä|ilman|ettei)\s[^.]{0,40}lukit/i;
const LOCKOUT_FI = /(?<!älä )lukitse (kädet|käsi|kyynärpää|kyynärpäät|kyynärpäitä|ne kyynärpäät|polvet|polvi|polvia|jalat)|(kädet|kyynärpäät|käsi|kyynärpää|polvet|polvi|jalat)\b[^.,]{0,30}\blukittuina?\b|lukittu(?:vat|nut)? (?:kyynär|polv)/i;

/** The chin as the end of an upright row. */
const UPRIGHT_ROW = /upright.*row|^dumbbell raise$/i;
const TO_THE_CHIN_EN = /\bchin\b|\bchin-high\b/i;
const TO_THE_CHIN_FI = /leuka|leuan(?!veto)/i;

/** The bar lowered to, or left resting on, the neck. Warnings against it are fine. */
const BAR_ON_NECK_EN = /\btouch(?:es|ing)?\s+(?:the\s+|your\s+)?(?:back of (?:the |your )?)?neck\b|\b(?:rest(?:s|ing)?|touch(?:es|ing)?|lower(?:s|ing)?|bring(?:s|ing)?|slide(?:s)?|set(?:s|ting)?|place(?:s)?)\b[^.]{0,50}\b(?:on|onto|to|toward|towards|against)\s+(?:the\s+|your\s+)?(?:back of (?:the |your )?)?(?:neck|traps)\b/i;
const BAR_ON_NECK_FI = /(?:tanko|stanga|paino)[^.]{0,40}(?:lepää|levätä|laskee|koskee|kosketa)[^.]{0,20}(?:kaula|niska)|laske[^.]{0,30}(?:niskaan|kaulalle|niskan taakse)/i;
const NEGATION_EN = /\b(?:never|not|without|don't|do not|avoid|no)\b|clear of|away from/i;
const NEGATION_FI = /\b(?:ei|älä|ettei|ilman|vältä|kaukana)\b|selvästi/i;

/** Pounds and inches. */
const IMPERIAL_EN = /\b(?:lbs?\.?|pounds?|inch(?:es)?|ounces?|oz)\b|\d\s*(?:in\b|")|[”″]/i;
const IMPERIAL_FI = /\b(?:lbs?\.?|paunaa|paunan|naulaa|naulan|tuumaa|tuuman|tuumaisen|unssia)\b|\d\s*(?:in\b|")|[”″]/i;

/** "Arch the back" in Finnish reads as a rounded back. */
const ARCH_WORDING = /(selkä|alaselkä|selän|alaselän|selkää)\S*[^.]{0,40}\bkaarella\b|\bkaarella\b[^.]{0,20}\bselkä|kaarra (alaselkää|selkää)/i;
/** Bench-press set-up cues are the one place an arch is deliberate. Empty on purpose. */
const ARCH_ALLOWED = new Map([]);

/** Marketing and menu filler. */
const FILLER_EN = /\bis (?:a lot of |so |very |really )?fun\b|\bhave fun\b|\bburns? (?:a lot of |more |many )?calories\b|\bcalorie burn\b|\bselect your program\b|\bfrom the menu\b|\bconvenient\b|\bmost enjoyable\b/i;
const FILLER_FI = /\bon (?:todella |erittäin )?hauska\b|\bhauskaa\b|\bpolttaa kaloreita\b|\bpolta kaloreita\b|\bkaloreiden poltto\b|\bvalitse ohjelma valikosta\b/i;

/** Medical boilerplate. */
const DOCTOR_EN = /\b(?:consult|check with|talk to|speak to|see) (?:a |your |with a |with your )?(?:doctor|physician|physiotherapist|medical professional)\b/i;
const DOCTOR_FI = /\b(?:kysy|neuvottele|ota yhteyttä|käy|keskustele)\b[^.]{0,30}\blääkäri\S*|\blääkärin kanssa\b|\blääkäriltä\b/i;

/** The rep count belongs to the programme, not to the sentence. */
const REPS_GUESS_FI = /toista suositeltu määrä|(suositeltu|haluttu) määrä toistoja|(suositellun|halutun) määrän toistoja/i;

// ── allow-lists: exercise → { step, reason } ────────────────────────────────

const ALLOW = {
  kneesPastToes: new Map([
    [
      'Ankle Mobility Drill',
      {
        step: 2,
        reason: 'The drill IS the knee travelling over the toes, bodyweight and against a wall, to test and train ankle dorsiflexion; it is not a loaded squat cue.',
      },
    ],
  ]),
  toFailureEn: new Map([]),
  lockout: new Map([
    ["Alternating Floor Press", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Double Kettlebell Jerk", { step: 5, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Double Kettlebell Windmill", { step: 2, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Clean and Jerk", { step: 4, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Jerk", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Military Press To The Side", { step: 2, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Para Press", { step: 2, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Push Press", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Snatch", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Kettlebell Split Jerk", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["One-Arm Overhead Kettlebell Squats", { step: 2, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Power Jerk", { step: 4, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Power Snatch", { step: 4, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Snatch", { step: 6, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Snatch Balance", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Split Jerk", { step: 3, reason: "Olympic and kettlebell overhead lifts: \"locked out overhead\" is the sport's term for arms straight over the head under a coached load, not a hard snap of the joint." }],
    ["Bench Press - Powerlifting", { step: 4, reason: "Powerlifting and press terminology: \"lockout\" names the finish of the rep, not a hard snap of the elbows; the step also tells the lifter to keep the elbows tucked." }],
    ["Bench Press with Chains", { step: 4, reason: "Powerlifting and press terminology: \"lockout\" names the finish of the rep, not a hard snap of the elbows; the step also tells the lifter to keep the elbows tucked." }],
    ["Board Press", { step: 4, reason: "Powerlifting and press terminology: \"lockout\" names the finish of the rep, not a hard snap of the elbows; the step also tells the lifter to keep the elbows tucked." }],
    ["Pin Presses", { step: 5, reason: "Powerlifting and press terminology: \"lockout\" names the finish of the rep, not a hard snap of the elbows; the step also tells the lifter to keep the elbows tucked." }],
    ["Reverse Band Bench Press", { step: 4, reason: "Powerlifting and press terminology: \"lockout\" names the finish of the rep, not a hard snap of the elbows; the step also tells the lifter to keep the elbows tucked." }],
    ["Bent-Arm Dumbbell Pullover", { step: 4, reason: "Not a joint lockout: \"locked\" here means held in place (a bench pad, an elbow held to the side, a held bent-arm angle); the joint is not forced straight." }],
    ["Cable One Arm Tricep Extension", { step: 2, reason: "Not a joint lockout: \"locked\" here means held in place (a bench pad, an elbow held to the side, a held bent-arm angle); the joint is not forced straight." }],
    ["Wide-Grip Decline Barbell Pullover", { step: 1, reason: "Not a joint lockout: \"locked\" here means held in place (a bench pad, an elbow held to the side, a held bent-arm angle); the joint is not forced straight." }],
    ["Dips - Triceps Version", { step: 1, reason: "Says \"nearly locked\", which is the opposite of a hard lockout: the arms stay just short of straight above the bars." }],
  ]),
  barOnNeckEn: new Map([]),
  imperialEn: new Map([]),
  fillerEn: new Map([]),
  doctorEn: new Map([]),
};

function violations(rows, test, allowed = new Map()) {
  return rows
    .filter((row) => test(row) && !(allowed.get(row.name)?.step === row.index))
    .map((row) => `${row.lang} ${row.name} #${row.index}: ${row.step.slice(0, 110)}`);
}

function matching(re) {
  return (row) => re.test(row.step);
}

/** Matches the pattern but not as a warning against it. */
function unlessNegated(re, negation) {
  return (row) => re.test(row.step) && !negation.test(row.step);
}

module.exports = [
  {
    name: 'guards: the guarded text is the whole library in English and both Finnish tables',
    run() {
      assert.ok(EN.length > 3000, `English rows: ${EN.length}`);
      assert.ok(FI.length > 3000, `Finnish rows: ${FI.length}`);
      assert.ok(new Set(FI.map((row) => row.name)).size > 900);
    },
  },
  {
    name: 'guards: no step keeps the knee behind the toes',
    run() {
      assert.deepEqual(violations(EN, matching(KNEES_PAST_TOES_EN), ALLOW.kneesPastToes), []);
      assert.deepEqual(violations(FI, matching(KNEES_PAST_TOES_FI), ALLOW.kneesPastToes), []);
    },
  },
  {
    name: 'guards: no step asks for reps to failure or exhaustion',
    run() {
      assert.deepEqual(violations(EN, matching(TO_FAILURE_EN), ALLOW.toFailureEn), []);
      assert.deepEqual(violations(FI, matching(TO_FAILURE_FI)), []);
    },
  },
  {
    name: 'guards: no step locks the arms or legs out hard',
    run() {
      assert.deepEqual(violations(EN, unlessNegated(LOCKOUT_EN, LOCKOUT_NEGATED_EN), ALLOW.lockout), []);
      assert.deepEqual(violations(FI, unlessNegated(LOCKOUT_FI, LOCKOUT_NEGATED_FI), ALLOW.lockout), []);
      // Racking the bar is a different "lock", and stays.
      assert.ok(FI.some((row) => /lukitse tanko takaisin telineeseen/i.test(row.step)));
    },
  },
  {
    name: 'guards: no upright row ends at the chin',
    run() {
      const en = EN.filter((row) => UPRIGHT_ROW.test(row.name));
      const fi = FI.filter((row) => UPRIGHT_ROW.test(row.name));
      assert.ok(new Set(en.map((row) => row.name)).size >= 7, 'the upright-row family is present');
      assert.deepEqual(violations(en, matching(TO_THE_CHIN_EN)), []);
      assert.deepEqual(violations(fi, matching(TO_THE_CHIN_FI)), []);
    },
  },
  {
    name: 'guards: the bar is never lowered to or left on the neck',
    run() {
      assert.deepEqual(violations(EN, unlessNegated(BAR_ON_NECK_EN, NEGATION_EN), ALLOW.barOnNeckEn), []);
      assert.deepEqual(violations(FI, unlessNegated(BAR_ON_NECK_FI, NEGATION_FI)), []);
    },
  },
  {
    name: 'guards: kg and cm only, no pounds and no inches',
    run() {
      assert.deepEqual(violations(EN, matching(IMPERIAL_EN), ALLOW.imperialEn), []);
      assert.deepEqual(violations(FI, matching(IMPERIAL_FI)), []);
    },
  },
  {
    name: 'guards: no Finnish step says the back "kaarella" or "kaarra selkää" outside the allow-list',
    run() {
      const bad = violations(FI, (row) => !ARCH_ALLOWED.has(row.name) && ARCH_WORDING.test(row.step));
      assert.deepEqual(bad, []);
      for (const [name, reason] of ARCH_ALLOWED) {
        assert.ok(String(reason).length > 20, `${name} is allowed with no reason`);
      }
    },
  },
  {
    name: 'guards: no marketing or menu filler',
    run() {
      assert.deepEqual(violations(EN, matching(FILLER_EN), ALLOW.fillerEn), []);
      assert.deepEqual(violations(FI, matching(FILLER_FI)), []);
    },
  },
  {
    name: 'guards: no "consult a doctor" boilerplate',
    run() {
      assert.deepEqual(violations(EN, matching(DOCTOR_EN), ALLOW.doctorEn), []);
      assert.deepEqual(violations(FI, matching(DOCTOR_FI)), []);
    },
  },
  {
    name: 'guards: the rep count follows the programme, not a guess',
    run() {
      assert.deepEqual(violations(FI, matching(REPS_GUESS_FI)), []);
    },
  },
  {
    name: 'guards: every allow-list entry names a real exercise and step, and gives a reason',
    run() {
      const known = new Set(EN.map((row) => row.name));
      for (const [list, entries] of Object.entries(ALLOW)) {
        for (const [name, entry] of entries) {
          assert.ok(known.has(name), `${list}: ${name} is not in the library`);
          assert.ok(Number.isInteger(entry.step) && entry.step > 0, `${list}: ${name} has no step number`);
          assert.ok(String(entry.reason).trim().length > 20, `${list}: ${name} is allowed with no reason`);
        }
      }
    },
  },
  {
    name: 'guards: the neck lifts carry their caution in both languages',
    run() {
      const en = (name) => EN.filter((row) => row.name === name).map((row) => row.step).join(' ');
      const fi = (name) => FI.filter((row) => row.name === name).map((row) => row.step).join(' ');
      assert.match(en('Neck Press'), /light weight and have a spotter/i);
      assert.match(en('Neck Press'), /never touch or rest on your neck/i);
      assert.match(fi('Neck Press'), /Varoitus: käytä vain kevyttä painoa ja pyydä vierelle varmistaja/);
      assert.match(fi('Neck Press'), /ei saa koskaan koskettaa kaulaa eikä levätä sen päällä/);
      assert.match(en('Barbell Guillotine Bench Press'), /light weight and a spotter/i);
      assert.match(en('Barbell Guillotine Bench Press'), /clear of your neck/i);
      assert.match(fi('Barbell Guillotine Bench Press'), /kevyttä painoa ja pyydä pari varmistamaan/);
      assert.match(fi('Barbell Guillotine Bench Press'), /kaukana kaulasta/);
    },
  },
  {
    name: 'guards: the guards catch the sentences they exist for (MUTATION)',
    run() {
      const yes = (re, text) => assert.match(text, re, text);
      const no = (re, text) => assert.doesNotMatch(text, re, text);

      yes(KNEES_PAST_TOES_EN, 'Do not let your knees go past your toes.');
      yes(KNEES_PAST_TOES_EN, 'Make sure your knees do not travel beyond your toes.');
      yes(KNEES_PAST_TOES_EN, 'Keep the knee from moving in front of the toes.');
      no(KNEES_PAST_TOES_EN, 'Let the knees track in line with the toes.');
      yes(KNEES_PAST_TOES_FI, 'Älä anna polven kulkea varpaiden edelle.');
      no(KNEES_PAST_TOES_FI, 'Polvet seuraavat varpaiden suuntaa.');

      yes(TO_FAILURE_EN, 'Repeat until failure.');
      yes(TO_FAILURE_EN, 'Do as many reps as you can to exhaustion.');
      yes(TO_FAILURE_EN, 'Work to muscular failure.');
      no(TO_FAILURE_EN, 'Stop the set if your form fails.');
      yes(TO_FAILURE_FI, 'Toista uupumukseen asti.');
      no(TO_FAILURE_FI, 'Toista ohjelman mukainen määrä toistoja.');

      yes(LOCKOUT_EN, 'Press up and lock out your elbows.');
      yes(LOCKOUT_EN, 'Stand tall and lock your knees.');
      yes(LOCKOUT_EN, 'Finish with the arms locked.');
      yes(LOCKOUT_EN, 'Hold the lockout at the top.');
      no(LOCKOUT_EN, 'Lock the bar in the rack when you are done.');
      no(LOCKOUT_EN, 'Extend the arms without forcing the elbows straight.');
      yes(LOCKOUT_FI, 'nosta tanko pään yläpuolelle ja lukitse kädet.');
      yes(LOCKOUT_FI, 'Lukitse polvet ylhäällä.');
      yes(LOCKOUT_FI, 'Pidä kädet ojennettuina ja lukittuina.');
      no(LOCKOUT_FI, 'Kun olet valmis, lukitse tanko takaisin telineeseen.');
      no(LOCKOUT_FI, 'Älä lukitse polvia.');
      // Warnings against a lockout are not violations; the instruction to lock is.
      assert.ok(unlessNegated(LOCKOUT_EN, LOCKOUT_NEGATED_EN)({ step: 'Lock out your elbows.' }));
      assert.ok(!unlessNegated(LOCKOUT_EN, LOCKOUT_NEGATED_EN)({ step: 'Straighten the legs without locking the knees.' }));
      assert.ok(unlessNegated(LOCKOUT_FI, LOCKOUT_NEGATED_FI)({ step: 'Nosta tanko ja pidä polvet lukittuina.' }));
      assert.ok(!unlessNegated(LOCKOUT_FI, LOCKOUT_NEGATED_FI)({ step: 'Nouse varpaille, polvet suorina mutta ei lukittuina.' }));

      yes(TO_THE_CHIN_EN, 'Pull the bar up to your chin.');
      no(TO_THE_CHIN_EN, 'Pull the bar to the middle of your chest.');
      yes(TO_THE_CHIN_FI, 'Jatka, kunnes tanko melkein koskettaa leukaa.');
      no(TO_THE_CHIN_FI, 'Tartu leuanvetotankoon.');

      yes(BAR_ON_NECK_EN, 'Lower the bar until it touches the back of your neck.');
      yes(BAR_ON_NECK_EN, 'Rest the bar on your neck.');
      assert.ok(unlessNegated(BAR_ON_NECK_EN, NEGATION_EN)({ step: 'Lower the bar until it rests on the back of your neck.' }));
      assert.ok(!unlessNegated(BAR_ON_NECK_EN, NEGATION_EN)({ step: 'The bar must never touch or rest on your neck.' }));
      yes(BAR_ON_NECK_FI, 'Laske tanko niskaan asti.');
      yes(BAR_ON_NECK_FI, 'Tanko lepää kaulalla.');
      assert.ok(!unlessNegated(BAR_ON_NECK_FI, NEGATION_FI)({ step: 'Tanko ei saa koskaan levätä kaulalla.' }));

      yes(IMPERIAL_EN, 'Use a 45 lb plate.');
      yes(IMPERIAL_EN, 'Keep your feet 12 inches apart.');
      yes(IMPERIAL_EN, 'Set the pad about 6" above the floor.');
      yes(IMPERIAL_EN, 'Lift 20 pounds.');
      no(IMPERIAL_EN, 'Pinch the shoulder blades together.');
      no(IMPERIAL_EN, 'Keep the weight at 20 kg.');
      yes(IMPERIAL_FI, 'Käytä 45 lbs painoa.');
      yes(IMPERIAL_FI, 'Jalat 12 tuumaa erillään.');
      yes(IMPERIAL_FI, 'Aseta tyyny 6" lattiasta.');
      no(IMPERIAL_FI, 'Jalat 30 cm erillään.');

      yes(ARCH_WORDING, 'pidä rinta ylhäällä ja selkä kaarella');
      yes(ARCH_WORDING, 'Vedä jalat altasi ja kaarra selkää.');
      no(ARCH_WORDING, 'pidä selkä suorana ja alaselän luonnollinen kaari');

      yes(FILLER_EN, 'Skipping is fun and good for the whole family.');
      yes(FILLER_EN, 'This exercise burns calories fast.');
      yes(FILLER_EN, 'Select your program from the menu.');
      yes(FILLER_EN, 'It is convenient and softer than outdoors.');
      no(FILLER_EN, 'Keep the funnel of the cable straight.');
      yes(FILLER_FI, 'Hyppynaru on hauska ja kuluttaa.');
      yes(FILLER_FI, 'Tämä polttaa kaloreita.');
      no(FILLER_FI, 'Tärkein vaihe on kevyt alkulämmittely.');

      yes(DOCTOR_EN, 'Consult a doctor before trying this.');
      yes(DOCTOR_EN, 'Check with your physician first.');
      no(DOCTOR_EN, 'Have a spotter ready.');
      yes(DOCTOR_FI, 'Kysy neuvoa lääkäriltä ennen kuin aloitat.');
      yes(DOCTOR_FI, 'Neuvottele lääkärin kanssa.');
      no(DOCTOR_FI, 'Pyydä pari varmistamaan.');

      yes(REPS_GUESS_FI, 'Toista suositeltu määrä toistoja.');
      yes(REPS_GUESS_FI, 'Toista haluttu määrä toistoja.');
      no(REPS_GUESS_FI, 'Toista ohjelman mukainen määrä toistoja.');
    },
  },
];
