/**
 * Recommendation accuracy matrix (hunt harness, not part of tests/run-tests.cjs).
 *
 *   npx tsc -p tsconfig.test.json
 *   node tests/hunt/recommendationMatrix.cjs [--extra N] [--json out.json] [--show N]
 *
 * Enumerates the onboarding answer space (equipment chips x goal x level x days
 * fully; avoid areas, focus areas, gender, age sampled deterministically on top),
 * runs the REAL pipeline the onboarding screen runs
 *   resolveFirstRunRecommendationWithTailoring -> composeProgramWeekForSelection
 *   -> buildProgramFocusSplit
 * and scores the top-1 (and the two cards the pick screen shows) against explicit
 * criteria. Prints per-criterion failure counts, the most common patterns, worked
 * examples and the catalog coverage gaps (no programme in the catalog fits).
 *
 * Criteria for the top-1 recommendation (HARD = a defect a reader can see):
 *   E1  HARD  gear: composed week drops >1 lift or swaps >1/3 of its lifts
 *   E2  HARD  gear use: reader owns gear, plan uses none of it although an
 *             eligible programme (goal+level+gender+gear fit, days +-1) does
 *   E2s SOFT  gear use: plan uses less of the reader's gear than the best eligible
 *   E4  SOFT  load ignored: reader owns a barbell, dumbbells, machines or cables
 *             (a gym included), the plan uses none of them, and a programme for
 *             their goal and level that fits their gear does, at any day count
 *             (E2 looks only a day either side, and missed bodyweight weeks
 *             beating a barbell week two days off; review 2026-10-05)
 *   E3  HARD  final week contains a lift the reader's gear cannot do
 *             (caution swaps are not gear-checked)
 *   G1  HARD  goal: programme supportedGoals does not include the answer
 *             (backup-only or none)
 *   G2  SOFT  split vs goal: muscle/strength plan with >10% conditioning+mobility,
 *             or lean_athletic with <15% conditioning
 *   G3  INFO  the bar's lifting disagrees with the goal: a muscle goal whose week
 *             is mostly heavy (<=6 reps) lifting, or a strength goal mostly lighter
 *   D1  SOFT  programme's own days != answer
 *   D2  HARD  composed week days != answer (beginner cap excluded, see D3)
 *   D3  INFO  beginner asked for >3 days, week capped at 3 by the waterfall
 *   D4  SOFT  a third or more of the composed week is synthetic "suggested" days
 *             (the programme is padded to reach the answer)
 *   D5  SOFT  composed week drops 2+ of the programme's own sessions (trimmed)
 *   L1  HARD  programme does not list the reader's level
 *   S1  HARD  gender-targeted programme shown to the other gender
 *   C1  HARD  composed week still contains a lift loading an AVOID area
 *   C2  SOFT  avoid flags removed >25% of the lifts (plan gutted)
 *   F1  SOFT  a chosen focus area is neither in the programme tags nor added
 *             as emphasis
 *   F2  SOFT  F1 and an eligible programme tagged for that area exists
 *   ANY HARD  at least one HARD criterion fails
 *   BOTH2     both shown cards fail a HARD criterion
 */
const path = require('node:path');

const dist = path.join(__dirname, '..', '..', '.test-dist');
const lib = (name) => require(path.join(dist, 'lib', `${name}.js`));

const { resolveFirstRunRecommendationWithTailoring } = lib('firstRunSetup');
const { composeProgramWeekForSelection } = lib('programDayComposer');
const { buildProgramFocusSplit } = lib('programFocusSplit');
const { RECOMMENDATION_PROGRAMS, getRecommendationProgramDefinition } = lib('recommendationCatalog');
const { resolveProgramEquipment } = lib('programEquipment');
const { selectWaterfallDecision } = lib('recommendationWaterfall');
const { buildRecommendationInput } = lib('recommendationInput');
const { programFitsEquipment, GYM_ALWAYS_HAS } = lib('programEquipmentFit');
const { exerciseHitsCautionArea } = lib('cautionAreaMatching');
const { isExerciseAllowedWithEquipment, resolveAvailableEquipment } = lib('equipmentExerciseFilter');
const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const EXTRA_PER_BASE = Number(argValue('--extra', 3));
const JSON_OUT = argValue('--json', null);
const SHOW = Number(argValue('--show', 4));

// ---------------------------------------------------------------- answer space
// Mirrors OnboardingScreen.applyEquipmentEnvironment: the cards write
// equipment + trainingEnvironment + equipmentItems, never a free-form value.
const HEAVY = ['Barbell & plates', 'Squat rack'];
const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];

function homeCard(items) {
  if (items.length === 0) return { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] };
  const heavy = items.some((item) => HEAVY.includes(item));
  return {
    equipment: heavy ? 'home' : 'minimal',
    trainingEnvironment: heavy ? 'home_gym' : 'minimal_equipment',
    equipmentItems: items,
  };
}
const bodyweightCard = (items) => ({ equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: items });
const gymCard = (items) => ({ equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: items });

const D = 'Dumbbells', B = 'Bench', R = 'Resistance bands', K = 'Kettlebells', P = 'Pull-up bar';
const BB = 'Barbell & plates', RK = 'Squat rack', C = 'Cardio machines';

const EQUIPMENT_SETS = [
  ['gym:all', gymCard(GYM_ALL)],
  ['gym:no-barbells', gymCard(GYM_ALL.filter((i) => i !== 'Barbells' && i !== 'Squat rack'))],
  ['gym:no-machines-cables', gymCard(GYM_ALL.filter((i) => i !== 'Machines' && i !== 'Cables'))],
  ['home:none', homeCard([])],
  ['home:D', homeCard([D])],
  ['home:D+B', homeCard([D, B])],
  ['home:D+B+R (default)', homeCard([D, B, R])],
  ['home:D+P', homeCard([D, P])],
  ['home:D+K', homeCard([D, K])],
  ['home:D+B+R+P', homeCard([D, B, R, P])],
  ['home:R', homeCard([R])],
  ['home:K', homeCard([K])],
  ['home:P', homeCard([P])],
  ['home:R+P', homeCard([R, P])],
  ['home:BB+RK', homeCard([BB, RK])],
  ['home:BB+RK+B', homeCard([BB, RK, B])],
  ['home:D+B+RK+BB', homeCard([D, B, RK, BB])],
  ['home:D+B+RK+BB+P', homeCard([D, B, RK, BB, P])],
  ['home:everything', homeCard([D, B, RK, BB, R, K, P])],
  ['home:D+B+C', homeCard([D, B, C])],
  ['bodyweight:none', bodyweightCard([])],
  ['bodyweight:P', bodyweightCard([P])],
  ['bodyweight:R', bodyweightCard([R])],
  ['bodyweight:P+R+mat', bodyweightCard([P, R, 'Yoga mat'])],
];

const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness']; // the four cards the UI offers
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];

const CAUTIONS = [
  ['none', []],
  ['knees:avoid', [{ area: 'knees', level: 'avoid', refinements: [] }]],
  ['knees:careful', [{ area: 'knees', level: 'careful', refinements: [] }]],
  ['lower_back:avoid', [{ area: 'lower_back', level: 'avoid', refinements: [] }]],
  ['shoulders:avoid', [{ area: 'shoulders', level: 'avoid', refinements: [] }]],
  ['shoulders:careful', [{ area: 'shoulders', level: 'careful', refinements: [] }]],
];
const FOCUSES = [
  ['none', []],
  ['glutes', ['glutes']],
  ['arms', ['arms']],
  ['chest', ['chest']],
  ['legs', ['legs']],
  ['back', ['back']],
  ['glutes+arms', ['glutes', 'arms']],
  ['chest+shoulders', ['chest', 'shoulders']],
  ['quads+hamstrings+calves', ['quads', 'hamstrings', 'calves']],
];
const GENDERS = ['unspecified', 'male', 'female'];
const AGES = ['19_25', '41_plus'];

function buildSelection(a) {
  return {
    gender: a.gender,
    ageRange: a.age,
    goal: a.goal,
    goals: [a.goal],
    level: a.level,
    daysPerWeek: a.days,
    equipment: a.card.equipment,
    trainingEnvironment: a.card.trainingEnvironment,
    equipmentItems: a.card.equipmentItems,
    secondaryOutcomes: [],
    focusAreas: a.focus[1],
    cautionFlags: a.caution[1],
    guidanceMode: 'guided_editable',
    scheduleMode: 'app_managed',
    automatedProgression: true,
    weeklyMinutes: null,
    availableDays: [],
    trainingCyclePattern: null,
    currentWeightKg: null,
    targetWeightKg: null,
    unitPreference: 'kg',
  };
}

// Deterministic pseudo-random so a rerun reproduces the same sample.
let seed = 20261005;
const rand = (n) => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed % n;
};

function enumerateCases() {
  const cases = [];
  for (const [equipName, card] of EQUIPMENT_SETS) {
    for (const goal of GOALS) {
      for (const level of LEVELS) {
        for (const days of DAYS) {
          // Base cell: nothing else answered.
          cases.push({ equipName, card, goal, level, days, gender: 'unspecified', age: '19_25', caution: CAUTIONS[0], focus: FOCUSES[0], base: true });
          for (let i = 0; i < EXTRA_PER_BASE; i += 1) {
            cases.push({
              equipName, card, goal, level, days,
              gender: GENDERS[rand(GENDERS.length)],
              age: AGES[rand(AGES.length)],
              caution: CAUTIONS[1 + rand(CAUTIONS.length - 1)],
              focus: FOCUSES[rand(FOCUSES.length)],
              base: false,
            });
          }
        }
      }
    }
  }
  return cases;
}

// ------------------------------------------------------------------- helpers
const templateNamesCache = new Map();
function templateNames(programId) {
  if (!templateNamesCache.has(programId)) {
    const template = getWorkoutTemplateById(programId);
    templateNamesCache.set(programId, template ? template.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseName)) : []);
  }
  return templateNamesCache.get(programId);
}
const needsCache = new Map();
function templateNeeds(programId) {
  if (!needsCache.has(programId)) needsCache.set(programId, resolveProgramEquipment(templateNames(programId)));
  return needsCache.get(programId);
}

/** Gear the reader owns that a plan could use (a mat is not training gear). */
function userGear(card) {
  return card.equipmentItems.filter((item) => item !== 'Yoga mat');
}
function gearAvailable(card) {
  // What the pool filter sees: gym readers get the pull-up bar and bands for free.
  return card.equipment === 'gym' ? [...new Set([...card.equipmentItems, ...GYM_ALWAYS_HAS])] : card.equipmentItems;
}
function gearUse(programId, card) {
  const gear = userGear(card);
  if (gear.length === 0) return 0;
  const needs = templateNeeds(programId);
  const used = gear.filter((item) => needs.includes(item) || (item === 'Barbell & plates' && needs.includes('Barbells')));
  return used.length / gear.length;
}
const LOAD = ['Barbells', 'Barbell & plates', 'Dumbbells', 'Machines', 'Cables'];
function ownedLoad(card) {
  return gearAvailable(card).filter((item) => LOAD.includes(item));
}
function usesAny(programId, items) {
  const needs = templateNeeds(programId);
  return items.some((item) => needs.includes(item) || (item === 'Barbell & plates' && needs.includes('Barbells')));
}
function focusEquivalent(area) {
  return area === 'legs' ? ['legs', 'quads', 'hamstrings', 'calves'] : ['quads', 'hamstrings', 'calves'].includes(area) ? [area, 'legs'] : [area];
}
function programTagsFocus(def, area) {
  return focusEquivalent(area).some((a) => def.focusAreaTags.includes(a));
}

/** Programmes a good recommender could have chosen for these answers. */
function eligiblePrograms(a, sel, daysTolerance = 1) {
  const avail = resolveAvailableEquipment(sel);
  return RECOMMENDATION_PROGRAMS.filter((def) => {
    if (!def.supportedGoals.includes(a.goal)) return false;
    if (!def.supportedLevels.includes(a.level)) return false;
    if (def.targetGender !== 'unisex' && def.targetGender !== a.gender) return false;
    if (Math.abs(def.daysPerWeek - a.days) > daysTolerance) return false;
    // A week of stretching only answers a reader who asked for one: running
    // and mobility as the goal, or mobility as an outcome or a focus. The
    // mobility flow uses a band, and counting it made every band owner who
    // was not handed it a gear failure (bug hunt, 2026-10-07).
    const recoveryOnly = def.familyId === 'joint_friendly' && !def.styleTags.includes('balanced');
    const askedForRecovery = a.goal === 'run_mobility'
      || (sel.secondaryOutcomes ?? []).includes('mobility')
      || (sel.focusAreas ?? []).includes('mobility');
    if (recoveryOnly && !askedForRecovery) return false;
    if (a.card.equipment === 'gym') {
      return programFitsEquipment(def.programId, gearAvailable(a.card));
    }
    return programFitsEquipment(def.programId, avail);
  });
}

function weekStats(sel, programId) {
  const week = composeProgramWeekForSelection(sel, programId);
  if (!week) return null;
  const names = week.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseName));
  const original = templateNames(programId).length;
  return { week, names, focus: buildProgramFocusSplit(week.sessions), originalCount: original };
}
const pct = (focus, quality) => (focus.find((s) => s.quality === quality) || { pct: 0 }).pct;

function evaluate(a, programId, sel, ws) {
  const def = getRecommendationProgramDefinition(programId);
  const week = ws.week;
  const fails = {};
  const detail = {};
  const gear = resolveAvailableEquipment(sel);

  // E1: gear survives composition
  const swapped = week.equipmentSwapped.length;
  const removed = week.equipmentRemoved.length;
  const lifts = ws.originalCount || 1;
  if (a.card.equipment !== 'gym' || (gear && gear.length < GYM_ALL.length)) {
    if (removed > 1 || swapped / lifts > 1 / 3) fails.E1 = true;
    detail.E1 = `removed ${removed}, swapped ${swapped}/${lifts}`;
  }

  // E2 / E2s: use of the reader's own gear
  if (a.card.equipment !== 'gym' && userGear(a.card).length > 0) {
    const mine = gearUse(programId, a.card);
    const elig = eligiblePrograms(a, sel).filter((d) => d.programId !== programId);
    let best = null;
    for (const d of elig) {
      const u = gearUse(d.programId, a.card);
      if (!best || u > best.u) best = { id: d.programId, u };
    }
    detail.E2 = `uses ${(mine * 100).toFixed(0)}% of gear; best eligible ${best ? `${best.id} ${(best.u * 100).toFixed(0)}%` : 'none'}`;
    if (best && best.u > mine + 1e-9) {
      fails.E2s = true;
      if (mine === 0) fails.E2 = true;
    }
  }

  // E4: owned load left unused while a geared programme for the goal serves
  if (a.goal !== 'run_mobility') {
    const load = ownedLoad(a.card);
    if (load.length > 0 && !usesAny(programId, load)) {
      const geared = eligiblePrograms(a, sel, 99).find((d) => usesAny(d.programId, load));
      if (geared) {
        fails.E4 = true;
        detail.E4 = `uses none of ${load.join('+')}; ${geared.programId} does`;
      }
    }
  }

  // E3: final week holds a lift the gear cannot do
  if (gear !== null) {
    const bad = ws.names.filter((n) => !isExerciseAllowedWithEquipment(n, gear));
    if (bad.length > 0) {
      fails.E3 = true;
      detail.E3 = bad.slice(0, 3).join(', ');
    }
  }

  // G1
  if (!def.supportedGoals.includes(a.goal)) {
    fails.G1 = true;
    detail.G1 = def.backupGoals.includes(a.goal) ? 'backup-goal match only' : 'goal not supported at all';
  }

  // G2 / G3
  const heavyPct = pct(ws.focus, 'Strength');
  const musclePct = pct(ws.focus, 'Muscle');
  const condPct = pct(ws.focus, 'Conditioning');
  const mobPct = pct(ws.focus, 'Mobility');
  detail.split = `Strength ${heavyPct} / Muscle ${musclePct} / Conditioning ${condPct} / Mobility ${mobPct}`;
  if ((a.goal === 'muscle' || a.goal === 'strength') && condPct + mobPct > 10) fails.G2 = true;
  if (a.goal === 'lean_athletic' && condPct < 15) fails.G2 = true;
  if (a.goal === 'muscle' && heavyPct > musclePct) fails.G3 = true;
  if (a.goal === 'strength' && musclePct > heavyPct) fails.G3 = true;

  // D
  if (def.daysPerWeek !== a.days) fails.D1 = true;
  if (week.days !== a.days) {
    if (a.level === 'beginner' && a.days > 3 && week.days === 3) fails.D3 = true;
    else fails.D2 = true;
    detail.D = `answer ${a.days}, programme ${def.daysPerWeek}, composed ${week.days}`;
  }

  const suggested = week.sessions.filter((x) => x.source === 'suggested').length;
  const kept = week.sessions.length - suggested;
  detail.D4 = `${suggested} suggested of ${week.sessions.length}`;
  if (suggested / Math.max(1, week.sessions.length) >= 1 / 3) fails.D4 = true;
  if (def.daysPerWeek - kept >= 2) {
    fails.D5 = true;
    detail.D5 = `programme ${def.daysPerWeek}d, kept ${kept}`;
  }

  // L / S
  if (!def.supportedLevels.includes(a.level)) {
    fails.L1 = true;
    detail.L1 = `programme levels ${def.supportedLevels.join('/')}`;
  }
  if (def.targetGender !== 'unisex' && def.targetGender !== a.gender) fails.S1 = true;

  // C
  const avoids = sel.cautionFlags.filter((f) => f.level === 'avoid');
  if (avoids.length > 0) {
    const viol = ws.names.filter((n) => avoids.some((f) => exerciseHitsCautionArea(n, f.area)));
    if (viol.length > 0) {
      fails.C1 = true;
      detail.C1 = viol.slice(0, 3).join(', ');
    }
    const cutShare = week.cautionRemoved.length / lifts;
    detail.C2 = `caution removed ${week.cautionRemoved.length}/${lifts}`;
    if (cutShare > 0.25) fails.C2 = true;
  }

  // F
  if (sel.focusAreas.length > 0) {
    const missing = sel.focusAreas.filter(
      (area) =>
        !programTagsFocus(def, area) &&
        !week.focusAdditions.some((add) => focusEquivalent(area).includes(add.area)),
    );
    if (missing.length > 0) {
      fails.F1 = true;
      detail.F1 = `unreflected: ${missing.join(',')}`;
      const elig = eligiblePrograms(a, sel);
      if (elig.some((d) => missing.some((area) => programTagsFocus(d, area)))) fails.F2 = true;
    }
  }

  fails.HARD = ['E1', 'E2', 'E3', 'G1', 'D2', 'L1', 'S1', 'C1'].some((k) => fails[k]);
  return { fails, detail, def, programName: getWorkoutTemplateById(programId).name };
}

// ----------------------------------------------------------------------- run
const cases = enumerateCases();
const results = [];
const t0 = Date.now();
let evaluated = 0;
for (const a of cases) {
  const sel = buildSelection(a);
  const tailoring = {
    setupEquipment: sel.equipment,
    setupFreeWeightsPreference: 'neutral',
    setupBodyweightPreference: 'neutral',
    setupMachinesPreference: 'neutral',
    setupShoulderFriendlySwaps: 'neutral',
    setupElbowFriendlySwaps: 'neutral',
    setupKneeFriendlySwaps: 'neutral',
  };
  const rec = resolveFirstRunRecommendationWithTailoring(sel, tailoring, 'en');
  const shown = [rec.featuredProgramId, rec.secondaryProgramId, ...rec.alternativeProgramIds].filter((id, i, arr) => id && arr.indexOf(id) === i).slice(0, 2);
  const evals = shown.map((programId) => {
    const ws = weekStats(sel, programId);
    return { programId, ...evaluate(a, programId, sel, ws) };
  });
  const elig = eligiblePrograms(a, sel);
  const eligAnyDays = eligiblePrograms(a, sel, 6);
  // What the waterfall alone picked, before scoring's tailoring "cell" swap
  // replaced it (recommendationScoring.ts, cellTop).
  const wf = selectWaterfallDecision(buildRecommendationInput(sel));
  const wfSwapped = wf.primaryProgramId !== rec.featuredProgramId;
  let wfEval = null;
  if (wfSwapped) {
    const wfWs = weekStats(sel, wf.primaryProgramId);
    wfEval = evaluate(a, wf.primaryProgramId, sel, wfWs);
  }
  results.push({
    wfSwapped,
    wfProgram: wf.primaryProgramId,
    wfHard: wfEval ? Boolean(wfEval.fails.HARD) : null,
    wfName: wfEval ? wfEval.programName : null,
    a,
    top: evals[0],
    second: evals[1] || null,
    rule: rec.waterfall ? rec.waterfall.rule : 'score-only',
    eligibleCount: elig.length,
    eligibleAnyDaysCount: eligAnyDays.length,
    scores: rec.scoredCandidates.slice(0, 3).map((c) => `${c.programId}=${c.score}`),
  });
  evaluated += 1;
  if (evaluated % 1000 === 0) process.stderr.write(`  ${evaluated}/${cases.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

// ------------------------------------------------------- device case (5.10.)
function workedExample() {
  const a = {
    equipName: 'home:D', card: homeCard([D]), goal: 'muscle', level: 'beginner', days: 3,
    gender: 'unspecified', age: '26_30',
    caution: CAUTIONS[1], focus: FOCUSES.find((f) => f[0] === 'glutes+arms'),
  };
  const sel = buildSelection(a);
  const rec = resolveFirstRunRecommendationWithTailoring(sel, {
    setupEquipment: sel.equipment, setupFreeWeightsPreference: 'neutral', setupBodyweightPreference: 'neutral',
    setupMachinesPreference: 'neutral', setupShoulderFriendlySwaps: 'neutral', setupElbowFriendlySwaps: 'neutral', setupKneeFriendlySwaps: 'neutral',
  }, 'en');
  const lines = ['Device case: home, dumbbells only, muscle, beginner, 3d, knees avoid, focus glutes+arms'];
  lines.push(`  rule=${rec.waterfall && rec.waterfall.rule}  top scores: ${rec.scoredCandidates.slice(0, 5).map((c) => `${c.programId}=${c.score}`).join(', ')}`);
  for (const id of [rec.featuredProgramId, rec.secondaryProgramId]) {
    if (!id) continue;
    const ws = weekStats(sel, id);
    const ev = evaluate(a, id, sel, ws);
    lines.push(`  ${ev.programName}: split ${ev.detail.split}; fails=${Object.keys(ev.fails).filter((k) => ev.fails[k]).join(',') || 'none'}; ${ev.detail.E2 || ''}`);
    lines.push(`    week: ${ws.week.sessions.map((x) => `[${x.name}: ${x.exercises.map((e) => e.exerciseName).join(', ')}]`).join(' ')}`);
  }
  const elig = eligiblePrograms(a, sel);
  lines.push(`  eligible (goal+level+gear, +-1 day): ${elig.map((d) => d.programId).join(', ') || 'none'}`);
  return lines.join('\n');
}
console.log(workedExample());
console.log('');

// -------------------------------------------------------------------- report
const CRITERIA = ['E1', 'E2', 'E2s', 'E3', 'E4', 'G1', 'G2', 'G3', 'D1', 'D2', 'D3', 'D4', 'D5', 'L1', 'S1', 'C1', 'C2', 'F1', 'F2', 'HARD'];
const lines = [];
const out = (s = '') => lines.push(s);
const label = (r) =>
  `${r.a.equipName} | ${r.a.goal} | ${r.a.level} | ${r.a.days}d | caution=${r.a.caution[0]} | focus=${r.a.focus[0]} | ${r.a.gender} | ${r.a.age}`;

out(`Cases: ${results.length} (${results.filter((r) => r.a.base).length} base cells, ${EXTRA_PER_BASE} extra answers per cell). ${(Date.now() - t0) / 1000}s`);
out('');
out('Per-criterion failures of the TOP-1 (all | non-gym | ranker-fault = a better eligible programme existed | content-gap = none did):');
for (const key of CRITERIA) {
  const all = results.filter((r) => r.top.fails[key]).length;
  const home = results.filter((r) => r.a.card.equipment !== 'gym' && r.top.fails[key]).length;
  const fixable = results.filter((r) => r.top.fails[key] && r.eligibleCount > 0).length;
  out(`  ${key.padEnd(5)} ${String(all).padStart(6)} (${((all / results.length) * 100).toFixed(1)}%) | home ${String(home).padStart(6)} | ranker-fault ${String(fixable).padStart(6)} | content-gap ${String(all - fixable).padStart(6)}`);
}
const both = results.filter((r) => r.second && r.top.fails.HARD && r.second.fails.HARD).length;
out(`  BOTH2 ${String(both).padStart(6)}  (both shown cards fail a HARD criterion)`);
const noE3 = results.filter((r) => ['E1', 'E2', 'G1', 'D2', 'L1', 'S1', 'C1'].some((k) => r.top.fails[k])).length;
out(`  HARD without E3 ${noE3} (${((noE3 / results.length) * 100).toFixed(1)}%); gym-all cells HARD ${results.filter((r) => r.a.equipName === 'gym:all' && r.top.fails.HARD).length}/${results.filter((r) => r.a.equipName === 'gym:all').length}`);
out('');

{
  const swapped = results.filter((r) => r.wfSwapped);
  const broke = swapped.filter((r) => r.wfHard === false && r.top.fails.HARD);
  const fixed = swapped.filter((r) => r.wfHard === true && !r.top.fails.HARD);
  const dup = results.filter((r) => r.second && r.second.programId === r.top.programId).length;
  out(`Tailoring cell swap (scoring replaced the waterfall pick): ${swapped.length} cases (${((swapped.length / results.length) * 100).toFixed(1)}%)`);
  out(`  waterfall pick was clean, swapped-in pick fails HARD: ${broke.length}; waterfall pick failed, swap rescued it: ${fixed.length}`);
  out(`  featured == secondary shown card (duplicate): ${dup}`);
  const byPair = new Map();
  for (const r of broke) {
    const k = `${r.wfName} -> ${r.top.programName}`;
    byPair.set(k, (byPair.get(k) || 0) + 1);
  }
  out('  top clean->broken swaps: ' + [...byPair.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} x${v}`).join('; '));
  out('');
}

out('HARD failures by equipment set (cases | fail %):');
const byEquip = new Map();
for (const r of results) {
  const e = byEquip.get(r.a.equipName) || { n: 0, f: 0, E2: 0, G1: 0, E3: 0, L1: 0, D2: 0, E1: 0, C1: 0 };
  e.n += 1;
  for (const k of ['E1', 'E2', 'E3', 'G1', 'D2', 'L1', 'C1']) if (r.top.fails[k]) e[k] += 1;
  if (r.top.fails.HARD) e.f += 1;
  byEquip.set(r.a.equipName, e);
}
for (const [name, e] of byEquip) {
  out(`  ${name.padEnd(24)} n=${String(e.n).padStart(4)} HARD ${((e.f / e.n) * 100).toFixed(0).padStart(3)}%  E1 ${e.E1} E2 ${e.E2} E3 ${e.E3} G1 ${e.G1} D2 ${e.D2} L1 ${e.L1} C1 ${e.C1}`);
}
out('');

out('HARD failures by goal x level (n, fail%):');
for (const goal of GOALS) {
  const row = LEVELS.map((level) => {
    const subset = results.filter((r) => r.a.goal === goal && r.a.level === level);
    const f = subset.filter((r) => r.top.fails.HARD).length;
    return `${level} ${((f / subset.length) * 100).toFixed(0)}%`;
  });
  out(`  ${goal.padEnd(14)} ${row.join(' | ')}`);
}
out('');

out('Top-1 programme frequency among non-gym readers (programme: count):');
const freq = new Map();
for (const r of results.filter((x) => x.a.card.equipment !== 'gym')) freq.set(r.top.programName, (freq.get(r.top.programName) || 0) + 1);
out('  ' + [...freq.entries()].sort((x, y) => y[1] - x[1]).map(([n, c]) => `${n}: ${c}`).join('; '));
out('');

function patternSection(title, predicate, keyFn, detailKeys) {
  const hit = results.filter(predicate);
  out(`### ${title}: ${hit.length}`);
  const groups = new Map();
  for (const r of hit) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const sorted = [...groups.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 6);
  for (const [k, list] of sorted) {
    out(`  - ${k}: ${list.length}`);
    for (const r of list.slice(0, SHOW > 1 ? 2 : SHOW)) {
      out(`      e.g. ${label(r)}`);
      out(`           top1=${r.top.programName} (${r.top.def.daysPerWeek}d, ${r.top.def.familyId}) rule=${r.rule} scores=[${r.scores.join(', ')}]`);
      out(`           2nd=${r.second ? r.second.programName : '-'} | ${detailKeys.map((d) => r.top.detail[d]).filter(Boolean).join(' ; ')}`);
    }
  }
  out('');
}

out('==================== FAILURE PATTERNS ====================');
patternSection('E2 gear ignored (owns gear, plan uses none, eligible plan uses it)', (r) => r.top.fails.E2, (r) => `${r.a.equipName} -> ${r.top.programName}`, ['E2']);
patternSection('E2s gear under-used (best eligible uses more)', (r) => r.top.fails.E2s && !r.top.fails.E2, (r) => `${r.a.equipName} -> ${r.top.programName}`, ['E2']);
patternSection('E1 plan needs gear the reader lacks', (r) => r.top.fails.E1, (r) => `${r.a.equipName} -> ${r.top.programName}`, ['E1']);
patternSection('E3 final week has a lift the gear cannot do', (r) => r.top.fails.E3, (r) => `${r.a.caution[0]} ${r.a.equipName.split(':')[0]}`, ['E3']);
patternSection('G1 goal not supported by the programme', (r) => r.top.fails.G1, (r) => `${r.a.goal} -> ${r.top.programName} (${r.top.detail.G1})`, ['E2']);
patternSection('G2 week split disagrees with goal', (r) => r.top.fails.G2, (r) => `${r.a.goal} -> ${r.top.programName}`, ['split']);
patternSection('D2 composed days differ from answer', (r) => r.top.fails.D2, (r) => `${r.a.days}d answered -> ${r.top.programName}`, ['D']);
patternSection('L1 level unsupported', (r) => r.top.fails.L1, (r) => `${r.a.level} -> ${r.top.programName} (${r.top.detail.L1})`, ['D']);
patternSection('S1 gender-targeted shown to wrong gender', (r) => r.top.fails.S1, (r) => `${r.a.gender} -> ${r.top.programName}`, ['D']);
patternSection('C1 avoid area still loaded', (r) => r.top.fails.C1, (r) => `${r.a.caution[0]} -> ${r.top.programName}`, ['C1']);
patternSection('C2 avoid flags gutted the plan (>25% removed)', (r) => r.top.fails.C2, (r) => `${r.a.caution[0]} -> ${r.top.programName}`, ['C2']);
patternSection('F2 focus ignored although an eligible programme matches', (r) => r.top.fails.F2, (r) => `${r.a.focus[0]} -> ${r.top.programName} rule=${r.rule}`, ['F1']);

out('==================== CONTENT GAPS (no eligible programme) ====================');
// A cell is a content gap when nothing in the catalog is goal+level+gender+gear
// fit within +-1 day. Also reported with any day count (days-only gap).
const gapCells = new Map();
for (const r of results.filter((x) => x.a.base)) {
  if (r.eligibleCount === 0) {
    const key = `${r.a.equipName} | ${r.a.goal} | ${r.a.level}`;
    if (!gapCells.has(key)) gapCells.set(key, { days: [], anyDays: r.eligibleAnyDaysCount, top: new Set() });
    gapCells.get(key).days.push(r.a.days);
    gapCells.get(key).top.add(r.top.programName);
  }
}
const gapList = [...gapCells.entries()];
out(`Equipment x goal x level cells with at least one day count that has NO eligible programme (+-1 day): ${gapList.length}`);
const noAnyDays = gapList.filter(([, v]) => v.anyDays === 0);
out(`  of which no programme at ANY day count fits: ${noAnyDays.length}`);
for (const [key, v] of noAnyDays.slice(0, 40)) out(`    ${key}  (days ${v.days.join(',')}) -> shown: ${[...v.top].join(' / ')}`);
out(`  gaps that are only a day-count gap (a programme fits at some other day count): ${gapList.length - noAnyDays.length}`);
const gapByEquip = new Map();
for (const [key, v] of gapList) {
  const eq = key.split(' | ')[0];
  gapByEquip.set(eq, (gapByEquip.get(eq) || 0) + v.days.length);
}
out('  gap (day,goal,level) cells per equipment set: ' + [...gapByEquip.entries()].map(([k, v]) => `${k}=${v}`).join('; '));

out('');
out('==================== EXACT-DAY COVERAGE (eligible programmes at exactly N days; 0 = hole) ====================');
out('Eligible = supports the goal, lists the level, fits the gear, gender-neutral or matching. Columns are 2d 3d 4d 5d 6d.');
for (const equipName of ['home:none', 'home:D', 'home:D+B+R (default)', 'home:K', 'home:R', 'home:P', 'home:BB+RK+B', 'home:D+B+RK+BB', 'gym:all']) {
  const card = EQUIPMENT_SETS.find(([n]) => n === equipName)[1];
  out(`  ${equipName}`);
  for (const goal of GOALS) {
    const cells = LEVELS.map((level) => {
      const counts = DAYS.map((days) => {
        const a = { goal, level, days, card, gender: 'unspecified', age: '19_25', caution: CAUTIONS[0], focus: FOCUSES[0] };
        return eligiblePrograms(a, buildSelection(a), 0).length;
      });
      return `${level.slice(0, 3)} ${counts.join(' ')}`;
    });
    out(`    ${goal.padEnd(15)} ${cells.join('   |   ')}`);
  }
}

console.log(lines.join('\n'));

if (JSON_OUT) {
  require('node:fs').writeFileSync(
    JSON_OUT,
    JSON.stringify(
      results.map((r) => ({
        case: label(r),
        rule: r.rule,
        top: r.top.programName,
        second: r.second ? r.second.programName : null,
        fails: Object.keys(r.top.fails).filter((k) => r.top.fails[k]),
        detail: r.top.detail,
        scores: r.scores,
        eligible: r.eligibleCount,
      })),
      null,
      1,
    ),
  );
}
