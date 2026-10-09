const assert = require('assert');
const fs = require('fs');
const path = require('path');

const programsHomeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramsHomeScreen.tsx'),
  'utf8',
);
// The workout tab's wiring moved to src/app in the phase-A split (2026-08-26).
const appSource = require('../helpers/appWiringSource.cjs').readAppWiring();
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between, functionBody } = require('../helpers/sourceSlices.cjs');
const routesSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'navigation', 'routes.ts'), 'utf8');
const bottomTabBarSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'BottomTabBar.tsx'),
  'utf8',
);
const modelsSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'types', 'models.ts'), 'utf8');
const databaseSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'), 'utf8');
const seedSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'seed.ts'), 'utf8');
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    name: 'programs tab is gated by a default-off flag and a dedicated route',
    run() {
      // Feature flag: typed, normalized like the other booleans, and defaulted
      // ON (phase 4) so the Programs tab is the live landing page; flipping the
      // seed default back to false is the data-free rollback.
      assert.match(modelsSource, /programsTabEnabled: boolean/);
      assert.match(seedSource, /programsTabEnabled: true/);
      assert.match(databaseSource, /programsTabEnabled:\s*\n?\s*typeof input\?\.preferences\?\.programsTabEnabled === 'boolean'/);
      // Dedicated route, not the legacy list.
      assert.match(routesSource, /tab: 'workout';\s*screen: 'programs_home';/);
      // Tab press honours the flag; default (off) keeps the legacy behaviour.
      // Where the tab LANDS and what it does to history are two decisions:
      // resolveTabRoute answers the first for both the bar and the buttons
      // that cross into the tab, and only the bar resets.
      assert.match(appSource, /if \(tab === 'workout' && preferences\.programsTabEnabled\)/);
      assert.match(appSource, /return \{ tab: 'workout', screen: 'programs_home' \};/);
      assert.match(appSource, /function navigateToTab\(tab: RootTabKey\) \{\s*\r?\n\s*resetToRoute\(resolveTabRoute\(tab\)\);/);
    },
  },
  {
    name: 'programs tab is labelled Programs with a layers icon (internal key unchanged)',
    run() {
      assert.match(bottomTabBarSource, /\{ key: 'workout', labelKey: 'tabs\.programs', stop: 'programs' \}/);
      assert.doesNotMatch(bottomTabBarSource, /label: 'Exercises'/);
      // Layers glyph replaces the dumbbell rects for the workout tab.
      assert.match(bottomTabBarSource, /Programs = a stacked-layers glyph/);
    },
  },
  {
    name: 'programs tab: what you own first, then finding something new',
    run() {
      assert.match(programsHomeSource, /useThemedStyles\(makeStyles\)/);
      assert.doesNotMatch(programsHomeSource, /Your plan, and the programs behind it\./);

      // The active program is GONE from this tab. It led the screen behind a
      // 320px photo hero, which meant the reader had to leave the screen they
      // were already on to find out what week they are in. It lives on Home
      // now; keeping a copy here would give the same week two owners.
      assert.doesNotMatch(programsHomeSource, /programsHeroScrim/);
      assert.doesNotMatch(programsHomeSource, /programs\.thisWeek/);
      assert.doesNotMatch(programsHomeSource, /styles\.dayRow\b/);
      assert.doesNotMatch(programsHomeSource, /programs\.noActive/);
      assert.doesNotMatch(programsHomeSource, /onStartActiveSession/);
      // The name went too (2026-09-26): its only reader was the switch
      // sheet, whose only opener — the trending list — left in #40.
      assert.doesNotMatch(programsHomeSource, /activeProgramTitle|SwitchProgramSheet|setPicked/);

      assert.doesNotMatch(programsHomeSource, /onAdjustSchedule/);

      // Exactly ONE way to start a new program on this page. There were two,
      // one at the top and one at the bottom, and both were the same action —
      // and for a while a third, the campaign slide, which went with the
      // carousel.
      assert.equal((programsHomeSource.match(/setCreateOpen\(true\)/g) ?? []).length, 1,
        'one button, and nothing else, may open the sheet');
      assert.doesNotMatch(programsHomeSource, /t\(language, 'csv\.newProgram'\)/);
      assert.match(programsHomeSource, /<NewProgramSheet/);

      // Designed gradient covers (oklch pre-converted to sRGB), not photos.
      // The screen no longer PICKS the style — it paints the one the item
      // carries, chosen from the programme's family in App.tsx (2026-08-13).
      // Picking here is what let the rail disagree with the catalog.
      assert.doesNotMatch(programsHomeSource, /EXPLORE PROGRAMS/);
      assert.match(programsHomeSource, /const style = item\.cover;/);
      assert.doesNotMatch(programsHomeSource, /COVER_STYLES\[/);
      assert.match(programsHomeSource, /function ProgramCover/);
      assert.match(programsHomeSource, /RadialGradient/);

      // Categories are TILES, not text chips. Colour and shape are read
      // before a word is, which is the only reason a browse row is coloured;
      // the first build quietly shipped nine identical grey pills instead.
      assert.match(programsHomeSource, /styles\.catTile\b/);
      assert.match(programsHomeSource, /d=\{entry\.icon\}/);
      // The icon set replaced the pale tile with a solid disc in the category's
      // own ink and the mark knocked out in white. The outline the pale version
      // needed to hold nine pastels apart is gone with it — filled, the hue is
      // the tile.
      assert.match(programsHomeSource, /backgroundColor: entry\.tint\.ink/);
      assert.match(programsHomeSource, /stroke="#FFFFFF"/);
      assert.match(programsHomeSource, /strokeWidth=\{2\.05\}/);
      assert.match(programsHomeSource, /catTile: \{[\s\S]{0,120}borderRadius: 37,/);
      // On the disc's edge with a ring in the surface colour, which a circle can
      // carry and the old cut corner could not without slicing the digit.
      assert.match(programsHomeSource, /catTileCount: \{[\s\S]{0,300}bottom: -1,/);
      assert.match(programsHomeSource, /borderColor: theme\.surface/);
      // A tile that says 8 has to open 8: the count and the rail read the
      // same source.
      assert.match(programsHomeSource, /categoryCounts\[entry\.key\]/);
      assert.match(programsHomeSource, /categoryMembers\[sheet\.key\]/);
      // A tile opens a SHEET, not a rail. Nine categories sharing one
      // horizontal rail gave every one of them the same eight-card shape, no
      // way to narrow further, and nowhere to say what the category is for or
      // what level its programs are.
      assert.match(programsHomeSource, /function ProgramSheet/);
      assert.match(programsHomeSource, /setSheet\(\{ kind: 'category', key: entry\.key \}\)/);
      assert.doesNotMatch(programsHomeSource, /\{category !== null \?/);
      // The level is the one fact that decides whether a program is for this
      // reader, and no card on this screen carried it before.
      assert.match(programsHomeSource, /const LEVEL_FILTERS/);
      assert.match(programsHomeSource, /items\.filter\(\(item\) => item\.level === level\)/);
      // The badge itself moved into the shared row when the catalog screen
      // became a second door onto the same programmes. It is still drawn from
      // the item's own level — this follows it rather than asserting that a
      // particular file holds it.
      const rowSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'ProgramLadderRow.tsx'),
        'utf8',
      );
      assert.match(rowSource, /PROGRAM_LEVEL_STYLES\[item\.level\]/);
      assert.match(programsHomeSource, /levelFilter=\{level\}/);
      // A filter left over from the last category would silently hide
      // programs in the next one.
      assert.match(programsHomeSource, /if \(!visible\) \{[\s\S]{0,40}setLevel\(null\)/);
      // The carousel is GONE (brief decision, 2026-08-31). It was the only
      // thing on the page that knew nothing about the reader, and it was also
      // the page's third door into the new-programme sheet. Its handler went
      // with it — that switch was the last caller of onOpenSeason here, which
      // is how the season section came off the tab in the same change.
      assert.doesNotMatch(programsHomeSource, /<CampaignHero/);
      assert.doesNotMatch(programsHomeSource, /function CampaignHero/);
      assert.doesNotMatch(programsHomeSource, /handleCampaignTarget/);
      assert.doesNotMatch(programsHomeSource, /CampaignTarget|ProgramCampaign/);

      // Nothing on this tab routes to the old plans list any more. "Näytä
      // kaikki" expands the tiles in place, trending's "Kaikki" opens the
      // whole catalog in the same sheet, and the sheet's own button clears
      // the level filter instead of navigating away from a list it is
      // already showing in full.
      assert.doesNotMatch(programsHomeSource, /onViewAllPrograms/);
      assert.match(programsHomeSource, /setAllCategories\(\(value\) => !value\)/);
      // The all-programmes SHEET is gone with trending, which was its only
      // door. The catalog screen answers that question better than a drawer
      // can — level, goal and a search over a windowed list — so the variant
      // went with the link rather than sitting unreachable.
      assert.doesNotMatch(programsHomeSource, /kind: 'all'/);
      assert.match(read('src', 'app', 'renderWorkoutTab.tsx'), /<CatalogScreen/);
      assert.match(programsHomeSource, /\{level !== null \? \(/);

      // The order, and the reason for it: what the reader OWNS opens the tab,
      // and finding a programme comes straight after (#bugs 2026-09-26: "omat
      // ohjelmat, selaa tavoitteen mukaan ja Sinulle — muut alapuolelle").
      // Targets and courses sat between the two and pushed the browse off
      // the first screen. The page once opened on a rotating advert with the
      // reader's own programmes sixth.
      const order = [
        "'tabs.programs'",
        "'programs.yourPrograms'",
        "'programs.browse'",
        "'programs.forYou'",
        "'programs.goals'",
        "'programs.learn'",
        "'programs.library'",
      ];
      // Each key exactly once, THEN compare positions. indexOf takes the
      // first match, so a second use of one of these higher up the file would
      // silently anchor the check to the wrong line and pass a reordered tab.
      const at = order.map((key) => {
        const uses = programsHomeSource.split(`t(language, ${key})`).length - 1;
        assert.equal(uses, 1, `${key} appears ${uses} times; the order check needs exactly one`);
        return [key, programsHomeSource.indexOf(`t(language, ${key})`)];
      });
      for (let i = 1; i < at.length; i += 1) {
        assert.ok(
          at[i][1] > at[i - 1][1],
          `${at[i][0]} is drawn before ${at[i - 1][0]}`,
        );
      }

      // And the Learn rail is actually FED. The heading above lives inside
      // `learnRows.length > 0`, so it would still be in the source with
      // nothing behind it — a section written and never wired, which is a
      // shape this repo keeps rediscovering.
      const workoutTab = read('src', 'app', 'renderWorkoutTab.tsx');
      // Sliced to the tab's own element first. onOpenCollection is also passed
      // to LearnIndexScreen further down, so asserting it against the whole
      // file proves nothing about the rail — deleting the rail's copy left the
      // guard green when this was mutation-tested.
      const tabStart = workoutTab.indexOf('<ProgramsHomeScreen');
      assert.ok(tabStart > 0, 'the tab element is not rendered at all');
      // To the element's own closing `/>`, not to the next screen: three other
      // screens in this file take an onOpenCollection, and two of them sit
      // between the tab and the library.
      const tabElement = workoutTab.slice(tabStart, workoutTab.indexOf('\n      />', tabStart));
      assert.ok(tabElement.length > 500, 'could not find the end of the tab element');
      const collectionProps = (tabElement.match(/onOpenCollection=/g) ?? []).length;
      assert.equal(
        collectionProps,
        1,
        collectionProps === 0
          ? 'a course on the rail opens nothing'
          : 'the slice caught more than the tab element',
      );
      assert.match(tabElement, /learnRows=\{learnRows\}/, 'the Learn rail is not fed');
      assert.match(workoutTab, /resolveCollectionProgress\(collection,/);
      assert.match(tabElement, /onOpenLearnIndex=\{\(\) => navigate\(\{ tab: 'workout', screen: 'learn' \}\)\}/);
      assert.match(
        tabElement,
        /onOpenCollection=\{\(collectionId\) =>\s*\n\s*navigate\(\{ tab: 'workout', screen: 'collection', collectionId \}\)/,
        'a course on the rail opens nothing',
      );
      // Required, not optional: an omitted prop must be a compile error rather
      // than a tab that quietly has no Learn section.
      assert.match(programsHomeSource, /\n  learnRows: ProgramsLearnRow\[\];/);
      assert.doesNotMatch(programsHomeSource, /seasonOffset/);

      // "Jatka siitä mihin jäit" is gone. It listed programmes with logged
      // work as covers you could tap, which is what "Omat ohjelmasi" below it
      // already is and what the active programme on Home already is — three
      // answers to one question.
      assert.doesNotMatch(programsHomeSource, /'programs\.continue/);

      // Covers come in more than one size. A page where every section draws
      // the same 274×176 card has told the reader nothing about what matters.
      // Heights rather than width×height pairs: the Learn rail's cover is
      // width="100%", so a pair regex sees only one of the two.
      const coverHeights = new Set(
        [...programsHomeSource.matchAll(/\bheight=\{(\d{2,})\}/g)].map((match) => match[1]),
      );
      assert.ok(
        coverHeights.size >= 2,
        `covers still draw at one height: ${[...coverHeights].join(', ')}`,
      );
      // The two the tab actually has: the "for you" card, and the course cover
      // on the Learn rail.
      assert.ok(coverHeights.has('104'), 'the "for you" cover is gone');
      assert.ok(coverHeights.has('76'), 'the Learn rail cover is gone');

      // Trending is gone, with the module behind it. Social proof needs other
      // people and this device only knows what its owner did; the counts were
      // invented, getTrendingEntries returned null in every release build, and
      // the brief's tab does not have the section (2026-09-01). What is
      // guarded now is that none of it comes back by halves. Each PART is
      // named rather than the word banned: a /trending/i sweep also forbids
      // the comment explaining the removal, and it already cost this file one
      // garbled sentence written around it.
      assert.doesNotMatch(programsHomeSource, /trendingItems|const MEDALS|RankMedal/);
      assert.doesNotMatch(programsHomeSource, /styles\.trending/);
      assert.doesNotMatch(programsHomeSource, /t\(language, 'programs\.trending/);
      assert.doesNotMatch(i18nSource, /'programs\.trending/);

      // The tile rows bled 20px past the gutter, so the category and season
      // tiles started left of every heading and card around them.
      assert.match(programsHomeSource, /tileRow: \{[\s\S]{0,40}paddingHorizontal: 20,/);
      // The hero clipped its own CTA at 186: "Avaa kirjasto" was cut off by
      // the card's bottom edge.
      assert.match(programsHomeSource, /const CAMPAIGN_H = 21[0-9];/);
      // The cover meta went through the dictionary after an emulator pass
      // found "3d / wk", "3 days / week", "Muscle" and "Strength" on cards
      // in the Finnish app — directly under category chips reading the same
      // words in Finnish.
      assert.match(programsHomeSource, /'programs\.card\.daysShort'/);
      assert.doesNotMatch(programsHomeSource, /days \/ week|\}d \/ wk/);
      // An emulator pass found four more English strings on this screen in
      // the Finnish app. A grep is cheaper than another pass: no bare
      // English sentence may sit in JSX here.
      assert.doesNotMatch(programsHomeSource, /exercises · browse|browse &amp; swap/);
      assert.match(programsHomeSource, /'programs\.library\.sub'/);
      // The switch-program sheet is gone (2026-09-26). Its only opener was the
      // trending list #40 removed; a programme opens its own page, where
      // adoption and the switch prompt live. Its copy went with it.
      assert.doesNotMatch(programsHomeSource, /programs\.switchSheet|programs\.switchConfirm/);
      assert.match(programsHomeSource, /onOpenExploreProgram\(item\.id\)/);
      // Your programs + create + library.
      assert.match(programsHomeSource, /programs\.yourPrograms/);
      assert.match(programsHomeSource, /customPrograms\.map/);
      assert.match(programsHomeSource, /programs\.create/);
      assert.match(programsHomeSource, /programs\.exerciseLibrary/);
      assert.match(programsHomeSource, /count: exerciseLibraryCount/);
    },
  },
  {
    name: 'app wires programs home to real stores and existing handlers',
    run() {
      // The screen renders from renderWorkoutTab since phase A; App.tsx keeps
      // only the ProgramsExploreItem type for its memo shapes.
      assert.match(appSource, /import \{ ProgramsHomeScreen \} from '\.\.\/screens\/ProgramsHomeScreen'/);
      assert.match(appSource, /if \(route\.screen === 'programs_home'\)/);
      // The plan card goes to Home, which is the screen that runs it; this tab
      // no longer takes even the programme's name (its reader was the
      // unreachable switch sheet, removed 2026-09-26).
      assert.doesNotMatch(appSource, /activeProgramTitle=/);
      assert.match(appSource, /onOpenActivePlan=\{\(\) => \{/);
      // The curated eight-program Explore rail is gone with the always-open
      // catalog row it fed; the category tiles are the way in now.
      assert.doesNotMatch(appSource, /const programsExploreItems = useMemo/);
      assert.match(appSource, /getReadyProgramContent\(template\.id, preferences\.appLanguage\)\?\.summary/);
      // Identity, not position: `index % 5` painted the same programme a
      // different colour in every list it appeared in. Hashing the id fixed
      // that but scattered each FAMILY across five colours and handed motifs
      // to strangers, so the ready catalog and the Programs tab disagreed
      // about the same programme. The style comes from the family now, with
      // the hash left as the fallback for names that have none (2026-08-13).
      assert.doesNotMatch(appSource, /coverIndex: index % 5/);
      assert.doesNotMatch(appSource, /coverIndex: programCoverIndex\(/);
      assert.match(appSource, /cover: programCoverStyle\(template\.id, template\.name\)/);
      assert.match(appSource, /const programsCustomItems = useMemo/);
      // The campaign counts were asserted here — the slides read the same
      // catalog the tiles filter, so one could not advertise a season with
      // nothing in it. The carousel is gone and so is lib/programCampaigns,
      // which is what this now guards: an orphaned module kept alive by its
      // own suite is how ProPaywallScreen survived the decision that killed it.
      assert.doesNotMatch(appSource, /buildProgramCampaigns/);
      assert.ok(
        !fs.existsSync(path.join(__dirname, '..', '..', 'src', 'lib', 'programCampaigns.ts')),
        'lib/programCampaigns is back with no caller',
      );
      assert.doesNotMatch(i18nSource, /'programs\.campaign/);
      // Handlers reuse existing navigation, nothing new invented.
      assert.match(appSource, /onOpenExploreProgram=\{handleOpenProgramDetail\}/);
      assert.match(appSource, /onOpenCustomProgram=\{handleOpenCustomProgramDetail\}/);
      assert.match(appSource, /onOpenLibrary=\{\(\) => navigate\(\{ tab: 'workout', screen: 'list' \}\)\}/);
      // ...and the library can be left again. ExercisesScreen declared an
      // onBack prop and then never took it, so the only way out was noticing
      // that tapping the Programs tab resets the screen.
      assert.match(appSource, /<ExercisesScreen[\s\S]{0,200}onBack=\{\(\) => navigateBack/);
      const library = read('src', 'screens', 'ExercisesScreen.tsx');
      assert.match(library, /onBack,/);
      assert.match(library, /onPress=\{onBack\}/);
      // Status-bar/shell treatment matches the other light workout screens —
      // by the shell's light default, not a flag: `programsHomeActive` was
      // never read and went with the other dead flags (#bugs 2026-10-01).
      assert.doesNotMatch(appSource, /const programsHomeActive =/);
    },
  },
  {
    /**
     * The fourth door, and where it sits.
     *
     * The brief drew "Browse the catalog" last of four and said so in its own
     * notes — "probably the most-used door and it is currently last". The call
     * on 2026-08-31 was to try it high, which is the kind of decision a later
     * tidy-up reverses without noticing, so the ORDER is what this pins.
     */
    name: 'the new-program sheet leads with AI-assisted, then building it yourself',
    run() {
      const sheet = read('src', 'components', 'NewProgramSheet.tsx');

      // Reversed on 2026-09-01. The catalog led since 2026-08-31 on the brief's
      // note that it was "probably the most-used door and it is currently
      // last" — tried high, and the call after seeing it on the device was
      // that the catalog has a whole screen of its own and did not need this
      // slot too. The ORDER is what this pins, either way, because it is the
      // kind of decision a later tidy-up reverses without noticing.
      const aiAt = sheet.indexOf("t(language, 'csv.ai')");
      const buildAt = sheet.indexOf("t(language, 'csv.build')");
      const pasteAt = sheet.indexOf("t(language, 'csv.paste')");
      const catalogAt = sheet.indexOf("t(language, 'csv.catalog')");
      assert.ok(catalogAt > 0, 'the sheet has no catalog row');
      assert.ok(aiAt > 0 && buildAt > 0, 'the sheet lost one of its original rows');
      assert.ok(aiAt < buildAt, 'AI-assisted no longer leads');
      assert.ok(buildAt < catalogAt, 'Build it yourself slipped below the catalog');
      if (pasteAt > 0) {
        assert.ok(buildAt < pasteAt && pasteAt < catalogAt, 'Import CSV left its slot between them');
      }

      // The row only draws when a caller can open it — a door to nowhere is
      // worse than no door.
      assert.match(sheet, /\{onBrowseCatalog \? \(/);

      // AI-assisted wears the Pro lock (user, 2026-09-01, reversing the
      // earlier "the chat, for everyone" call).
      assert.match(sheet, /const aiLocked = !proUnlocked && Boolean\(onOpenPaywall\);/);
      assert.match(sheet, /\{aiLocked \? <ProPill \/> : null\}/);
      assert.match(sheet, /aiLocked \? <ProLockIcon/);

      // And it WALLS (user, 2026-09-01, reversing my own call of the same
      // day). The row says the price in words as well as with a padlock, and
      // goes to the paywall instead of the coach.
      assert.match(sheet, /t\(language, 'csv\.aiUnlock'\)/);
      assert.match(i18nSource, /'csv\.aiUnlock':/);
      assert.match(sheet, /if \(aiLocked\) \{\s+onOpenPaywall\?\.\(\);/);

      // The cost of that is real and stays measured: the coach answers a brief
      // naming a days-per-week with a matching ready programme, free, before
      // its own Pro gate. This row no longer reaches it — the tab bar's middle
      // button still does, for everyone, and that is what keeps the free
      // answer reachable. (This used to pin the session analysis's "ask the
      // coach", which is itself behind Pro — the wrong door; audit 7.)
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      const catalogFirst = chat.indexOf('shouldOfferCatalogInstead(signals)');
      const proGate = chat.indexOf('if (!proUnlocked) {');
      assert.ok(catalogFirst > 0 && proGate > 0, 'the compose handler was restructured — recheck by hand');
      assert.ok(catalogFirst < proGate, 'the free catalog answer no longer runs before the Pro gate');
      // The whole shell: the <BottomTabBar> element moved from App.tsx to
      // src/app/renderAppShell.tsx (phase C, 2026-10-01).
      assert.match(
        readAppWiring(),
        // Through the open screen's unsaved-work question since hunt 10 (#7);
        // still the chat, for everyone.
        /<BottomTabBar[\s\S]{0,1100}onAiPress=\{\(\) => leaveThroughScreenGuard\(\(\) => navigate\(\{ tab: 'home', screen: 'ai_chat' \}\)\)\}/,
        'Home lost the ungated door to the coach, so the free answer has none',
      );

      assert.match(sheet, /proUnlocked = true,/);

      // BOTH callers that open the menu are. The sheet is one component, so
      // it must not offer four doors from the Programs tab and three from the
      // training plan — a reader who creates programmes from the other screen
      // would be the one who never learns the catalog exists.
      for (const tab of ['renderWorkoutTab.tsx', 'renderProfileTab.tsx']) {
        const source = read('src', 'app', tab);
        assert.match(
          source,
          /onBrowseCatalog=\{\(\) => navigate\(\{ tab: 'workout', screen: 'catalog' \}\)\}/,
          `${tab} opens the sheet without the catalog door`,
        );
        // And the lock, for the same reason: one sheet must not mark the
        // composer Pro from one entry point and say nothing from the other.
        assert.match(source, /proUnlocked=\{proUnlocked\}/, `${tab} opens the sheet unmarked`);
        assert.match(
          source,
          /onOpenPaywall=\{\(\) => navigate\(\{ tab: 'profile', screen: 'premium' \}\)\}/,
          `${tab} locks the row with no paywall behind it`,
        );
      }
      const workoutTab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.match(workoutTab, /<CatalogScreen/);
      assert.match(workoutTab, /route\.screen === 'catalog'/);
    },
  },
  {
    /**
     * "Type a search, tap the result" is what this screen is for, and React
     * Native's default spends that tap closing the keyboard instead. Caught on
     * the device: the first tap on a chip after typing did nothing.
     */
    name: 'the catalog survives a tap made while the keyboard is open',
    run() {
      const catalog = read('src', 'screens', 'CatalogScreen.tsx');
      const scrollers = (catalog.match(/<(ScrollView|FlatList)\b/g) ?? []).length;
      const persists = (catalog.match(/keyboardShouldPersistTaps="handled"/g) ?? []).length;
      assert.ok(scrollers > 0, 'the catalog has no scrolling surface at all');
      assert.equal(persists, scrollers, `${scrollers} scrollers but ${persists} keep their taps`);

      // Windowed: every row draws an Svg, and a plain ScrollView would mount
      // all 57 and re-render them on each keystroke.
      assert.match(catalog, /<FlatList/);
      assert.doesNotMatch(catalog, /shown\.map\(/, 'the results are mounted all at once again');

      // "Clear the filters" only draws when there is a filter to clear.
      // It resets the chips and deliberately leaves the search alone, so with
      // both chips already null and the typed text alone emptying the list,
      // the tap wrote the values they already held and the empty state stayed
      // exactly as it was — the one control the empty state offers, doing
      // nothing. Flagged by the PR review on #40.
      assert.match(
        catalog,
        /\{query\.level !== null \|\| query\.goal !== null \? \(/,
        'the clear-filters button can render with nothing to clear',
      );
    },
  },
  {
    /**
     * Every value declared before the branch that reads it.
     *
     * renderWorkoutTab is a chain of early returns, so a `const` below a
     * branch that reads it is not a compile error and not a runtime one
     * either: TypeScript assumes an arrow function runs later, and a release
     * bundle turns `const` into `var`, so the temporal dead zone hands the
     * callback `undefined` instead of throwing a ReferenceError that names the
     * variable. The Learn rail did exactly this — it read
     * learnedExerciseNames 66 lines above its declaration, and the app died
     * two frames away inside resolveCollectionProgress with "Cannot read
     * property 'includes' of undefined". Typecheck and 1540 tests were green;
     * the emulator was not.
     */
    name: 'renderWorkoutTab declares every value above the branch that reads it',
    run() {
      const source = read('src', 'app', 'renderWorkoutTab.tsx');
      const body = source
        .slice(source.indexOf('export function renderWorkoutTab'))
        // Comments name variables all the time; only code counts.
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

      const readEarly = [];
      for (const match of body.matchAll(/^ {2}const (\w+) =/gm)) {
        const name = match[1];
        if (new RegExp(`\\b${name}\\b`).test(body.slice(0, match.index))) {
          readEarly.push(name);
        }
      }

      assert.deepEqual(
        readEarly,
        [],
        `read before declared in renderWorkoutTab: ${readEarly.join(', ')}`,
      );
    },
  },
  {
    name: 'bottom bar center action is the AI button with no text caption',
    run() {
      assert.doesNotMatch(bottomTabBarSource, /<Text[^>]*centerLabel[^>]*>Start<\/Text>/);
      assert.doesNotMatch(bottomTabBarSource, /styles\.centerLabel/);
      // The center action is the raised "AI" button; a11y label preserved.
      assert.match(bottomTabBarSource, /accessibilityLabel=\{t\(language, 'tabs\.aiCoach'\)\}/);
    },
  },
  {
    /**
     * The target flow says it finished, AFTER it finished.
     *
     * `handleAcceptTargetProposal` adopted the programme and wrote the goal
     * and then did nothing at all: no navigation, no toast, no state any
     * screen reads. The tap left the reader on the same three steps with the
     * same numbers — written, never wired.
     *
     * The success state is the ARRIVAL. A toast was raised alongside it and
     * has since gone: it appeared over the page that already showed both
     * halves of what it announced (#bugs 2026-09-05). The rule it was pinned
     * against is unchanged — [CLAUDE.md](CLAUDE.md): "A success state must
     * follow the resolved write, never precede it" — so the order is still
     * pinned, now on the navigation, which must come after BOTH awaits or it
     * is showing a finish that has not happened.
     */
    name: 'target flow: the success state follows the resolved write',
    run() {
      // The shell: App.tsx and the src/app modules its blocks moved into.
      const app = readAppWiring();
      // The handler's OWN body, brace-matched from its declaration to the `}`
      // that closes it at its own indentation (functionBody asserts both, and
      // that the declaration is unique). Sliced, because the shell is
      // thousands of lines and every one of these four strings appears
      // elsewhere in it — an unbounded search would pass on some other
      // function's toast.
      const body = functionBody(app, 'async function handleAcceptTargetProposal(');

      const adopt = body.indexOf('await handleAdoptReadyProgram');
      const write = body.indexOf('await updatePreferences');
      const leave = body.indexOf("navigate({ tab: 'workout', screen: 'programs_home' })");

      assert.ok(adopt > 0, 'the programme is no longer adopted here');
      assert.ok(write > 0, 'the target is no longer written here');
      assert.ok(leave > 0, 'the tap is silent again — nothing takes the reader to what it built');

      assert.ok(adopt < write, 'the target is written before the programme lands');
      assert.ok(write < leave, 'the reader arrives before the write that put it there resolves');

      // The toast that used to sit between them is gone, key and all. The
      // three finds above prove the slice is this handler, so the absence
      // below scans exactly it; the same key is also absent from the whole
      // shell, and from i18n.ts, which is the guard for every other screen.
      assert.equal(body.indexOf('goalFlow.created'), -1, 'the toast is back in this handler');
      assert.equal(app.indexOf('goalFlow.created'), -1, 'the toast key is back in the shell');
      assert.doesNotMatch(read('src', 'lib', 'i18n.ts'), /'goalFlow\.created'/);
    },
  },
  {
    /**
     * The device walkthrough of 2026-09-01, in one case.
     *
     * Four asks, all of them about a control saying less than it does or
     * sitting where it is not looked for.
     */
    name: 'programs tab: the active programme leads, and a target can be removed',
    run() {
      const home = read('src', 'screens', 'ProgramsHomeScreen.tsx');
      const app = read('App.tsx');
      // "Omat ohjelmasi", bounded to its own memo and found in the shell: it
      // left App.tsx for useProgramsCustomItems (phase-C split, 2026-10-01).
      // CRLF-normalised: the end anchor spans line breaks, and a Windows
      // checkout would otherwise miss it.
      const customItems = between(
        readAppWiring().replace(/\r\n/g, '\n'),
        'const programsCustomItems = useMemo(() => {',
        '\n  }, [\n    customWorkouts,\n',
      );

      // The one you are training is first, authored or adopted. It used to
      // keep its authoring position, so ACTIVE was a tag you had to read the
      // list to find rather than a place in it.
      assert.match(customItems, /const leadFirst = /);
      assert.match(customItems, /\.\.\.rows\.filter\(\(row\) => row\.active\),/);
      assert.match(customItems, /return leadFirst\(\[\.\.\.runningRows, \.\.\.authored\]\);/);

      // And EVERY running programme is on the list, not only the leader. An
      // adopted ready programme has no row in `workoutTemplates`, so it was
      // listed only while it led: making a second programme lead dropped it
      // out of the one list called "your programmes" while it kept running
      // and kept holding a slot against the programme cap (user 2026-09-07).
      // The rule itself lives in src/lib and is tested there. What this pins
      // is that App.tsx asks it, with the reader's own templates excluded so a
      // programme cannot appear both as authored and as running.
      // Held, not only running: a programme switched off is still the
      // reader's and stays on this list (device, 2026-09-16).
      assert.match(customItems, /const runningRows = listHeldProgrammes\(\{/);
      assert.match(customItems, /authoredTemplateIds: authoredIds,/);
      // The dedup loop must not come back anywhere in the shell: App.tsx or a
      // src/app module (phase-B split, 2026-09-30).
      assert.doesNotMatch(
        readAppWiring(),
        /const seenTemplateIds = new Set/,
        'the dedup loop moved back into App.tsx or src/app',
      );

      // "The programme you are training right now" is a claim about ONE row,
      // and this list can hold several running programmes. Said on every one
      // it contradicted the ACTIVE tag beside it, which only the leader
      // carries (review, 2026-09-07).
      assert.match(customItems, /subtitle: active\s*\r?\n?\s*\? t\(preferences\.appLanguage, 'programs\.activeSubtitle'\)/);
      // A running programme that does not lead says its week; one switched
      // off says so instead (device, 2026-09-16).
      assert.match(customItems, /\? t\(preferences\.appLanguage, 'programs\.card\.days', \{ count: template\.daysPerWeek \}\)\s*: t\(preferences\.appLanguage, 'programs\.card\.switchedOff'\),/);
      // Only what the catalog can open — a plan pointing at a deleted custom
      // template is neither authored nor ready, and its row would navigate
      // nowhere.
      assert.match(customItems, /const template = getWorkoutTemplateById\(row\.templateId\);/);
      assert.match(customItems, /if \(!template\) \{[\s\S]{0,40}?return null;/);
      // One notion of "active" for the whole list, the same one the authored
      // rows ask, so two rows cannot both be marked by different rules.
      // The lead plan's own template, not Home's hero card, which is null
      // whenever the hero cannot be built (device, 2026-09-16).
      assert.match(customItems, /const active = leadingTemplateId === row\.templateId;/);
      assert.match(customItems, /active: leadingTemplateId === template\.id,/);
      assert.match(customItems, /^\s+active,$/m);

      // One name for one programme. Home resolved season titles and ready
      // presentations inline; the Programs tab now lists the same programmes,
      // so both go through the same resolver rather than growing a third
      // spelling of the rule.
      assert.match(app, /const runningProgrammeTitle = useCallback\(/);
      // Counted across the shell, App.tsx and src/app, since Programs' list
      // left App.tsx for its own module (phase-C split, 2026-10-01).
      assert.equal(
        (readAppWiring().match(/runningProgrammeTitle\(/g) ?? []).length,
        2,
        'the running-programme title rule was copied instead of shared',
      );

      // A chevron, not the word "Open" on every row.
      assert.doesNotMatch(home, /styles\.customAction/);
      assert.match(home, /d="M9 5l7 7-7 7"/);

      // The create card is filled and wears the accent, not a dashed outline.
      assert.doesNotMatch(home, /fill="transparent"[\s\S]{0,120}dashed/);
      assert.match(home, /color: theme\.highlight/);

      // Removing a target is a control you can see. It was a long press, and
      // the card's own accessibility label announced "Remove the target" for a
      // tap that opens the picker.
      assert.match(home, /styles\.goalRemove/);
      assert.match(home, /stroke=\{theme\.danger\}/);
      assert.match(home, /onPress=\{\(\) => onRemoveGoal\(entry\.goal\.exerciseName\)\}/);

      // With no target the section is a card, not a caption. One line of grey
      // prose under a heading reads as an explanation of the heading; this has
      // a title, the same surface and speed line a real target wears, and a
      // filled button (user 2026-09-01).
      assert.match(home, /styles\.goalEmptyCta/);
      assert.match(home, /backgroundColor: theme\.highlight/);
      assert.match(home, /t\(language, 'programs\.goals\.emptyTitle'\)/);
      assert.match(i18nSource, /'programs\.goals\.emptyTitle':/);
      // And the header link hides while the card is showing: two doors to the
      // same picker, side by side, is the duplicate this tab keeps growing.
      assert.match(home, /\{goals\.length > 0 \? \(/);

      // Every tier's footer reserves the same lines, so the button does not
      // move between tabs. Free has neither a plan sub-line nor recurring
      // terms, and `foot` is bottom-anchored, so its CTA sat lower than the
      // other two.
      const premium = read('src', 'screens', 'PremiumScreen.tsx');
      assert.match(premium, /\{entry\.subKey \? t\(language, entry\.subKey\) : ' '\}/);
      assert.match(premium, /\{fineKey \? t\(language, fineKey\) : ' '\}/);
      assert.doesNotMatch(premium, /\{fineKey \? <Text/);
      assert.match(premium, /priceSub: \{ fontSize: 13, lineHeight: 17/);
    },
  },
];
