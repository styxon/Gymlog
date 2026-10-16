/**
 * About you: what Continue waits for.
 *
 * Gender and age band are answers; weight is not required (user, 2026-10-12) —
 * a reader who skips it goes on with `weightKg: null`, and nothing downstream
 * invents a default.
 */
export function canContinueAboutYou(answers: { gender: unknown; ageRange: unknown }): boolean {
  return answers.gender !== null && answers.gender !== undefined && answers.ageRange !== null && answers.ageRange !== undefined;
}

/**
 * The first answer Continue still waits for, in the order the rows stand —
 * the line under the disabled button names it. A skipped gender is an answer.
 */
export function firstMissingAboutYou(answers: { gender: unknown; ageRange: unknown }): 'gender' | 'age' | null {
  if (answers.gender === null || answers.gender === undefined) {
    return 'gender';
  }
  if (answers.ageRange === null || answers.ageRange === undefined) {
    return 'age';
  }
  return null;
}
