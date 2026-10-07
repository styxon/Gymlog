const assert = require('node:assert/strict');

const {
  briefAsksForSpecialty,
  composeProgrammePreview,
  parseProgrammeBrief,
  resolveLiveProposal,
} = require('../../.test-dist/lib/programmeBrief.js');
const { matchProgrammeToBrief, shouldOfferCatalogInstead } = require('../../.test-dist/lib/briefProgrammeMatch.js');
const { buildProgramIntakeBrief } = require('../../.test-dist/lib/programIntake.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { programFitsEquipment } = require('../../.test-dist/lib/programEquipmentFit.js');
const { displayEquipmentValue } = require('../../.test-dist/lib/libraryLabel.js');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
const { createSeedDatabase, createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');

const preferences = createSeedDatabase().preferences;
const library = createSeedExerciseLibrary();

/** Every exercise name in a composed week. */
function weekNames(proposal) {
  return proposal.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
}

/** Every exercise name in a ready programme. */
function programmeNames(programId) {
  return getWorkoutTemplateById(programId).sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
}

/** What "no leg day" keeps out (owner decision, 2026-10-07). */
const LEG_WORK = ['squat', 'deadlift', 'lunge', 'leg press', 'leg curl', 'leg extension', 'calf'];

/**
 * The bug hunt of 2026-10-07 (findings 16–22): the brief parser read a
 * refusal outside its three-word window as a request, a pain word anywhere in
 * a comma-joined sentence as pain for all of it, negated goals, places and
 * body parts as asked for, "5x5" as five days — and the catalog shortcut
 * opened a ready programme holding the very lift the brief kept out.
 *
 * One row per brief. `lifts` is the exact ask; `refused` are lifts that must
 * be on the avoid list and `kept` terms that must not; `focus` / `cautions`
 * exact; `goal`, `equipment`, `days`, `requested` exact when given.
 */
const TABLE = [
  // Refusals, the long way round (#18).
  { brief: "I don't want to do deadlifts", lifts: [], refused: ['deadlift'] },
  { brief: 'I do not want deadlifts in my programme', lifts: [], refused: ['deadlift'] },
  { brief: 'En todellakaan halua tehdä maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'En halua maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'En tee maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'En pysty tekemään kyykkyä', lifts: [], refused: ['back squat'] },
  { brief: 'Vältän maastavetoa', lifts: [], refused: ['deadlift'] },
  { brief: 'Jätä pois maastaveto', lifts: [], refused: ['deadlift'] },
  { brief: 'Poista maastaveto ohjelmasta', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastavetoa ei saa olla', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastaveto ei sovi minulle', lifts: [], refused: ['deadlift'] },
  { brief: 'Penkkiä ei', lifts: [], refused: ['bench press'] },
  { brief: 'Ilman leuanvetoja', lifts: [], refused: ['pull-up'] },
  { brief: 'Älä laita pystypunnerrusta', lifts: [], refused: ['overhead press'] },
  { brief: 'Please leave out deadlifts', lifts: [], refused: ['deadlift'] },
  { brief: 'Leave the deadlifts out', lifts: [], refused: ['deadlift'] },
  { brief: 'bench press is not for me', lifts: [], refused: ['bench press'] },
  { brief: "I can't squat", lifts: [], refused: ['back squat'] },
  { brief: 'I cannot do pull-ups', lifts: [], refused: ['pull-up'] },
  { brief: 'Never any deadlifts please', lifts: [], refused: ['deadlift'] },
  { brief: 'Avoid overhead press', lifts: [], refused: ['overhead press'] },
  { brief: 'I hate dips', lifts: [], refused: ['dips'] },
  { brief: 'Without deadlifts', lifts: [], refused: ['deadlift'] },
  { brief: 'Kyykky ei onnistu polven takia', lifts: [], refused: ['back squat'], focus: [] },
  // A refusal reaches no further than its clause: "so", an ask verb and a cap
  // turn it (review of the #18 fix).
  { brief: "I don't have a lot of time so focus on squats and bench", lifts: ['Back Squat', 'Bench Press'] },
  { brief: "I'm not experienced so I want to learn squats", lifts: ['Back Squat'] },
  { brief: 'No more than 45 minutes with squats and deadlifts', lifts: ['Back Squat', 'Deadlift'] },
  { brief: "I don't have much time I want squats", lifts: ['Back Squat'] },
  { brief: "I don't have much time so squats and deadlifts only", lifts: ['Back Squat', 'Deadlift'] },
  { brief: 'Ei maastavetoa koska kyykky riittää', lifts: ['Back Squat'], refused: ['deadlift'] },
  { brief: 'No deadlifts because squats are enough', lifts: ['Back Squat'], refused: ['deadlift'] },
  { brief: "I don't really want to learn deadlifts", lifts: [], refused: ['deadlift'] },
  { brief: "I'm not so keen on deadlifts", lifts: [], refused: ['deadlift'] },
  // "must not be left out" is an ask, not a refusal.
  { brief: 'Maastaveto ei saa jäädä pois', lifts: ['Deadlift'] },
  { brief: 'Kyykky ei saa puuttua ohjelmasta', lifts: ['Back Squat'] },
  { brief: 'Haluan että kyykky ei jää pois', lifts: ['Back Squat'] },
  { brief: 'Penkki ei voi puuttua', lifts: ['Bench Press'] },
  { brief: 'Maastaveto jää pois', lifts: [], refused: ['deadlift'] },
  { brief: 'Kyykkyä en jättäisi pois', lifts: ['Back Squat'] },
  { brief: 'Kyykkyä älä jätä pois', lifts: ['Back Squat'] },
  // …and what is NOT a refusal (#339 fix 1 stays fixed).
  { brief: 'En ole tehnyt maastavetoa, haluan oppia', lifts: ['Deadlift'] },
  { brief: 'Never done deadlifts, want to learn', lifts: ['Deadlift'] },
  { brief: "I've never tried squats and I want to learn them", lifts: ['Back Squat'] },
  { brief: 'No problem with deadlifts', lifts: ['Deadlift'] },
  { brief: 'Ei haittaa vaikka maastavetoa on paljon', lifts: ['Deadlift'] },
  { brief: 'Haluan maastavetoa ja kyykkyä', lifts: ['Back Squat', 'Deadlift'] },
  { brief: 'I want deadlifts, not bench', lifts: ['Deadlift'], refused: ['bench press'] },
  { brief: 'En halua koneita ja haluan maastavetoa', lifts: ['Deadlift'] },
  // Pain, clause by clause, and negated pain (#21).
  { brief: 'Sore knee, keep the bench press', lifts: ['Bench Press'], cautions: ['knee'] },
  { brief: 'Polvi kipeä, penkki mukaan', lifts: ['Bench Press'], cautions: ['knee'] },
  { brief: 'Olkapää kipeä, ei maastavetoa', lifts: [], cautions: ['shoulder'], refused: ['deadlift', 'overhead press'] },
  { brief: 'Polvi kipeä, ei kyykkyä', lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: 'No injuries, I want deadlifts', lifts: ['Deadlift'], cautions: [] },
  { brief: 'No injuries, knees are fine', cautions: [], focus: [] },
  { brief: 'No shoulder pain', cautions: [], focus: [] },
  { brief: 'Ei polvikipuja', cautions: [], focus: [] },
  { brief: 'Polvi ei ole kipeä', cautions: [] },
  { brief: 'Polvi, olkapää ja selkä kipeitä', cautions: ['knee', 'back', 'shoulder'], focus: [] },
  { brief: 'Olkapää kipeä, varsinkin penkissä', lifts: [], cautions: ['shoulder'] },
  { brief: 'Knee hurts.', cautions: ['knee'] },
  // A refused lift and then the reason: the "can't" is the lift's, the pain
  // stands (review of the #21 fix).
  { brief: "I can't squat because my knee hurts", lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: 'Kyykky ei onnistu koska polvi on kipeä', lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: 'En pysty kyykkäämään koska polvi on kipeä', cautions: ['knee'] },
  { brief: "I don't squat because my knee hurts", lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: 'I avoid running since my knee is sore', cautions: ['knee'] },
  // …and with no "because" between, the negation is still the lift's.
  { brief: 'En pysty kyykkäämään polvi kipeä', cautions: ['knee'] },
  { brief: "I can't squat my knee hurts", lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: 'Ei kyykkyä polvi kipeä', lifts: [], cautions: ['knee'], refused: ['back squat'] },
  { brief: "I don't have any knee pain", cautions: [] },
  // Goals, places and body parts named only to rule them out (#22).
  { brief: 'I want to build muscle, not lose weight', goal: 'muscle' },
  { brief: "Strength, I'm not trying to cut", goal: 'strength' },
  { brief: 'Voimaohjelma, ei rasvanpudotusta', goal: 'strength' },
  { brief: 'Haluan voimaa, en pudottaa painoa', goal: 'strength' },
  { brief: 'Haluan pudottaa painoa', goal: 'fat_loss' },
  { brief: 'No gym access', equipment: null },
  { brief: '3 days, no gym', equipment: null, days: 3 },
  { brief: "I don't have a gym membership, only dumbbells", equipment: 'minimal' },
  { brief: 'Salilla', equipment: 'full_gym' },
  { brief: 'Kotisali, käsipainot ja tanko', equipment: 'home_gym' },
  { brief: 'Where: at home, dumbbells.', equipment: 'minimal' },
  { brief: 'Paikka: kotona, käsipainot.', equipment: 'minimal' },
  { brief: 'no leg day', focus: [] },
  { brief: 'skip legs', focus: [] },
  { brief: 'Ilman jalkatreeniä', focus: [] },
  { brief: 'Ei jalkapäivää', focus: [] },
  { brief: 'Älä keskity rintaan', focus: [] },
  { brief: 'Rinta painopisteenä', focus: ['chest'] },
  { brief: 'Legs and glutes, please', focus: ['legs', 'glutes'] },
  // Sets by reps are not days (#17).
  { brief: 'Haluan 5x5 voimaohjelman, 3 päivää viikossa', days: 3, goal: 'strength' },
  { brief: 'I want to try StrongLifts 5x5, three days a week', days: 3 },
  { brief: 'Voimaohjelma 5x5, 3 päivää viikossa', days: 3 },
  { brief: 'Penkki 3x10, 4 päivää viikossa', days: 4, lifts: ['Bench Press'] },
  { brief: '3x viikossa', days: 3 },
  { brief: '4x a week, 45 min', days: 4 },
  { brief: '10 päivää kuukaudessa', days: null },
  { brief: '12 days of rest then 3 days a week', days: 3 },
  // A count with a day unit outranks a bare "2 kertaa" before it.
  { brief: 'Penkkiä 2 kertaa, treeniä 4 päivää viikossa', days: 4 },

  // Re-hunt of 2026-10-07. A refusal about fitness, experience or injuries
  // reaches no further than the polite ask after "ja" / "and" (R2 #6).
  { brief: 'En ole kovin hyvässä kunnossa ja haluaisin kyykkyä ja penkkiä', lifts: ['Back Squat', 'Bench Press'], kept: ['back squat', 'bench press'] },
  { brief: "I'm not very fit and would like squats and bench", lifts: ['Back Squat', 'Bench Press'] },
  { brief: "I'm not in great shape and would love to do deadlifts", lifts: ['Deadlift'] },
  { brief: "I don't have much experience and I'd like to do squats", lifts: ['Back Squat'] },
  { brief: 'En ole treenannut pitkään aikaan ja haluaisin tehdä maastavetoa', lifts: ['Deadlift'] },
  { brief: 'Ei vammoja ja haluaisin maastavetoa', lifts: ['Deadlift'], kept: ['deadlift'] },
  { brief: 'No injuries and would like deadlifts', lifts: ['Deadlift'], kept: ['deadlift'] },
  { brief: "I have no pain and I'd like to deadlift", lifts: ['Deadlift'] },
  { brief: 'No deadlifts and lots of squats', lifts: ['Back Squat'], refused: ['deadlift'] },
  { brief: 'Ei maastavetoa ja paljon kyykkyä', lifts: ['Back Squat'], refused: ['deadlift'] },
  { brief: 'No bench and more squats', lifts: ['Back Squat'], refused: ['bench press'] },
  { brief: "I don't have a gym and would like to train at home with dumbbells", equipment: 'minimal' },
  { brief: 'En käy salilla ja treenaan kotona käsipainoilla', equipment: 'minimal' },
  { brief: "Not much time and I'd like to lose weight", goal: 'fat_loss' },
  { brief: 'En ehdi paljon ja haluaisin laihtua', goal: 'fat_loss' },
  { brief: 'En ole koskaan treenannut ja haluaisin lihasta', goal: 'muscle' },
  { brief: 'En ole kovin notkea ja haluaisin keskittyä jalkoihin', focus: ['legs'] },
  { brief: "I'd rather not do deadlifts", lifts: [], refused: ['deadlift'] },
  { brief: "I'd prefer no deadlifts", lifts: [], refused: ['deadlift'] },
  { brief: 'En haluaisi maastavetoa', lifts: [], refused: ['deadlift'] },
  // Two negations that govern the same lift insist on it (R2 #8).
  { brief: "Don't skip deadlifts", lifts: ['Deadlift'], kept: ['deadlift'] },
  { brief: 'Älä jätä maastavetoa pois', lifts: ['Deadlift'], kept: ['deadlift'] },
  { brief: "Don't leave out squats", lifts: ['Back Squat'] },
  { brief: 'Do not remove the bench press', lifts: ['Bench Press'] },
  { brief: 'I never skip squats', lifts: ['Back Squat'] },
  { brief: "No way I'm skipping deadlifts", lifts: ['Deadlift'] },
  { brief: "I can't live without squats", lifts: ['Back Squat'] },
  { brief: "Can't do without bench press", lifts: ['Bench Press'] },
  { brief: 'Never without squats', lifts: ['Back Squat'] },
  { brief: 'En voi elää ilman kyykkyä', lifts: ['Back Squat'] },
  { brief: 'Ilman kyykkyä ei ole ohjelmaa', lifts: ['Back Squat'] },
  { brief: 'Ei ohjelmaa ilman maastavetoa', lifts: ['Deadlift'] },
  { brief: 'There is no programme without the bench press', lifts: ['Bench Press'] },
  { brief: 'Kyykkyä ei saa unohtaa', lifts: ['Back Squat'] },
  { brief: "Don't forget the deadlifts", lifts: ['Deadlift'] },
  { brief: 'Deadlifts should not be skipped', lifts: ['Deadlift'] },
  // …and one negation alone is still a refusal, two coordinated ones both.
  { brief: 'Ei kyykkyä eikä maastavetoa', lifts: [], refused: ['back squat', 'deadlift'] },
  { brief: 'No deadlifts and skip squats', lifts: [], refused: ['back squat', 'deadlift'] },
  // Refusals after or around the lift, and swaps (R2 #9).
  { brief: 'Deadlifts should not be in the programme', lifts: [], refused: ['deadlift'] },
  { brief: 'Deadlifts should be excluded', lifts: [], refused: ['deadlift'] },
  { brief: "Deadlifts aren't my thing", lifts: [], refused: ['deadlift'] },
  { brief: 'Maastaveto ei kuulu ohjelmaan', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastaveto ei ole mun juttu', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastavedosta en välitä', lifts: [], refused: ['deadlift'] },
  { brief: 'Squats yes, deadlifts no', lifts: ['Back Squat'], refused: ['deadlift'] },
  { brief: 'Deadlifts no', lifts: [], refused: ['deadlift'] },
  { brief: 'deadlifts? no thanks', lifts: [], refused: ['deadlift'] },
  { brief: 'Maastavetoa? Ei kiitos', lifts: [], refused: ['deadlift'] },
  { brief: 'Drop the deadlifts', lifts: [], refused: ['deadlift'] },
  { brief: 'Ditch the bench press', lifts: [], refused: ['bench press'] },
  { brief: 'Cut deadlifts', lifts: [], refused: ['deadlift'], goal: null },
  { brief: 'Unohda maastaveto', lifts: [], refused: ['deadlift'] },
  { brief: 'Skippaa maastaveto', lifts: [], refused: ['deadlift'] },
  { brief: "I wouldn't do deadlifts", lifts: [], refused: ['deadlift'] },
  { brief: 'Instead of squats give me leg press', lifts: ['Leg Press'], refused: ['back squat'] },
  { brief: 'Leg press instead of squats', lifts: ['Leg Press'], refused: ['back squat'] },
  { brief: 'Rather leg press than squats', lifts: ['Leg Press'], refused: ['back squat'] },
  { brief: 'Mieluummin jalkaprässiä kuin kyykkyä', lifts: ['Leg Press'], refused: ['back squat'] },
  { brief: 'Replace deadlifts with hip thrusts', lifts: ['Hip Thrust'], refused: ['deadlift'] },
  { brief: 'Swap bench for push-ups', lifts: ['Pushups'], refused: ['bench press'] },
  { brief: 'Jalkaprässi kyykyn sijaan', lifts: ['Leg Press'], refused: ['back squat'] },
  { brief: 'Kyykyn tilalle jalkaprässi', lifts: ['Leg Press'], refused: ['back squat'] },
  { brief: 'Penkin sijasta punnerruksia', lifts: ['Pushups'], refused: ['bench press'] },
  // …and what still asks.
  { brief: "I wouldn't mind some deadlifts", lifts: ['Deadlift'] },
  { brief: "I can't wait to start deadlifting", lifts: ['Deadlift'] },
  { brief: 'Squats no matter what', lifts: ['Back Squat'] },
  { brief: 'Not just squats, also deadlifts', lifts: ['Back Squat', 'Deadlift'] },
  { brief: 'Not only bench but also overhead press', lifts: ['Bench Press', 'Overhead Press'] },
  { brief: 'Ei pelkkää kyykkyä vaan myös maastavetoa', lifts: ['Back Squat', 'Deadlift'] },
  { brief: "I don't know how to deadlift, teach me", lifts: ['Deadlift'] },
  { brief: 'Weight loss is not the goal, strength is', goal: 'strength' },
  // Never done is not refused (owner decision, 2026-10-07).
  { brief: "I've never squatted before", lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'En ole koskaan tehnyt kyykkyä', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'I have never done deadlifts', lifts: ['Deadlift'], kept: ['deadlift'] },
  // An injury in everyday words is a caution, never a focus (R2 #10).
  { brief: 'Bad knees', cautions: ['knee'], focus: [] },
  { brief: 'Huono polvi', cautions: ['knee'], focus: [] },
  { brief: 'Polvivaiva', cautions: ['knee'], focus: [] },
  { brief: 'Polvessa vaivaa', cautions: ['knee'], focus: [] },
  { brief: 'Knee problems', cautions: ['knee'], focus: [] },
  { brief: 'Ongelmia polven kanssa', cautions: ['knee'], focus: [] },
  { brief: 'Had knee surgery last year', cautions: ['knee'], focus: [] },
  { brief: 'Polvi leikattu viime vuonna', cautions: ['knee'], focus: [] },
  { brief: 'Knee aches', cautions: ['knee'], focus: [] },
  { brief: 'Polvi oireilee', cautions: ['knee'], focus: [] },
  { brief: 'I have a bad back', cautions: ['back'], focus: [] },
  { brief: 'Selkä vaivaa', cautions: ['back'], focus: [] },
  { brief: 'Selkävaivoja', cautions: ['back'], focus: [] },
  { brief: 'Olkapää jumissa', cautions: ['shoulder'], focus: [] },
  { brief: 'Penkki on jumissa, haluan penkkiä', lifts: ['Bench Press'], cautions: [] },
  { brief: 'Tennis elbow', cautions: ['elbow'], focus: [] },
  { brief: 'No squats because of my knee', lifts: [], cautions: ['knee'], refused: ['back squat'], focus: [] },
  { brief: 'Polven takia ei kyykkyä', lifts: [], cautions: ['knee'], refused: ['back squat'], focus: [] },
  { brief: 'Selän takia ei maastavetoa', lifts: [], cautions: ['back'], refused: ['deadlift'], focus: [] },
  // A lift named where it hurts is kept out, not asked or ignored.
  { brief: 'Kyykky sattuu polveen', lifts: [], cautions: ['knee'], refused: ['back squat'], focus: [] },
  { brief: 'Maastaveto sattuu selkään', lifts: [], cautions: ['back'], refused: ['deadlift'], focus: [] },
  { brief: 'Bench hurts my shoulder', lifts: [], cautions: ['shoulder'], refused: ['bench press'] },
  { brief: 'Polvi sattuu, penkki mukaan', lifts: ['Bench Press'], cautions: ['knee'] },
  // "kipu" inside "penkkipunnerrus" is no pain, "bad at" no injury.
  { brief: 'Haluan penkkipunnerrusta ja kyykkyä', lifts: ['Back Squat', 'Bench Press'], cautions: [] },
  { brief: 'Penkkipunnerrus ja rinta painopisteenä', lifts: ['Bench Press'], cautions: [], focus: ['chest'] },
  { brief: "I'm bad at squats, teach me", lifts: ['Back Squat'], cautions: [] },
  // Pain scoped past "ja" / "and" / "but" (R2 #11).
  { brief: 'Polvi kipeä ja haluan rintaa', cautions: ['knee'], focus: ['chest'], kept: ['bench press'] },
  { brief: 'Knee hurts and I want chest focus', cautions: ['knee'], focus: ['chest'], kept: ['bench press'] },
  { brief: 'Polvi kipeä ja rinta painopisteenä', cautions: ['knee'], focus: ['chest'] },
  { brief: 'No knee pain but my shoulder hurts', cautions: ['shoulder'] },
  { brief: 'Ei kipuja polvessa mutta olkapää kipeä', cautions: ['shoulder'] },
  { brief: "Shoulder doesn't hurt anymore but the knee does", cautions: ['knee'], focus: [] },
  { brief: 'Polvi ei ole kipeä mutta selkä on', cautions: ['back'], focus: [] },
  { brief: 'Knee pain is gone, shoulder still hurts', cautions: ['shoulder'] },
  { brief: 'Polvi ei ole enää kipeä, kyykkyä saa tehdä', cautions: [], focus: [], lifts: ['Back Squat'] },
  { brief: 'Selkä kipeä ja penkki mukaan', lifts: ['Bench Press'], cautions: ['back'] },
  { brief: 'Olkapää ja polvi kipeät', cautions: ['knee', 'shoulder'], focus: [] },
  { brief: 'Olkapää kipeä ja polvi kipeä', cautions: ['knee', 'shoulder'], focus: [] },
  { brief: 'Kyykky sattuu polveen ja selkään', cautions: ['back', 'knee'], focus: [] },
  { brief: 'Selkä kunnossa ja polvi kipeä', cautions: ['knee'], focus: [] },
  { brief: 'Knee and shoulder hurt', cautions: ['knee', 'shoulder'], focus: [] },
  { brief: 'My shoulder hurts in bench and overhead press', lifts: [], cautions: ['shoulder'], refused: ['bench press', 'overhead press'] },
  { brief: 'Haluan kyykkyä vaikka polvi on vähän kipeä', lifts: ['Back Squat'], cautions: ['knee'] },
  { brief: "My shoulder isn't 100% and hurts in bench", lifts: [], cautions: ['shoulder'], refused: ['bench press'] },
  // Finnish cases in both consonant grades (R2 #12).
  { brief: 'Haluan kyykyt ja penkin mukaan', lifts: ['Back Squat', 'Bench Press'] },
  { brief: 'Kyykyt ja maastavedot pakollisia', lifts: ['Back Squat', 'Deadlift'] },
  { brief: 'En pidä kyykystä', lifts: [], refused: ['back squat'] },
  { brief: 'Haluan raskaan kyykyn', lifts: ['Back Squat'] },
  { brief: 'Aloittelija en ole, haluan raskaan kyykyn', lifts: ['Back Squat'] },
  { brief: 'En ole koskaan käynyt salilla, haluaisin oppia kyykyn', lifts: ['Back Squat'] },
  { brief: 'Kulmasoudut mukaan', lifts: ['Barbell Row'] },
  { brief: 'Tankosoudun haluan pitää', lifts: ['Barbell Row'] },
  { brief: 'Dipit mukaan', lifts: ['Dips - Triceps Version'] },
  { brief: 'Leuanvedot ja penkit', lifts: ['Bench Press', 'Pullups'] },
  { brief: 'Penkissä painot nousee, haluan penkkiä', lifts: ['Bench Press'] },
  { brief: 'Etukyykyt mukaan', lifts: [] },
  { brief: 'Haluan isommat hauikset', focus: ['arms'] },
  { brief: 'Haluan isommat hauikset ja rinnan', focus: ['chest', 'arms'] },
  { brief: 'Pakaroita ja reiden takaosaa', focus: ['legs', 'glutes'] },
  { brief: 'Selän takia', cautions: ['back'], focus: [] },
  // Goals and days, read as words, not inside other words (R2 #13).
  { brief: 'Treenaan kuntosalilla 3 kertaa viikossa', goal: null, equipment: 'full_gym', days: 3 },
  { brief: 'Yleiskunto, ohjelmassa saa olla juoksua', goal: 'fitness' },
  { brief: 'Haluan että ohjelmassa on kyykky', goal: null, lifts: ['Back Squat'] },
  { brief: '3 päivää, power clean mukaan', goal: null, days: 3 },
  { brief: 'I get fatigue easily, 3 days', goal: null, days: 3 },
  { brief: "Fat loss isn't my goal", goal: null },
  { brief: 'Laihdutus ei ole tavoite, voima on', goal: 'strength' },
  { brief: 'Lihasmassaa, 4 päivää', goal: 'muscle', days: 4 },
  { brief: 'I want to cut', goal: 'fat_loss' },
  { brief: 'Get lean', goal: 'fat_loss' },
  { brief: '3 times a week', days: 3 },
  { brief: '3 times per week', days: 3 },
  { brief: '5 times a week, chest focus', days: 4, requested: 5, focus: ['chest'] },
  { brief: '3 kertaa viikossa', days: 3 },
  { brief: 'Kolmesti viikossa', days: 3 },
  // No leg day keeps the leg work out (owner decision, 2026-10-07).
  { brief: 'no leg day', focus: [], refused: LEG_WORK },
  { brief: 'Ei jalkapäivää', focus: [], refused: LEG_WORK },
  { brief: 'skip legs', focus: [], refused: LEG_WORK },
  { brief: 'jalat pois', focus: [], refused: LEG_WORK },
  { brief: 'Ilman jalkatreeniä', focus: [], refused: LEG_WORK },
  { brief: 'No leg day, but I want deadlifts', lifts: ['Deadlift'], refused: ['squat', 'lunge', 'leg press'], kept: ['deadlift'] },
  { brief: 'Never skip leg day', focus: ['legs'], kept: LEG_WORK },
  { brief: 'No leg press', refused: ['leg press'], kept: ['squat', 'deadlift', 'lunge'] },
  { brief: 'Legs and glutes, please', kept: LEG_WORK },

  // Review of the re-hunt fix (2026-10-08). An English pain word starts a
  // word, and "vaivaton" is no trouble.
  { brief: 'I want coaching on squats and bench', lifts: ['Back Squat', 'Bench Press'], cautions: [], kept: ['back squat', 'bench press'] },
  { brief: 'My coaches want more squats', lifts: ['Back Squat'], cautions: [], kept: ['back squat'] },
  { brief: 'Teaching myself to squat', lifts: ['Back Squat'], cautions: [] },
  { brief: 'Attending a gym, extending my bench', lifts: ['Bench Press'], cautions: [] },
  { brief: 'Haluan vaivattoman ohjelman jossa kyykkyä', lifts: ['Back Squat'], cautions: [] },
  { brief: 'Haluan vaivattoman ohjelman jossa kyykkyä ja rintaa', lifts: ['Back Squat'], cautions: [], focus: ['chest'], kept: ['bench press'] },
  { brief: 'Polven vaivat', cautions: ['knee'], focus: [] },
  { brief: 'Knee tendinitis', cautions: ['knee'], focus: [] },
  // The leg day is refused only from within its own "ja" / "and"; never
  // done and never missed refuse nothing.
  { brief: 'Ei juoksua ja jalat painopisteenä', focus: ['legs'], kept: LEG_WORK },
  { brief: 'No knee pain and legs focus', focus: ['legs'], cautions: [], kept: LEG_WORK },
  { brief: 'Ilman koneita ja jalkoja paljon', kept: LEG_WORK },
  { brief: 'Kotona ei ole laitteita ja jalkoja haluan treenata', kept: LEG_WORK },
  { brief: 'No running and legs', kept: LEG_WORK },
  { brief: 'I never miss leg day', kept: LEG_WORK },
  { brief: "I've never trained legs", kept: LEG_WORK },
  { brief: 'En ole koskaan treenannut jalkoja', kept: LEG_WORK },
  { brief: 'I miss squats', lifts: ['Back Squat'] },
  // An ask anywhere in the "ja" stretch after an opening negation, or a
  // modifier before the lift, makes it a fresh statement.
  { brief: 'No cardio and heavy squats', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: "I don't have much time and squats are my favourite", lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'Ei aikaa paljon ja maastaveto tärkein', lifts: ['Deadlift'], kept: ['deadlift'] },
  { brief: 'En ole kovin hyvässä kunnossa ja kyykkyä haluaisin', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'No deadlifts and squats', lifts: [], refused: ['back squat', 'deadlift'] },
  { brief: "I don't want deadlifts and squats are not my favourite", lifts: [], refused: ['back squat', 'deadlift'] },
  // "jättää", "poistaa", "miss" negated insist, and the first two alone refuse.
  { brief: 'Kyykkyä ei saa jättää pois', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'Ei saa jättää kyykkyä pois', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'Never miss squats', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'Kyykkyä en halua poistaa', lifts: ['Back Squat'], kept: ['back squat'] },
  { brief: 'Haluan poistaa maastavedon', lifts: [], refused: ['deadlift'] },
  { brief: 'Consider removing deadlifts', lifts: [], refused: ['deadlift'] },
];

/** Whether the lift named by a canonical avoid term is kept out. */
function avoids(signals, term) {
  return signals.avoidTerms.includes(term);
}

module.exports = [
  {
    name: 'brief negation: every row of the FI+EN table reads as the reader meant it',
    run() {
      assert.ok(TABLE.length >= 40, `${TABLE.length} rows`);
      const failures = [];
      for (const row of TABLE) {
        const signals = parseProgrammeBrief(row.brief);
        const check = (label, actual, expected) => {
          try {
            assert.deepEqual(actual, expected);
          } catch {
            failures.push(`"${row.brief}" ${label}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
          }
        };
        if (row.lifts) check('lifts', [...signals.lifts].sort(), [...row.lifts].sort());
        for (const term of row.refused ?? []) check(`avoids ${term}`, avoids(signals, term), true);
        for (const term of row.kept ?? []) check(`keeps ${term}`, avoids(signals, term), false);
        if (row.focus) check('focus', signals.focusBodyParts, row.focus);
        if (row.cautions) check('cautions', [...signals.cautions].sort(), [...row.cautions].sort());
        if ('goal' in row) check('goal', signals.goal, row.goal);
        if ('equipment' in row) check('equipment', signals.equipment, row.equipment);
        if ('days' in row) check('days', signals.daysPerWeek, row.days);
        if ('requested' in row) check('requested', signals.requestedDaysPerWeek, row.requested);
      }
      assert.deepEqual(failures, []);
    },
  },
  {
    // #18: the refused lift reached the composed week as a main lift.
    name: 'brief negation: a refused lift stays out of the composed week, in either language',
    run() {
      for (const brief of [
        "3 days a week. I don't want to do deadlifts.",
        '3 päivää viikossa. En todellakaan halua tehdä maastavetoa.',
        '3 päivää viikossa. Jätä pois maastaveto.',
      ]) {
        const names = weekNames(composeProgrammePreview(brief, preferences, library));
        assert.ok(!names.includes('Barbell Deadlift'), `${brief}: ${names.join(', ')}`);
      }
      // A lift asked for in the clause after a pain is in the week (#21).
      const kept = composeProgrammePreview('3 days a week. Sore knee, keep the deadlift.', preferences, library);
      assert.deepEqual(kept.signals.lifts, ['Deadlift']);
      assert.ok(weekNames(kept).includes('Barbell Deadlift'), weekNames(kept).join(', '));
      // A refusal before the reason keeps the knee caution, and with it the
      // lunges out of the week (review of the #21 fix).
      for (const brief of [
        '3 päivää viikossa. Kyykky ei onnistu koska polvi on kipeä.',
        "3 days a week. I can't squat because my knee hurts.",
      ]) {
        const knee = composeProgrammePreview(brief, preferences, library);
        assert.deepEqual(knee.signals.cautions, ['knee'], brief);
        const lunges = weekNames(knee).filter((name) => /lunge/i.test(name));
        assert.deepEqual(lunges, [], `${brief}: ${weekNames(knee).join(', ')}`);
      }
      // "must not be left out" keeps the lift in the week.
      const insisted = weekNames(composeProgrammePreview('3 päivää viikossa. Maastaveto ei saa jäädä pois.', preferences, library));
      assert.ok(insisted.includes('Barbell Deadlift'), insisted.join(', '));
      // An ask after "so" is in the week, not on the avoid list.
      const focused = weekNames(
        composeProgrammePreview("3 days a week. I don't have a lot of time so focus on squats and bench.", preferences, library),
      );
      assert.ok(focused.includes('Barbell Full Squat'), focused.join(', '));
      assert.ok(focused.some((name) => /^Barbell Bench Press/.test(name)), focused.join(', '));
      // Negated pain does not strip the lift the reader asked for.
      const press = composeProgrammePreview('3 days a week. No shoulder pain, I want overhead press.', preferences, library);
      assert.deepEqual(press.signals.cautions, []);
      assert.deepEqual(press.unmetLifts, []);
    },
  },
  {
    // Re-hunt R2 #6, #8–#13 and the leg-day decision, as the composed week shows them.
    name: 'brief negation: the re-hunt briefs compose the week the reader asked for',
    run() {
      const week = (brief) => weekNames(composeProgrammePreview(`3 days a week. ${brief}`, preferences, library));
      const has = (names, pattern) => names.some((name) => pattern.test(name));
      // #6: the polite ask after an opening negation is in the week.
      for (const brief of ['Ei vammoja ja haluaisin maastavetoa.', 'No injuries and would like deadlifts.']) {
        const names = week(brief);
        assert.ok(has(names, /deadlift/i), `${brief}: ${names.join(', ')}`);
      }
      const both = week('En ole kovin hyvässä kunnossa ja haluaisin kyykkyä ja penkkiä.');
      assert.ok(both.includes('Barbell Full Squat') && has(both, /^Barbell Bench Press/), both.join(', '));
      // #8: insisted on twice over, the deadlift stays — the default Romanian one too.
      for (const brief of ["Don't skip deadlifts.", 'Älä jätä maastavetoa pois.']) {
        const names = week(brief);
        assert.ok(names.includes('Barbell Deadlift'), `${brief}: ${names.join(', ')}`);
        assert.ok(names.includes('Romanian Deadlift'), `${brief}: ${names.join(', ')}`);
      }
      // #9: refused after the name or swapped out, the lift is not forced in.
      for (const brief of ['Deadlifts should not be in the programme.', 'Replace deadlifts with hip thrusts.']) {
        const names = week(brief);
        assert.ok(!has(names, /deadlift/i), `${brief}: ${names.join(', ')}`);
      }
      const swapped = composeProgrammePreview('3 days a week. Instead of squats give me leg press.', preferences, library);
      assert.deepEqual(swapped.signals.lifts, ['Leg Press']);
      assert.ok(!weekNames(swapped).includes('Barbell Full Squat'), weekNames(swapped).join(', '));
      // #10: bad knees keep the lunges out, and a lift that hurts is not in the week.
      assert.ok(!has(week('Bad knees.'), /lunge/i), week('Bad knees.').join(', '));
      assert.ok(!week('Kyykky sattuu polveen.').includes('Barbell Full Squat'), week('Kyykky sattuu polveen.').join(', '));
      assert.ok(!has(week('Maastaveto sattuu selkään.'), /deadlift/i), week('Maastaveto sattuu selkään.').join(', '));
      // #11: the chest asked for after "ja" keeps its bench.
      assert.ok(has(week('Polvi kipeä ja haluan rintaa.'), /bench press/i), week('Polvi kipeä ja haluan rintaa.').join(', '));
      assert.ok(!has(week("Shoulder doesn't hurt anymore but the knee does."), /lunge/i));
      // #12: the weak grade is read.
      const inflected = week('Haluan kyykyt ja penkin mukaan.');
      assert.ok(inflected.includes('Barbell Full Squat') && has(inflected, /^Barbell Bench Press/), inflected.join(', '));
      // #13: "kuntosalilla" leaves a stored goal alone.
      const stored = { ...preferences, aiPlannerGoal: 'muscle' };
      assert.equal(
        composeProgrammePreview('Treenaan kuntosalilla 3 kertaa viikossa', stored, library).signals.goal,
        null,
      );
      // Owner decision: no leg day keeps squats, deadlifts, lunges, presses, curls and calves out.
      for (const brief of ['No leg day.', 'Ei jalkapäivää.', 'Jalat pois.']) {
        const legWork = week(brief).filter((name) => /squat|deadlift|lunge|leg press|leg curl|leg extension|calf/i.test(name));
        assert.deepEqual(legWork, [], brief);
      }
      // Review of the fix: legs asked for after "ja", never missed or never
      // trained keep their leg work.
      for (const brief of ['Ei juoksua ja jalat painopisteenä.', 'No knee pain and legs focus.', 'I never miss leg day.', "I've never trained legs."]) {
        const names = week(brief);
        assert.ok(has(names, /squat/i) && has(names, /deadlift/i) && has(names, /lunge/i), `${brief}: ${names.join(', ')}`);
      }
      // "coaching" is no pain, and the lifts asked for after a refusal, insisted
      // on twice over or polite at the end of the clause are in the week.
      for (const brief of [
        'I want coaching on squats and bench.',
        'Kyykkyä ei saa jättää pois.',
        'Never miss squats.',
        'En ole kovin hyvässä kunnossa ja kyykkyä haluaisin.',
        'No cardio and heavy squats.',
      ]) {
        const names = week(brief);
        assert.ok(names.includes('Barbell Full Squat'), `${brief}: ${names.join(', ')}`);
      }
      assert.ok(has(week('I want coaching on squats and bench.'), /^Barbell Bench Press/), week('I want coaching on squats and bench.').join(', '));
    },
  },
  {
    // Re-hunt R2 #9, #10, #13: the catalog shortcut reads the same brief.
    name: 'brief negation: the re-hunt briefs pick no ready programme holding what they keep out',
    run() {
      for (const brief of [
        '6 päivää viikossa, maastaveto ei kuulu ohjelmaan',
        '5 days a week, deadlifts should not be in the programme',
        '5 days a week, I have a bad back',
        '6 days a week, no leg day',
      ]) {
        const signals = parseProgrammeBrief(brief);
        assert.ok(signals.avoidTerms.includes('deadlift'), brief);
        const match = matchProgrammeToBrief(signals, preferences);
        const deadlifts = match ? programmeNames(match.programId).filter((name) => /deadlift/i.test(name)) : [];
        assert.deepEqual(deadlifts, [], `${brief} → ${match?.programId}`);
      }
      // "5 times a week" is five days, and the shortcut answers it like "5 days a week".
      const times = parseProgrammeBrief('5 times a week, chest focus');
      assert.equal(times.requestedDaysPerWeek, 5);
      assert.equal(shouldOfferCatalogInstead(times), true);
      // "kuntosalilla" is no fitness goal, so the catalog is not filtered to one.
      assert.equal(parseProgrammeBrief('Treenaan kuntosalilla 5 kertaa viikossa, painotus rinta').goal, null);
      // A specialty insisted on, or asked for after a polite "I'd like", is asked for.
      assert.equal(briefAsksForSpecialty("No machines and I'd like tire flips", { name: 'Tire Flip' }), true);
      assert.equal(briefAsksForSpecialty("Don't leave out the tire flips", { name: 'Tire Flip' }), true);
      assert.equal(briefAsksForSpecialty('Älä jätä strongman-liikkeitä pois', { name: 'Yoke Walk' }), true);
      assert.equal(briefAsksForSpecialty('Ei strongman-liikkeitä', { name: 'Yoke Walk' }), false);
      // A refused list stays refused; only an ask in its stretch turns it.
      assert.equal(briefAsksForSpecialty('Ilman koneita ja strongmania', { name: 'Yoke Walk' }), false);
      assert.equal(briefAsksForSpecialty('Ei koneita ja strongman tärkein', { name: 'Yoke Walk' }), true);
    },
  },
  {
    // #19: the live path's specialty safety net failed open on these.
    name: 'brief negation: a specialty refusal however phrased leaves the movement out of a live answer',
    run() {
      const raw = {
        title: 'Week',
        sessions: [
          {
            name: 'Day 1',
            exercises: [
              { name: 'Tire Flip', sets: 3, repsMin: 3, repsMax: 5 },
              { name: 'Yoke Walk', sets: 3, repsMin: 3, repsMax: 5 },
              { name: 'Barbell Full Squat', sets: 4, repsMin: 5, repsMax: 5 },
            ],
          },
        ],
      };
      for (const brief of [
        "3 days a week. I don't want to do any strongman stuff",
        'En halua tehdä mitään erikoisliikkeitä',
        'Vältä erikoisliikkeitä',
        'Jätä pois erikoisliikkeet',
        'Leave out the strongman stuff',
        'Erikoisliikkeet eivät kiinnosta',
        'Basic lifts only, nothing like tire flips',
      ]) {
        const proposal = resolveLiveProposal(raw, brief, library, 120, preferences);
        assert.deepEqual(proposal.specialtyLeftOut, ['Tire Flip', 'Yoke Walk'], brief);
      }
      // A request is still a request.
      assert.equal(briefAsksForSpecialty('I want to try tire flips', { name: 'Tire Flip' }), true);
      assert.equal(briefAsksForSpecialty('haluan strongman-treeniä', { name: 'Yoke Walk' }), true);
    },
  },
  {
    // #16: 'home_gym' carries a barbell; "Koti (käsipainot)" composed a barbell week.
    name: 'brief negation: the intake answer "home, dumbbells" composes no barbell, machine or cable work',
    run() {
      const byId = new Map(library.map((item) => [item.id, item]));
      const offenders = [];
      for (const language of ['fi', 'en']) {
        for (const goal of ['muscle', 'strength', 'fat_loss', 'fitness']) {
          for (const days of [2, 3, 4, 5, 6]) {
            const brief = buildProgramIntakeBrief(
              { goal, days, minutes: 60, equipment: 'home_dumbbells', experience: 'intermediate', extra: null },
              language,
            );
            const proposal = composeProgrammePreview(brief, preferences, library);
            assert.equal(proposal.signals.equipment, 'minimal', brief);
            for (const session of proposal.sessions) {
              for (const exercise of session.exercises) {
                const gear = displayEquipmentValue(byId.get(exercise.libraryItemId));
                if (gear === 'barbell' || gear === 'machine' || gear === 'cable') {
                  offenders.push(`${language} ${goal} ${days}d: ${exercise.name} (${gear})`);
                }
              }
            }
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} heavy-gear picks`);
    },
  },
  {
    // #17: "5x5 … 3 päivää" opened a five-day ready programme in place of the build.
    name: 'brief negation: a sets-by-reps brief for three days is built, not swapped for a five-day programme',
    run() {
      for (const brief of ['Voimaohjelma 5x5, 3 päivää viikossa', '5x5 strength programme, 3 days a week', 'Penkki 5x5, 2 päivää viikossa']) {
        const signals = parseProgrammeBrief(brief);
        assert.equal(signals.requestedDaysPerWeek, null, brief);
        assert.equal(shouldOfferCatalogInstead(signals), false, brief);
      }
    },
  },
  {
    /**
     * #20: the catalog shortcut never opens a ready programme holding a lift
     * the brief keeps out, needing gear the reader does not have, or running
     * more days than asked. Nothing left is an answer: the composer builds
     * the week and honours the avoid list.
     */
    name: 'brief negation: the catalog match never opens a programme holding an avoided lift, missing gear or extra days',
    run() {
      const violations = [];
      const extras = [
        '',
        ', olkapää kipeä',
        ', ei maastavetoa',
        ', selkä kipeä, ei maastavetoa',
        ', no deadlifts, no overhead press',
        ", I don't want to do squats",
        ', polvi kipeä',
        ', ilman leuanvetoja',
      ];
      const places = ['', ' Paikka: kotona, käsipainot.', ' Where: bodyweight only, no equipment.', ' Where: the gym.'];
      for (const days of [5, 6]) {
        for (const extra of extras) {
          for (const place of places) {
            for (const goal of ['', ' Goal: build muscle.', ' Tavoite: voima.']) {
              const brief = `${days} päivää viikossa${extra}.${place}${goal}`;
              const signals = parseProgrammeBrief(brief);
              const match = matchProgrammeToBrief(signals, preferences);
              if (!match) {
                continue;
              }
              const names = programmeNames(match.programId).map((name) => name.toLowerCase());
              const hit = names.find((name) => signals.avoidTerms.some((term) => name.includes(term)));
              if (hit) violations.push(`${brief} → ${match.programId} holds ${hit}`);
              if (match.daysPerWeek !== days) violations.push(`${brief} → ${match.programId} runs ${match.daysPerWeek} days`);
              if (signals.equipment === 'minimal' && !programFitsEquipment(match.programId, ['Dumbbells', 'Resistance bands'])) {
                violations.push(`${brief} → ${match.programId} needs more than dumbbells`);
              }
              if (signals.equipment === 'bodyweight' && !programFitsEquipment(match.programId, [])) {
                violations.push(`${brief} → ${match.programId} needs equipment`);
              }
            }
          }
        }
      }
      assert.deepEqual(violations.slice(0, 10), [], `${violations.length} violations`);

      // The finding's own briefs: each opened a programme with the avoided lift.
      for (const brief of ['5 päivää viikossa, olkapää kipeä', '6 päivää viikossa, ei maastavetoa', '5 days a week, no deadlifts, no overhead press']) {
        const signals = parseProgrammeBrief(brief);
        assert.ok(signals.avoidTerms.length > 0, brief);
        const match = matchProgrammeToBrief(signals, preferences);
        assert.ok(!['tpl_5_day_hybrid_v1', 'tpl_6_day_ppl_v1'].includes(match?.programId), `${brief} → ${match?.programId}`);
      }
      // A sore shoulder keeps out the presses overhead by any of their names.
      for (const brief of ['5 päivää viikossa, olkapää kipeä', '5 days a week, my shoulder hurts', '6 päivää viikossa, olkapää kipeä']) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief), preferences);
        const overhead = match ? programmeNames(match.programId).filter((name) => /overhead|shoulder press|seated dumbbell press|arnold|push press|thruster|military/i.test(name)) : [];
        assert.deepEqual(overhead, [], `${brief} → ${match?.programId}`);
      }
      // A refused squat keeps out the catalog's "Back Squat", not only the library's names.
      for (const brief of ['5 päivää viikossa, ei kyykkyä', "6 days a week, I don't want to do squats"]) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief), preferences);
        const squats = match ? programmeNames(match.programId).filter((name) => /back squat/i.test(name)) : [];
        assert.deepEqual(squats, [], `${brief} → ${match?.programId}`);
      }
      // Every five- and six-day home programme runs on dumbbells today, so the
      // gear rule is held on one that does not: a pull-up bar programme is no
      // answer to "home, dumbbells".
      const calisthenics = RECOMMENDATION_PROGRAMS.filter((definition) => definition.programId === 'tpl_gainer_calisthenics_mastery_v1');
      assert.equal(calisthenics.length, 1);
      const plain = parseProgrammeBrief('4 päivää viikossa. Tavoite: lihasmassa.');
      assert.equal(matchProgrammeToBrief({ ...plain, equipment: 'bodyweight' }, preferences, calisthenics), null);
      assert.equal(
        matchProgrammeToBrief(parseProgrammeBrief('4 päivää viikossa. Tavoite: lihasmassa. Paikka: kotona, käsipainot.'), preferences, calisthenics),
        null,
      );
      // A reader stored as training at home, whose brief does not say otherwise, can take it.
      assert.equal(matchProgrammeToBrief(plain, { ...preferences, setupEquipment: 'home' }, calisthenics)?.programId, 'tpl_gainer_calisthenics_mastery_v1');
      // With nothing kept out, the shortcut still answers.
      assert.equal(matchProgrammeToBrief(parseProgrammeBrief('6 päivää lihasmassaa'), preferences).programId, 'tpl_6_day_ppl_v1');
      assert.ok(RECOMMENDATION_PROGRAMS.length > 0);
    },
  },
  {
    // #22: "not trying to lose weight" opened the shred programme.
    name: 'brief negation: a goal named only to rule it out does not pick the catalog programme',
    run() {
      const signals = parseProgrammeBrief('5 days a week, build muscle, not trying to lose weight');
      assert.equal(signals.goal, 'muscle');
      assert.notEqual(matchProgrammeToBrief(signals, preferences)?.programId, 'tpl_shred_elite_v1');
      assert.equal(parseProgrammeBrief('5 päivää viikossa, voimaa, ei rasvanpudotusta').goal, 'strength');
    },
  },
];
