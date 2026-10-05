// Debug one answer set: node tests/hunt/debugCase.cjs '{"items":["Dumbbells"],"goal":"general_fitness","level":"advanced","days":3}'
const path = require('node:path');
const dist = path.join(__dirname, '..', '..', '.test-dist');
const { resolveFirstRunRecommendationWithTailoring } = require(path.join(dist, 'lib', 'firstRunSetup.js'));
const { selectWaterfallDecision } = require(path.join(dist, 'lib', 'recommendationWaterfall.js'));
const { buildRecommendationInput } = require(path.join(dist, 'lib', 'recommendationInput.js'));

const o = JSON.parse(process.argv[2] || '{}');
const items = o.items || [];
const heavy = items.some((i) => ['Barbell & plates', 'Squat rack'].includes(i));
const gym = o.gym === true;
const sel = {
  gender: o.gender || 'unspecified', ageRange: o.age || '19_25', goal: o.goal || 'muscle', goals: [o.goal || 'muscle'],
  level: o.level || 'beginner', daysPerWeek: o.days || 3,
  equipment: gym ? 'gym' : items.length === 0 ? 'home' : heavy ? 'home' : 'minimal',
  trainingEnvironment: gym ? 'full_gym' : items.length === 0 ? 'bodyweight_only' : heavy ? 'home_gym' : 'minimal_equipment',
  equipmentItems: items, secondaryOutcomes: [], focusAreas: o.focus || [], cautionFlags: o.caution || [],
  guidanceMode: 'guided_editable', scheduleMode: 'app_managed', availableDays: [], unitPreference: 'kg',
};
const tailoring = {
  setupEquipment: sel.equipment, setupFreeWeightsPreference: 'neutral', setupBodyweightPreference: 'neutral',
  setupMachinesPreference: 'neutral', setupShoulderFriendlySwaps: 'neutral', setupElbowFriendlySwaps: 'neutral', setupKneeFriendlySwaps: 'neutral',
};
const decision = selectWaterfallDecision(buildRecommendationInput(sel));
console.log('waterfall:', decision.rule, decision.primaryProgramId, '| alt', decision.alternativeProgramId);
const rec = resolveFirstRunRecommendationWithTailoring(sel, tailoring, 'en');
console.log('final featured:', rec.featuredProgramId, '| secondary', rec.secondaryProgramId, '| alts', rec.alternativeProgramIds.join(','));
console.log('scores:', rec.scoredCandidates.slice(0, 6).map((c) => `${c.programId}=${c.score}`).join(', '));
