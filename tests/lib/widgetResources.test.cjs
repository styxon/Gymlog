const assert = require('node:assert/strict');

/**
 * Cross-checks the widget's generated native side against itself.
 *
 * The widget is the one part of this repo whose real verification costs a
 * prebuild, a Gradle build, an install and a hand-placed widget — about ten
 * minutes per attempt, on a device, because Android will not let anything force
 * a widget to redraw. A missing `R.id.` or a drawable that no longer exists is
 * a compile error found at the end of that ten minutes. This finds it in
 * milliseconds instead.
 *
 * It cannot tell you the layout looks right. That still needs the device.
 */
const { widgetResources, applyWidgetReceivers, PROVIDERS } = require('../../plugins/withHomeWidget.js');
const {
  HOME_WIDGET_PAYLOAD_VERSION,
  HOME_WIDGET_MONTH_ROWS,
} = require('../../src/lib/widgetPayload');
const { WIDGET_LINK_PREFIX } = require('../../src/lib/widgetDeepLink');

const FILES = widgetResources();
const paths = Object.keys(FILES);
const DAY_COUNT = 7;
const CELL_COUNT = HOME_WIDGET_MONTH_ROWS * DAY_COUNT;

function pathsIn(prefix, suffix = '.xml') {
  return paths.filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix));
}

function basename(entry) {
  return entry.slice(entry.lastIndexOf('/') + 1).replace(/\.xml$/, '');
}

const layoutPaths = pathsIn('res/layout/');
const realLayouts = layoutPaths.filter((entry) => !entry.includes('_preview'));
const previewLayouts = layoutPaths.filter((entry) => entry.includes('_preview'));
const calendarLayouts = ['res/layout/home_widget_calendar.xml', 'res/layout/home_widget_stats.xml'];
const kotlinPaths = paths.filter((entry) => entry.endsWith('.kt'));
const kotlin = kotlinPaths.map((entry) => FILES[entry]).join('\n');

const drawableNames = new Set(pathsIn('res/drawable/').map(basename));
const layoutNames = new Set(layoutPaths.map(basename));
const definedIds = new Set();
for (const entry of realLayouts) {
  for (const match of FILES[entry].matchAll(/@\+id\/([a-z0-9_]+)/g)) {
    definedIds.add(match[1]);
  }
}

function stringNames(xml) {
  return new Set([...xml.matchAll(/<string name="([a-z0-9_]+)">/g)].map((match) => match[1]));
}
const enStrings = stringNames(FILES['res/values/widget_strings.xml']);
const fiStrings = stringNames(FILES['res/values-fi/widget_strings.xml']);

/** name -> value, for the few strings the widget owns outright. */
function stringValues(xml) {
  return new Map(
    [...xml.matchAll(/<string name="([a-z0-9_]+)">([\s\S]*?)<\/string>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}
const enText = stringValues(FILES['res/values/widget_strings.xml']);
const fiText = stringValues(FILES['res/values-fi/widget_strings.xml']);

module.exports = [
  {
    name: 'widgetResources: every R.* the Kotlin names exists as a resource',
    run() {
      const missing = [];
      for (const [, kind, name] of kotlin.matchAll(/R\.(drawable|layout|id|string)\.([a-z0-9_]+)/g)) {
        const known =
          kind === 'drawable'
            ? drawableNames.has(name)
            : kind === 'layout'
              ? layoutNames.has(name)
              : kind === 'id'
                ? definedIds.has(name)
                : enStrings.has(name);
        if (!known) {
          missing.push(`R.${kind}.${name}`);
        }
      }
      assert.deepEqual(missing, [], `Kotlin references resources that are not generated: ${missing.join(', ')}`);
    },
  },
  {
    name: 'widgetResources: every drawable and string a layout names exists',
    run() {
      const missing = [];
      for (const entry of layoutPaths) {
        for (const [, name] of FILES[entry].matchAll(/@drawable\/([a-z0-9_]+)/g)) {
          if (!drawableNames.has(name)) {
            missing.push(`${entry} → @drawable/${name}`);
          }
        }
        for (const [, name] of FILES[entry].matchAll(/@string\/([a-z0-9_]+)/g)) {
          if (!enStrings.has(name)) {
            missing.push(`${entry} → @string/${name}`);
          }
        }
      }
      assert.deepEqual(missing, []);
    },
  },
  {
    name: 'widgetResources: previews borrow ids rather than defining them twice',
    run() {
      // Two layouts may not both define the same id, and the previews are
      // deliberately the same layouts with the text filled in.
      for (const entry of previewLayouts) {
        assert.ok(!FILES[entry].includes('@+id/'), `${entry} defines ids instead of referencing them`);
        for (const [, name] of FILES[entry].matchAll(/@id\/([a-z0-9_]+)/g)) {
          assert.ok(definedIds.has(name), `${entry} references @id/${name}, which no layout defines`);
        }
      }
    },
  },
  {
    name: 'widgetResources: the previews are not blank, which is the bug they fix',
    run() {
      // The picker used to show the app icon because previewImage was the app
      // icon. A preview layout whose text is empty would be worse.
      for (const entry of previewLayouts) {
        // Only what the picker actually shows. A layout carries the slot for
        // every state, and the ones this preview does not use are hidden — as
        // are the days either side of the month, which have no number.
        const texts = FILES[entry]
          .split('<TextView')
          .slice(1)
          .filter((element) => !element.includes('android:visibility="gone"'))
          .map((element) => element.match(/android:text="([^"]*)"/)?.[1] ?? '');
        const filled = texts.filter((text) => text.length > 0);
        assert.ok(filled.length > 0, `${entry} has no text at all`);
        // Every visible word is a resource, so the picker speaks the phone's
        // language rather than whatever was hardcoded here. Date numbers are
        // the exception: they are the same in every language.
        assert.ok(
          filled.every((text) => text.startsWith('@string/') || /^\d{1,2}$/.test(text)),
          `${entry} hardcodes copy instead of using @string/`,
        );
      }
    },
  },
  {
    name: 'widgetResources: the calendar previews show more than one state',
    run() {
      // A preview where every date is unmarked teaches nothing about what the
      // widget does. Trained, planned and free, plus today.
      for (const entry of previewLayouts.filter((name) => !name.includes('streak') && !name.includes('routine'))) {
        const pips = new Set([...FILES[entry].matchAll(/@drawable\/(widget_pip_[a-z0-9_]+)/g)].map((m) => m[1]));
        assert.ok(pips.size >= 4, `${entry} previews only ${pips.size} date state(s)`);
        assert.ok([...pips].some((name) => name.includes('_today')), `${entry} never shows today`);
        assert.ok([...pips].some((name) => name.startsWith('widget_pip_done')), `${entry} shows nothing trained`);
        assert.ok([...pips].some((name) => name.startsWith('widget_pip_plan')), `${entry} shows nothing planned`);
      }
    },
  },
  {
    name: 'widgetResources: four layouts, four receivers, one preview each',
    run() {
      assert.deepEqual(
        realLayouts.map(basename).sort(),
        ['home_widget_calendar', 'home_widget_routine', 'home_widget_stats', 'home_widget_streak'],
      );
      assert.equal(PROVIDERS.length, 4);

      for (const provider of PROVIDERS) {
        const info = FILES[`res/xml/${provider.infoFile}.xml`];
        assert.ok(info, `${provider.infoFile}.xml is not generated`);
        // The fix for "the picker only shows the logo".
        assert.match(info, /android:previewLayout="@layout\/[a-z0-9_]+"/);
        assert.ok(enStrings.has(provider.label), `${provider.label} is missing from strings.xml`);
        // The 4×2 has none since 2026-10-16: its line said nothing the preview does not.
        if (provider.description) {
          assert.ok(enStrings.has(provider.description), `${provider.description} is missing from strings.xml`);
          assert.match(info, /android:description="@string\//);
        } else {
          assert.doesNotMatch(info, /android:description=/);
        }
        assert.ok(kotlin.includes(`class ${provider.className}`), `${provider.className} has no Kotlin class`);
      }

      // Every receiver gets its own name and its own preview, or the rows in the
      // picker are indistinguishable.
      assert.equal(new Set(PROVIDERS.map((provider) => provider.label)).size, PROVIDERS.length);
      assert.equal(new Set(PROVIDERS.map((provider) => provider.info.preview)).size, PROVIDERS.length);
      assert.equal(previewLayouts.length, PROVIDERS.length);
    },
  },
  {
    name: 'widgetResources: the two widgets already on home screens keep their class names',
    run() {
      // Renaming either would orphan every widget a user has already added —
      // whatever it draws now.
      assert.ok(PROVIDERS.some((provider) => provider.className === 'HomeWidgetProvider'));
      assert.ok(PROVIDERS.some((provider) => provider.className === 'WeekWidgetProvider'));
      assert.ok(kotlin.includes('open class HomeWidgetProvider : AppWidgetProvider()'));
    },
  },
  {
    name: 'widgetResources: both palettes exist for every date state, today included',
    run() {
      for (const theme of ['light', 'dark']) {
        assert.ok(drawableNames.has(`widget_card_${theme}`));
        for (const state of ['done', 'plan', 'off', 'pad']) {
          assert.ok(drawableNames.has(`widget_pip_${state}_${theme}`), `pip missing: ${state}/${theme}`);
          assert.ok(drawableNames.has(`widget_pip_${state}_today_${theme}`), `today pip missing: ${state}/${theme}`);
        }
      }
      // Two cards, two textures, eight pips per theme, and one copy each of
      // the two marks: an image is tinted at runtime rather than written out
      // twice. Eight, not six — rest carries the green tint now, so padding
      // needed its own truly-empty state (2026-08-25).
      assert.equal(drawableNames.size, 22);
      assert.ok(drawableNames.has('widget_logo'));
      assert.ok(drawableNames.has('widget_arrow'));
      assert.ok(kotlin.includes('"setColorFilter"'), 'the marks are never tinted, so one theme draws the other’s');
    },
  },
  {
    name: 'widgetResources: a date is either today or it is not, and it shows',
    run() {
      // Today is drawn on its own axis — a ring — so a day can be today *and*
      // trained. The one state with a ring of its own is `plan`: the outline
      // IS how a planned day is marked, and today swaps it for the ink ring.
      // Padding stays bare both ways — a cell from the neighbouring month has
      // nothing to announce.
      const fill = (xml) => xml.match(/<solid android:color="(#[0-9A-Fa-f]{6,8})"/)[1];
      for (const theme of ['light', 'dark']) {
        for (const state of ['done', 'plan', 'off', 'pad']) {
          const plain = FILES[`res/drawable/widget_pip_${state}_${theme}.xml`];
          const today = FILES[`res/drawable/widget_pip_${state}_today_${theme}.xml`];
          if (state === 'plan') {
            assert.match(plain, /<stroke android:width="[\d.]+dp"/, `${theme}: a planned day has no outline`);
          } else {
            assert.ok(!plain.includes('<stroke'), `${state}/${theme} rings a day that is not today`);
          }
          if (state === 'pad') {
            assert.ok(!today.includes('<stroke'), `${theme}: the ring landed on a cell outside the month`);
          } else {
            assert.match(today, /<stroke android:width="[\d.]+dp"/, `${state}/${theme} does not mark today`);
          }
          // Same fill either way: the ring is added, it does not replace.
          assert.equal(fill(plain), fill(today));
        }
      }
    },
  },
  {
    name: 'widgetResources: training days carry the highlight, everything else is quiet',
    run() {
      // A trained day is the solid highlight, a planned day the same colour as
      // an outline. Rest and padding draw as nothing — the green rest tint was
      // tried on every cell and read as too colourful on a real launcher
      // (user 2026-08-25 evening), so the marks alone carry the message.
      for (const theme of ['light', 'dark']) {
        // The card fill carries alpha; the pills do not. Compare the RGB only.
        const rgb = (value) => `#${value.slice(-6).toUpperCase()}`;
        const pip = (state) => FILES[`res/drawable/widget_pip_${state}_${theme}.xml`];
        const fillOf = (state) => pip(state).match(/<solid android:color="(#[0-9A-Fa-f]{6,8})"/)[1];
        const card = rgb(FILES[`res/drawable/widget_card_${theme}.xml`].match(/<solid android:color="(#[0-9A-Fa-f]{6,8})"/)[1]);

        // Planned wears the trained colour as a ring over an empty fill: one
        // colour means training day, filled means it happened.
        const done = rgb(fillOf('done'));
        assert.notEqual(done, card, `${theme}: the trained mark vanishes into the card`);
        assert.equal(fillOf('plan').toUpperCase(), '#00000000', `${theme}: a planned day is filled in`);
        assert.equal(rgb(pip('plan').match(/<stroke[^>]*android:color="(#[0-9A-Fa-f]{6,8})"/)[1]), done, `${theme}: planned and trained disagree on the training colour`);

        // Free days and padding are drawn as nothing rather than as a tint: a
        // month of coloured pills reads as a month of marks.
        assert.equal(fillOf('off').toUpperCase(), '#00000000', `${theme}: a free day is painted`);
        assert.equal(fillOf('pad').toUpperCase(), '#00000000', `${theme}: a padding cell is painted`);
      }
    },
  },
  {
    name: 'widgetResources: the card is fill, texture, wash — in that order',
    run() {
      // The texture has to sit on the fill and under the wash, or the fade
      // fades nothing and the contour lines run edge to edge.
      for (const theme of ['light', 'dark']) {
        const card = FILES[`res/drawable/widget_card_${theme}.xml`];
        assert.match(card, /^<\?xml[^>]*\?>\s*<layer-list/, `${theme} card is not layered`);
        const order = [...card.matchAll(/<(solid|item android:drawable|gradient)/g)].map((match) => match[1]);
        assert.deepEqual(order, ['solid', 'item android:drawable', 'gradient'], `${theme}: wrong layer order`);
        assert.ok(card.includes(`@drawable/widget_texture_${theme}`));

        // The wash ends in the card's own colour. Anything else shifts the
        // card's tone as it fades, which is a different bug every time.
        const rgb = (value) => value.slice(-6).toUpperCase();
        const fill = card.match(/<solid android:color="(#[0-9A-Fa-f]{8})"/)[1];
        const end = card.match(/android:endColor="(#[0-9A-Fa-f]{8})"/)[1];
        assert.equal(rgb(end), rgb(fill), `${theme}: the wash fades to a colour the card is not`);
        // Violet at the top-right, the card at the bottom-left: 225° is the
        // axis that runs between those two corners.
        assert.equal(card.match(/android:angle="(\d+)"/)[1], '225');
        assert.ok(parseInt(card.match(/android:startColor="#([0-9A-Fa-f]{2})/)[1], 16) < 0x40, `${theme}: the tint is not a tint`);
      }
    },
  },
  {
    name: 'widgetResources: the texture is clipped inside the card it sits on',
    run() {
      // A vector stretched to a wide card stretches its corners with it, so the
      // clip's radius is larger than the card's 20dp on purpose: it has to stay
      // inside the card's own corner at every aspect ratio a launcher hands out.
      for (const theme of ['light', 'dark']) {
        const texture = FILES[`res/drawable/widget_texture_${theme}.xml`];
        assert.match(texture, /<clip-path android:pathData="M30,0/, `${theme} texture is unclipped`);
        const rings = (texture.match(/<path/g) ?? []).length;
        assert.ok(rings > 20, `${theme} texture has only ${rings} contour lines`);
        // Lines, not fills: a filled ring would be a disc over the whole card.
        assert.equal((texture.match(/android:fillColor="#00000000"/g) ?? []).length, rings);
        const alpha = parseInt(texture.match(/android:strokeColor="#([0-9A-Fa-f]{2})/)[1], 16);
        assert.ok(alpha < 0x50, `${theme} contour lines are a pattern, not a texture (alpha ${alpha})`);
      }
    },
  },
  {
    name: 'widgetResources: the card is opaque, because the text cannot afford otherwise',
    run() {
      // A translucent card composites the wallpaper into itself. Measured worst
      // case — a pale wallpaper under the dark palette — put the 9sp faint label
      // at a contrast ratio of 1.59 against WCAG's 3.0 floor for large text.
      // Opaque, that pair is 3.59, which is the app's own dark-theme floor.
      for (const theme of ['light', 'dark']) {
        const fill = FILES[`res/drawable/widget_card_${theme}.xml`].match(/<solid android:color="(#[0-9A-Fa-f]{6,8})"/)[1];
        assert.equal(fill.length, 9, `${theme} card fill should state its alpha`);
        assert.equal(
          parseInt(fill.slice(1, 3), 16),
          0xff,
          `${theme} card is translucent again — re-measure the faint label before trusting it`,
        );
      }
    },
  },
  {
    name: 'widgetResources: the month is a whole month, in both sizes',
    run() {
      // Six rows because a month can need six, and RemoteViews cannot add one.
      for (const entry of calendarLayouts) {
        const xml = FILES[entry];
        assert.ok(xml.includes('@+id/widget_month"'), `${entry} has no month heading`);
        for (let index = 0; index < DAY_COUNT; index += 1) {
          assert.ok(xml.includes(`@+id/widget_axis_${index}"`), `${entry} is missing widget_axis_${index}`);
        }
        for (let row = 0; row < HOME_WIDGET_MONTH_ROWS; row += 1) {
          assert.ok(xml.includes(`@+id/widget_row_${row}"`), `${entry} is missing widget_row_${row}`);
        }
        for (let cell = 0; cell < CELL_COUNT; cell += 1) {
          assert.ok(xml.includes(`@+id/widget_cell_${cell}"`), `${entry} is missing widget_cell_${cell}`);
        }
      }
      // And the provider can hide the rows a shorter month does not use.
      assert.ok(kotlin.includes('rowIds'), 'the provider never touches the week rows');
      assert.match(kotlin, /setViewVisibility\(rowIds\[rowIndex\]/);
    },
  },
  {
    name: 'widgetResources: the figures live only where there is room for them',
    run() {
      // Three of them, and only on the 4×2 — the 2×2 is the month alone, which
      // is the whole difference between the two calendars.
      const stats = FILES['res/layout/home_widget_stats.xml'];
      for (let index = 0; index < 3; index += 1) {
        assert.ok(stats.includes(`@+id/widget_stat_value_${index}"`));
        assert.ok(stats.includes(`@+id/widget_stat_label_${index}"`));
      }
      assert.ok(!FILES['res/layout/home_widget_calendar.xml'].includes('widget_stat_value_0'));
      // A figure is bigger than its caption, or the caption is the anchor.
      const sizeAfter = (id) =>
        Number(stats.slice(stats.indexOf(`@+id/${id}"`)).match(/android:textSize="([\d.]+)sp"/)[1]);
      assert.ok(sizeAfter('widget_stat_value_0') > sizeAfter('widget_stat_label_0'));
    },
  },
  {
    name: 'widgetResources: the 4×2 gives the month the room, and its edges some air',
    run() {
      // User 2026-09-14: the grid ran to 11dp from the card's left edge while
      // three short figures kept 40% of the width. The month is what the card is
      // for; the figures get the smaller share and a step-down size.
      for (const entry of ['res/layout/home_widget_stats.xml', 'res/layout/home_widget_stats_preview.xml']) {
        const xml = FILES[entry];
        const shares = [...xml.matchAll(/android:layout_weight="(\d+)"/g)].map((m) => Number(m[1])).filter((w) => w > 1);
        assert.equal(shares.length, 2, `${entry}: one share for the month, one for the figures`);
        const [month, figures] = shares;
        // Strictly more than the old 3:2, which is exactly 0.6 (PR review).
        assert.ok(month / (month + figures) > 0.6, `${entry}: the month takes more than the old 60% (${month}:${figures})`);

        const dp = (attr) => Number(xml.match(new RegExp(`android:${attr}="(\\d+)dp"`))[1]);
        assert.ok(dp('paddingStart') > dp('paddingTop'), `${entry}: the sides breathe more than top and bottom`);
        assert.equal(dp('paddingStart'), dp('paddingEnd'), `${entry}: both sides alike`);

        // Small enough that "12 h 30 min" fits the narrower column unellipsized.
        const value = Number(xml.slice(xml.indexOf('widget_stat_value_0"')).match(/android:textSize="([\d.]+)sp"/)[1]);
        assert.ok(value <= 14, `${entry}: figures at most 14sp (${value})`);
      }
      // The 2×2 has no figures to make room for and keeps its even padding.
      assert.match(FILES['res/layout/home_widget_calendar.xml'], /android:padding="12dp"/);
    },
  },
  {
    name: 'widgetResources: every layout carries the ids the provider always touches',
    run() {
      // The background, the body and the line that replaces it before the app
      // has ever run. A layout missing one of them draws a stale card.
      for (const entry of realLayouts) {
        for (const id of ['widget_root', 'widget_prompt', 'widget_body']) {
          assert.ok(FILES[entry].includes(`@+id/${id}"`), `${entry} is missing ${id}`);
        }
      }

      // The mark is on every card that has room for it. The 2×1 routine card
      // does not: measured on a phone, it has about 127dp of usable width, the
      // arrow takes 34, and the session name came out as "Kyykky & S…". The
      // arrow is the affordance and the mark is decoration, so the mark went.
      const marked = realLayouts.filter((entry) => FILES[entry].includes('@+id/widget_logo"'));
      assert.deepEqual(
        realLayouts.filter((entry) => !marked.includes(entry)),
        ['res/layout/home_widget_routine.xml'],
      );
      // And the provider must not paint a mark that is not there. It tints by
      // id, and an id no layout defines is a silently dropped action.
      assert.ok(kotlin.includes('R.id.widget_logo'), 'nothing tints the mark any more');
    },
  },
  {
    name: 'widgetResources: the two small widgets keep what they are when stretched',
    run() {
      // The size ladder is for the calendars. A streak stretched across four
      // cells is still a streak, and a reader who picked it did not ask for a
      // month.
      for (const className of ['StreakWidgetProvider', 'RoutineWidgetProvider']) {
        const source = FILES[`java/app/vinha/${className}.kt`];
        assert.ok(source, `${className} is not generated`);
        assert.match(
          source,
          /override fun layoutFor\(width: Int, height: Int\): Int = R\.layout\.home_widget_(streak|routine)/,
          `${className} can be resized into a calendar`,
        );
      }
      // The calendars do use the ladder, and narrow means the month alone.
      const ladder = kotlin.slice(kotlin.indexOf('protected open fun layoutFor'));
      const body = ladder.slice(0, ladder.indexOf('}'));
      assert.ok(body.includes('home_widget_calendar'));
      assert.ok(body.includes('home_widget_stats'));
    },
  },
  {
    name: 'widgetResources: the app can reach every receiver it declares',
    run() {
      // The plugin declares the receivers; the native module is what asks them
      // to redraw after a workout and what answers "do you already have one".
      // A receiver missing from that list still works — it just shows whatever
      // it drew up to half an hour ago, which is the bug that is hardest to see.
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(
        path.join(__dirname, '../../modules/home-widget/android/src/main/java/expo/modules/homewidget/HomeWidgetModule.kt'),
        'utf8',
      );
      const listed = [...source.matchAll(/"([A-Za-z]+WidgetProvider)"/g)].map((match) => match[1]);
      assert.deepEqual(
        [...new Set(listed)].sort(),
        PROVIDERS.map((provider) => provider.className).sort(),
        'the native module and the plugin disagree about which widgets exist',
      );
    },
  },
  {
    name: 'widgetResources: the payload contract matches on both sides of the process boundary',
    run() {
      // Nothing can import TypeScript into a launcher process, so these numbers
      // are copies. A mismatch means the widget silently ignores every payload
      // the app writes.
      assert.ok(kotlin.includes(`PAYLOAD_VERSION = ${HOME_WIDGET_PAYLOAD_VERSION}`));
      assert.ok(kotlin.includes(`MONTH_ROWS = ${HOME_WIDGET_MONTH_ROWS}`));
      assert.ok(kotlin.includes('DAY_COUNT = 7'));
      assert.ok(kotlin.includes('PAYLOAD_FILE = "vinha-widget.json"'));

      // Every field the payload carries is read by name on the other side.
      for (const field of [
        'monthLabel',
        'weekdayLabels',
        'monthWeeks',
        'stats',
        'totalValue',
        'totalLabel',
        'routineDays',
        'when',
        'title',
        'target',
        'dateLabel',
        'dateKey',
        'inMonth',
        'state',
        'theme',
      ]) {
        assert.ok(kotlin.includes(`"${field}"`), `the provider never reads ${field}`);
      }

      // And the two questions the payload is no longer allowed to answer. A
      // file written yesterday cannot know what day it is being read on: the
      // launcher has the clock, so the launcher decides.
      assert.ok(!kotlin.includes('"isToday"'), 'the provider still trusts the payload about today');
      assert.match(kotlin, /fun todayKey\(\)/, 'the provider never asks the device for the date');
      // Matched by date, not by weekday. A weekday is only an address for a
      // rhythm with a period of seven, and two-on-one-off does not have one.
      assert.ok(!kotlin.includes('mondayFirstWeekday'), 'the provider still indexes the routine by weekday');
      assert.match(kotlin, /fun findToday\(days: JSONArray\?\)/, 'the provider never looks today up by date');

      // And the link prefix the widget builds has to be the one the app parses.
      assert.ok(
        kotlin.includes(`LINK_PREFIX = "${WIDGET_LINK_PREFIX}"`),
        `Kotlin does not build ${WIDGET_LINK_PREFIX}`,
      );
    },
  },
  {
    name: 'widgetResources: every key is translated, and the copy the widget owns is small',
    run() {
      assert.deepEqual([...fiStrings].sort(), [...enStrings].sort());
      // The widget owns copy only where no payload can reach it: the picker,
      // a fresh install, and the four static previews. Everything else arrives
      // pre-translated. Four widgets is four picker rows and four previews, so
      // the cap is higher than the two-widget family's was — it is still a cap.
      assert.ok(enStrings.has('widget_setup'));
      assert.ok(enStrings.has('widget_setup_short'));
      // And the one thing that copy must never do: claim a fact about the
      // reader's data. A missing payload means the app has not run since it was
      // installed or updated — after a version bump it told a reader with six
      // programmes to go and make one. Opening the app is true either way.
      for (const key of ['widget_setup', 'widget_setup_short']) {
        for (const [language, strings] of [['en', enText], ['fi', fiText]]) {
          const value = strings.get(key) ?? '';
          assert.doesNotMatch(value, /program|ohjelma/i, `${key} (${language}) claims something it cannot know`);
        }
      }
      assert.ok(enStrings.size <= 30, `the widget owns ${enStrings.size} strings — that is a translation surface`);
    },
  },
  {
    name: 'widgetResources: an axis letter or a date can never wrap',
    run() {
      // Found on a device: a 2×2 column is about 25dp wide, and Android breaks
      // a word that does not fit across lines, so "MON" rendered as three
      // stacked letters. Every label that lives in a seven-column row is pinned
      // to one line and given the whole column to sit in.
      for (const entry of layoutPaths) {
        const elements = FILES[entry].split('<TextView').slice(1);
        for (const element of elements) {
          const id = element.match(/android:id="@\+?id\/([a-z0-9_]+)"/)?.[1];
          if (!id || !/^widget_(axis|cell)_\d+$/.test(id)) {
            continue;
          }
          assert.match(element, /android:maxLines="1"/, `${entry} → ${id} may wrap`);
          assert.ok(
            !/android:layout_width="wrap_content"/.test(element),
            `${entry} → ${id} is only as wide as its text, so the column's padding squeezes it`,
          );
        }
      }
    },
  },
  {
    name: 'widgetResources: every generated XML file is well-formed',
    run() {
      // Not pedantry: the layouts are built by string concatenation, and the
      // failure this catches is a duplicate attribute — which aapt rejects, ten
      // minutes into a native build. xml2js comes in with @expo/config-plugins,
      // which this plugin already depends on.
      const xml2js = require('xml2js');
      const parser = new xml2js.Parser();
      for (const entry of paths.filter((name) => name.endsWith('.xml'))) {
        let error = null;
        // Synchronous when the parser has no async option set.
        parser.parseString(FILES[entry], (parseError) => {
          error = parseError;
        });
        assert.equal(error, null, `${entry} is not well-formed XML: ${error && error.message}`);
      }
    },
  },
  {
    name: 'widgetResources: an attribute past the closing bracket is not an attribute',
    run() {
      // Well-formed is not the same as correct. `...dp">${margin}${pad}` parses
      // cleanly and reads right, but everything after the `>` is character
      // data: aapt2 drops it without a word, and the dates lose the gap between
      // them.
      for (const entry of layoutPaths) {
        assert.ok(
          !/>\s*android:/.test(FILES[entry]),
          `${entry} carries android: attributes as text, which never reach the layout`,
        );
      }
      // And the spacing that goes through that path is really in the file.
      const calendar = FILES['res/layout/home_widget_calendar.xml'];
      assert.match(calendar, /android:paddingStart="[\d.]+dp"/);
      assert.match(calendar, /android:layout_marginTop="[\d.]+dp"/);
    },
  },
  {
    name: 'widgetResources: a manifest built by an older version is brought up to date',
    run() {
      // prebuild merges into the manifest already there, so the interesting
      // case is not the empty one. A tree from before the family had labels
      // still carries the receiver, and skipping it left the picker showing
      // rows with nothing but the app's name on them.
      const application = {
        receiver: [
          { $: { 'android:name': '.HomeWidgetProvider', 'android:exported': 'true' } },
          { $: { 'android:name': '.RetiredWidgetProvider', 'android:exported': 'true' } },
        ],
      };

      applyWidgetReceivers(application);

      const names = application.receiver.map((entry) => entry.$['android:name']);
      assert.deepEqual(names.sort(), PROVIDERS.map((provider) => `.${provider.className}`).sort());
      for (const provider of PROVIDERS) {
        const entry = application.receiver.find((item) => item.$['android:name'] === `.${provider.className}`);
        assert.equal(entry.$['android:label'], `@string/${provider.label}`);
        assert.equal(entry['meta-data'][0].$['android:resource'], `@xml/${provider.infoFile}`);
      }
      // Every row answers to its own name, which is the whole point of a label.
      assert.equal(new Set(application.receiver.map((entry) => entry.$['android:label'])).size, PROVIDERS.length);

      // Running twice is running once — prebuild does.
      applyWidgetReceivers(application);
      assert.equal(application.receiver.length, PROVIDERS.length);
    },
  },
  {
    name: 'widgetResources: nothing the design cut has come back',
    run() {
      const everything = paths.join('\n') + kotlin + layoutPaths.map((entry) => FILES[entry]).join('\n');
      // The bar strip and its one big number, which the month replaced, plus
      // the elements cut before that.
      // 'gradient' was on this list until the design asked for the contour
      // card, whose whole colour is one — so the guard now names the ids the
      // month replaced, and the elements cut before them.
      for (const gone of [
        'widget_bar',
        'widget_tall',
        'widget_day_label',
        'widget_prev_',
        'widget_hero',
        'widget_count',
        'widget_meta',
        'widget_cta',
        'widget_pill',
        'widget_play',
        'widget_mark',
      ]) {
        assert.ok(!everything.includes(gone), `${gone} is still in the generated widget`);
      }
    },
  },
  {
    // Found on a phone 2026-08-23: every APK built since 17.8. showed "Tee
    // ohjelma" in the widget. The plugin had moved the payload version to 9
    // over several commits; the generated Kotlin in android/ still said 4 and
    // rejected every payload the app wrote. android/ is not in git, so only a
    // local check can see it — and this is exactly where a stale prebuild
    // shows up first.
    name: 'widgetResources: the generated Kotlin in android/ is not behind the plugin (run prebuild)',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const generated = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'app', 'vinha', 'HomeWidgetProvider.kt');
      if (!fs.existsSync(generated)) {
        return; // no native directory here (CI, fresh clone) — nothing to compare
      }
      const kotlin = fs.readFileSync(generated, 'utf8');
      const match = kotlin.match(/PAYLOAD_VERSION = (\d+)/);
      assert.ok(match, 'generated HomeWidgetProvider.kt has no PAYLOAD_VERSION');
      assert.equal(
        Number(match[1]),
        HOME_WIDGET_PAYLOAD_VERSION,
        `android/ was generated for widget payload v${match[1]} but the app writes v${HOME_WIDGET_PAYLOAD_VERSION}. `
          + 'Every widget on every phone shows the empty state until you run: '
          + 'npx expo prebuild --platform android --clean (then restore android/local.properties).',
      );
    },
  },
];
