const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { matchProgrammeToBrief, shouldOfferCatalogInstead } = require('../../.test-dist/lib/briefProgrammeMatch.js');
const { parseProgrammeBrief } = require('../../.test-dist/lib/programmeBrief.js');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
const { createSeedDatabase } = require('../../.test-dist/data/seed.js');

const preferences = createSeedDatabase().preferences;

module.exports = [
  {
    name: 'brief match: a five-day ask gets a five-day programme instead of a trimmed four',
    run() {
      // The composer only has splits for one to four days, so "5 päivää" came
      // back as four with a note explaining the trim — while fourteen designed
      // five- and six-day programmes sat in the catalog (user 2026-08-26,
      // "eikö aichat voi vain ottaa lähimpää ohjelmaa").
      const signals = parseProgrammeBrief('5 päivää viikossa, jalat ja pakarat');
      assert.equal(signals.requestedDaysPerWeek, 5, 'the ask survives the cap');
      assert.equal(shouldOfferCatalogInstead(signals), true);

      const match = matchProgrammeToBrief(signals, preferences);
      assert.ok(match, 'the catalog has a five-day answer');
      assert.equal(match.daysPerWeek, 5, 'matched on the ASK, not on the capped four');
      assert.equal(match.matched.days, true);
      assert.deepEqual(match.matched.focus.sort(), ['glutes', 'legs']);
    },
  },
  {
    name: 'brief match: within the composer\'s range the catalog is not offered',
    run() {
      // Three days is something the composer builds exactly as described, and
      // steering that to a ready-made programme answers a different question.
      const signals = parseProgrammeBrief('3 päivää, penkki painopisteenä');
      assert.equal(signals.requestedDaysPerWeek, null);
      assert.equal(shouldOfferCatalogInstead(signals), false);
    },
  },
  {
    name: 'brief match: a brief with nothing to match on returns nothing',
    run() {
      // Better than picking the catalog's first programme and calling it a fit.
      assert.equal(matchProgrammeToBrief(parseProgrammeBrief('jotain kivaa'), preferences), null);
    },
  },
  {
    name: 'brief match: every id it can return is a real catalog programme',
    run() {
      // The whole reason this is a scorer and not a question for the coach: a
      // model asked to name a programme names ones that do not exist.
      const ids = new Set(RECOMMENDATION_PROGRAMS.map((definition) => definition.programId));
      for (const brief of ['5 päivää, rinta', '6 päivää lihasmassaa', '5 päivää, jalat']) {
        const match = matchProgrammeToBrief(parseProgrammeBrief(brief), preferences);
        assert.ok(match && ids.has(match.programId), `${brief} produced an unknown id`);
      }
    },
  },
  {
    name: 'brief parser: asking for legs no longer flags the back as well',
    run() {
      // `lats?\b` had a boundary only at the end, so it matched the tail of any
      // word ending in "lat" — and Finnish "jalat" is exactly that. Legs came
      // back as back+legs, which vetoed deadlifts and pulled back-tagged
      // programmes up the match.
      assert.deepEqual(parseProgrammeBrief('5 päivää, jalat').focusBodyParts, ['legs']);
      assert.deepEqual(parseProgrammeBrief('5 päivää, jalat ja pakarat').focusBodyParts, ['legs', 'glutes']);
      // The real word still matches, from either language.
      assert.deepEqual(parseProgrammeBrief('lat pulldown painopisteenä').focusBodyParts, ['back']);
      assert.deepEqual(parseProgrammeBrief('selkä painopisteenä').focusBodyParts, ['back']);
    },
  },
  {
    name: 'chat: the catalog answer is offered before the Pro gate, and never as a raw id',
    run() {
      const chat = fs.readFileSync(
        path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'),
        'utf8',
      );
      // A chat message reading "tpl_5_day_ppl_v1" would be worse than the
      // composed week it replaced.
      assert.match(chat, /function catalogProgrammeTitle\(programId: string\): string \| null/);
      assert.match(chat, /const title = match \? catalogProgrammeTitle\(match\.programId\) : null;/);
      assert.match(chat, /if \(match && title\) \{/);
    },
  },
];
