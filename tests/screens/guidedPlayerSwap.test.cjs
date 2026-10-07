const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'),
  'utf8',
);
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');

/**
 * Swapping a lift lives behind the set screen's dots menu — and only there.
 *
 * This has moved twice, both times on the user's word. 2026-08-21: "ei
 * tässäkään voi vaihtaa liikettä" — swap buttons grew on the set screen and
 * the rest screen, ungated. 2026-08-23, after a second tester's round: a set
 * screen is for logging reps and weight, so everything else — swap included —
 * goes behind the three dots ("3 pisteen taakse siirtyy kaikki liikkeiden
 * vaihto"), and the rest screen's swap button goes away ("Poista vaihda liike
 * tästä ruudusta"). What must survive the move: the row never hides itself,
 * and the sheet still searches the whole library.
 */
module.exports = [
  {
    name: 'guided swap: reachable from the actions sheet, never gated',
    run() {
      // The sheet's swap row must not hide when the substitution group is
      // empty — an empty group is a reason to search the library.
      assert.doesNotMatch(playerSource, /swapOptions\.length \?/);
      assert.match(playerSource, /label=\{t\(language, 'guided\.action\.swap'\)\}/);
    },
  },
  {
    name: 'guided swap: no dedicated buttons on the set or rest screens',
    run() {
      // The set screen's own controls are pause and the menu; swap rides
      // behind the menu rather than as a fourth button.
      assert.doesNotMatch(playerSource, /onSwapExercise/);
      // The rest screen lost its swap button (2026-08-23); its old label is
      // gone from the app entirely.
      assert.doesNotMatch(playerSource, /'guided\.swap\.action'/);
      assert.doesNotMatch(i18nSource, /'guided\.swap\.action'/);
      // But the actions sheet still resolves the lift a rest belongs to, so
      // swapping mid-rest stays possible through the menu.
      assert.match(
        playerSource,
        /step\.type === 'set' \|\| step\.type === 'position' \|\| step\.type === 'rest'/,
      );
    },
  },
  {
    name: 'guided swap: search, then suggestions, then the whole library',
    run() {
      // The search and the suggestions' heading are the shared sheet's
      // copy now (lib/exerciseSheetMode, #bugs 2026-10-06).
      const modeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'exerciseSheetMode.ts'), 'utf8');
      assert.match(modeSource, /'guided\.swap\.search'/);
      assert.match(modeSource, /'guided\.swap\.suggested'/);
      assert.match(playerSource, /featured=\{\s*swapFeaturedEntries\.length > 0[\s\S]{0,120}exerciseSheetCopy\('swap', language\)\.featuredTitle/);
      assert.match(playerSource, /'guided\.swap\.library'/);
      // The library list is derived and capped: 873 rows inside a sheet is a
      // scroll, not a choice.
      assert.match(playerSource, /const swapLibrary = useMemo/);
      assert.match(playerSource, /\.slice\(0, 25\)/);
      assert.match(playerSource, /\.slice\(0, 40\)/);
      // And an empty search says so rather than drawing nothing.
      assert.match(playerSource, /'guided\.swap\.noMatch'/);
    },
  },
  {
    name: 'guided swap: every new string reads in both languages',
    run() {
      for (const key of [
        'guided.swap.search',
        'guided.swap.suggested',
        'guided.swap.library',
        'guided.swap.noMatch',
      ]) {
        const occurrences = i18nSource.split(`'${key}':`).length - 1;
        assert.equal(occurrences, 2, `${key} is missing one of its two languages`);
      }
    },
  },
  {
    /**
     * The rest runs out into the set.
     *
     * It used to hold at zero, say READY and count how far over you were, and
     * the reader had to press "Aloita sarja" — on the theory that a set screen
     * nobody asked for is worse than an overrun. From the gym, watching the
     * ring reach zero: "sarja 2 pitäis alkaa nyt itsestään mutta ei ala vain
     * tuli valmista ruutu ja tämä on väärin" (user 2026-09-09). So a rest
     * expires like a drill does, the ring says only what is left, and the
     * READY state, the "/ 2:00" total and the start button went with their copy.
     */
    name: 'guided rest: the wait runs out into the set, and says only what is left',
    run() {
      assert.doesNotMatch(playerSource, /restHoldsAtZero|restIsOver/);
      // Expiry advances — the branch every timed step takes.
      assert.match(playerSource, /if \(next <= 0\) \{[\s\S]{0,1200}?expireRef\.current\(\);/);
      // A deadline already in the past is still not handed to the OS.
      assert.match(playerSource, /step\.type === 'rest' && endsAtRef\.current > Date\.now\(\)/);
      // And a rest that now runs out on its own must not run out behind the
      // "fix the set you just logged" sheet, whose edits commit on Save only.
      assert.match(playerSource, /const frozen = guidedClockHeld\(\{[^}]*\brestEditOpen,[^}]*\}\);/);
      for (const key of [
        'guided.rest.of',
        'guided.rest.ready',
        'guided.rest.over',
        'guided.rest.startSet',
        'guided.rest.startSetWeight',
      ]) {
        assert.equal(i18nSource.includes(`'${key}'`), false, `${key} outlived its screen`);
        assert.equal(playerSource.includes(`'${key}'`), false, `${key} is still rendered`);
      }
    },
  },
  {
    /**
     * −15 s takes time away, +15 s adds it, Tauko holds: three same-shaped
     * outlines the reader told apart by reading, mid-set, at arm's length.
     * Colour does it without reading (user 2026-09-09, light theme).
     */
    name: 'guided rest: the three timer controls are red, green and amber',
    run() {
      assert.match(playerSource, /label="−15s"\s+tint=\{theme\.danger\}/);
      // Green and amber in their ink shades since the accessibility audit
      // (2026-09-21): these tints are the words' colour, and the raw accents
      // were 3.30:1 and 3.19:1 as text on white. Still red, green and amber.
      assert.match(playerSource, /label="\+15s"\s+tint=\{theme\.greenInk\}/);
      assert.match(playerSource, /icon=\{paused \? 'play' : 'pause'\}\s+tint=\{theme\.amberInk\}/);
    },
  },
  {
    /**
     * "16,25" had to share its row with two buttons and lost the ",25"; the
     * reps number was squeezed the same way. The reader's sketch (2026-09-09):
     * the number on its own line, −/+ under it, always there, and "tap to
     * type" under those. Both cards type now, not only the weight.
     */
    name: 'guided dial: number above, buttons always below, both cards type',
    run() {
      // The buttons render unconditionally, under the number, above the hint.
      assert.match(
        playerSource,
        // Each button may span lines since a step also clears typed text
        // (CI review of #174); a note may sit above them.
        /<\/Pressable>\s*<View style=\{styles\.setDialControls\}>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<DialButton\s+glyph="−"[\s\S]*?\/>\s*<DialButton\s+glyph="\+"[\s\S]*?\/>\s*<\/View>/,
      );
      assert.doesNotMatch(playerSource, /open \? \(\s*<View style=\{styles\.setDialControls\}>/);
      // The reps card steps and commits through the lib rule, inside the same
      // bounds, as the weight card does — a stepper without a ceiling and a
      // field with one would disagree about the same number.
      assert.match(
        playerSource,
        /: setReps\(\(current\) => stepDialReps\(current, direction, timed \? HOLD_DIAL : REPS_DIAL\)\)/,
      );
      assert.match(
        playerSource,
        /: setReps\(\(current\) => commitDialReps\(text, current, timed \? HOLD_DIAL : REPS_DIAL\)\)/,
      );
      // No "tap to type" line under the buttons: it was in the sketch and
      // struck out on the phone the same day ("napauta ja kirjoita poista nämä").
      assert.doesNotMatch(playerSource, /setDialHint|guided\.dial\.tapToType/);
      assert.equal(i18nSource.includes("'guided.dial.tapToType'"), false);
      // Typing commits on every keystroke: the log button reads the number in
      // the same tick it closes the card, and a commit deferred to blur, to
      // the done key or to an unmount was a typed weight logged as the old one.
      assert.match(playerSource, /onChangeText=\{\(text\) => \{\s*setDraft\(text\);\s*onCommit\(text\);\s*\}\}/);
      assert.doesNotMatch(playerSource, /draftRef|onCommitRef/);
    },
  },
  {
    /**
     * Where you are in the workout is a colour, not a size.
     *
     * The rail gave the current exercise the same purple as the finished ones
     * and told them apart by two pixels of height and twice the width — on a
     * 5px bar, read at arm's length between sets (user 2026-09-01).
     *
     * Amber carried that mark until 2026-09-04, when the session flow started
     * using amber for a body part the reader flagged in setup. Two meanings
     * for one colour in one flow is the problem the size difference was: the
     * rail moved to `highlight` for here and `green` for done, which are the
     * same two colours every other screen of the session uses, and amber is
     * now caution and nothing else.
     */
    name: 'guided player: the rail says here and done in the two colours the session uses',
    run() {
      // The bar no longer shares a branch with `done`.
      assert.doesNotMatch(
        playerSource,
        /done \|\| isCurrent \? \(dark \? GPD\.purple : theme\.purple\)/,
        'the current exercise is the same colour as a finished one again',
      );
      // Here / done / ahead, three states in one expression.
      assert.match(
        playerSource,
        /backgroundColor: isCurrent \? theme\.highlight : done \? theme\.green : theme\.faint/,
      );

      // The multi-set pill is the current exercise too, so it wears the same
      // mark: a `highlight` rim, `highlight` on the set being worked, and
      // green on the sets already logged.
      assert.match(playerSource, /borderColor: theme\.highlight/);
      assert.match(playerSource, /dot === dotIndex\s+\? theme\.highlight/);
      assert.match(playerSource, /dot < dotsDone\s+\? theme\.green/);

      // And amber is gone from the rail entirely — including the dark
      // gradient's own palette, which no longer carries one.
      assert.doesNotMatch(playerSource, /GPD\.amber/, 'the rail palette still has an amber to reach for');
    },
  },
  {
    /**
     * A borrowed "last time" is a different claim from this slot's own.
     *
     * `LastTimeView.borrowed` has existed since 2026-08-29 with a comment
     * asking for it to be said out loud, and `resolveSlotHistory` set it on
     * every view — but neither heading that shows the number read it. So the
     * first time a pump day came round, the heavy day's weight for the same
     * lift sat under "VIIME KERRALLA" as this day's own record, and under
     * "VIIMEKSI" on the walk-up card one step before (#bugs 2026-09-09,
     * "3x20 10kg ei pidä paikkansa ... eri päivä"). The number stays; both
     * headings said where it came from — until the reader, three weeks on,
     * asked for the second line gone (#bugs 2026-09-30). The screen reader
     * still hears it.
     */
    name: 'guided player: a borrowed last time is headed like any other, and said to a screen reader',
    run() {
      // The view still carries the flag...
      assert.match(playerSource, /borrowed: resolved\?\.borrowed \?\? false,/);
      // ...but no visible heading reads it any more: the "ERI PÄIVÄ" second
      // line went on request, on the set card and the walk-up card both
      // (#bugs 2026-09-30, "jätä tuo viimekerralla mutta pois eri päivä").
      assert.match(playerSource, /<Text style=\{styles\.setExerciseLastLabel\}>\{t\(language, 'guided\.card\.lastTime'\)\}<\/Text>/);
      assert.match(playerSource, /<Text style=\{styles\.walkStatLabel\}>\{t\(language, 'guided\.walk\.last'\)\}<\/Text>/);
      assert.doesNotMatch(i18nSource, /'guided\.(?:card\.lastTimeBorrowed|walk\.lastBorrowed)'/);
      // The card's spoken label keeps the distinction.
      assert.match(playerSource, /borrowed: panels\.history\.borrowed === true,/);
      assert.match(i18nSource, /'guided\.a11y\.lastTimeBorrowed': 'Viime kerralla, eri päivänä',/);
      // And the "VIIMEKSI · 27.9." badge under the dials is gone with its key.
      assert.doesNotMatch(playerSource, /guided\.carriedFrom/);
      assert.doesNotMatch(i18nSource, /'guided\.carriedFrom'/);
    },
  },
  {
    /**
     * The rest screen, from the gym: "vähän liikaa kaikkea". The next set's
     * card and the "Seuraava · …" line under the buttons said what the ring
     * already implied, three ways; the logged card cut its own text at one
     * line. What is left: what was logged (name, then numbers), how long is
     * left, three controls, skip (user 2026-09-09).
     */
    name: 'guided rest: what was logged and how long is left, nothing about the set to come',
    run() {
      assert.doesNotMatch(playerSource, /restNextCard|restTargetRow|restChosenKg|restTargetMove/);
      for (const key of ['guided.rest.nextSet', 'guided.rest.target', 'guided.rest.targetHold']) {
        assert.equal(i18nSource.includes(`'${key}'`), false, `${key} outlived its card`);
      }
      // The logged card is gone too ("sarja 1 kirjattu osion voi poistaa ja
      // tuodaan se tähän tämä treenin sisälle"): the sheet says what was
      // logged, and Muokkaa moved into it, on the current lift while resting.
      assert.doesNotMatch(playerSource, /restLoggedCard|restLogged\b|guided\.rest\.logged'/);
      assert.equal(i18nSource.includes("'guided.rest.logged'"), false);
      // Every lift with a logged set gets its own correction, one pencil per
      // lift — a superset's two halves each their own (2026-09-16) — and on
      // every step, not only while resting: the last set of a lift is
      // followed by a walk-up, and a rest-only correction left it with none
      // (#bugs 2026-09-30). See `restRoundCorrections`.
      assert.match(
        playerSource,
        /const correction = restRoundCorrections\(\[member\], exerciseBySlot\)\[0\] \?\? null;/,
      );
      assert.doesNotMatch(playerSource, /roundCorrections|restingLogged/);
      assert.match(
        playerSource,
        /setRunSheetOpen\(false\);\s*setRestEdit\(\{\s*slotId: correction\.lift\.slotId,\s*setIndex: correction\.setIndex,\s*justLoggedSetIndex: justLogged \? correction\.setIndex : -1,\s*\}\);/,
      );
      // "Just logged" only for the round the running rest belongs to.
      assert.match(
        playerSource,
        /const justLogged =\s*correction !== null &&\s*step\.type === 'rest' &&\s*!step\.recoveryKind &&\s*item\.status === 'current';/,
      );
      // And the editor it opens is not a rest-only overlay any more.
      assert.match(playerSource, /\{restEdit \? \(\s*<LoggedSetEditor/);
      assert.doesNotMatch(playerSource, /restEdit && step\.type === 'rest'/);
      // One NextLine left in the file: the drills'. The rest screen's is gone.
      assert.equal((playerSource.match(/<NextLine /g) ?? []).length, 1);
    },
  },
  {
    /**
     * The walk-up's finished-lift card was cut to two lines on 2026-09-09
     * ("max 2 riviä valmis osiolle"), and then asked away altogether: it took
     * the room the swap button needed (#bugs 2026-09-30, "poistetaan tuo mitä
     * on viimeksi tehty se vie liikaa tilaa ... vaihda liike nappi näkyviin").
     */
    name: 'guided walk-up: no finished-lift card, and swapping is a button',
    run() {
      assert.doesNotMatch(playerSource, /walkDone|guided\.walk\.done/);
      assert.equal(i18nSource.includes("'guided.walk.done'"), false);
      assert.match(
        playerSource,
        /<GhostBtn icon="swap" label=\{t\(language, 'guided\.walk\.swap'\)\} onPress=\{\(\) => setSwapOpen\(true\)\} \/>/,
      );
      // The walk-up keeps its "SEURAAVAKSI" ("jätetään tähän seuraavaksi").
      assert.match(playerSource, /\{t\(language, 'guided\.nextUp'\)\}/);
      // Last time on the left, now on the right: then to today, left to
      // right (#bugs 2026-09-30, "Vaihda viimeksi ja nyt paikkaa").
      assert.ok(
        playerSource.indexOf("{t(language, 'guided.walk.last')}") < playerSource.indexOf("{t(language, 'guided.walk.today')}"),
        'the walk-up shows NYT before VIIMEKSI again',
      );
    },
  },
  {
    /**
     * The recovery splash is its title and its list. "Treeni valmis",
     * "SEURAAVAKSI" and "2 venytystä · ~4 min" were three lines about a
     * screen that shows its own contents (user 2026-09-09). The warm-up and
     * workout splashes kept theirs until asked — and were asked (#bugs
     * 2026-09-30, "otetaan seuraavaksi pois").
     */
    name: 'guided splash: no eyebrow on any splash, and the recovery one drops its length',
    run() {
      // The done row ("Lämmittely valmis" between warm-up and workout) is
      // gone from every splash, not only the recovery one (user 2026-09-09).
      assert.doesNotMatch(playerSource, /step\.doneLabel/);
      assert.doesNotMatch(playerSource, /guided\.upNext/);
      assert.equal(i18nSource.includes("'guided.upNext'"), false);
      assert.match(playerSource, /\{step\.phase !== 'cooldown' \? \(\s*<Text[^\n]*\{step\.sub\}<\/Text>\s*\) : null\}/);
    },
  },
  {
    /**
     * Nothing flashes between the last set and the summary. "{title} — valmis"
     * and a spinner were on screen for the length of the save (user
     * 2026-09-09, "tämä valmis ja treeni valmis osion väliin ei saa jäädä
     * mitään mikä välähtää").
     */
    name: 'guided finish: the step that exists for the length of a save says nothing',
    run() {
      assert.match(playerSource, /<StepIn stepKey="finish">\s*<View style=\{\{ flex: 1 \}\} \/>\s*<\/StepIn>/);
      assert.doesNotMatch(playerSource, /finishTitle|ActivityIndicator|guided\.finish\.title|guided\.finish\.saving/);
      for (const key of ['guided.finish.title', 'guided.finish.saving', 'guided.finish.continue']) {
        assert.equal(i18nSource.includes(`'${key}'`), false, `${key} outlived its screen`);
      }
    },
  },
  {
    /**
     * The entry screen, on the way to the rack: the plan, not last week's
     * receipt, and the plan as columns. "VIIME KERRALLA · 44 min · 1 040 kg"
     * is gone; each lift's row is name (wide, two lines), sets, reps, kg or
     * time — in the same place on every row, with a header once for the lifts
     * (user 2026-09-09, "liikaa dataa", "pomppii", "nimeä saa vasemmalle").
     */
    name: 'guided entry: the plan as columns, without last time',
    run() {
      assert.doesNotMatch(playerSource, /guided\.entry\.lastTime'|lastTimeLine|entryLastLabel|buildOverviewScheme/);
      assert.equal(i18nSource.includes("'guided.entry.lastTime'"), false);
      assert.match(playerSource, /\.\.\.buildOverviewColumns\(/);
      // The whole name ("on pakko olla koko tekstit") in two lines at most,
      // the type shrinking past that rather than a third line or a word cut
      // in half (#bugs 2026-09-30, "max 2 riviä"). A drill row spends nothing
      // on the two columns it has no numbers for.
      assert.match(
        playerSource,
        /<Text\s*style=\{styles\.phaseRowName\}\s*numberOfLines=\{2\}\s*adjustsFontSizeToFit\s*minimumFontScale=\{0\.7\}\s*>\s*\{row\.name\}/,
      );
      assert.match(playerSource, /\{row\.sets \|\| row\.reps \? \(/);
      for (const col of ['Sets', 'Reps', 'Load']) {
        assert.match(playerSource, new RegExp(`styles\\.phaseCol, styles\\.phaseCol${col}\\]`), `${col} column`);
      }
      // No box around a block: its border and 15 px of padding a side were
      // the width the names were missing ("laatikointi pois").
      const phaseCard = playerSource.match(/  phaseCard: \{[^}]*\}/)?.[0] ?? '';
      assert.doesNotMatch(phaseCard, /backgroundColor|borderWidth: 1,|paddingHorizontal|borderRadius/);
      assert.match(playerSource, /phaseRowGroup: \{\s*paddingLeft: 4,/);
      // The header row exists once, for the lifts.
      assert.equal((playerSource.match(/styles\.phaseColHead/g) ?? []).length, 3);
      assert.match(playerSource, /\{phase\.key === 'work' \? \(/);
      // The sets column is as wide as the reps one: at 38 "SARJAT" read
      // "SARJA…" on the phone (#bugs 2026-09-22), and both hold a header of
      // the same length and weight.
      const width = (name) => Number(playerSource.match(new RegExp(`${name}: \\{ width: (\\d+) \\}`))?.[1]);
      assert.ok(width('phaseColSets') >= width('phaseColReps'), 'the sets header column is narrower than the reps one');
    },
  },
  {
    /**
     * The paused sheet is two things, both about the lift. "Jatka" was a
     * third, and closing the sheet already resumes (user 2026-09-09).
     */
    name: 'guided pause sheet: swap and skip, no resume button',
    run() {
      assert.doesNotMatch(playerSource, /label=\{t\(language, 'guided\.resume'\)\}\s*color=\{theme\.purple\}/);
      assert.match(playerSource, /label=\{t\(language, 'guided\.action\.swap'\)\}/);
      assert.match(playerSource, /label=\{t\(language, 'guided\.action\.skipExercise'\)\}/);
      // And the third door to the whole session, for the set screen that had none.
      // Out of the pause through `unpause`, which was `setPaused(false)`
      // here: that cleared the screen's pause and left the session clock
      // stopped behind it (live-session audit, 2026-09-20).
      assert.match(
        playerSource,
        /label=\{t\(language, 'guided\.runSheet\.title'\)\}\s*onPress=\{\(\) => \{\s*setPauseSheetOpen\(false\);\s*unpause\(\);\s*setRunSheetOpen\(true\);/,
      );
    },
  },
  {
    /**
     * The whole session, one tap from what was just logged: the run sheet the
     * dot rail opens, opened from a strip under the rest screen's logged card —
     * where the reader asked for it — and saying what has been logged in each
     * lift, not only the session's shape (user 2026-09-09, "paras idea").
     */
    name: 'guided contents: one tap from the rest, and it says what is still to do',
    run() {
      assert.match(playerSource, /style=\{styles\.restRunStrip\}\s*onPress=\{\(\) => setRunSheetOpen\(true\)\}/);
      assert.match(playerSource, /'guided\.runSheet\.progress', \{ done: completedSetCount, count: totalSets \}/);
      // The line under each name is the PLAN, not the log. It carried logged
      // weights from 2026-09-09 until 2026-09-11, when the reader asked for
      // "pelkät tulevat sarjat ja toistot": a sheet opened mid-session is
      // opened to find out what is coming.
      assert.doesNotMatch(playerSource, /const memberLogged/);
      // Not inside a superset: a set count per lift there asks the reader to
      // reconcile "4 × 8" with "3 × 10" inside one box whose real unit is
      // rounds (user 2026-09-11).
      // The plan line is one helper since the walk-up lists the same rows
      // (#bugs 2026-10-06), so the two cannot say different things.
      assert.match(playerSource, /const memberPlan = !isSuperset \? runPlanLine\(member\.slotId\) : '';/);
      assert.match(playerSource, /const runPlanLine = \(slotId: string \| null\): string => \{/);
      // Read off the next set still to do. A swap rewrites only the sets
      // ahead, so the first set of a slot swapped mid-way still carries the
      // old lift's reps and lowered target (review of #202, 2026-09-28).
      assert.match(playerSource, /const planSet = lift \? planSetOf\(lift\.sets\) : undefined;/);
      assert.match(playerSource, /return sets\.find\(\(set\) => set\.status === 'pending'\) \?\? sets\[sets\.length - 1\];/);
      assert.doesNotMatch(playerSource, /formatRepRangeLabel\(exercise\.sets\[0\]\)/);
      assert.equal((playerSource.match(/formatRepRangeLabel\(planSetOf\(exercise\.sets\)\)/g) ?? []).length, 2);
      assert.match(playerSource, /const firstSet = planSetOf\(instance\.sets\);/);
      // Through the shared formatter, so a hold's numbers keep their unit —
      // "45" beside "60 × 8" reads as forty-five reps.
      assert.match(playerSource, /\? formatSetScheme\(\s*lift\.sets\.length,/);
      assert.match(
        playerSource,
        /\{memberPlan \? <Text style=\{styles\.runPlan\}>\{memberPlan\}<\/Text> : null\}/,
      );
      // The right-hand column is down to the one number the rows cannot carry:
      // how many rounds a superset runs. A set count beside "3 × 12" was the
      // same number twice.
      assert.match(playerSource, /\{item\.setCount && item\.members\.length > 1 \? \(/);
      // And every lift in the row is drawn, or a superset would be a row that
      // names one of the two lifts it is about to ask for.
      assert.match(playerSource, /\{item\.members\.map\(\(member\) => \{/);
      assert.equal((i18nSource.match(/'guided\.runSheet\.progress': '[^']+'/g) ?? []).length, 2);
      // A superset's block is counted in rounds — three rounds of A1 + A2
      // under the word "sets" would state neither number — and rounds are now
      // the only thing that column carries, so the set-count key is gone.
      assert.match(playerSource, /t\(language, 'guided\.runSheet\.rounds', \{ count: item\.setCount \}\)/);
      assert.equal((i18nSource.match(/'guided\.runSheet\.rounds': '[^']+'/g) ?? []).length, 2);
      assert.equal(i18nSource.includes("'guided.runSheet.sets'"), false);
    },
  },
  {
    /**
     * The walk-up card is the last thing read before the first set of a block,
     * and for a superset it used to quote the lift's own rest — a pause that
     * never happens, because what follows A1 is A2. It says what does follow.
     */
    name: 'guided walk-up: a lift that runs into the next one quotes no rest',
    run() {
      assert.match(playerSource, /supersetNextBySlot\.get\(step\.slotId\)\s*\?\s*t\(language, 'guided\.walk\.planSuperset'/);
      // Both dictionaries carry it, and neither version mentions a rest.
      const lines = i18nSource.match(/'guided\.walk\.planSuperset': '[^']+'/g) ?? [];
      assert.equal(lines.length, 2);
      for (const line of lines) {
        assert.doesNotMatch(line, /rest|lepo/i, line);
      }
      // The badges the card reads from are the ones the step list agrees with:
      // a lift that is out of the plan is unpaired before any of them is built.
      assert.match(
        playerSource,
        /isGuidedExerciseOut\(exercise\) \? \{ \.\.\.exercise, supersetGroup: null \} : exercise/,
      );
    },
  },
  {
    /**
     * Review of #170. A swap now changes the exercise's tracking mode, so the
     * correction sheet can no longer read the exercise to know whether a
     * logged set had a weight: a squat set corrected after a swap to a
     * bodyweight lift was offered no weight field, sent none, and the reducer
     * — judging it as the squat it was — refused the save. The sheet asks the
     * reducer's rule, liftOfSet.
     */
    /**
     * The swap sheet's library heading claimed "All exercises" even once a
     * browse chip had narrowed the list to one body part — a completeness
     * the row no longer had (break round 2026-09-29). Selecting a chip other
     * than "all" swaps the heading for the chip's own label.
     */
    name: 'guided swap: the library heading names the chip once one narrows the list',
    run() {
      assert.match(
        playerSource,
        /title:\s*swapBodyPart !== 'all'\s*\?\s*libraryLabel\(swapBodyPart, language\)\s*:\s*t\(language, 'guided\.swap\.library'\),/,
      );
    },
  },
  {
    name: 'guided swap: a logged set is corrected as the lift it was logged as',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      assert.match(source, /return exercise \? \(set \? liftOfSet\(exercise, set\) : exercise\) : null;/);
      const editor = source.slice(source.indexOf('<LoggedSetEditor'), source.indexOf('onCancel={() => setRestEdit(null)}'));
      // Grew past 2000 once the sheet gained the set list and a title that
      // follows the selection (#bugs 2026-09-29) — still a loose bound, just
      // one that catches the wiring moving somewhere else entirely.
      assert.ok(editor.length > 0 && editor.length < 2600, 'the correction sheet moved');
      assert.match(editor, /unloaded=\{isUnloadedTrackingMode\(restEditLift\?\.trackingMode \?\? 'load_and_reps'\)\}/);
      assert.match(editor, /repsCeilingFor\(restEditLift, /);
      assert.doesNotMatch(editor, /exerciseBySlot\.get\(restEdit\.slotId\)\?\.trackingMode/);
      // And the reducer asks the same rule.
      const reducer = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'features', 'workout', 'workoutState.ts'), 'utf8')
        .replace(/\r\n/g, '\n');
      const edit = reducer.slice(reducer.indexOf("case 'set/editLogged': {"), reducer.indexOf("case 'set/recordEffort': {"));
      assert.ok(edit.length > 0 && edit.length < 4000, 'set/editLogged moved');
      assert.match(edit, /const lift = liftOfSet\(exercise, set\);/);
      assert.match(edit, /isUnloadedTrackingMode\(lift\.trackingMode\)/);
    },
  },
  {
    /**
     * #bugs 2026-09-29, "Olisiko järkevä jos näkyis kaikki tehdyt sarjat" —
     * the sheet used to open on the just-logged set with no way to reach any
     * other. It now lists every logged set of the lift, the just-logged one
     * preselected, and edits whichever one the reader taps.
     */
    name: 'guided rest edit: every logged set is offered, the just-logged one preselected, and the title follows the tap',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');

      // The state remembers which set was just logged separately from which
      // one is currently selected — the title reads the first, Save and the
      // reducer read the second.
      assert.match(
        source,
        /const \[restEdit, setRestEdit\] = useState<\s*\{ slotId: string; setIndex: number; justLoggedSetIndex: number \} \| null\s*>\(null\);/,
      );
      // Opened from a lift's pencil on its latest logged set, selected; that
      // set counts as "just logged" only on the rest after it — from any
      // other step the title names the set by number (#bugs 2026-09-30).
      assert.match(
        source,
        /setRestEdit\(\{\s*slotId: correction\.lift\.slotId,\s*setIndex: correction\.setIndex,\s*justLoggedSetIndex: justLogged \? correction\.setIndex : -1,\s*\}\);/,
      );
      // And the sheet says whose set it is: it opens from any lift now.
      assert.match(source, /liftName=\{exerciseNameLabel\(language, restEditLift\?\.exerciseName \?\? ''\)\}/);

      // Every completed set of that lift, computed once per render from the
      // pure helper tests/lib/guidedPlayer covers.
      assert.match(
        source,
        /const restEditSets = restEdit \? loggedSetsOf\(exerciseBySlot\.get\(restEdit\.slotId\)\) : \[\];/,
      );

      const editor = source.slice(source.indexOf('<LoggedSetEditor'), source.indexOf('onCancel={() => setRestEdit(null)}'));
      // The rows and the title both come from the outer state, not from a
      // copy the editor keeps of its own.
      assert.match(editor, /sets=\{restEditSets\}/);
      assert.match(editor, /selectedSetIndex=\{restEdit\.setIndex\}/);
      assert.match(
        editor,
        /onSelectSet=\{\(setIndex\) => setRestEdit\(\(current\) => \(current \? \{ \.\.\.current, setIndex \} : current\)\)\}/,
      );
      // Tapping a row must not touch justLoggedSetIndex — only that keeps
      // the title able to tell "still on the one just logged" from "now
      // correcting a different one".
      assert.doesNotMatch(editor, /justLoggedSetIndex: setIndex/);
      assert.match(
        editor,
        /restEdit\.setIndex === restEdit\.justLoggedSetIndex\s*\? t\(language, 'guided\.rest\.editTitle'\)\s*: t\(language, 'guided\.rest\.editTitleFor', \{ index: restEdit\.setIndex \+ 1 \}\)/,
      );
      // A fresh key per selected set: the reps/weight drafts must reset to
      // the newly picked set's own numbers, not keep the previous typing.
      assert.match(editor, /key=\{`rest-edit-\$\{restEdit\.slotId\}-\$\{restEdit\.setIndex\}`\}/);

      // Inside the editor itself: the list renders only once there is a
      // choice (a lone row would only repeat the title), each row selects
      // by its own setIndex, and the two detail strings — loaded and
      // unloaded — are both used.
      const editorFn = source.slice(
        source.indexOf('function LoggedSetEditor('),
        source.indexOf('function SetStepView('),
      );
      assert.match(editorFn, /sets\.length > 1 \? \(/);
      assert.match(editorFn, /onPress=\{\(\) => onSelectSet\(row\.setIndex\)\}/);
      assert.match(editorFn, /t\(language, 'guided\.rest\.setRowUnloaded', \{ reps: row\.reps \}\)/);
      assert.match(
        editorFn,
        /t\(language, 'guided\.rest\.setRow', \{\s*weight: formatWeight\(row\.loadKg, unitPreference\),\s*reps: row\.reps,\s*\}\)/,
      );
      assert.match(editorFn, /<Text style=\{styles\.editTitle\}>\{title\}<\/Text>/);

      // New copy in both languages, real translations rather than the
      // English text repeated (i18n: every EN key has an FI translation is
      // covered generically by tests/lib/i18n; this pins the words).
      for (const key of ['guided.rest.editTitleFor', 'guided.rest.setRowLabel', 'guided.rest.setRow', 'guided.rest.setRowUnloaded']) {
        assert.ok(i18nSource.includes(`'${key}'`), `${key} missing from i18n.ts`);
      }
      assert.match(i18nSource, /'guided\.rest\.editTitleFor': 'Correct set \{index\}'/);
      assert.match(i18nSource, /'guided\.rest\.editTitleFor': 'Korjaa sarja \{index\}'/);
    },
  },
  {
    /**
     * Each row of the correction sheet must judge itself by its OWN set's
     * tracking mode, not by the sheet's single `unloaded` flag — that flag
     * is derived from `restEditLift`, i.e. from whichever row is currently
     * SELECTED (`restEdit.setIndex`). After a mid-exercise swap between a
     * loaded and an unloaded/timed lift, the other rows' sets were logged
     * as a different lift than the one currently selected, so borrowing the
     * selected row's flag for every row's text showed a 100 kg squat set as
     * bare reps, or a bodyweight set with a weight (break round 2026-09-29).
     */
    name: 'guided rest edit: each row reads its own trackingMode, not the sheet-wide unloaded flag',
    run() {
      const editorFn = playerSource.slice(
        playerSource.indexOf('function LoggedSetEditor('),
        playerSource.indexOf('function SetStepView('),
      );
      // The per-row detail string is decided from a value derived off
      // `row.trackingMode` — never straight off the sheet-wide `unloaded`
      // parameter, which is only correct for the one row it was computed
      // from.
      assert.match(editorFn, /isUnloadedTrackingMode\(row\.trackingMode\)/);
      assert.doesNotMatch(
        editorFn,
        /const detail = unloaded\s*\n\s*\? t\(language, 'guided\.rest\.setRowUnloaded'/,
      );

      // loggedSetsOf, the pure helper, is the one place that stamps each
      // row with its own mode — via liftOfSet, the same rule the reducer's
      // set/editLogged and the single-set editor's `unloaded` prop both
      // already trust for the SELECTED set. A row must not be able to
      // disagree with what Save itself would judge that same set as.
      const libSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'lib', 'guidedPlayer.ts'),
        'utf8',
      );
      assert.match(libSource, /trackingMode: liftOfSet\(lift, set\)\.trackingMode/);
    },
  },
  {
    /**
     * `restEditLift` — which feeds the editor's `unloaded` prop, its reps
     * ceiling, AND (via `findSetByIndex`) the reps/weight fields it opens
     * on — must be recomputed from `restEdit.setIndex`, the field that
     * moves when the reader taps another row. Tying it to
     * `justLoggedSetIndex` (which never moves) or to a value computed once
     * at open time would leave the fields showing the set the sheet opened
     * on instead of the one tapped, across the swap boundary or not.
     */
    name: 'guided rest edit: restEditLift and the editor fields follow restEdit.setIndex, not a value fixed at open time',
    run() {
      assert.match(
        playerSource,
        /const restEditLift = \(\(\) => \{\s*const exercise = restEdit \? exerciseBySlot\.get\(restEdit\.slotId\) : undefined;\s*const set = exercise && restEdit \? findSetByIndex\(exercise, restEdit\.setIndex\) : null;\s*return exercise \? \(set \? liftOfSet\(exercise, set\) : exercise\) : null;\s*\}\)\(\);/,
      );
      // The reps/weight fields the editor opens on read the SAME call —
      // findSetByIndex keyed on restEdit.setIndex — so a tap that moves
      // setIndex moves these too, not just the title.
      assert.match(
        playerSource,
        /reps=\{findSetByIndex\(exerciseBySlot\.get\(restEdit\.slotId\), restEdit\.setIndex\)\?\.actualReps \?\? 0\}/,
      );
      assert.match(
        playerSource,
        /loadKg=\{findSetByIndex\(exerciseBySlot\.get\(restEdit\.slotId\), restEdit\.setIndex\)\?\.actualLoadKg \?\? 0\}/,
      );
      // Never justLoggedSetIndex for any of these three — that field is
      // frozen at open time and exists only to word the title.
      const restEditBlock = playerSource.slice(
        playerSource.indexOf('const restEditLift ='),
        playerSource.indexOf('const restEditSets ='),
      );
      assert.doesNotMatch(restEditBlock, /justLoggedSetIndex/);
    },
  },
  {
    /**
     * #bugs 2026-09-30, on the contents sheet: "vaikea sulkea tätä valikkoa
     * joko klikkaamalla muualta sulkee alasvedettäessä tai ruksi". Every
     * player sheet closes three ways — the dimmed page, a ✕ beside the title,
     * a pull down on the top strip — and the grip it drew now does something.
     */
    name: 'guided sheets: a tap outside, the ✕ and a pull down all close them',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      const sheet = source.slice(source.indexOf('function GPSheet('), source.indexOf('/* ══'));
      assert.ok(sheet.length > 0, 'GPSheet moved');
      // The page.
      assert.match(sheet, /<Pressable\s*style=\{styles\.sheetScrim\}\s*onPress=\{onClose\}/);
      // The ✕, named for a screen reader.
      assert.match(
        sheet,
        /accessibilityLabel=\{t\(language, 'common\.close'\)\}\s*hitSlop=\{10\}\s*onPress=\{onClose\}/,
      );
      // The pull: on the strip that holds the grip AND the title, closing past
      // a distance or a flick, springing back otherwise — on a transform.
      assert.match(sheet, /<View\s*\{\.\.\.pan\.panHandlers\}\s*style=\{styles\.sheetGrab\}\s*onLayout=\{[^\n]*\}\s*>\s*<View style=\{styles\.sheetHandle\} \/>\s*<View style=\{styles\.sheetTitleRow\}>/);
      assert.match(
        sheet,
        /if \(gesture\.dy > SHEET_DISMISS_DRAG \|\| gesture\.vy > SHEET_DISMISS_VELOCITY\) \{\s*onCloseRef\.current\(\);/,
      );
      assert.match(sheet, /transform: \[\{ translateY: dragY \}\]/);
      // Every sheet passes its title in, so every title is part of the strip.
      const openings = source.match(/<GPSheet\b/g) ?? [];
      const titled = source.match(/<GPSheet\s+title=/g) ?? [];
      // Four since the swap sheet became the shared exercise sheet (#bugs 2026-10-06).
      assert.ok(openings.length >= 4, 'the player lost its sheets');
      assert.equal(titled.length, openings.length, 'a sheet draws its title outside the pull zone');
      assert.doesNotMatch(source, /styles\.sheetTitle\b/);
    },
  },
  {
    /**
     * #bugs 2026-09-30: "Poista yläosasta treeni ja lepo", then "Otetaan toi
     * 1/6 pois myös yläpalkista". The player's top bar is the session clock
     * and nothing else; only the do-it-yourself block, which has no title of
     * its own, still names itself there.
     */
    name: 'guided top bar: the player shows the clock alone',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      const bars = source.match(/<TopBar\b[\s\S]*?\/>/g) ?? [];
      assert.equal(bars.length, 2, 'the player bar and the own-block bar');
      const [player, ownBlock] = bars;
      assert.doesNotMatch(player, /label=/, 'the player bar carries a label again');
      assert.match(ownBlock, /label=\{t\(\s*language,\s*ownBlock\.phase === 'warmup' \? 'guided\.label\.warmup' : 'guided\.label\.cooldown',?\s*\)\}/);
      assert.doesNotMatch(source, /getGuidedPhaseLabel/);
      assert.match(source, /\{\[label, clock\]\.filter\(Boolean\)\.join\(' · '\)\}/);
    },
  },
  {
    /**
     * Measured on the phone, 2026-09-30: every render of the player took
     * ~230 ms, on every 100 ms timer tick — the countdown showed its 3 for
     * 1.24 s and its 1 for 0.7 s ("Countdown lagaa 3 3 2 1"). The cost was the
     * add-exercise sheet, mounted closed all session, re-sorting the ~900-lift
     * library because the player handed it a new `recentItems` array each
     * render. Under 40 ms per render once the array was stable.
     */
    name: 'guided player: the closed add-exercise sheet does no work on the player\'s renders',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      // A module-level constant, not an inline literal.
      assert.match(source, /^const NO_RECENT_EXERCISES: ExerciseLibraryItem\[\] = \[\];$/m);
      assert.match(source, /recentItems=\{NO_RECENT_EXERCISES\}/);
      assert.doesNotMatch(source, /recentItems=\{\[\]\}/);
      // The warm-up brief's input is memoized too (~20 ms a render).
      assert.match(source, /const activeExercises = useMemo\(\s*\(\) => exercises\.filter\(/);
      // And the sheet itself lists nothing while closed, whatever it is handed.
      const sheet = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'AddExerciseSheet.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(sheet, /const filteredItems = useMemo\(\(\) => \{[\s\S]*?if \(!visible\) \{\s*return \[\];\s*\}/);
      assert.match(sheet, /\}, \[bodyPart, category, commonStarterOrder, equipment, items, language, search, visible\]\);/);
      assert.match(sheet, /visible\s*\?\s*getSuggestedExerciseLibraryItems\(/);
    },
  },
  {
    /**
     * #bugs 2026-10-06: "Vaihda liike ja Lisää liike pitäisi olla identtiset,
     * käyttäen sitä miltä Lisää liike näyttää". The swap sheet was a GPSheet
     * of picture rows with its own search and chips (#bugs 2026-09-30); it is
     * the add sheet's card grid now — one component, two modes.
     */
    name: 'guided swap: the swap sheet is the add sheet, in swap mode',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      const sheet = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'AddExerciseSheet.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      // One presentation: AddExerciseSheet draws ExercisePickerSheet, and the
      // player's swap draws the same component.
      assert.match(sheet, /export function ExercisePickerSheet\(/);
      assert.match(sheet, /<ExercisePickerSheet\s+visible=\{visible\}[\s\S]*?mode="add"/);
      assert.match(source, /<ExercisePickerSheet\s+visible=\{swapOpen && Boolean\(actionExercise\)\}[\s\S]*?mode="swap"/);
      assert.equal((source.match(/<ExercisePickerSheet\b/g) ?? []).length, 1);
      // The old list is gone: no swap GPSheet, no picture rows, no own search.
      assert.doesNotMatch(source, /\{swapOpen && actionExercise && \(/);
      assert.doesNotMatch(source, /ExerciseLibraryRow|swapSearch|swapList|swapBrowseChip|sheetFrameTall/);
      assert.doesNotMatch(source, /<GPSheet\b[^>]*\btall\b/);
      // Same search, same three filter groups, same cards in both modes:
      // the sheet has no mode branch in its layout, only in its copy.
      assert.match(sheet, /const copy = exerciseSheetCopy\(mode, language, swappedName\);/);
      assert.equal((sheet.match(/mode === 'swap'|mode === 'add'/g) ?? []).length, 0);
      for (const group of ['sheet.category', 'sheet.bodyPart', 'sheet.equipment']) {
        assert.ok(sheet.includes(`t(language, '${group}')`), group);
      }
      assert.match(sheet, /options=\{equipmentOptions\}/);
      // The swap list obeys all three groups through every picker's one list
      // (lib/exercisePicker), the add sheet's too.
      assert.match(source, /listPickerExercises\(exerciseLibrary, \{\s*query,\s*filters: swapFilters,/);
      assert.match(sheet, /listPickerExercises\(items, \{\s*query: search,\s*filters: \{ category, bodyPart, equipment \}/);
      // A programme alternative keeps its card, with its picture when the
      // library holds it (swapSuggestionRows) and its name when it does not.
      assert.match(source, /const swapSuggestionRows = useMemo\(/);
      assert.match(source, /findGuidedLibraryIndex\(getDrillLibraryName\(name\) \?\? name, libraryNames\)/);
      assert.match(sheet, /item: ExerciseLibraryItem \| null;/);
      // A tap swaps by name, the same applySwap as before.
      assert.match(source, /onSelect=\{\(entry\) => applySwap\(entry\.name\)\}/);
      // "Already in this workout" stays under the list, and no empty card
      // argues with it.
      assert.match(source, /listNote=\{\s*swapSessionHits\.length > 0/);
      assert.match(sheet, /ListEmptyComponent=\{\s*listNote \? null :/);
      // The sheet's own bottom: the inset read on the screen, carried by the
      // list when there is no commit bar under it.
      assert.match(source, /<ExercisePickerSheet[\s\S]*?bottomInset=\{screenInsets\.bottom\}/);
      assert.match(sheet, /footer \? null : \{ paddingBottom: spacing\.xxl \+ bottomInset \}/);
    },
  },
  {
    /**
     * The list opens on the lifts nearest the one being swapped: "filtteröinti
     * siihen liikkeeseen perustuva eli lähin sitä mitä haluu tehdä" (#bugs
     * 2026-09-29). Kept through the move to the shared sheet (2026-10-06):
     * the body-part pill opens on the lift's own body part, and only a pill
     * the reader moves becomes theirs.
     */
    name: 'guided swap: the body-part filter opens on the lift\'s own body part until the reader picks',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      assert.match(source, /useState<BodyPartFilter \| null>\(null\);/);
      assert.match(
        source,
        /const swapBodyPart: BodyPartFilter = effectiveSwapBodyPart\(swapBodyPartFilter, swapBrowsePrefilter, swapQuery\);/,
      );
      assert.match(source, /\(\) => \(\{ category: swapCategory, bodyPart: swapBodyPart, equipment: swapEquipment \}\)/);
      assert.match(
        source,
        /if \(next\.bodyPart !== swapFilters\.bodyPart\) \{\s*setSwapBodyPartFilter\(next\.bodyPart\);\s*\}/,
      );
      // No link in front of the chips any more, and no key for it.
      assert.doesNotMatch(source, /swapBrowseOpen|guided\.swap\.browseAll/);
      assert.doesNotMatch(i18nSource, /'guided\.swap\.browseAll'/);
      // Both ways out start the next opening from the lift again, all three
      // groups and the query with it.
      assert.equal((source.match(/setSwapBodyPartFilter\(null\);/g) ?? []).length, 2);
      assert.equal((source.match(/setSwapCategory\('all'\);/g) ?? []).length, 2);
      assert.equal((source.match(/setSwapEquipment\('all'\);/g) ?? []).length, 2);
      assert.doesNotMatch(source, /setSwapBodyPartFilter\('all'\)/);
    },
  },
  {
    name: 'exercise sheet modes: title, card action and note follow the mode in both languages',
    run() {
      const { exerciseSheetCopy } = require('../../.test-dist/lib/exerciseSheetMode.js');
      const fiSwap = exerciseSheetCopy('swap', 'fi', 'Barbell Bench Press - Medium Grip');
      assert.match(fiSwap.title, /^Vaihda /);
      assert.ok(fiSwap.title.length > 'Vaihda '.length, 'the swap title names the lift');
      assert.equal(fiSwap.actionLabel, 'Vaihda');
      assert.equal(fiSwap.note, 'Jo kirjaamasi sarjat jäävät sille liikkeelle, jolla ne teit.');
      assert.equal(fiSwap.featuredTitle, 'Ehdotetut');

      const fiAdd = exerciseSheetCopy('add', 'fi');
      assert.equal(fiAdd.title, 'Lisää liike');
      assert.equal(fiAdd.actionLabel, 'Lisää');
      assert.equal(fiAdd.note, null, 'adding touches no logged set, so it says nothing about them');
      // The same search reads the same in both modes.
      assert.equal(fiAdd.searchPlaceholder, fiSwap.searchPlaceholder);

      const enSwap = exerciseSheetCopy('swap', 'en', 'Barbell Squat');
      const enAdd = exerciseSheetCopy('add', 'en');
      assert.equal(enSwap.actionLabel, 'Swap');
      assert.equal(enAdd.actionLabel, 'Add');
      assert.notEqual(enSwap.title, enAdd.title);
      assert.ok(enSwap.note && enSwap.note.length > 0);
      // A missing name never prints "undefined".
      assert.doesNotMatch(exerciseSheetCopy('swap', 'fi', null).title, /undefined/);
      // The new label exists in both dictionaries.
      assert.equal((i18nSource.match(/'sheet\.swapAction': '[^']+'/g) ?? []).length, 2);
    },
  },
  {
    /**
     * #bugs 2026-10-06: "Jos mahtuu, olisi hyvä tässäkin ruudussa olla koko
     * ohjelman sisältö luettavissa." The walk-up lists the contents sheet's
     * rows in the room under its cards — as many as fit — and never moves
     * its buttons for them.
     */
    name: 'guided walk-up: the workout contents in the room that is left, never at the buttons\' cost',
    run() {
      const source = playerSource.replace(/\r\n/g, '\n');
      const start = source.indexOf("{step.type === 'position' && (");
      const walk = source.slice(start, source.indexOf('{/* An interval work bout', start));
      assert.ok(start > 0 && walk.length > 0, 'walk-up moved');
      // The list lives INSIDE the scroll, and the buttons outside it: the
      // ScrollView closes before the swap / add / start buttons begin.
      const scrollEnd = walk.indexOf('</ScrollView>');
      assert.ok(walk.indexOf('{walkRunFit ? (') < scrollEnd, 'the list is in the scroll area');
      assert.ok(walk.indexOf("label={t(language, 'guided.walk.startFirst')}") > scrollEnd, 'the start button is outside it');
      assert.ok(walk.indexOf("label={t(language, 'guided.walk.swap')}") > scrollEnd);
      // Measured room: the scroll's own height less everything above the list.
      assert.match(walk, /onLayout=\{\(event\) => setWalkViewportHeight\(Math\.floor\(event\.nativeEvent\.layout\.height\)\)\}/);
      assert.match(walk, /onLayout=\{\(event\) => setWalkTopHeight\(Math\.ceil\(event\.nativeEvent\.layout\.height\)\)\}/);
      assert.match(source, /availableHeight: walkViewportHeight - WALK_RUN_CHROME - walkTopHeight,/);
      assert.match(source, /const WALK_RUN_CHROME = 28 \+ 8 \+ 14;/);
      assert.match(walk, /contentContainerStyle=\{\{ paddingTop: 28, paddingHorizontal: 24, paddingBottom: 8, gap: 14 \}\}/);
      // Drawn at the heights the fit was worked out with.
      assert.match(source, /headHeight: WALK_RUN_HEAD,\s*rowHeight: WALK_RUN_ROW,/);
      assert.match(source, /walkRunHead: \{ height: WALK_RUN_HEAD,/);
      assert.match(source, /walkRunRow: \{ height: WALK_RUN_ROW,/);
      assert.match(walk, /numberOfLines=\{1\}\s*accessibilityLabel=\{item\.members\.map/);
      // The contents sheet's rows: its builder, its plan line, its rounds.
      assert.match(source, /const walkRunItems = step\.type === 'position' \? buildGuidedRunSheet\(stepPlan, stepIndex\) : \[\];/);
      assert.match(walk, /runPlanLine\(item\.members\[0\]\?\.slotId \?\? null\)/);
      assert.match(walk, /t\(language, 'guided\.runSheet\.rounds', \{ count: item\.setCount \}\)/);
      // What did not fit is counted, and the whole sheet is one tap away.
      assert.match(walk, /t\(language, 'guided\.walk\.contentMore', \{ count: walkRunFit\.hidden \}\)/);
      assert.match(walk, /onPress=\{\(\) => setRunSheetOpen\(true\)\}/);
      assert.equal((i18nSource.match(/'guided\.walk\.contentMore': '\+\{count\} [^']+'/g) ?? []).length, 2);
    },
  },
];
