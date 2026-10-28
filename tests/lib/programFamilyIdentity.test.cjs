const assert = require('node:assert/strict');

const {
  programFamilyFromTitle,
  programFamilyIdentity,
  programFamilyIdentityOrNull,
} = require('../../src/lib/programFamilyIdentity');
const {
  PROGRAM_COVER_STYLES,
  programCoverStyle,
} = require('../../src/lib/programVisualIdentity');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

module.exports = [
  {
    name: 'the family is the first word of the title, whatever the level suffix',
    run() {
      assert.equal(programFamilyFromTitle('HOME Starter'), 'HOME');
      assert.equal(programFamilyFromTitle('STRONG'), 'STRONG');
      assert.equal(programFamilyFromTitle('HUGE Pro+'), 'HUGE');
      assert.equal(programFamilyFromTitle('FOCUS Glutes'), 'FOCUS');
      assert.equal(programFamilyFromTitle('  RESET   Yoga '), 'RESET');
      assert.equal(programFamilyFromTitle('huge volume'), 'HUGE');
    },
  },
  {
    name: 'every member of a family wears the same cover and motif',
    run() {
      const starter = programFamilyIdentity('STRONG Starter');
      const elite = programFamilyIdentity('STRONG Elite');
      assert.deepEqual(starter.cover, elite.cover);
      assert.equal(starter.motif, elite.motif);
      assert.notDeepEqual(starter.cover, programFamilyIdentity('HUGE Pro').cover);
    },
  },
  {
    name: 'an unknown or empty name still gets a cover instead of throwing',
    run() {
      assert.equal(programFamilyFromTitle('Maanantain oma treeni'), 'STRONG');
      assert.equal(programFamilyFromTitle(''), 'STRONG');
      assert.equal(programFamilyFromTitle('   '), 'STRONG');
      const identity = programFamilyIdentity('');
      assert.equal(identity.cover.length, 2);
      assert.ok(identity.motif.length > 0);
    },
  },
  {
    name: 'the palette is the existing one — same hex pairs, reassigned by family',
    run() {
      // These five are the design's oklch stops evaluated per hue, and they
      // come out identical to five of the hash-picked styles. If this ever
      // fails, the two systems have drifted into genuinely different colours
      // and the same program would look different on two screens.
      const existing = PROGRAM_COVER_STYLES.map((style) => style.cover.join('/'));
      for (const title of ['HOME', 'STRONG', 'HUGE', 'RUN', 'FOCUS']) {
        const pair = programFamilyIdentity(title).cover.join('/');
        assert.ok(existing.includes(pair), `${title} cover ${pair} is not in the shared palette`);
      }
    },
  },
  {
    name: 'the catalog and the Programs tab paint the same programme the same',
    run() {
      // The whole point of the family system. Before it, the catalog coloured
      // by family and the Programs rail hashed the id, so one programme wore
      // two colours depending on which screen you met it on.
      for (const template of WORKOUT_TEMPLATES_V1) {
        const fromTab = programCoverStyle(template.id, template.name);
        const family = programFamilyIdentityOrNull(template.name);
        if (!family) {
          continue;
        }
        assert.deepEqual(fromTab.cover, family.cover, `${template.id} cover disagrees`);
        assert.deepEqual(fromTab.hero, family.hero, `${template.id} hero disagrees`);
        assert.equal(fromTab.motif, family.motif, `${template.id} motif disagrees`);
      }
    },
  },
  {
    name: 'a name with no family keeps the stable hash colour, not STRONG',
    run() {
      assert.equal(programFamilyIdentityOrNull('Maanantain oma treeni'), null);
      assert.equal(programFamilyIdentityOrNull(null), null);
      assert.equal(programFamilyIdentityOrNull(''), null);
      const own = programCoverStyle('tpl_user_1', 'Maanantain oma treeni');
      assert.notDeepEqual(own.cover, programFamilyIdentity('STRONG').cover);
      // Same id, same colour, every time — that was the hash's whole job.
      assert.deepEqual(own, programCoverStyle('tpl_user_1', 'Maanantain oma treeni'));
    },
  },
  {
    name: 'the three new families got heroes; every hero is a real pair',
    run() {
      for (const title of ['RESET', 'FIT', 'SHRED', 'HOME', 'STRONG', 'HUGE', 'RUN', 'FOCUS']) {
        const identity = programFamilyIdentity(title);
        for (const ramp of ['cover', 'tile', 'hero']) {
          assert.equal(identity[ramp].length, 2, `${title} ${ramp}`);
          identity[ramp].forEach((hex) => assert.match(hex, /^#[0-9A-F]{6}$/, `${title} ${ramp} ${hex}`));
        }
        // The hero has to be darker than the cover or white text stops passing.
        assert.notDeepEqual(identity.hero, identity.cover);
      }
    },
  },
  {
    name: 'each family owns its own motif — no glyph is shared',
    run() {
      const titles = ['HOME', 'STRONG', 'HUGE', 'RESET', 'FIT', 'SHRED', 'RUN', 'FOCUS'];
      const motifs = titles.map((title) => programFamilyIdentity(title).motif);
      assert.equal(new Set(motifs).size, titles.length);
    },
  },
];
