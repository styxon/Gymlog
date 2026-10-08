/**
 * Warmup and cooldown drills are generated copy, not library exercises, so the
 * media zone had nothing to show for them and fell back to initials on a purple
 * panel. Every drill does have a close enough sibling in the exercise library,
 * though — this maps them so a drill screen looks like the rest of the session.
 *
 * The drill name arriving from the player is already localized, so the match
 * runs against every language's label for the key rather than the English one.
 */
import { I18nKey, SUPPORTED_LANGUAGES, t } from './i18n';

/**
 * Drill key → exercise-library name whose photo stands in for it. Chosen for
 * the position the photo shows, not for an exact name match: "Empty-bar squats"
 * borrows the barbell squat, "Dead hang" the bar hang from pullups.
 */
const DRILL_LIBRARY_NAME: Record<string, string> = {
  'home.drill.rowingMachine': 'Rowing, Stationary',
  'home.drill.hipOpeners': 'Hip Circles (prone)',
  'home.drill.emptyBarSquats': 'Barbell Squat',
  'home.drill.bandPullAparts': 'Band Pull Apart',
  'home.drill.pushUps': 'Pushups',
  'home.drill.scapularPullUps': 'Scapular Pull-Up',
  'home.drill.bandFacePulls': 'Face Pull',
  'home.drill.chestDoorwayStretch': 'Chest And Front Of Shoulder Stretch',
  'home.drill.tricepsOverheadStretch': 'Triceps Stretch',
  'home.drill.latStretchOnRack': 'Standing Lateral Stretch',
  'home.drill.deadHang': 'Pullups',
  'home.drill.couchStretch': 'Intermediate Hip Flexor and Quad Stretch',
  'home.drill.seatedHamstringStretch': 'Seated Floor Hamstring Stretch',
  // Bodyweight fallbacks for gear-gated drills (equipment-aware warmups).
  'home.drill.jumpingJacks': 'Star Jump',
  'home.drill.bodyweightSquats': 'Bodyweight Squat',
  'home.drill.armCircles': 'Arm Circles',
  'home.drill.wallSlides': 'Arm Circles',
  'home.drill.standingLatStretch': 'Standing Lateral Stretch',
  'home.drill.childsPose': "Child's Pose",
  'home.drill.marchInPlace': 'Walking, Treadmill',
  'home.drill.gluteBridges': 'Butt Lift (Bridge)',
};

const DRILL_KEYS = Object.keys(DRILL_LIBRARY_NAME) as I18nKey[];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Every localized label that can name a drill, mapped to the library exercise
 * standing in for it. Built once — the dictionary never changes at runtime.
 */
const LIBRARY_NAME_BY_LABEL: Map<string, string> = (() => {
  const byLabel = new Map<string, string>();
  for (const key of DRILL_KEYS) {
    for (const language of SUPPORTED_LANGUAGES) {
      byLabel.set(normalize(t(language.key, key)), DRILL_LIBRARY_NAME[key]);
    }
  }
  return byLabel;
})();

/**
 * The library exercise whose photo should stand in for this drill, or null when
 * the name is not a known drill (a real exercise resolves on its own).
 */
export function getDrillLibraryName(drillName: string): string | null {
  return LIBRARY_NAME_BY_LABEL.get(normalize(drillName)) ?? null;
}
