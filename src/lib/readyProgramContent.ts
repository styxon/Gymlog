import { AppLanguage } from '../types/models';
import { FALLBACK_READY_PROGRAM_CONTENT_FI, READY_PROGRAM_CONTENT_FI } from './readyProgramContentFi';

export interface ReadyProgramContentSection {
  kicker: string;
  body: string;
}

export interface ReadyProgramContent {
  summary: string;
  audience: string;
  equipmentProfile: string;
  whyItWorks: string;
}

function buildFallbackReadyProgramContent(templateId: string): ReadyProgramContent | null {
  if (!templateId.startsWith('tpl_gainer_')) {
    return null;
  }

  return {
    summary: 'A structured Vinha program with clear sessions, exercise targets, and progression rules for the selected training profile.',
    audience: 'Best for users whose onboarding choices match this program style, weekly frequency, experience level, and training focus.',
    equipmentProfile: 'Equipment needs follow the exercises in the selected plan. Review the first week before starting if your gym setup is limited.',
    whyItWorks: 'The plan groups related training days into a repeatable weekly structure and keeps sets, reps, and rest targets explicit so progression stays easy to follow.',
  };
}

const READY_PROGRAM_CONTENT: Record<string, ReadyProgramContent> = {
  // ── Vinha programs, written against what each one actually contains ──
  tpl_gainer_dream_body_man_v1: {
    summary:
      'Five gym days a week, each with its own territory: chest and triceps, back and biceps, legs, shoulders and abs, then arms. Four of the days open with a heavy compound lift and work down to isolation moves, and the arms day is isolation from the first set.',
    audience:
      'Intermediate lifters who already bench, squat and do pull-ups and want to add muscle over the whole body on five days a week.',
    equipmentProfile:
      'A full gym: barbell, dumbbells, cables, machines, plus a dip station and a pull-up bar.',
    whyItWorks:
      'Each muscle group gets a day of its own and seven exercises, and the anchor lift only goes up once the top of the rep range is hit in every set.',
  },
  tpl_gainer_beginner_bro_split_v1: {
    summary:
      'Four gym days, one muscle group at a time: chest, back, legs, then shoulders and arms. Five or six exercises a day, so each session is quick to learn.',
    audience:
      'Beginners who want to learn the basic gym lifts one muscle group at a time, training four days a week.',
    equipmentProfile:
      'A standard gym: barbell, dumbbells, cables and machines.',
    whyItWorks:
      'With one muscle group per day there is room to concentrate on technique, and each muscle gets a week to recover before its next session. The weight goes up when the top of the rep range is reached.',
  },
  tpl_gainer_advanced_ppl_v1: {
    summary:
      'Six gym days: push, pull and legs twice a week, with a different emphasis on each pass. The first round leads with chest, back width and quads, the second with shoulders, back thickness and the posterior chain.',
    audience:
      'Advanced lifters who can recover from six gym days of seven exercises each and want to build as much muscle as possible.',
    equipmentProfile:
      'A full gym: a barbell and rack for heavy squats and deadlifts, dumbbells, cables and machines.',
    whyItWorks:
      'Every muscle group is trained twice a week from two different angles, so weekly volume is high without any single session running long.',
  },
  tpl_gainer_expert_powerbuilding_v1: {
    summary:
      'Five gym days built around the powerlifting competition lifts: a bench day, a squat day and a deadlift day that each open with five sets of the competition lift, plus a pull day and a press-and-pump day.',
    audience:
      'Experienced lifters who want more kilos on the competition lifts and bodybuilding work in the same week.',
    equipmentProfile:
      'A well-equipped gym: squat rack, bench station, barbell and plates, dumbbells, cables and machines.',
    whyItWorks:
      'The competition lift comes first, fresh, for five sets, then a variation of it, then the bodybuilding work, so strength climbs and muscle grows in the same session.',
  },
  tpl_gainer_lean_shred_v1: {
    summary:
      'Five days a week: three lifting days that finish with intervals on the treadmill, bike or rower, one full-body circuit and one conditioning-and-core day.',
    audience:
      'Intermediate lifters cutting fat who want to keep their bench, squat and pull-up numbers while they do it.',
    equipmentProfile:
      'A standard gym plus a treadmill, bike or rower for the intervals.',
    whyItWorks:
      'Heavy compound lifts hold on to muscle in a calorie deficit, and the intervals add expenditure in the same gym visit, so the conditioning never gets skipped.',
  },
  tpl_gainer_dream_body_female_v1: {
    summary:
      'Five gym days: glutes and hamstrings, upper body, quads and cardio, back and core, and a full-body day. Glutes and upper body each get trained twice a week.',
    audience:
      'Intermediate lifters who want to grow their glutes and legs and keep the upper body strong on five gym days a week.',
    equipmentProfile:
      'A full gym: a barbell for hip thrusts, dumbbells, cables, machines and a stair climber.',
    whyItWorks:
      'Hip thrusts and Romanian deadlifts load the glutes heavily once a week, and the hip thrust comes back lighter on the full-body day, so the glutes get two stimuli a week without the legs being sore all the time.',
  },
  tpl_gainer_glute_foundations_v1: {
    summary:
      'Three days a week: an activation day with a band, a lower-body strength day and a glute growth day. The weights are light, and the movements are learned before they are loaded.',
    audience:
      'Beginners, or anyone coming back from a break, who want to learn to use their glutes and get the squat, hinge and hip thrust technically right.',
    equipmentProfile:
      'Basic gym equipment: a resistance band, dumbbells or a kettlebell, a cable station and a light barbell.',
    whyItWorks:
      'First the band teaches you to feel the glutes, then load arrives in the squat and the hinge, and only on the third day in the hip thrust, so strength is built on top of the right movement pattern.',
  },
  tpl_gainer_advanced_glutes_v1: {
    summary:
      'Five days a week, three of them glute days: a heavy day with the barbell, a volume day with bands and cables, and a single-leg day. The other two cover quads and hamstrings, and the upper body.',
    audience:
      'Experienced lifters whose glutes are the top priority of the next block and who can recover from three glute days a week.',
    equipmentProfile:
      'A full gym: a barbell and somewhere to hip thrust, cables, machines, bands and a reverse hyperextension bench.',
    whyItWorks:
      'A heavy five-set hip thrust, a light twenty-rep pump and single-leg work give the glutes three different stimuli a week, while the upper-body and thigh days keep the rest of the body in step.',
  },
  tpl_gainer_hourglass_shape_v1: {
    summary:
      'Four gym days: glutes and legs, shoulders and back width, glutes and core, and an upper-body toning day. Glutes twice, shoulders twice.',
    audience:
      'Intermediate lifters who want wider shoulders, bigger glutes and a tight core on four gym days.',
    equipmentProfile:
      'A standard gym: a barbell for hip thrusts, dumbbells, cables, machines and a band.',
    whyItWorks:
      'Shoulder width comes from lateral raises and wide-grip pulldowns, glute shape from hip thrusts and hinges, and the core stays tight through static holds. Twice a week for each is enough to grow.',
  },
  tpl_gainer_fat_burn_hiit_v1: {
    summary:
      'Four interval days: upper body, lower body, total body and a tabata. The moves are mostly bodyweight with some light dumbbell and kettlebell work, the sets are short and the rests shorter.',
    audience:
      'Beginners who want fitness and calorie burn from four short interval sessions a week.',
    equipmentProfile:
      'Dumbbells and a kettlebell, plus a box and battle ropes on the total-body day. Everything else is bodyweight.',
    whyItWorks:
      'Short, hard work intervals push the heart rate up fast, and with the days split into upper body, lower body, total body and tabata, no two sessions are the same.',
  },
  tpl_gainer_mobility_flow_v1: {
    summary:
      'Five short mobility sessions a week: a full-body morning opener, hips, shoulders, spine and a recovery stretch. Holds run from 30 seconds to a minute and a half, and the resting pose that closes the last day lasts 3–5 minutes.',
    audience:
      'Beginners, and anyone stiff from training or sitting who wants their mobility back through short daily sessions.',
    equipmentProfile:
      'No gym machines. A resistance band and an exercise mat cover nearly everything, and one spine drill uses a foam roller.',
    whyItWorks:
      'Each area gets a day of its own and the holds are long, so range grows where it is stuck, and no session takes an hour.',
  },
  tpl_gainer_at_home_beginner_v1: {
    summary:
      'Three bodyweight sessions a week at home: upper body, lower body and a full-body circuit. Push-ups, squats, lunges and planks, with a table for rows and a chair for dips.',
    audience:
      'Beginners who want to start strength training at home with no equipment, three sessions a week.',
    equipmentProfile:
      'No equipment: everything is bodyweight. A sturdy table for rows and a chair for dips are all it takes.',
    whyItWorks:
      'Squat, push, pull and plank come back every week and progress comes from reps, so strength and fitness build without a kilo of iron.',
  },
  tpl_home_dumbbell_upper_lower_v1: {
    summary:
      'Four days a week at home with a pair of dumbbells: two upper-body days and two lower-body days, each once heavier and once with more reps.',
    audience:
      'Anyone training at home with dumbbells who wants four sessions a week for muscle and strength.',
    equipmentProfile:
      'A pair of dumbbells, ideally adjustable, and a sturdy chair or a bench to lean on for rows and split squats. The presses are done on the floor.',
    whyItWorks:
      'Every muscle is trained twice a week, once heavier and once with more reps, and progress comes from adding reps before adding weight.',
  },
  tpl_home_dumbbell_ppl_v1: {
    summary:
      'Six days a week at home with a pair of dumbbells: push, pull and legs, each twice, once heavier and once with more reps.',
    audience:
      'Experienced lifters training at home with dumbbells who want six sessions a week.',
    equipmentProfile:
      'A pair of dumbbells, ideally adjustable, a sturdy chair or a bench to lean on, and a table for rows. The presses are done on the floor.',
    whyItWorks:
      'Every muscle is trained twice a week from two directions, and each session is short enough to fit a busy day.',
  },
  tpl_home_dumbbell_strength_v1: {
    summary:
      'Three full-body days a week with a pair of dumbbells: a squat or a hinge, a press and a row every day, in heavy sets of five and six. Floor press, goblet squat, split squat, deadlift and rows, with a short finish each day.',
    audience:
      'Anyone with dumbbells, at home or in a gym without barbells, who wants to get stronger on three days a week.',
    equipmentProfile:
      'A pair of dumbbells, ideally adjustable and heavy enough for sets of five, and a sturdy chair or a bench to lean on for rows and split squats. The presses are done on the floor.',
    whyItWorks:
      'Every session trains legs, a press and a pull in sets of five or six with long rests. When every set is done at the target reps, the weight goes up next time.',
  },
  tpl_home_dumbbell_strength_split_v1: {
    summary:
      'Five days a week with a pair of dumbbells: two upper-body days, two lower-body days and a full-body day. Floor press, rows, shoulder press, goblet squat and stiff-legged deadlift in heavy sets of five and six.',
    audience:
      'Experienced lifters with dumbbells and no barbell who want to train for strength five days a week.',
    equipmentProfile:
      'A pair of dumbbells, ideally adjustable and heavy enough for sets of five, and a sturdy chair or a bench to lean on for rows and split squats. The presses are done on the floor.',
    whyItWorks:
      'Press, pull, squat and hinge each get two heavy days a week, so every lift is practised often and no single session runs long.',
  },
  tpl_home_bodyweight_upper_lower_v1: {
    summary:
      'Four bodyweight days a week: two upper-body days and two lower-body days. Push-ups, rows under a table, split squats and single-leg work.',
    audience:
      'Anyone training at home without equipment who is past the beginner stage and wants four sessions a week.',
    equipmentProfile:
      'No equipment. A sturdy table for rows and a chair for dips and split squats.',
    whyItWorks:
      'Harder variations stand in for added weight: one leg instead of two, feet raised, slower reps. Progress comes from reps first.',
  },
  tpl_home_bodyweight_full_body_v1: {
    summary:
      'Two bodyweight days a week, the whole body each time. Decline push-ups, pull-ups or rows, split squats and single-leg work, with the harder variation doing the job of added weight.',
    audience:
      'Anyone past the beginner stage who wants to build muscle at home with no equipment and has two days a week.',
    equipmentProfile:
      'No equipment is needed. A sturdy table for rows, a chair or bench for dips and split squats, and a pull-up bar if you have one: without it the pull-ups become rows.',
    whyItWorks:
      'Every muscle is trained twice a week at 8 to 15 repetitions, and progress comes from reps first, then a harder variation: feet raised, one leg instead of two, a slower lowering.',
  },
  tpl_home_bodyweight_ppl_v1: {
    summary:
      'Six bodyweight days a week: push, legs, and pull with core, each twice. The second round uses different exercises from the first.',
    audience:
      'Experienced bodyweight trainers who want to build muscle at home with no equipment and can train six days a week.',
    equipmentProfile:
      'No equipment is needed. A sturdy table for rows, a chair or bench for dips and split squats, and a pull-up bar if you have one: without it the pull-ups become rows.',
    whyItWorks:
      'Pushing, pulling and legs each come back twice a week with different exercises the second time, so the work is spread across the week instead of piled into one session. The triceps pairs are supersets to keep it dense.',
  },
  tpl_athletic_starter_v1: {
    summary:
      'Three sessions a week with a barbell: a lower-body day, an upper-body day and a full-body day that ends in conditioning. Squat, bench press, row, deadlift, jumps and burpees.',
    audience:
      'Beginners with a barbell, a rack and a bench who want strength and conditioning in the same week.',
    equipmentProfile:
      'A barbell with plates, a squat rack and a bench. The conditioning is bodyweight.',
    whyItWorks:
      'A few big lifts carry the strength work and short jump and burpee sets carry the conditioning, so a first block trains both without a long list of exercises.',
  },
  tpl_home_athletic_5_day_v1: {
    summary:
      'Five bodyweight days a week at home: push and core, legs, a full-body circuit, pull and conditioning, and a balance day.',
    audience:
      'Anyone training at home without equipment who wants five sessions a week for strength and fitness together.',
    equipmentProfile:
      'No equipment. A sturdy table for rows and a chair for dips and split squats.',
    whyItWorks:
      'Strength days and conditioning days alternate, so the week mixes heavier work with faster circuits.',
  },
  tpl_athletic_upper_lower_4_day_v1: {
    summary:
      'Four gym days a week: upper-body strength, lower-body strength, an upper-body day with intervals, and a lower-body power day. Bench press, row, squat and trap bar deadlift in sets of five to eight, and a conditioning finish on every day.',
    audience:
      'Experienced lifters who want strength and conditioning in the same week on four gym days, without a bodybuilding split.',
    equipmentProfile:
      'A well-equipped gym: barbell, squat rack and bench, trap bar, dumbbells, cables, a pull-up bar, a box, a sled, a kettlebell, a medicine ball and an air bike or exercise bike.',
    whyItWorks:
      'The heavy lifts come first, while you are fresh, and the conditioning comes last on the same day. The upper body pulls on more sets than it presses, and the trap bar deadlift, the heaviest pull of the week, is on its last day.',
  },
  tpl_athletic_performance_5_day_v1: {
    summary:
      'Five gym days a week: upper-body strength, lower-body strength, upper-body hypertrophy, a power and conditioning day, and a heavy hinge day with intervals. Squat, bench press, row, trap bar deadlift, box jumps and sled pushes.',
    audience:
      'Experienced lifters who train five days a week and want strength, power and conditioning together. On six days, the app adds one light day.',
    equipmentProfile:
      'A well-equipped gym: barbell, squat rack and bench, trap bar, dumbbells, cables, a pull-up bar, a box, a sled, a medicine ball, an air bike and a treadmill.',
    whyItWorks:
      'Strength, size, power and conditioning each have their own day. Upper and lower days alternate, the upper body pulls on more sets than it presses, and the trap bar deadlift, the heaviest pull of the week, is on the last day, so the day after it is an upper-body day.',
  },
  tpl_home_dumbbell_athletic_5_day_v1: {
    summary:
      'Five days a week at home with a pair of dumbbells: upper-body strength, lower-body strength, upper-body hypertrophy, a power and conditioning day, and a lower-body day with a short engine finish. Floor press, rows, goblet squat, stiff-legged deadlift, thrusters and jump squats.',
    audience:
      'Experienced trainees with dumbbells at home who want strength, power and conditioning on five days a week. On six days, the app adds one light day.',
    equipmentProfile:
      'A pair of dumbbells, ideally adjustable, and a sturdy chair or a bench to lean on for rows and split squats. The presses are done on the floor. No barbell and no machines.',
    whyItWorks:
      'Upper and lower days alternate, the upper body rows on more sets than it presses, and jumps and burpees add the conditioning without any gear beyond the dumbbells.',
  },
  tpl_home_bodyweight_strength_3_day_v1: {
    summary:
      'Three full-body days a week with no equipment: hard push-up and split-squat variations at low reps, rows under a table and single-leg hinges.',
    audience:
      'Anyone training at home without equipment who wants to get stronger, not just fitter. Beginners start on the easier variations the swap sheet offers.',
    equipmentProfile:
      'No equipment. A sturdy table for rows, a chair or couch to raise your feet and for dips, and something to hook your feet under for the Nordic curl.',
    whyItWorks:
      'A hard variation at six reps works the muscle the way added weight would: few reps, long rests. Add a rep when the sets are clean, and move to a harder variation at eight.',
  },
  tpl_home_calisthenics_strength_5_day_v1: {
    summary:
      'Five days a week of calisthenics for strength: planche and pike push-ups, pistol and shrimp squats, pull-ups and L-sits, at low reps with long rests.',
    audience:
      'Experienced bodyweight trainers who can already do push-ups and pull-ups for reps and want five strength sessions a week.',
    equipmentProfile:
      'A pull-up bar for the pull-ups; without one they become rows. A table for rows, a chair to raise your feet and for dips, a wall for the handstand, and something to hook your feet under for the Nordic curl.',
    whyItWorks:
      'Every movement is trained twice a week on a hard variation, with five reps or fewer on the lead lift of the day and long rests. Add reps, then move to a harder variation.',
  },
  tpl_gainer_calisthenics_mastery_v1: {
    summary:
      'Four days a week built around skills: handstand and planche, muscle-up and front lever, pistol squats and jumps, plus a skills-and-core day.',
    audience:
      'Experienced bodyweight athletes who already do weighted pull-ups and dips and want the skills next.',
    equipmentProfile:
      'A pull-up bar and dip bars, a wall for handstands, and ideally rings.',
    whyItWorks:
      'The week mixes long holds, explosive reps and weighted strength work, so skill, strength and body control develop side by side.',
  },
  tpl_gainer_strength_5x5_v1: {
    summary:
      'Three sessions a week alternating A and B: squat every time, bench and barbell row on A days, overhead press and deadlift on B days. Five sets of five, one set for the deadlift.',
    audience:
      'Beginners who want to learn five barbell lifts and watch the weight go up every week.',
    equipmentProfile:
      'A barbell, plates, a squat rack and a bench.',
    whyItWorks:
      'Three lifts at the same weight across all sets are easy to log and repeat, and when five sets of five go up clean, the smallest plate goes on the bar.',
  },
  tpl_gainer_athlete_conditioning_v1: {
    summary:
      'Five days a week: explosive lower body, athletic upper body, speed and agility, a strength circuit, and endurance. Power cleans, jumps, sprints, rowing intervals and sled pushes.',
    audience:
      'Experienced trainees and athletes who want power, speed and endurance rather than muscle alone.',
    equipmentProfile:
      'A well-equipped gym and room for sprints and agility drills: barbell, sled, box, medicine ball, battle ropes, rower and air bike.',
    whyItWorks:
      'Strength, speed and endurance each get their own day, so each can be trained fresh, and over the week all three move forward.',
  },
  tpl_gainer_strong_lean_female_v1: {
    summary:
      'Four gym days: upper-body strength, lower-body strength, push and core, and pull and conditioning. Bench press, back squat, incline dumbbell press and barbell row anchor the four days.',
    audience:
      'Intermediate lifters who want more strength in the basic lifts and a lean, athletic build on four gym days.',
    equipmentProfile:
      'A standard gym: barbell, dumbbells, cables, machines and a kettlebell.',
    whyItWorks:
      'The upper body is trained three times, twice led by a barbell lift (the bench press and the barbell row) and once with dumbbells, and the lower body once heavy plus hip thrusts and swings on the pull day, so strength and muscle both progress without the week turning into a grind.',
  },
  tpl_gainer_joint_friendly_v1: {
    summary:
      'Three days a week on machines, cables and a band: supported lower body, supported upper body, and a full-body and balance day. Reps mostly run 12–20, and every movement is controlled.',
    audience:
      'Beginners, people returning from a break, or anyone whose joints do not tolerate heavy free weights but who still wants to get stronger.',
    equipmentProfile:
      'Gym machines and cables, a resistance band and a chair.',
    whyItWorks:
      'The machine guides the path, so the load lands on the muscle rather than the joint, and the high reps build strength with light weights.',
  },
  tpl_gainer_prenatal_fitness_v1: {
    summary:
      'Three light sessions a week for pregnancy: gentle strength, mobility and pelvic floor, and low-impact cardio and balance.',
    audience:
      'Expectant mothers cleared to exercise by a healthcare professional who want to keep their strength and mobility up.',
    equipmentProfile:
      'Dumbbells, a resistance band and an exercise mat, plus a cable station for rows and a stationary bike at the gym.',
    whyItWorks:
      'Light weights, pelvic floor activation and easy cycling keep you functional without jumps or heavy lifting.',
  },
  tpl_gainer_postpartum_recovery_v1: {
    summary:
      'Three short sessions a week after childbirth: core reconnection starting from breathing and the pelvic floor, a gentle full-body day, and a strength rebuild with light dumbbells.',
    audience:
      'Anyone recovering from childbirth who has a doctor\'s or healthcare professional\'s go-ahead to start training.',
    equipmentProfile:
      'Light dumbbells, a resistance band and some floor space.',
    whyItWorks:
      'Breathing and deep-core activation come first, then light basic movements, and only at the end any load, so the core recovers before it is asked to carry anything.',
  },
  tpl_gainer_runners_strength_v1: {
    summary:
      'Three gym days for a runner: posterior chain and power, single-leg stability, and core and mobility. Romanian deadlifts, hip thrusts, split squats and jumps.',
    audience:
      'Intermediate runners who want stronger hamstrings, glutes and calves, fewer injuries and a more economical stride.',
    equipmentProfile:
      'Basic gym gear: a barbell or dumbbells, a box for jumps, a pull-up bar for hanging leg raises and room for mobility work.',
    whyItWorks:
      'Single-leg work and a stronger posterior chain target exactly what running asks for, and the jumps teach the leg to produce force fast, so the stride gets lighter and overuse injuries rarer.',
  },

  tpl_strong_elite_v1: {
    summary: 'A 12-week Pro strength block: five-set anchor lifts, heavy pressure days, and accessories that protect the next heavy session.',
    audience: 'Best for experienced lifters who recover well, know the main lifts cold, and want maximal strength as the clear priority.',
    equipmentProfile: 'Full gym required: barbell, rack, bench, trap bar or deadlift setup, machines and cables.',
    whyItWorks: 'Each pattern gets one heavy and one pressure exposure per week, so intensity climbs across the block without the week collapsing into fatigue.',
  },
  tpl_fit_elite_v1: {
    summary: 'A 12-week Pro block that keeps strength anchors moving while conditioning finishers build a real engine four days per week.',
    audience: 'Best for experienced all-rounders who want strength, conditioning and mobility in one honest weekly structure.',
    equipmentProfile: 'Full gym recommended: barbell, dumbbells, machines, kettlebell and a cardio machine for finishers.',
    whyItWorks: 'Power days push the main lifts while volume days add conditioning density, so both strength and engine progress without stealing from each other.',
  },
  tpl_shred_elite_v1: {
    summary: 'A 12-week Pro fat-loss block: five days that hold strength anchors while HIIT finishers drive the energy expenditure up.',
    audience: 'Best for experienced lifters cutting fat who refuse to lose their strength base while conditioning volume climbs.',
    equipmentProfile: 'Full gym recommended: barbell, machines, kettlebell, and treadmill or bike for the interval finishers.',
    whyItWorks: 'Every session pairs one honest strength slot with a conditioning finisher, so the deficit comes from work you can actually progress, not from junk volume.',
  },
  tpl_3_day_full_body_v1: {
    summary: 'Three full-body sessions built to keep strength practice frequent while overall weekly fatigue stays manageable.',
    audience: 'Best for newer lifters or anyone who wants simple weekly structure with repeated practice on the main lifts.',
    equipmentProfile: 'Full gym recommended: barbell, bench, cable, leg press, and a basic pull station.',
    whyItWorks: 'The template repeats squat, press, pull, and hinge patterns across the week, so progression stays obvious without requiring a complicated split.',
  },
  tpl_4_day_upper_lower_v1: {
    summary: 'A balanced upper/lower split with enough weekly volume for hypertrophy while anchor lifts still get clear progression targets.',
    audience: 'Best for intermediate lifters who can train four days per week and want more upper/lower volume than full body gives.',
    equipmentProfile: 'Full gym setup recommended, especially barbells, dumbbells, machines, pulldown, and cable stations.',
    whyItWorks: 'Each pattern gets two exposures per week, which makes recovery predictable and gives you more productive hard sets without turning every day into a marathon.',
  },
  tpl_5_day_hybrid_v1: {
    summary: 'A higher-frequency hybrid split that mixes upper/lower structure with dedicated push and pull days for more specialization.',
    audience: 'Best for intermediate lifters who recover well, want more gym time each week, and like a body-part feel without losing progression structure.',
    equipmentProfile: 'Full gym required. This template assumes broad equipment access across barbell, machines, dumbbells, and cables.',
    whyItWorks: 'The week opens with heavier compound structure, then adds separate push and pull days so extra volume can land where it actually matters without bloating every session.',
  },
  tpl_2_day_minimal_full_body_v1: {
    summary: 'A low-friction two-day bodyweight plan for weeks when you want full-body coverage without needing a gym.',
    audience: 'Best for beginners, busy weeks, home workouts, or anyone coming back into training who still wants structure and progression.',
    equipmentProfile: 'Home and bodyweight friendly. Floor space and a sturdy row setup are enough for the core plan.',
    whyItWorks: 'The template keeps squat, push, pull, hinge, and core patterns in the week while using bodyweight progression instead of gym-only equipment.',
  },
  tpl_3_day_strength_base_v1: {
    summary: 'A simple strength-first week with three heavy exposures so squat, press, and hinge patterns all progress on repeatable rails.',
    audience: 'Best for newer lifters who want a real strength template without jumping straight into a high-fatigue powerlifting setup.',
    equipmentProfile: 'Full gym recommended, especially barbell stations, a row option, pulldown, and basic lower-body machines.',
    whyItWorks: 'Each session starts with one anchor lift in a low-rep range, then fills the rest of the day with enough secondary work to build support without blunting recovery.',
  },
  tpl_4_day_powerbuilding_v1: {
    summary: 'A four-day powerbuilding plan that lets the week open with strength work and finish with volume that actually builds muscle.',
    audience: 'Best for intermediate lifters who care about the numbers on the bar but still want upper and lower days to look like bodybuilding sessions.',
    equipmentProfile: 'Full gym required, including barbells, dumbbells, pulldown, row stations, and lower-body machines.',
    whyItWorks: 'The split separates performance days from volume days, so the main lifts stay fresh while chest, back, shoulders, and legs still accumulate enough hypertrophy work across the week.',
  },
  tpl_2_day_beginner_strength_v1: {
    summary: 'A two-day strength entry point that keeps the lift menu simple while still giving squat, press, hinge, and pull patterns room to progress.',
    audience: 'Best for new lifters who want obvious barbell progress without committing to three or four weekly sessions immediately.',
    equipmentProfile: 'Full gym recommended, but the exercise count stays low enough that each day remains easy to learn and repeat.',
    whyItWorks: 'The plan strips strength work down to the core compounds, so effort goes into repeatable lifts instead of chasing variety too early.',
  },

  tpl_3_day_upper_lower_lite_v1: {
    summary: 'A softer three-day upper/lower split that keeps the week balanced without demanding long or overly dense sessions.',
    audience: 'Best for beginners who want something more varied than full body but are not ready for a classic four-day split.',
    equipmentProfile: 'Standard full gym works best, but the session length and exercise count stay modest across the week.',
    whyItWorks: 'The split gives upper body two exposures and lower body one bigger day, which keeps skill practice and recovery both easy to manage.',
  },

  tpl_3_day_push_pull_legs_v1: {
    summary: 'A classic three-day PPL that keeps the split familiar while using simple progression rails instead of random gym-day volume.',
    audience: 'Best for intermediate hypertrophy blocks when you want a recognizable body-part split without drifting into junk volume.',
    equipmentProfile: 'Full gym recommended, especially pressing machines, pulldown/row stations, and a solid lower-body setup.',
    whyItWorks: 'Each day only has one big job to do, so you can push chest/shoulders, back/arms, and legs separately without dragging fatigue through the whole week.',
  },

  tpl_4_day_muscle_builder_v1: {
    summary: 'A four-day hypertrophy template that stays accessible for newer lifters while still giving enough total volume to grow.',
    audience: 'Best for beginners who want to move past full-body structure into a real upper/lower muscle-building split.',
    equipmentProfile: 'Full gym recommended, especially machines, dumbbells, and basic lower-body stations.',
    whyItWorks: 'The split repeats upper and lower twice each week, but the exercise choices stay beginner-friendly so the training load grows before the complexity does.',
  },

  tpl_4_day_strength_size_v1: {
    summary: 'A four-day block that gives the week clear performance days while still leaving room for enough hypertrophy work to matter.',
    audience: 'Best for intermediate lifters who want more heavy lifting than a pure bodybuilding split, but more growth work than a barebones strength plan.',
    equipmentProfile: 'Full gym required, especially barbells, pulldown/row options, and enough lower-body equipment to support heavy and lighter days.',
    whyItWorks: 'The first half of the week handles the heaviest work, while the second half adds the extra volume that keeps size and exercise tolerance moving forward.',
  },
  tpl_2_day_mobility_reset_v1: {
    summary: 'A low-friction two-day recovery template built around mobility flows, breathing resets, and easy movement quality work.',
    audience: 'Best for recovery weeks, onboarding phases, or anyone who wants a lighter entry point than a full lifting split.',
    equipmentProfile: 'No heavy equipment needed. This program works as a floor-space and bodyweight reset block.',
    whyItWorks: 'The sessions repeat simple mobility patterns and breath work so you build consistency first and only add extra rounds once the whole flow feels natural.',
  },
  tpl_2_day_yoga_recovery_v1: {
    summary: 'A two-day yoga-oriented recovery block for mobility, balance, breathing, and slower full-body movement practice.',
    audience: 'Best for beginners, mobility-focused weeks, or anyone who wants a calmer movement option inside Vinha.',
    equipmentProfile: 'Mat-friendly and bodyweight-only. No gym setup is required for the core flow of the program.',
    whyItWorks: 'The template uses short repeatable flows instead of complex sequencing, so you can build a steady yoga habit without needing a full studio class every time.',
  },
  tpl_3_day_run_mobility_v1: {
    summary: 'A beginner-friendly run-and-reset template that pairs interval-based running blocks with mobility and recovery work.',
    audience: 'Best for people who want a simple running entry point inside the current Vinha model without jumping straight into high mileage.',
    equipmentProfile: 'Minimal setup. The running days are structured as simple blocks, and the reset day only needs floor space.',
    whyItWorks: 'Instead of chasing long runs immediately, the plan alternates easy and tempo-style run blocks with a dedicated reset day so your legs and hips can keep up.',
  },

  tpl_season_summer_v1: {
    summary: 'The summer season programme: three days that each pair a short lift block with a run block, with no barbell anywhere in it.',
    audience: 'Best for anyone training the summer season - and for anyone whose gym access gets unreliable between April and September.',
    equipmentProfile: 'A pair of dumbbells or a kettlebell, something to row under, and somewhere to run. No barbell, no machines.',
    whyItWorks: 'Lifting and running usually get split into different days and then the running quietly stops happening. Putting a run block at the end of every session means the engine gets built on the days you were training anyway.',
  },

  tpl_season_winter_v1: {
    summary: 'The winter season programme: four days, upper and lower twice each, with a heavy anchor in every session and a conditioning finisher on the leg days.',
    audience: 'Best for anyone training the winter season who already knows the main lifts and wants the dark half of the year to add something.',
    equipmentProfile: 'Full gym. Barbell, dumbbells, a pulldown and a leg curl, plus a bike or treadmill for the finishers.',
    whyItWorks: 'Twenty-six weeks is long enough to run one heavy anchor per session without forcing it, and the two short finishers keep the conditioning you built in summer from quietly disappearing by March.',
  },

  tpl_4_day_ppl_plus_v1: {
    summary: 'A four-day PPL+1 split that adds a dedicated upper session to the classic push/pull/legs pattern for more weekly volume without training six days.',
    audience: 'Best for intermediate lifters who have outgrown three-day PPL but are not ready for a full six-day commitment.',
    equipmentProfile: 'Full gym required. The template assumes barbell, dumbbell, cable, pulldown, and machine access throughout.',
    whyItWorks: 'By splitting the fourth day into an upper catch-up rather than a fourth lower day, the template keeps legs from being over-trained while giving chest, back, and arms a meaningful second exposure.',
  },

  tpl_5_day_ppl_v1: {
    summary: 'A five-day PPL block that runs push and pull twice each week and fits a single leg session in the middle so lower-body recovery stays clean.',
    audience: 'Best for intermediate-to-advanced lifters who train five days per week and want a high-volume push/pull structure.',
    equipmentProfile: 'Full gym required across all five days. Cable and machine access is especially important for the second push and pull sessions.',
    whyItWorks: 'Running push and pull patterns twice gives upper body double the exposure without stacking a second heavy leg day that would compromise recovery.',
  },

  tpl_5_day_upper_lower_full_v1: {
    summary: 'A five-day plan that runs upper and lower twice each week and caps the week with a full-body session for extra practice and volume.',
    audience: 'Best for intermediate lifters who want to add a fifth day without doubling a single muscle group too aggressively.',
    equipmentProfile: 'Full gym required. The full-body day is deliberately lighter so it works in a gym with standard barbell and machine access.',
    whyItWorks: 'The full-body day acts as a skill and volume buffer — it keeps each pattern in the week three times without loading any of them to the point of impairing recovery.',
  },

  tpl_6_day_ppl_v1: {
    summary: 'The classic six-day PPL double, running push, pull, and legs twice per week for maximum weekly volume and frequency.',
    audience: 'Best for advanced lifters who recover well from high weekly volume and want the most specialization time available in a training week.',
    equipmentProfile: 'Full gym required on all six days. Machine variety is especially helpful on the B sessions where volume peaks.',
    whyItWorks: 'Running the full PPL cycle twice gives every major muscle group two distinct stimuli per week while still keeping individual session length manageable.',
  },

  tpl_6_day_arnold_v1: {
    summary: 'Six days of chest/back, shoulders/arms, and legs — the structure made famous by Arnold Schwarzenegger, updated with modern double-progression rails.',
    audience: 'Best for advanced lifters who enjoy pairing antagonist muscles and want a high-frequency bodybuilding split with strong structural logic.',
    equipmentProfile: 'Full gym required on all six days, especially pressing machines, cables, and a complete lower-body setup.',
    whyItWorks: 'Pairing chest with back and shoulders with arms allows one muscle to recover while its opposite is working, which keeps overall session density high without local fatigue killing effort.',
  },

  tpl_focus_chest_v1: {
    summary: 'A dedicated chest session with multi-angle pressing and fly work to maximise pec volume in a single visit.',
    audience: 'Best used as an add-on day, a specialization block, or a standalone chest session inside a custom weekly plan.',
    equipmentProfile: 'Requires a flat and incline bench, dumbbells, and ideally a cable or pec-deck machine.',
    whyItWorks: 'The session hits the chest from three angles — flat, incline, and fly — so both the clavicular and sternal heads receive direct work in one efficient block.',
  },

  tpl_focus_back_v1: {
    summary: 'A full back session covering lats, upper back, and rear delts with pull, row, and shrug patterns.',
    audience: 'Best as a standalone back day, a supplementary pull session, or part of a custom higher-frequency week.',
    equipmentProfile: 'Requires a pull-up or pulldown station, a barbell or cable row setup, and access to face pull or rear-delt machine.',
    whyItWorks: 'Combining vertical and horizontal pulling patterns with a rear-delt finisher ensures all three primary back regions — lats, mid-back, and posterior delt — are trained in one session.',
  },

  tpl_focus_shoulders_v1: {
    summary: 'A shoulder-focused session built around pressing and lateral/rear delt isolation to add weekly delt volume without overloading push days.',
    audience: 'Best for lifters who want more delt development on top of their existing program or as a targeted shoulder day in a custom split.',
    equipmentProfile: 'Requires dumbbells, a barbell or machine press option, and cable or machine access for rear-delt work.',
    whyItWorks: 'Separating pressing from isolation lets the lateral and posterior delts receive direct work rather than relying on carry-over from chest days.',
  },

  tpl_focus_arms_v1: {
    summary: 'A standalone arm session with biceps curls and triceps extensions across multiple angles for direct arm development.',
    audience: 'Best for lifters who want extra arm volume beyond what push and pull days provide, or anyone running a dedicated arm day.',
    equipmentProfile: 'Requires dumbbells, a barbell or EZ-bar, and cable access for curls and pushdowns.',
    whyItWorks: 'Direct biceps and triceps work in the same session keeps the session short while ensuring both muscle groups get enough stimulus to grow beyond indirect carry-over alone.',
  },

  tpl_focus_legs_v1: {
    summary: 'A complete leg session with quad, hamstring, glute, and calf work to build lower-body volume in a single dedicated visit.',
    audience: 'Best as a standalone leg day, an add-on session, or the lower-body anchor in a custom split.',
    equipmentProfile: 'Requires a squat rack, leg press, leg curl machine, and calf raise station.',
    whyItWorks: 'The session runs squat, hinge, and unilateral patterns before finishing with isolation, which mirrors the best-practice fatigue order for lower-body compound work.',
  },

  tpl_focus_glutes_v1: {
    summary: 'A glute-focused session built around hip thrust, cable kickback, and Romanian deadlift patterns for targeted posterior chain development.',
    audience: 'Best for lifters who want more glute volume than standard leg days provide, or anyone running a glute specialization phase.',
    equipmentProfile: 'Requires a hip thrust bench or stable surface, a cable machine, and Romanian deadlift access.',
    whyItWorks: 'The session prioritises hip extension patterns that load the glutes at long length, which research consistently shows produces greater hypertrophy than compound carry-over alone.',
  },

  tpl_shred_v1: {
    summary: 'Three full-body sessions that pair compound lifting with real conditioning finishers, built for dropping fat while keeping muscle.',
    audience: 'Best for anyone whose main goal is fat loss and who wants strength work and conditioning inside the same visit.',
    equipmentProfile: 'Full gym recommended: barbell, machines, kettlebell, and a treadmill or bike for the finishers.',
    whyItWorks: 'Heavy compounds protect muscle while you are in a calorie deficit, and every session ends with an interval finisher that adds real energy expenditure — the name only works because the conditioning is actually in the plan.',
  },

  tpl_huge_starter_v1: {
    summary: 'Two efficient full-body sessions that build muscle with the least possible weekly friction.',
    audience: 'Best for new lifters who want to grow muscle on two gym days per week without a complicated split.',
    equipmentProfile: 'Full gym recommended: bench, leg press, cable stations, and dumbbells.',
    whyItWorks: 'Every big muscle gets trained twice a week through compound patterns, and short sessions keep consistency high — the main driver of beginner growth.',
  },

  tpl_focus_chest_program_v1: {
    summary: 'A three-day specialisation block that trains chest twice a week while the rest of the body stays on maintenance volume.',
    audience: 'Best for intermediate lifters whose chest lags behind and who can commit three days a week to a focused block.',
    equipmentProfile: 'Full gym required: flat and incline bench, machines, dumbbells, and cables.',
    whyItWorks: 'Doubling chest frequency with a heavy day and a volume day drives growth, while a single maintenance day keeps back and legs from detraining.',
  },

  tpl_focus_back_program_v1: {
    summary: 'A three-day specialisation block that trains back twice a week while pressing and legs stay on maintenance volume.',
    audience: 'Best for intermediate lifters who want a wider, thicker back and can train three days per week.',
    equipmentProfile: 'Full gym required: barbell, pulldown and row stations, and cables.',
    whyItWorks: 'A heavy row day plus a pulldown-led volume day doubles weekly back stimulus, while one full-body maintenance day protects the rest of your progress.',
  },

  tpl_focus_arms_program_v1: {
    summary: 'A three-day specialisation block with two direct arm days and one full-body maintenance day.',
    audience: 'Best for intermediate lifters whose arms lag behind chest and back development.',
    equipmentProfile: 'Full gym required: barbell, EZ-bar or dumbbells, and cable stations.',
    whyItWorks: 'Arms recover fast, so hitting biceps and triceps directly twice a week adds real volume without stealing recovery from the rest of the week.',
  },

  tpl_focus_legs_program_v1: {
    summary: 'A three-day specialisation block that trains legs twice a week — one heavy squat day, one volume day — with a single upper-body maintenance day.',
    audience: 'Best for intermediate lifters who want serious lower-body growth and can recover from two hard leg days.',
    equipmentProfile: 'Full gym required: squat rack, hack squat or leg press, leg curl machine, and calf station.',
    whyItWorks: 'Squat-led heavy work plus machine-led volume work doubles the weekly growth stimulus, and the upper-body day keeps pressing and pulling from sliding backwards.',
  },

  tpl_focus_glutes_program_v1: {
    summary: 'A three-day specialisation block with two glute-led lower days and one upper-body maintenance day.',
    audience: 'Best for lifters who want glute growth as the clear top priority for the next training block.',
    equipmentProfile: 'Full gym required: hip thrust setup, squat rack or leg press, and leg curl machine.',
    whyItWorks: 'Hip thrust and hinge patterns load the glutes directly twice a week, with squat and lunge variations adding stimulus from a second angle.',
  },

};

/**
 * English is the source of truth. A Finnish entry replaces it when one exists;
 * a program the Finnish mirror has not caught up with still reads in English
 * rather than showing a hole.
 */
export function getReadyProgramContent(
  templateId: string,
  language: AppLanguage = 'en',
): ReadyProgramContent | null {
  if (language === 'fi') {
    const finnish = READY_PROGRAM_CONTENT_FI[templateId];
    if (finnish) {
      return finnish;
    }
    if (!READY_PROGRAM_CONTENT[templateId] && templateId.startsWith('tpl_gainer_')) {
      return {
        ...FALLBACK_READY_PROGRAM_CONTENT_FI,
      };
    }
  }

  return READY_PROGRAM_CONTENT[templateId] ?? buildFallbackReadyProgramContent(templateId);
}
