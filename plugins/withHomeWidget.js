const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

/**
 * Recreates the home-screen widget family's native side on every
 * `expo prebuild`.
 *
 * android/ is gitignored in this repo, so every file the widgets need is
 * written from here: four provider metadata files, four layouts, four picker
 * previews, the drawables, two string tables, the Kotlin providers and the
 * manifest receivers.
 *
 * The widgets read a JSON file the app writes (see src/utils/homeWidget.ts).
 * That is the entire data bridge — no broadcast, no shared preferences. In
 * exchange they refresh on Android's own schedule, whose floor is 30 minutes.
 *
 * Everything drawn is a finished string. No dates are formatted and nothing is
 * translated here, because a launcher process has none of the app's context and
 * this is the worst possible place to rediscover that. The exception is the
 * copy for states where no payload exists yet: those live in strings.xml, get
 * translated by the system locale, and are the only words the widget owns.
 *
 * THEMING. The widget cannot read `src/theming.ts` — it is drawn by the
 * launcher, in another process, from RemoteViews. So both palettes are written
 * out as drawables and colour literals below, and the payload carries the
 * *resolved* theme name. The tables below name their source so the two can be
 * diffed by eye.
 *
 * THE FAMILY. Four receivers, because the widget picker lists receivers and a
 * size nobody can find is a size nobody uses:
 *
 *   WeekWidgetProvider     2×2  "Month"    the month, and nothing else
 *   HomeWidgetProvider     4×2  "Month +"  the month, with this month's figures
 *   StreakWidgetProvider   2×1  "Workouts" one number: everything logged
 *   RoutineWidgetProvider  2×1  "Today"    today's session, or the rest day
 *
 * `HomeWidgetProvider` and `WeekWidgetProvider` keep their class names on
 * purpose: widgets already pinned to a home screen are bound to those
 * components and would otherwise vanish. What they draw has changed; what
 * Android calls them has not.
 *
 * THE CALENDAR. A real month — its name, the weekday letters, its own numbers.
 * The four-week bar strip this replaced drew marks nobody could date. A month
 * has four, five or six week rows depending on the weekday it starts on, and
 * RemoteViews cannot add a row, so the layout always holds six and the provider
 * hides the ones the month does not use.
 */

const PACKAGE = 'app.vinha';
const PAYLOAD_FILE = 'vinha-widget.json';
/** Must match HOME_WIDGET_PAYLOAD_VERSION in src/lib/widgetPayload.ts. */
const PAYLOAD_VERSION = 10;
/** Must match HOME_WIDGET_MONTH_ROWS in src/lib/widgetPayload.ts. */
const MONTH_ROWS = 6;
const DAY_COUNT = 7;
/** Workouts, duration, volume — the three the 4×2 draws. */
const STAT_COUNT = 3;
/** Must match WIDGET_LINK_SCHEME/HOST in src/lib/widgetDeepLink.ts. */
const LINK_PREFIX = 'vinha://widget/';
/** Android's own floor. Anything smaller is silently rounded up to this. */
const UPDATE_PERIOD_MS = 1800000;

/**
 * Copies of src/lightTheme.ts and src/darkTheme.ts as the widget design resolved
 * them. If a token moves there, move it here too — nothing enforces it, because
 * nothing on this side of the process boundary can import TypeScript.
 *
 * A training day carries the theme's highlight — orange on dark, violet on
 * light, the same `theme.highlight` the app's own calendars mark training days
 * with. `train` fills a trained day and outlines a planned one. A rest day
 * draws as nothing: the green rest tint was tried on every cell and the month
 * read as "ihan liian värikäs" on a real launcher (user 2026-08-25 evening) —
 * the marks carry the message, the quiet carries the marks.
 * `onTrain` is what a date reads as on the fill — white on the light theme's
 * deep violet, near-black on the dark theme's bright orange, because a bright
 * fill is where white text fails.
 */
/**
 * The card fill is opaque, and it is opaque on evidence.
 *
 * Every widget the phone ships with is translucent, and at 75% ours did look
 * like part of the home screen rather than a box on top of it. Then the numbers
 * came in. A translucent card composites the wallpaper into itself, so the worst
 * case is a pale wallpaper under the dark palette, and there the faint label —
 * the weekday letters, the stat captions — fell to a contrast ratio of 1.59.
 * WCAG's floor for large text is 3.0. Opaque, the same pair is 3.59, which is
 * the app's own dark-theme floor and as low as this palette goes anywhere.
 *
 * Keep the eight-digit form. `FF` states the intent, and the alpha channel is
 * where a future experiment would go.
 */
const CARD_ALPHA = 'FF';

const LIGHT = {
  card: `#${CARD_ALPHA}FFFFFF`,
  border: '#D8CBEE',
  ink: '#17131F',
  muted: '#5E5670',
  faint: '#8A82A0',
  train: '#6D28D9',
  onTrain: '#FFFFFF',
  // The 2x1's one coloured word on a rest day. Warm, and deliberately not a
  // calendar mark: a rest day is the one thing the 2x1 exists to say, and it
  // should not read as a pip.
  rest: '#C2410C',
  brand: '#7C3AED',
  texture: '#2E7C3AED',
  glow: '#1F7C3AED',
  washClear: '#00FFFFFF',
  wash: '#D9FFFFFF',
};

const DARK = {
  card: `#${CARD_ALPHA}241D45`,
  border: '#332A4E',
  ink: '#F4F1FF',
  muted: '#A79FC4',
  faint: '#7C739E',
  train: '#FF8A4C',
  onTrain: '#241203',
  rest: '#FB923C',
  brand: '#A98BFF',
  texture: '#3DA98BFF',
  glow: '#33A98BFF',
  washClear: '#00241D45',
  wash: '#D9241D45',
};

const THEMES = [
  ['light', LIGHT],
  ['dark', DARK],
];

/**
 * Per-size geometry, in dp/sp.
 *
 * The two calendars differ only in how much room they were given. The 2×2 gets
 * a whole ~205dp square; the 4×2 shares its card with three figures and is the
 * shorter of the two, which is why every number in `stats` is a step down. Six
 * week rows in ~95dp is the tight case, and it is the one that decides the type
 * size.
 */
const SIZES = {
  // 2×2 — the month alone.
  calendar: {
    pad: 12,
    month: 13,
    axis: 9,
    date: 11,
    pipPad: 3,
    gap: 4,
    axisGap: 8,
    gridGap: 4,
    logo: 15,
  },
  // 4×2 — the month, and this month's figures beside it.
  //
  // The month is what the card is for, so it takes the larger share (13:7, was
  // 3:2) and the figures a step down (14sp, was 17). User 2026-09-14, from a
  // store image: the left edge "jää tosi tiiviiksi" — the grid ran to 11dp from
  // the card's edge while three short figures kept a wide column to themselves.
  // The sides get their own, wider padding. 14sp is sized so the longest figure
  // the card prints ("12 h 30 min") still fits the narrower column on a 4×2 of
  // ~270dp without its end-ellipsis — at the default font. A larger font or a
  // narrower launcher cell still cut it ("4 h 20 …", 2026-10-16), so the figure
  // shrinks to fit (Android 8+) in a fixed-height row instead of ellipsizing.
  stats: {
    pad: 11,
    padHorizontal: 16,
    month: 12,
    axis: 8.5,
    date: 9.5,
    pipPad: 2,
    gap: 3,
    axisGap: 6,
    gridGap: 3,
    logo: 14,
    monthShare: 13,
    figureShare: 7,
    figureGap: 10,
    statValue: 14,
    statValueMin: 9,
    statValueHeight: 20,
    statLabel: 8.5,
    statGap: 7,
  },
  // 2×1 — one number, or one line.
  // routinePad is tighter than the streak card's: that one draws one line,
  // this one may draw two.
  small: { pad: 12, padHorizontal: 14, logo: 15, arrow: 24, routinePad: 9 },
};

// ── Provider metadata ──────────────────────────────────────────────────────

/**
 * `previewLayout` is what fixes the picker showing the app icon: the launcher
 * inflates a layout resource instead. It inflates it *statically* — no provider
 * callback runs, so every string in a preview layout is hardcoded. That is why
 * the previews are separate files rather than the real layouts, whose text is
 * empty until the provider fills it.
 *
 * `previewLayout`, `description`, `targetCellWidth/Height` and
 * `maxResizeWidth/Height` are all Android 12+. Older devices ignore them and
 * fall back to `previewImage`, `minWidth` and `minHeight`, which is why those
 * are still here.
 */
function providerInfo({ layout, preview, description, minWidth, minHeight, cells, maxWidth, maxHeight, resize }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:initialLayout="@layout/${layout}"
    android:previewLayout="@layout/${preview}"
    android:previewImage="@mipmap/ic_launcher"
${description ? `    android:description="@string/${description}"\n` : ''}    android:minWidth="${minWidth}dp"
    android:minHeight="${minHeight}dp"
    android:targetCellWidth="${cells[0]}"
    android:targetCellHeight="${cells[1]}"
    android:maxResizeWidth="${maxWidth}dp"
    android:maxResizeHeight="${maxHeight}dp"
    android:resizeMode="${resize}"
    android:widgetCategory="home_screen"
    android:updatePeriodMillis="${UPDATE_PERIOD_MS}" />
`;
}

const PROVIDERS = [
  {
    // The original component. Renaming it would orphan every widget already on
    // a home screen, so the 4×2 keeps the old name whatever it draws.
    className: 'HomeWidgetProvider',
    infoFile: 'home_widget_info',
    label: 'widget_stats_name',
    defaultLayout: 'home_widget_stats',
    info: {
      layout: 'home_widget_stats',
      preview: 'home_widget_stats_preview',
      minWidth: 250,
      minHeight: 110,
      cells: [4, 2],
      maxWidth: 500,
      maxHeight: 320,
      resize: 'horizontal|vertical',
    },
  },
  {
    // Also already pinned to home screens, so also keeps its name.
    className: 'WeekWidgetProvider',
    infoFile: 'week_widget_info',
    label: 'widget_calendar_name',
    description: 'widget_calendar_description',
    defaultLayout: 'home_widget_calendar',
    info: {
      layout: 'home_widget_calendar',
      preview: 'home_widget_calendar_preview',
      description: 'widget_calendar_description',
      minWidth: 140,
      minHeight: 110,
      cells: [2, 2],
      maxWidth: 500,
      maxHeight: 320,
      resize: 'horizontal|vertical',
    },
  },
  {
    className: 'StreakWidgetProvider',
    infoFile: 'streak_widget_info',
    label: 'widget_streak_name',
    description: 'widget_streak_description',
    defaultLayout: 'home_widget_streak',
    // Content, not a size: stretching it must not turn it into a calendar.
    pinned: true,
    info: {
      layout: 'home_widget_streak',
      preview: 'home_widget_streak_preview',
      description: 'widget_streak_description',
      minWidth: 140,
      minHeight: 40,
      cells: [2, 1],
      maxWidth: 400,
      maxHeight: 140,
      resize: 'horizontal',
    },
  },
  {
    className: 'RoutineWidgetProvider',
    infoFile: 'routine_widget_info',
    label: 'widget_routine_name',
    description: 'widget_routine_description',
    defaultLayout: 'home_widget_routine',
    pinned: true,
    info: {
      layout: 'home_widget_routine',
      preview: 'home_widget_routine_preview',
      description: 'widget_routine_description',
      // 140, not the 180 a session name would like: One UI sizes the picker row
      // from minWidth rather than from targetCellWidth, and at 180 it offered
      // this as a 3×1. The name ellipsizes on a narrow cell; being findable as
      // the size it was designed for matters more.
      minWidth: 140,
      minHeight: 40,
      cells: [2, 1],
      maxWidth: 400,
      maxHeight: 140,
      resize: 'horizontal',
    },
  },
];

// ── Drawables ──────────────────────────────────────────────────────────────

/**
 * The card: an opaque fill, a contour texture, and a wash that fades the
 * texture out across the diagonal.
 *
 * Three layers rather than one shape, because the texture cannot be a shape:
 * contour lines are paths, and paths mean a vector. The order matters — the
 * fill has to be under the lines, and the wash over them, or the fade fades
 * nothing.
 *
 * The wash is where the colour is. It runs from a violet tint at the top-right
 * corner to the card's own colour at the bottom-left, so the same drawable both
 * tints the card and thins the texture out to nothing in the corner the eye
 * reaches last. Its end colour is the card's own, never a grey: a wash in any
 * other colour shifts the whole card's tone as it fades.
 */
function cardDrawable(palette, theme) {
  return `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <solid android:color="${palette.card}" />
            <corners android:radius="20dp" />
            <stroke android:width="1dp" android:color="${palette.border}" />
        </shape>
    </item>
    <item android:drawable="@drawable/widget_texture_${theme}" />
    <item>
        <shape android:shape="rectangle">
            <gradient
                android:type="linear"
                android:angle="225"
                android:startColor="${palette.glow}"
                android:centerColor="${palette.washClear}"
                android:endColor="${palette.wash}" />
            <corners android:radius="20dp" />
        </shape>
    </item>
</layer-list>
`;
}

/**
 * The contour texture: concentric lines around the top-right corner, the way a
 * contour map draws a hill whose summit is just off the page.
 *
 * Generated rather than drawn, because the spacing has to survive being
 * stretched from a 2×2 square to a 2×1 strip — the same drawable backs all four
 * widgets, and a launcher scales it to whatever its grid hands out.
 *
 * The rings are clipped to a rounded rectangle. A vector stretched to a wide
 * card stretches its corners with it, so the clip's radius is deliberately
 * larger than the card's 20dp: it has to stay *inside* the card's own corner at
 * every aspect ratio, and a texture that stops a hair early is invisible where
 * one that bleeds past the corner is not.
 */
const TEXTURE_VIEWPORT = 200;

function contourRings() {
  // Just off the top-right corner, which is where the design puts the summit.
  const centreX = TEXTURE_VIEWPORT * 0.98;
  const centreY = TEXTURE_VIEWPORT * 0.02;
  // Far enough to reach the opposite corner: that distance is ~277 units.
  const OUTER = 290;
  const STEP = 9;
  const POINTS = 14;
  const round = (value) => Math.round(value * 10) / 10;

  const rings = [];
  for (let index = 0, radius = 16; radius < OUTER; index += 1, radius += STEP) {
    const points = Array.from({ length: POINTS }, (_, step) => {
      const angle = (step / POINTS) * Math.PI * 2;
      // Two out-of-phase waves per ring, drifting with the ring's index. One
      // wave reads as a wobbly circle; two read as terrain.
      const wobble =
        1 + 0.028 * Math.sin(3 * angle + index * 0.7) + 0.016 * Math.sin(5 * angle - index * 1.1);
      const distance = radius * wobble;
      return [centreX + distance * Math.cos(angle), centreY + distance * Math.sin(angle)];
    });

    // Catmull-Rom through the points, converted to the cubics a path can hold,
    // so a 14-point ring draws as a curve rather than as a polygon.
    const segments = points.map((_, step) => {
      const before = points[(step - 1 + POINTS) % POINTS];
      const start = points[step];
      const end = points[(step + 1) % POINTS];
      const after = points[(step + 2) % POINTS];
      const first = [start[0] + (end[0] - before[0]) / 6, start[1] + (end[1] - before[1]) / 6];
      const second = [end[0] - (after[0] - start[0]) / 6, end[1] - (after[1] - start[1]) / 6];
      return `C${round(first[0])},${round(first[1])} ${round(second[0])},${round(second[1])} ${round(end[0])},${round(end[1])}`;
    });

    rings.push(`M${round(points[0][0])},${round(points[0][1])} ${segments.join(' ')} Z`);
  }

  return rings;
}

function textureVector(palette) {
  const size = TEXTURE_VIEWPORT;
  const radius = 30;
  const clip =
    `M${radius},0 H${size - radius} A${radius},${radius} 0 0 1 ${size},${radius} ` +
    `V${size - radius} A${radius},${radius} 0 0 1 ${size - radius},${size} ` +
    `H${radius} A${radius},${radius} 0 0 1 0,${size - radius} ` +
    `V${radius} A${radius},${radius} 0 0 1 ${radius},0 Z`;

  const paths = contourRings()
    .map(
      (pathData) => `        <path
            android:pathData="${pathData}"
            android:strokeColor="${palette.texture}"
            android:strokeWidth="0.8"
            android:fillColor="#00000000" />`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${size}"
    android:viewportHeight="${size}">
    <group>
        <clip-path android:pathData="${clip}" />
${paths}
    </group>
</vector>
`;
}

/**
 * A date's highlight.
 *
 * A pill rather than a circle, and that is a size decision rather than a taste
 * one: a circle only stays round if the cell is square, and the cell is
 * whatever a launcher's grid leaves after six rows. A 999dp corner clamps to a
 * pill at any height, so one drawable serves both calendars.
 *
 * Today is the ring. It is drawn on its own axis so a day can be today *and*
 * trained, which is the one thing a glance at a home screen is asking.
 */
function pipDrawable(fill, ring) {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="${fill}" />
    <corners android:radius="999dp" />${ring ? `\n    <stroke android:width="1.5dp" android:color="${ring}" />` : ''}
</shape>
`;
}

const PIP_STATES = ['done', 'plan', 'off', 'pad'];

function pipResourceName(state, today, theme) {
  return `widget_pip_${state}${today ? '_today' : ''}_${theme}`;
}

/**
 * The brand mark, as a path rather than a bitmap: it is drawn at 15dp beside a
 * heading, and the adaptive launcher icon carries a third of its own width in
 * safe-zone padding, which at this size is most of the glyph.
 *
 * One copy, not two — the provider tints it per theme with `setColorFilter`,
 * the only recolouring RemoteViews can do to an image.
 */
const LOGO_VECTOR = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="100"
    android:viewportHeight="100">
    <path
        android:pathData="M18,15 L50,72 L82,15"
        android:strokeColor="${LIGHT.brand}"
        android:strokeWidth="22"
        android:strokeLineJoin="miter"
        android:fillColor="#00000000" />
</vector>
`;

/**
 * The routine widget's affordance: a chevron in a ring. Two arcs rather than
 * the almost-closed single arc, which leaves a visible notch at 24dp.
 */
const ARROW_VECTOR = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:pathData="M2,12 A10,10 0 1 1 22,12 A10,10 0 1 1 2,12"
        android:strokeColor="${LIGHT.muted}"
        android:strokeWidth="1.4"
        android:fillColor="#00000000" />
    <path
        android:pathData="M10.6,8.6 L14,12 L10.6,15.4"
        android:strokeColor="${LIGHT.muted}"
        android:strokeWidth="1.8"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:fillColor="#00000000" />
</vector>
`;

function drawables() {
  const files = { 'widget_logo.xml': LOGO_VECTOR, 'widget_arrow.xml': ARROW_VECTOR };
  for (const [theme, palette] of THEMES) {
    files[`widget_card_${theme}.xml`] = cardDrawable(palette, theme);
    files[`widget_texture_${theme}.xml`] = textureVector(palette);
    for (const state of PIP_STATES) {
      // Trained is the solid highlight fill, a planned day the same colour as
      // an outline; rest and padding draw as nothing. A green rest tint was
      // tried and read as too colourful on the launcher (user 2026-08-25).
      const fill = state === 'done' ? palette.train : '#00000000';
      const ring = state === 'plan' ? palette.train : null;
      files[`${pipResourceName(state, false, theme)}.xml`] = pipDrawable(fill, ring);
      files[`${pipResourceName(state, true, theme)}.xml`] = pipDrawable(
        fill,
        state === 'pad' ? null : palette.ink,
      );
    }
  }
  return files;
}

// ── Layout building blocks ─────────────────────────────────────────────────

/**
 * What a date reads as. On the trained fill it is the fill's own on-colour, on
 * a planned outline the outline's colour; off it, the quiet grey — except
 * today, which is ink so the ring has something to hold.
 */
function dateColor(palette, state, today) {
  if (state === 'done') {
    return palette.onTrain;
  }
  if (state === 'plan') {
    return today ? palette.ink : palette.train;
  }
  return today ? palette.ink : palette.muted;
}

function root(theme, { padding, paddingHorizontal = null, children }) {
  const pad =
    paddingHorizontal !== null
      ? `android:paddingStart="${paddingHorizontal}dp"
    android:paddingEnd="${paddingHorizontal}dp"
    android:paddingTop="${padding}dp"
    android:paddingBottom="${padding}dp"`
      : `android:padding="${padding}dp"`;
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center_vertical"
    android:background="@drawable/widget_card_${theme}"
    ${pad}>

${children}
</LinearLayout>
`;
}

/**
 * The one line the widget owns: what it says before the app has ever run.
 *
 * Every layout carries it, hidden, and hides its body to show it. That is the
 * whole of the no-payload state — a widget added from the picker before first
 * launch has no file to read, and an honest instruction beats a confident zero.
 */
function promptView(theme, { size = 14 }) {
  return `        <TextView
            android:id="@+id/widget_prompt"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:maxLines="3"
            android:ellipsize="end"
            android:textSize="${size}sp"
            android:textStyle="bold"
            android:visibility="gone"
            android:textColor="${theme === 'light' ? LIGHT.ink : DARK.ink}"
            android:text="" />`;
}

function logoView(size, { indent = '            ', gravity = null, marginEnd = 0 }) {
  return `${indent}<ImageView
${indent}    android:id="@+id/widget_logo"
${indent}    android:layout_width="${size}dp"
${indent}    android:layout_height="${size}dp"${gravity ? `\n${indent}    android:layout_gravity="${gravity}"` : ''}${marginEnd ? `\n${indent}    android:layout_marginEnd="${marginEnd}dp"` : ''}
${indent}    android:contentDescription="@null"
${indent}    android:src="@drawable/widget_logo" />`;
}

/**
 * The month: its name, the weekday letters, and six rows of dates.
 *
 * Shared verbatim by the 2×2 and the 4×2 — same ids, same provider code, only
 * the type sizes differ. Two layouts defining the same id is allowed and is
 * what lets one `renderCalendar` fill either card.
 *
 * The rows are weighted so a launcher's leftover height spreads across them
 * rather than pooling under the last one, and each date spans its whole column
 * so the pill behind it lines up with its neighbours. The gap between pills is
 * the column's padding, not the date's width: a `wrap_content` date inside a
 * padded column had barely 13dp to sit in, and Android's answer to a number
 * that does not fit is to break it across lines.
 */
function calendarParts(size, theme, { preview = null } = {}) {
  const palette = theme === 'light' ? LIGHT : DARK;
  const half = size.gap / 2;
  const pad = (depth) => '    '.repeat(depth);

  const axis = Array.from({ length: DAY_COUNT }, (_, index) => `${pad(1)}<TextView
${pad(1)}    android:id="@+id/widget_axis_${index}"
${pad(1)}    android:layout_width="0dp"
${pad(1)}    android:layout_height="wrap_content"
${pad(1)}    android:layout_weight="1"
${pad(1)}    android:maxLines="1"
${pad(1)}    android:gravity="center_horizontal"
${pad(1)}    android:textSize="${size.axis}sp"
${pad(1)}    android:textStyle="bold"
${pad(1)}    android:textColor="${palette.faint}"
${pad(1)}    android:text="${preview ? preview.axis[index] : ''}" />`).join('\n');

  const rows = Array.from({ length: MONTH_ROWS }, (_, rowIndex) => {
    const cells = Array.from({ length: DAY_COUNT }, (_, dayIndex) => {
      const cellIndex = rowIndex * DAY_COUNT + dayIndex;
      const cell = preview ? preview.cells[cellIndex] : null;
      // 'pad', not 'off': the runtime layout is repainted by the provider
      // before it is seen, and rest cells now carry a tint that would flash.
      const state = cell ? cell.state : 'pad';
      const today = Boolean(cell && cell.today);
      return `${pad(2)}<LinearLayout
${pad(2)}    android:layout_width="0dp"
${pad(2)}    android:layout_height="wrap_content"
${pad(2)}    android:layout_weight="1"
${pad(2)}    android:orientation="vertical"
${pad(2)}    android:paddingStart="${half}dp"
${pad(2)}    android:paddingEnd="${half}dp">
${pad(2)}    <TextView
${pad(2)}        android:id="@+id/widget_cell_${cellIndex}"
${pad(2)}        android:layout_width="match_parent"
${pad(2)}        android:layout_height="wrap_content"
${pad(2)}        android:maxLines="1"
${pad(2)}        android:gravity="center"
${pad(2)}        android:paddingTop="${size.pipPad}dp"
${pad(2)}        android:paddingBottom="${size.pipPad}dp"
${pad(2)}        android:textSize="${size.date}sp"
${pad(2)}        android:textColor="${dateColor(palette, state, today)}"
${pad(2)}        android:background="@drawable/${pipResourceName(state, today, theme)}"
${pad(2)}        android:text="${cell ? cell.date : ''}" />
${pad(2)}</LinearLayout>`;
    }).join('\n');

    return `${pad(1)}<LinearLayout
${pad(1)}    android:id="@+id/widget_row_${rowIndex}"
${pad(1)}    android:layout_width="match_parent"
${pad(1)}    android:layout_height="0dp"
${pad(1)}    android:layout_weight="1"
${pad(1)}    android:gravity="center_vertical"
${pad(1)}    android:orientation="horizontal"${preview && preview.rows <= rowIndex ? `\n${pad(1)}    android:visibility="gone"` : ''}>
${cells}
${pad(1)}</LinearLayout>`;
  }).join('\n');

  return {
    month: `<TextView
    android:id="@+id/widget_month"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:maxLines="1"
    android:ellipsize="end"
    android:textSize="${size.month}sp"
    android:textStyle="bold"
    android:textAllCaps="true"
    android:letterSpacing="0.04"
    android:textColor="${palette.ink}"
    android:text="${preview ? preview.month : ''}" />`,
    axis: `<LinearLayout
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginTop="${size.axisGap}dp"
    android:orientation="horizontal">
${axis}
</LinearLayout>`,
    grid: `<LinearLayout
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1"
    android:layout_marginTop="${size.gridGap}dp"
    android:orientation="vertical">
${rows}
</LinearLayout>`,
  };
}

/** Pushes a generated block to the depth its parent sits at. Cosmetic only. */
function indentBlock(text, indent) {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? indent + line : line))
    .join('\n');
}

/** One figure and its caption. Three of them make the 4×2's right-hand column. */
function statBlock(size, theme, index, { indent, preview = null }) {
  const palette = theme === 'light' ? LIGHT : DARK;
  return `${indent}<TextView
${indent}    android:id="@+id/widget_stat_value_${index}"
${indent}    android:layout_width="match_parent"
${indent}    android:layout_height="${size.statValueHeight}dp"${index > 0 ? `\n${indent}    android:layout_marginTop="${size.statGap}dp"` : ''}
${indent}    android:maxLines="1"
${indent}    android:autoSizeTextType="uniform"
${indent}    android:autoSizeMinTextSize="${size.statValueMin}sp"
${indent}    android:autoSizeMaxTextSize="${size.statValue}sp"
${indent}    android:autoSizeStepGranularity="0.5sp"
${indent}    android:textSize="${size.statValue}sp"
${indent}    android:textStyle="bold"
${indent}    android:textColor="${palette.ink}"
${indent}    android:text="${preview ? preview.stats[index].value : ''}" />
${indent}<TextView
${indent}    android:id="@+id/widget_stat_label_${index}"
${indent}    android:layout_width="match_parent"
${indent}    android:layout_height="wrap_content"
${indent}    android:maxLines="1"
${indent}    android:ellipsize="end"
${indent}    android:textSize="${size.statLabel}sp"
${indent}    android:textStyle="bold"
${indent}    android:textAllCaps="true"
${indent}    android:letterSpacing="0.08"
${indent}    android:textColor="${palette.faint}"
${indent}    android:text="${preview ? preview.stats[index].label : ''}" />`;
}

// ── The four layouts ───────────────────────────────────────────────────────

/** 2×2. The month, and nothing else. */
function calendarLayout(theme, { preview = null } = {}) {
  const size = SIZES.calendar;
  const parts = calendarParts(size, theme, { preview });
  // The mark shares the heading's line: it is the only row with slack in it,
  // and a 2×2 has no corner to spare that is not already a date.
  const body = `        <LinearLayout
            android:id="@+id/widget_body"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:orientation="vertical">
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal">
                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:orientation="vertical">
${indentBlock(parts.month, '                    ')}
                </LinearLayout>
${logoView(size.logo, { indent: '                ' })}
            </LinearLayout>
${indentBlock(parts.axis, '            ')}
${indentBlock(parts.grid, '            ')}
        </LinearLayout>`;

  return root(theme, { padding: size.pad, children: `${promptView(theme, { size: 14 })}\n${body}` });
}

/** 4×2. The same month, with this month's three figures beside it. */
function statsLayout(theme, { preview = null } = {}) {
  const size = SIZES.stats;
  const parts = calendarParts(size, theme, { preview });
  const stats = Array.from({ length: STAT_COUNT }, (_, index) =>
    statBlock(size, theme, index, { indent: '                    ', preview }),
  ).join('\n');

  const body = `        <LinearLayout
            android:id="@+id/widget_body"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:orientation="horizontal">
            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="${size.monthShare}"
                android:orientation="vertical">
${indentBlock(parts.month, '                ')}
${indentBlock(parts.axis, '                ')}
${indentBlock(parts.grid, '                ')}
            </LinearLayout>
            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="${size.figureShare}"
                android:layout_marginStart="${size.figureGap}dp"
                android:orientation="vertical">
${logoView(size.logo, { indent: '                ', gravity: 'end' })}
                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="0dp"
                    android:layout_weight="1"
                    android:gravity="center_vertical"
                    android:orientation="vertical">
${stats}
                </LinearLayout>
            </LinearLayout>
        </LinearLayout>`;

  return root(theme, {
    padding: size.pad,
    paddingHorizontal: size.padHorizontal,
    children: `${promptView(theme, { size: 14 })}\n${body}`,
  });
}

/** 2×1. One number: the weeks in a row the app itself counts. */
function streakLayout(theme, { preview = null } = {}) {
  const size = SIZES.small;
  const palette = theme === 'light' ? LIGHT : DARK;
  const body = `        <LinearLayout
            android:id="@+id/widget_body"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal">
            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical">
                <TextView
                    android:id="@+id/widget_streak_value"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:textSize="26sp"
                    android:textStyle="bold"
                    android:textColor="${palette.ink}"
                    android:text="${preview ? preview.streakValue : ''}" />
                <TextView
                    android:id="@+id/widget_streak_label"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:ellipsize="end"
                    android:textSize="9sp"
                    android:textStyle="bold"
                    android:textAllCaps="true"
                    android:letterSpacing="0.08"
                    android:textColor="${palette.faint}"
                    android:text="${preview ? preview.streakLabel : ''}" />
            </LinearLayout>
${logoView(size.logo, { indent: '            ' })}
        </LinearLayout>`;

  return root(theme, {
    padding: size.pad,
    paddingHorizontal: size.padHorizontal,
    children: `${promptView(theme, { size: 13 })}\n${body}`,
  });
}

/** 2×1. Today: the weekday, and what it is for. */
function routineLayout(theme, { preview = null } = {}) {
  const size = SIZES.small;
  const palette = theme === 'light' ? LIGHT : DARK;
  const body = `        <LinearLayout
            android:id="@+id/widget_body"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal">
            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical">
                <TextView
                    android:id="@+id/widget_routine_when"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:maxLines="1"
                    android:ellipsize="end"
                    android:textSize="9sp"
                    android:textStyle="bold"
                    android:textAllCaps="true"
                    android:letterSpacing="0.1"
                    android:textColor="${palette.faint}"
                    android:text="${preview ? preview.routineWhen : ''}" />
                <TextView
                    android:id="@+id/widget_routine_title"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="1dp"
                    android:maxLines="2"
                    android:ellipsize="end"
                    android:textSize="13sp"
                    android:lineSpacingMultiplier="0.95"
                    android:textStyle="bold"
                    android:textColor="${palette.ink}"
                    android:text="${preview ? preview.routineTitle : ''}" />
            </LinearLayout>
            <ImageView
                android:id="@+id/widget_arrow"
                android:layout_width="${size.arrow}dp"
                android:layout_height="${size.arrow}dp"
                android:layout_marginStart="10dp"
                android:contentDescription="@null"
                android:src="@drawable/widget_arrow" />
        </LinearLayout>`;

  return root(theme, {
    padding: size.routinePad,
    paddingHorizontal: size.padHorizontal,
    children: `${promptView(theme, { size: 13 })}\n${body}`,
  });
}

// ── Picker previews ────────────────────────────────────────────────────────

/**
 * The picker previews. Static by necessity, light palette by choice: the
 * preview is inflated with no provider running, so it cannot know which theme
 * the reader bought, and light is what a fresh install resolves.
 *
 * The example month is a five-row one, half of it trained and the rest of the
 * week ahead planned, with today in the middle. It shows every mark in one
 * glance, which is the whole point of a preview.
 */
const PREVIEW_AXIS = Array.from({ length: DAY_COUNT }, (_, index) => `@string/widget_preview_axis_${index}`);
/** A month that starts on a Wednesday and runs 31 days: five rows, two blanks. */
const PREVIEW_FIRST_COLUMN = 2;
const PREVIEW_DAYS = 31;
const PREVIEW_TODAY = 18;
const PREVIEW_DONE = [2, 4, 7, 9, 11, 14, 16, 18];
const PREVIEW_PLAN = [21, 23, 25, 28, 30];

function previewCalendar() {
  const cells = Array.from({ length: MONTH_ROWS * DAY_COUNT }, (_, index) => {
    const dayOfMonth = index - PREVIEW_FIRST_COLUMN + 1;
    if (dayOfMonth < 1 || dayOfMonth > PREVIEW_DAYS) {
      // Padding, not rest: a rest cell carries the green tint, and these two
      // blanks belong to no month the preview is showing.
      return { date: '', state: 'pad', today: false };
    }
    const state = PREVIEW_DONE.includes(dayOfMonth) ? 'done' : PREVIEW_PLAN.includes(dayOfMonth) ? 'plan' : 'off';
    return { date: `${dayOfMonth}`, state, today: dayOfMonth === PREVIEW_TODAY };
  });

  return {
    month: '@string/widget_preview_month',
    axis: PREVIEW_AXIS,
    cells,
    rows: Math.ceil((PREVIEW_FIRST_COLUMN + PREVIEW_DAYS) / DAY_COUNT),
  };
}

const PREVIEW_STATS = [
  // Values that are not a bare number have to be strings, because the picker
  // speaks the phone's language and a hardcoded "4 h 20 min" does not.
  { value: '8', label: '@string/widget_label_workouts' },
  { value: '@string/widget_preview_duration', label: '@string/widget_label_duration' },
  { value: '@string/widget_preview_volume', label: '@string/widget_label_volume' },
];

/**
 * Previews reference the same ids as the real layouts, and two layouts may not
 * both *define* an id where the preview is one of them. `@+id/x` becomes
 * `@id/x` so the previews reuse the definitions instead of fighting over them.
 */
function stripIds(xml) {
  return xml.replace(/@\+id\//g, '@id/');
}

function calendarPreview() {
  return stripIds(calendarLayout('light', { preview: previewCalendar() }));
}

function statsPreview() {
  return stripIds(statsLayout('light', { preview: { ...previewCalendar(), stats: PREVIEW_STATS } }));
}

function streakPreview() {
  return stripIds(
    streakLayout('light', { preview: { streakValue: '48', streakLabel: '@string/widget_label_streak' } }),
  );
}

function routinePreview() {
  return stripIds(
    routineLayout('light', {
      preview: { routineWhen: '@string/widget_preview_weekday', routineTitle: '@string/widget_preview_title' },
    }),
  );
}

// ── Strings ────────────────────────────────────────────────────────────────

/**
 * The only copy the widget owns. Everything else arrives pre-translated in the
 * payload — but these are the states where there is no payload (a fresh
 * install) or no widget yet (the picker), so they have to live in the APK and
 * follow the system locale.
 */
const STRINGS = {
  en: {
    widget_calendar_name: 'Vinha · Month',
    widget_calendar_description: 'Your training month, one square.',
    widget_stats_name: 'Vinha · Month & figures',
    // The ids keep the word 'streak': the receiver behind them is pinned to
    // home screens by class name, and what it counts changed, not what it is.
    widget_streak_name: 'Vinha · Workouts',
    widget_streak_description: 'Every workout you have logged.',
    widget_routine_name: 'Vinha · Today',
    widget_routine_description: 'What today is for, and one tap to it.',
    // Never "create a program": a missing payload means the app has not run
    // since it was installed or updated, which is not the same as the reader
    // having no programme — and after an update it told a reader with six
    // programmes to go and make one. Opening the app is true in both cases,
    // and is also the thing that fixes it.
    widget_setup: 'Open Vinha Fitness to fill this in',
    widget_setup_short: 'Open Vinha',
    widget_label_workouts: 'Workouts',
    widget_label_duration: 'Duration',
    widget_label_volume: 'Volume',
    widget_label_streak: 'workouts',
    widget_preview_month: 'August',
    widget_preview_weekday: 'Monday',
    widget_preview_title: 'Upper body A',
    widget_preview_duration: '4 h 20 min',
    widget_preview_volume: '12.4 t',
    widget_preview_axis: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  },
  fi: {
    widget_calendar_name: 'Vinha · Kuukausi',
    widget_calendar_description: 'Treenikuukausi yhdessä ruudussa.',
    widget_stats_name: 'Vinha · Kuukausi ja luvut',
    widget_streak_name: 'Vinha · Treenit',
    widget_streak_description: 'Kaikki kirjaamasi treenit.',
    widget_routine_name: 'Vinha · Tänään',
    widget_routine_description: 'Mitä varten tämä päivä on, yhden napautuksen päässä.',
    widget_setup: 'Avaa Vinha Fitness niin tämä täyttyy',
    widget_setup_short: 'Avaa Vinha',
    widget_label_workouts: 'Treenit',
    widget_label_duration: 'Kesto',
    widget_label_volume: 'Volyymi',
    widget_label_streak: 'treeniä',
    widget_preview_month: 'elokuu',
    widget_preview_weekday: 'Maanantai',
    widget_preview_title: 'Ylävartalo A',
    widget_preview_duration: '4 h 20 min',
    widget_preview_volume: '12,4 t',
    widget_preview_axis: ['MA', 'TI', 'KE', 'TO', 'PE', 'LA', 'SU'],
  },
};

/**
 * Android's string parser treats a bare apostrophe as an error, so the copy
 * above uses typographic ones — this only has to cover the XML metacharacters.
 */
function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
}

function stringsXml(table) {
  const entries = Object.entries(table).flatMap(([name, value]) =>
    Array.isArray(value)
      ? value.map((item, index) => `    <string name="${name}_${index}">${escapeXml(item)}</string>`)
      : [`    <string name="${name}">${escapeXml(value)}</string>`],
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
${entries.join('\n')}
</resources>
`;
}

// ── Kotlin ─────────────────────────────────────────────────────────────────

function paletteLiteral(name, palette, theme) {
  const pips = PIP_STATES.flatMap((state) => [
    `            "${state}" to R.drawable.${pipResourceName(state, false, theme)},`,
    `            "${state}_today" to R.drawable.${pipResourceName(state, true, theme)},`,
  ]).join('\n');

  return `    private val ${name} = Palette(
        card = R.drawable.widget_card_${theme},
        ink = Color.parseColor("${palette.ink}"),
        muted = Color.parseColor("${palette.muted}"),
        faint = Color.parseColor("${palette.faint}"),
        rest = Color.parseColor("${palette.rest}"),
        train = Color.parseColor("${palette.train}"),
        onTrain = Color.parseColor("${palette.onTrain}"),
        brand = Color.parseColor("${palette.brand}"),
        pips = mapOf(
${pips}
        ),
    )`;
}

function idArray(name, count, pattern) {
  const entries = Array.from({ length: count }, (_, index) => `            R.id.${pattern(index)},`).join('\n');
  return `        private val ${name} = intArrayOf(
${entries}
        )`;
}

const BASE_PROVIDER_KT = `package ${PACKAGE}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Draws the home-screen widget family from the JSON the app writes to filesDir.
 *
 * Deliberately dumb: it reads finished strings and puts them on TextViews, and
 * reads four state names and puts a drawable behind a date. All dates,
 * translation and pluralisation happened in JS (src/lib/widgetPayload.ts) where
 * they are covered by tests. Generated by plugins/withHomeWidget.js — edit it
 * there, not here, because android/ is regenerated by prebuild.
 *
 * Two decisions are made on this side, and neither is a judgement call:
 * which of the two palettes to paint (the payload says, Pro gate included) and
 * which layout fits the size Android reports.
 *
 * This class is also the 4×2 receiver. It keeps the name it shipped with,
 * because widgets already pinned to a home screen are bound to this component.
 */
open class HomeWidgetProvider : AppWidgetProvider() {

    /** Every colour and drawable the widget can paint, for one theme. */
    private class Palette(
        val card: Int,
        val ink: Int,
        val muted: Int,
        val faint: Int,
        val rest: Int,
        val train: Int,
        val onTrain: Int,
        val brand: Int,
        val pips: Map<String, Int>,
    ) {
        /** Anything unrecognised draws as a free day rather than as nothing. */
        fun pip(state: String?, today: Boolean): Int {
            val key = (state ?: "off") + if (today) "_today" else ""
            return pips[key] ?: pips["off"] ?: 0
        }

        /** What a date reads as once its pill is behind it. */
        fun dateInk(state: String?, today: Boolean): Int = when {
            state == "done" -> onTrain
            today -> ink
            state == "plan" -> train
            else -> muted
        }
    }

${paletteLiteral('light', LIGHT, 'light')}

${paletteLiteral('dark', DARK, 'dark')}

    /** The layout this receiver draws before Android has reported a size. */
    protected open fun defaultLayout(): Int = R.layout.home_widget_stats

    /**
     * Which layout fits. The two calendars are one widget at two widths, so
     * either receiver lands on the shape it has room for — and the 2×1s pin
     * their own layout, because a streak stretched wide is still a streak.
     */
    protected open fun layoutFor(width: Int, height: Int): Int = when {
        width <= 0 -> defaultLayout()
        width < 220 -> R.layout.home_widget_calendar
        else -> R.layout.home_widget_stats
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            render(context, manager, id, optionsOf(manager, id))
        }
    }

    /** Resizing is the only way to change layout, so it has to redraw. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        newOptions: Bundle?,
    ) {
        render(context, manager, id, newOptions)
    }

    private fun optionsOf(manager: AppWidgetManager, id: Int): Bundle? = try {
        manager.getAppWidgetOptions(id)
    } catch (error: Exception) {
        null
    }

    private fun render(context: Context, manager: AppWidgetManager, id: Int, options: Bundle?) {
        val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
        val height = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
        try {
            manager.updateAppWidget(id, buildViews(context, layoutFor(width, height)))
        } catch (error: Exception) {
            // A widget that fails to draw must not take the app's process with
            // it. The next update is 30 minutes away and costs nothing.
        }
    }

    private fun buildViews(context: Context, layoutId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, layoutId)
        val payload = readPayload(context)
        // Light with no payload: that is what a fresh install resolves, and the
        // dark theme is something the reader buys and chooses.
        val palette = if (payload?.optString("theme") == "dark") dark else light

        views.setInt(R.id.widget_root, "setBackgroundResource", palette.card)
        // The mark is one drawable for both themes. A colour filter is the only
        // recolouring RemoteViews can do to an image, and it is enough.
        views.setInt(R.id.widget_logo, "setColorFilter", palette.brand)

        if (payload == null) {
            renderSetup(context, views, layoutId, palette)
            views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context))
            return views
        }

        views.setViewVisibility(R.id.widget_prompt, View.GONE)
        views.setViewVisibility(R.id.widget_body, View.VISIBLE)

        when (layoutId) {
            R.layout.home_widget_streak -> renderTotal(context, views, payload, palette)
            R.layout.home_widget_routine -> renderRoutine(context, views, payload, palette)
            R.layout.home_widget_stats -> {
                val month = monthFor(payload)
                if (month == null) {
                    renderSetup(context, views, layoutId, palette)
                    views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context))
                } else {
                    renderCalendar(views, payload, month, palette)
                    renderStats(views, month, palette)
                    views.setOnClickPendingIntent(R.id.widget_root, targetIntent(context, "calendar"))
                }
            }
            else -> {
                val month = monthFor(payload)
                if (month == null) {
                    renderSetup(context, views, layoutId, palette)
                    views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context))
                } else {
                    renderCalendar(views, payload, month, palette)
                    views.setOnClickPendingIntent(R.id.widget_root, targetIntent(context, "calendar"))
                }
            }
        }

        return views
    }

    /**
     * No file yet: the widget was added before the app ever ran. The only words
     * it can use are its own, from the APK, in the system's language.
     */
    private fun renderSetup(context: Context, views: RemoteViews, layoutId: Int, palette: Palette) {
        val short = layoutId == R.layout.home_widget_calendar ||
            layoutId == R.layout.home_widget_streak ||
            layoutId == R.layout.home_widget_routine
        val text = context.getString(if (short) R.string.widget_setup_short else R.string.widget_setup)

        views.setViewVisibility(R.id.widget_body, View.GONE)
        views.setViewVisibility(R.id.widget_prompt, View.VISIBLE)
        views.setTextViewText(R.id.widget_prompt, text)
        views.setTextColor(R.id.widget_prompt, palette.ink)
    }

    /**
     * The month. Six rows exist in the layout because a month can need six;
     * the ones this month does not use are hidden rather than left blank, so
     * the rows that remain spread across the whole card.
     */
    private fun renderCalendar(views: RemoteViews, payload: JSONObject, month: JSONObject, palette: Palette) {
        views.setTextViewText(R.id.widget_month, month.optString("monthLabel"))
        views.setTextColor(R.id.widget_month, palette.ink)

        val labels = payload.optJSONArray("weekdayLabels")
        for (index in 0 until DAY_COUNT) {
            views.setTextViewText(axisIds[index], labels?.optString(index) ?: "")
            views.setTextColor(axisIds[index], palette.faint)
        }

        val weeks = month.optJSONArray("monthWeeks")
        for (rowIndex in 0 until MONTH_ROWS) {
            val week = weeks?.optJSONArray(rowIndex)
            views.setViewVisibility(rowIds[rowIndex], if (week == null) View.GONE else View.VISIBLE)

            for (dayIndex in 0 until DAY_COUNT) {
                val cellIndex = rowIndex * DAY_COUNT + dayIndex
                val day = week?.optJSONObject(dayIndex)
                // The days either side of the month keep their column and say
                // nothing: they are there so the weekdays line up, not to be
                // read. "pad", not "off" — a rest day now carries a tint, and
                // these cells must carry none.
                val inMonth = day?.optBoolean("inMonth") == true
                val dateKey = day?.optString("dateKey") ?: ""
                val today = inMonth && dateKey == todayKey()
                // A planned day is only planned until its date has passed. The
                // payload is written days before it is drawn (nextMonth most of
                // all: it is built at write time and swapped in when the
                // calendar turns), so the clock decides here. The keys are
                // yyyy-MM-dd, which sort as dates.
                val stored = if (inMonth) day?.optString("state") else "pad"
                val state = if (stored == "plan" && dateKey.isNotEmpty() && dateKey < todayKey()) "off" else stored

                views.setTextViewText(cellIds[cellIndex], if (inMonth) day?.optString("dateLabel") ?: "" else "")
                views.setTextColor(cellIds[cellIndex], palette.dateInk(state, today))
                views.setInt(cellIds[cellIndex], "setBackgroundResource", palette.pip(state, today))
            }
        }
    }

    /** The three figures beside the month, in the order the payload lists them. */
    private fun renderStats(views: RemoteViews, month: JSONObject, palette: Palette) {
        val stats = month.optJSONArray("stats")
        for (index in 0 until STAT_COUNT) {
            val stat = stats?.optJSONObject(index)
            views.setTextViewText(statValueIds[index], stat?.optString("value") ?: "")
            views.setTextColor(statValueIds[index], palette.ink)
            views.setTextViewText(statLabelIds[index], stat?.optString("label") ?: "")
            views.setTextColor(statLabelIds[index], palette.faint)
        }
    }

    /** How many workouts there have ever been. The ids keep the older name. */
    private fun renderTotal(context: Context, views: RemoteViews, payload: JSONObject, palette: Palette) {
        views.setTextViewText(R.id.widget_streak_value, payload.optString("totalValue"))
        views.setTextColor(R.id.widget_streak_value, palette.ink)
        views.setTextViewText(R.id.widget_streak_label, payload.optString("totalLabel"))
        views.setTextColor(R.id.widget_streak_label, palette.faint)
        // A count of everything logged is a calendar fact, so it opens the calendar.
        views.setOnClickPendingIntent(R.id.widget_root, targetIntent(context, "calendar"))
    }

    /**
     * Today's line, chosen here rather than read.
     *
     * The payload carries seven dated days. It used to carry one line, decided
     * when the app last ran, and a Thursday rest day then sat on a Friday
     * training day until something opened the app. The launcher has a clock;
     * this is the only place that knows what day the card is being drawn on.
     *
     * Matched by date rather than by weekday: a reader who trains two days on
     * and one off has no fixed weekdays to index by, and the same Tuesday
     * trains on one turn of their cycle and rests on the next.
     */
    private fun renderRoutine(context: Context, views: RemoteViews, payload: JSONObject, palette: Palette) {
        val days = payload.optJSONArray("routineDays")
        val today = findToday(days)

        val kind = today?.optString("kind") ?: "prompt"
        // A prompt has a sentence and needs its eyebrow; a rest or workout day
        // is one coloured word, and the weekday above it would be the second
        // thing on a card that exists to say exactly one.
        val prompt = kind == "prompt"
        views.setViewVisibility(R.id.widget_routine_when, if (prompt) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.widget_routine_when, today?.optString("when") ?: "")
        views.setTextColor(R.id.widget_routine_when, palette.faint)
        views.setTextViewText(R.id.widget_routine_title, today?.optString("title") ?: "")
        views.setTextColor(
            R.id.widget_routine_title,
            // The calendar's own logic, spoken as one word: a training day —
            // ahead or already done — is the highlight, a rest day is green.
            when (kind) {
                "rest" -> palette.rest
                "done", "work" -> palette.train
                else -> palette.ink
            },
        )
        views.setTextViewTextSize(R.id.widget_routine_title, TypedValue.COMPLEX_UNIT_SP, if (prompt) 13f else 22f)
        views.setInt(R.id.widget_arrow, "setColorFilter", palette.muted)
        views.setOnClickPendingIntent(R.id.widget_root, targetIntent(context, today?.optString("target")))
    }

    /**
     * The month block that is true today: the one the app built, or the
     * following month it also built when the calendar has turned since. Neither
     * means the file is older than that, and the card asks to be opened rather
     * than drawing a month that is over.
     */
    private fun monthFor(payload: JSONObject): JSONObject? {
        val key = SimpleDateFormat("yyyy-MM", Locale.US).format(Date())
        if (payload.optString("monthKey") == key) {
            return payload
        }
        val next = payload.optJSONObject("nextMonth")
        return if (next != null && next.optString("monthKey") == key) next else null
    }

    /** "2026-08-20" in the device's own timezone, matching the payload's keys. */
    private fun todayKey(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    /**
     * The dated entry for today, or nothing.
     *
     * Nothing, rather than the first entry: the seven days start at the day the
     * app last ran, so a card drawn eight days later has no line that is true.
     * A blank card says less than a wrong one, and asks to be tapped.
     */
    private fun findToday(days: JSONArray?): JSONObject? {
        if (days == null) {
            return null
        }
        val key = todayKey()
        for (index in 0 until days.length()) {
            val day = days.optJSONObject(index) ?: continue
            if (day.optString("dateKey") == key) {
                return day
            }
        }
        return null
    }

    /**
     * A link back into the app. The slug travels, not a session id: the file
     * this was read from can be half an hour old, and the app resolves what the
     * slug means against live state when it opens.
     */
    private fun targetIntent(context: Context, target: String?): PendingIntent {
        val slug = if (target.isNullOrEmpty()) "home" else target
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(LINK_PREFIX + slug))
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

        // An APK that cannot handle its own scheme would leave a dead tap, so
        // fall back to simply opening the app.
        if (context.packageManager.resolveActivity(intent, 0) == null) {
            return launchIntent(context)
        }

        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(context, requestCodeFor(slug), intent, flags)
    }

    private fun launchIntent(context: Context): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(context, 0, launch, flags)
    }

    /** Distinct per destination, so one target's intent cannot replace another's. */
    private fun requestCodeFor(slug: String): Int = when (slug) {
        "session" -> 1
        "calendar" -> 2
        "programs" -> 3
        "schedule" -> 4
        "suggestion" -> 6
        else -> 5
    }

    private fun readPayload(context: Context): JSONObject? {
        return try {
            val file = File(context.filesDir, PAYLOAD_FILE)
            if (!file.exists()) {
                return null
            }
            val parsed = JSONObject(file.readText())
            // A payload from another app version may mean anything; ignore it
            // rather than draw a guess.
            if (parsed.optInt("version", -1) != PAYLOAD_VERSION) null else parsed
        } catch (error: Exception) {
            null
        }
    }

    companion object {
        private const val PAYLOAD_FILE = "${PAYLOAD_FILE}"
        private const val PAYLOAD_VERSION = ${PAYLOAD_VERSION}
        private const val LINK_PREFIX = "${LINK_PREFIX}"
        private const val DAY_COUNT = ${DAY_COUNT}
        private const val MONTH_ROWS = ${MONTH_ROWS}
        private const val STAT_COUNT = ${STAT_COUNT}

${idArray('axisIds', DAY_COUNT, (index) => `widget_axis_${index}`)}

${idArray('rowIds', MONTH_ROWS, (index) => `widget_row_${index}`)}

${idArray('cellIds', MONTH_ROWS * DAY_COUNT, (index) => `widget_cell_${index}`)}

${idArray('statValueIds', STAT_COUNT, (index) => `widget_stat_value_${index}`)}

${idArray('statLabelIds', STAT_COUNT, (index) => `widget_stat_label_${index}`)}
    }
}
`;

/**
 * The other three receivers. They exist to be three more rows in the widget
 * picker — one per question the family answers — and differ only in which
 * layout they start at, and whether the size ladder may move them off it.
 */
function subclassKt(className, defaultLayout, { pinned, comment }) {
  const ladder = pinned
    ? `

    /** Content, not a size: stretched wide, this is still what it says it is. */
    override fun layoutFor(width: Int, height: Int): Int = R.layout.${defaultLayout}`
    : '';
  return `package ${PACKAGE}

/**
 * ${comment}
 *
 * Generated by plugins/withHomeWidget.js. All drawing lives in
 * HomeWidgetProvider; this only says where the size ladder starts.
 */
class ${className} : HomeWidgetProvider() {
    override fun defaultLayout(): Int = R.layout.${defaultLayout}${ladder}
}
`;
}

// ── Writing it all out ─────────────────────────────────────────────────────

function writeFile(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

/** Every generated file, keyed by its path under app/src/main. Exported for tests. */
function widgetResources() {
  const javaDir = `java/${PACKAGE.split('.').join('/')}`;
  const files = {
    'res/layout/home_widget_calendar.xml': calendarLayout('light'),
    'res/layout/home_widget_stats.xml': statsLayout('light'),
    'res/layout/home_widget_streak.xml': streakLayout('light'),
    'res/layout/home_widget_routine.xml': routineLayout('light'),
    'res/layout/home_widget_calendar_preview.xml': calendarPreview(),
    'res/layout/home_widget_stats_preview.xml': statsPreview(),
    'res/layout/home_widget_streak_preview.xml': streakPreview(),
    'res/layout/home_widget_routine_preview.xml': routinePreview(),
    'res/values/widget_strings.xml': stringsXml(STRINGS.en),
    'res/values-fi/widget_strings.xml': stringsXml(STRINGS.fi),
    [`${javaDir}/HomeWidgetProvider.kt`]: BASE_PROVIDER_KT,
    [`${javaDir}/WeekWidgetProvider.kt`]: subclassKt('WeekWidgetProvider', 'home_widget_calendar', {
      pinned: false,
      comment: 'The 2×2: the month, and nothing else.',
    }),
    [`${javaDir}/StreakWidgetProvider.kt`]: subclassKt('StreakWidgetProvider', 'home_widget_streak', {
      pinned: true,
      comment: 'The 2×1: how many weeks in a row have something in them.',
    }),
    [`${javaDir}/RoutineWidgetProvider.kt`]: subclassKt('RoutineWidgetProvider', 'home_widget_routine', {
      pinned: true,
      comment: 'The 2×1: what today is for, and one tap to it.',
    }),
  };

  for (const provider of PROVIDERS) {
    files[`res/xml/${provider.infoFile}.xml`] = providerInfo(provider.info);
  }
  for (const [name, contents] of Object.entries(drawables())) {
    files[`res/drawable/${name}`] = contents;
  }

  return files;
}

function withHomeWidgetFiles(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const main = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main');
      for (const [relativePath, contents] of Object.entries(widgetResources())) {
        writeFile(path.join(main, ...relativePath.split('/')), contents);
      }
      return config;
    },
  ]);
}

/**
 * Writes the family's receivers onto whatever `<application>` prebuild produced.
 *
 * Exported so a test can hand it a stale manifest. Being right about an empty
 * one proves nothing: prebuild merges rather than rewrites, so the manifest
 * this runs against is usually the last build's.
 */
function applyWidgetReceivers(application) {
  const wanted = PROVIDERS.map((provider) => `.${provider.className}`);

  // Prune first. `expo prebuild` merges into an existing manifest rather than
  // rewriting it, so a receiver this plugin used to add stays behind after it
  // is removed here — pointing at an @xml resource that no longer exists,
  // which fails resource linking. Dropping a widget has to be as easy as
  // adding one.
  application.receiver = (application.receiver ?? []).filter((entry) => {
    const name = entry.$?.['android:name'] ?? '';
    const isWidgetReceiver = /WidgetProvider$/.test(name);
    return !isWidgetReceiver || wanted.includes(name);
  });

  for (const provider of PROVIDERS) {
    const name = `.${provider.className}`;
    const attributes = {
      'android:name': name,
      // The launcher is a different app, so the receiver has to be exported
      // for it to deliver APPWIDGET_UPDATE at all.
      'android:exported': 'true',
      // What the widget picker calls this one.
      'android:label': `@string/${provider.label}`,
    };
    const intentFilter = [
      {
        action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
      },
    ];
    const metaData = [
      {
        $: {
          'android:name': 'android.appwidget.provider',
          'android:resource': `@xml/${provider.infoFile}`,
        },
      },
    ];

    // Patch rather than skip. A tree prebuilt before this plugin grew labels
    // already has the receiver, and left alone it keeps the attributes it was
    // written with — a picker row with no name of its own. Same reason the
    // prune above exists: what ends up in the manifest has to be what this
    // file says, not what happened to be there first.
    const existing = application.receiver.find((entry) => entry.$?.['android:name'] === name);
    if (existing) {
      existing.$ = { ...existing.$, ...attributes };
      existing['intent-filter'] = intentFilter;
      existing['meta-data'] = metaData;
      continue;
    }

    application.receiver.push({
      $: attributes,
      'intent-filter': intentFilter,
      'meta-data': metaData,
    });
  }

  return application;
}

function withHomeWidgetReceivers(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      applyWidgetReceivers(application);
    }
    return config;
  });
}

module.exports = function withHomeWidget(config) {
  return withHomeWidgetReceivers(withHomeWidgetFiles(config));
};

// Exported so a test can cross-check the generated XML against the Kotlin that
// references it, which is cheaper than a 10-minute native build.
module.exports.widgetResources = widgetResources;
module.exports.applyWidgetReceivers = applyWidgetReceivers;
module.exports.PROVIDERS = PROVIDERS;
module.exports.PACKAGE = PACKAGE;
