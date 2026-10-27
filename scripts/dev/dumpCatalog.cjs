// Dumps the recommendation catalog: days, tier, family, goals, levels, gear needed,
// and the template's own "where your week goes" split.
const path = require('node:path');
const dist = path.join(__dirname, '..', '..', '.test-dist');
const cat = require(path.join(dist, 'lib', 'recommendationCatalog.js'));
const wc = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));
const pe = require(path.join(dist, 'lib', 'programEquipment.js'));
const fs = require(path.join(dist, 'lib', 'programFocusSplit.js'));

console.log(cat.RECOMMENDATION_PROGRAMS.length, 'programmes');
for (const d of cat.RECOMMENDATION_PROGRAMS) {
  const t = wc.getWorkoutTemplateById(d.programId);
  const names = t.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseName));
  const split = fs.buildProgramFocusSplit(t.sessions).map((s) => `${s.quality[0]}${s.pct}`).join('/');
  console.log(
    [
      d.programId,
      t.name,
      `${d.daysPerWeek}d`,
      d.equipmentTier,
      d.familyId,
      `goals=${d.supportedGoals.join('/')}`,
      `backup=${d.backupGoals.join('/')}`,
      `lv=${d.supportedLevels.join('/')}`,
      d.targetGender,
      `style=${d.styleTags.join('/')}`,
      `split=${split}`,
      `needs=${pe.resolveProgramEquipment(names).join(',')}`,
    ].join(' ; '),
  );
}
