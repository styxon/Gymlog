import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const DATA_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const OUTPUT_PATH = path.resolve(process.cwd(), 'src/data/generatedExerciseLibrary.ts');
// Loaded lifts the source files under "other", by name — see the file's _why.
const EQUIPMENT_OVERRIDES = JSON.parse(
  await fs.readFile(path.resolve(process.cwd(), 'scripts/exercise-equipment-overrides.json'), 'utf8'),
).overrides;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'gymlog-exercise-library-sync',
            Accept: 'application/json',
          },
        },
        (response) => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`Failed to fetch ${url}: ${response.statusCode ?? 'unknown status'}`));
            response.resume();
            return;
          }

          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              resolve(JSON.parse(raw));
            } catch (error) {
              reject(error);
            }
          });
        },
      )
      .on('error', reject);
  });
}

function toId(value) {
  return `free_${String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function mapEquipment(rawEquipment) {
  const value = String(rawEquipment ?? '')
    .trim()
    .toLowerCase();

  if (!value || value === 'body only') {
    return 'bodyweight';
  }
  if (value.includes('barbell') || value.includes('e-z curl bar')) {
    return 'barbell';
  }
  if (value.includes('dumbbell') || value.includes('kettlebell')) {
    return 'dumbbell';
  }
  if (value.includes('cable')) {
    return 'cable';
  }
  if (value.includes('machine')) {
    return 'machine';
  }

  return 'bodyweight';
}

function mapBodyPart(primaryMuscles, fallbackCategory) {
  const muscles = Array.isArray(primaryMuscles)
    ? primaryMuscles.map((item) => String(item).trim().toLowerCase())
    : [];
  const has = (values) => values.some((value) => muscles.includes(value));

  if (has(['abdominals', 'obliques'])) {
    return 'core';
  }
  if (has(['glutes'])) {
    return 'glutes';
  }
  if (has(['quadriceps', 'hamstrings', 'calves', 'abductors', 'adductors'])) {
    return 'legs';
  }
  if (has(['pectorals', 'chest'])) {
    return 'chest';
  }
  if (has(['middle back', 'lats', 'lower back', 'traps'])) {
    return 'back';
  }
  if (has(['shoulders'])) {
    return 'shoulders';
  }
  if (has(['biceps', 'forearms'])) {
    return 'biceps';
  }
  if (has(['triceps'])) {
    return 'triceps';
  }
  if (fallbackCategory === 'cardio') {
    return 'full body';
  }

  return 'full body';
}

function mapCategory(entry, mappedBodyPart) {
  const category = String(entry.category ?? '')
    .trim()
    .toLowerCase();
  const mechanic = String(entry.mechanic ?? '')
    .trim()
    .toLowerCase();

  if (category === 'cardio') {
    return 'cardio';
  }
  if (mappedBodyPart === 'core') {
    return 'core';
  }
  if (
    mechanic === 'compound' ||
    category === 'strength' ||
    category === 'powerlifting' ||
    category === 'olympic weightlifting' ||
    category === 'strongman' ||
    category === 'plyometrics'
  ) {
    return 'compound';
  }

  return 'isolation';
}

// The picture folder name in the source repository ("3_4_Sit-Up/0.jpg" ->
// "3_4_Sit-Up"). Only the first picture of an exercise is ever shown, so only
// that one is kept; scripts/bundle_exercise_images.py turns each key into a
// bundled .webp, and src/lib/exerciseImageKey.ts is the one reader of the key.
function toImageKey(images) {
  const first = Array.isArray(images) ? String(images[0] ?? '') : '';
  const slug = first.split('/')[0];
  return /^[A-Za-z0-9_-]+$/.test(slug) ? slug : null;
}

function mapExercise(entry) {
  const preliminaryBodyPart = mapBodyPart(entry.primaryMuscles, String(entry.category ?? '').toLowerCase());
  const category = mapCategory(entry, preliminaryBodyPart);
  const bodyPart = mapBodyPart(entry.primaryMuscles, category);

  const name = String(entry.name ?? 'Exercise').trim();

  return {
    id: toId(entry.id ?? entry.name),
    name,
    category,
    bodyPart,
    // The fallback in mapEquipment is "bodyweight", which is wrong for every
    // loaded lift the source calls "other"; those are named in the overrides.
    equipment: EQUIPMENT_OVERRIDES[name] ?? mapEquipment(entry.equipment),
    primaryMuscles: Array.isArray(entry.primaryMuscles) ? entry.primaryMuscles.map((item) => String(item)) : [],
    secondaryMuscles: Array.isArray(entry.secondaryMuscles) ? entry.secondaryMuscles.map((item) => String(item)) : [],
    instructions: Array.isArray(entry.instructions) ? entry.instructions.map((item) => String(item)) : [],
    ...(toImageKey(entry.images) ? { imageKey: toImageKey(entry.images) } : {}),
    sourceCategory: entry.category ? String(entry.category) : null,
    sourceEquipment: entry.equipment ? String(entry.equipment) : null,
    sourceMechanic: entry.mechanic ? String(entry.mechanic) : null,
    sourceLevel: entry.level ? String(entry.level) : null,
  };
}

async function main() {
  const source = await fetchJson(DATA_URL);
  if (!Array.isArray(source)) {
    throw new Error('Unexpected exercise dataset shape');
  }

  const mapped = source
    .map(mapExercise)
    .filter((item) => item.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));

  const file = `/* eslint-disable */\nimport type { ExerciseLibraryItem } from '../types/models';\n\n// Generated from yuhonas/free-exercise-db (Unlicense).\n// Refresh with: npm run exercise:sync (also bundles the pictures, see scripts/bundle_exercise_images.py)\nexport const GENERATED_EXERCISE_LIBRARY: ExerciseLibraryItem[] = ${JSON.stringify(mapped, null, 2)};\n`;

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, file, 'utf8');

  console.log(`Wrote ${mapped.length} exercise library items to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
