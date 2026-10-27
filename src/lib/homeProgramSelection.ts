interface HomeCustomWorkoutItem {
  id: string;
  name: string;
  exerciseCount: number;
  updatedAt: string;
}

interface HomeCustomProgramSelectionInput {
  customWorkouts: HomeCustomWorkoutItem[];
  activeSessionTemplateId: string | null;
  hasActiveSession: boolean;
  lastSelectedTemplateId: string | null;
  recentCompletedCustomTemplateId: string | null;
}

interface HomeCustomProgramSelection {
  mode: 'resume_active' | 'open_existing' | 'create_new';
  workoutId: string | null;
  title: string;
  subtitle: string;
  meta: string;
  ctaLabel: string;
}

function findCustomWorkout(workouts: HomeCustomWorkoutItem[], workoutId: string | null) {
  if (!workoutId) {
    return null;
  }

  return workouts.find((workout) => workout.id === workoutId) ?? null;
}

export function selectHomeCustomProgram({
  customWorkouts,
  activeSessionTemplateId,
  hasActiveSession,
  lastSelectedTemplateId,
  recentCompletedCustomTemplateId,
}: HomeCustomProgramSelectionInput): HomeCustomProgramSelection {
  const activeCustomWorkout = findCustomWorkout(customWorkouts, activeSessionTemplateId);
  const lastSelectedCustomWorkout = findCustomWorkout(customWorkouts, lastSelectedTemplateId);
  const recentCompletedCustomWorkout = findCustomWorkout(customWorkouts, recentCompletedCustomTemplateId);
  const latestEditedCustomWorkout = customWorkouts[0] ?? null;

  const selectedWorkout =
    activeCustomWorkout ??
    lastSelectedCustomWorkout ??
    recentCompletedCustomWorkout ??
    latestEditedCustomWorkout;

  if (!selectedWorkout) {
    return {
      mode: 'create_new',
      workoutId: null,
      title: 'Custom workout',
      subtitle: 'Build your first split.',
      meta: 'Start here',
      ctaLabel: 'Create workout',
    };
  }

  const meta =
    selectedWorkout.exerciseCount === 1
      ? '1 exercise'
      : `${selectedWorkout.exerciseCount} exercises`;

  if (activeCustomWorkout) {
    return {
      mode: 'resume_active',
      workoutId: selectedWorkout.id,
      title: selectedWorkout.name,
      subtitle: 'Open the workout you are currently running.',
      meta,
      ctaLabel: 'Open workout',
    };
  }

  return {
    mode: 'open_existing',
    workoutId: selectedWorkout.id,
    title: selectedWorkout.name,
    subtitle: hasActiveSession ? 'Open your latest workout.' : 'Open your latest workout.',
    meta,
    ctaLabel: 'Open workout',
  };
}