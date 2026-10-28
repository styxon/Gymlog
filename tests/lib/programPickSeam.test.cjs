const assert = require('node:assert/strict');

const {
  PICK_BOTTOM_CLEARANCE,
  PICK_MAX_SLACK,
  PICK_SEAM_BOTTOM_SELECTED,
  PICK_SEAM_TOP_SELECTED,
  PICK_TOP_CLEARANCE,
  PICK_TOP_PADDING,
  resolvePickSeam,
} = require('../../src/lib/programPickSeam');

/**
 * "Your programme is ready": the second programme's name went behind the
 * first programme's half (device, 2026-09-16).
 */

const CTA = 140;

/** The box each half gets, in points, for a seam. */
function boxes(seam, height) {
  const low = Math.min(...seam);
  const high = Math.max(...seam);
  return {
    top: (low - PICK_TOP_CLEARANCE) * height,
    bottom: height - CTA - (high + PICK_BOTTOM_CLEARANCE) * height,
  };
}

module.exports = [
  {
    name: 'pick seam: a chosen lower card that grew moves the seam up instead of hiding its name',
    run() {
      // The week strip made the chosen card ~300 points; the fixed seam gave
      // the lower box under 200, bottom-anchored, so the name rose behind the
      // upper half.
      const height = 650;
      const fixed = boxes(PICK_SEAM_BOTTOM_SELECTED, height);
      assert.ok(fixed.bottom < 300, 'the fixed seam really was too low for it');

      const seam = resolvePickSeam({
        height,
        topSelected: false,
        selectedContentHeight: 300,
        collapsedContentHeight: 80,
        ctaRoom: CTA,
      });
      const room = boxes(seam, height);
      assert.ok(room.bottom >= 300 - 0.5, `chosen card has ${room.bottom}`);
      assert.ok(room.top >= 80 + PICK_TOP_PADDING - 0.5, `collapsed name has ${room.top}`);
      // The slant is the same slant.
      assert.ok(Math.abs((seam[0] - seam[1]) - (PICK_SEAM_BOTTOM_SELECTED[0] - PICK_SEAM_BOTTOM_SELECTED[1])) < 1e-9);
    },
  },
  {
    name: 'pick seam: the collapsed name keeps its room before the chosen card grows into it',
    run() {
      const height = 650;
      const seam = resolvePickSeam({
        height,
        topSelected: true,
        selectedContentHeight: 300,
        collapsedContentHeight: 80,
        ctaRoom: CTA,
      });
      const room = boxes(seam, height);
      assert.ok(room.bottom >= 80 - 0.5, `collapsed name has ${room.bottom}`);
      assert.ok(room.top >= 300 + PICK_TOP_PADDING - 0.5, `chosen card has ${room.top}`);

      // A screen too short for both: the collapsed name is still readable,
      // and the chosen card takes what is left rather than the other way round.
      const tight = resolvePickSeam({
        height: 420,
        topSelected: true,
        selectedContentHeight: 320,
        collapsedContentHeight: 80,
        ctaRoom: CTA,
      });
      assert.ok(boxes(tight, 420).bottom >= 80 - 0.5);
    },
  },
  {
    name: 'pick seam: nothing measured is the designed seam, and nothing leaves the screen',
    run() {
      assert.deepEqual(
        resolvePickSeam({ height: 0, topSelected: true, selectedContentHeight: 0, collapsedContentHeight: 0, ctaRoom: CTA }),
        [...PICK_SEAM_TOP_SELECTED],
      );
      // A chosen card that about fills its box: the seam stays where it was
      // designed (a tall phone with room to spare is the next suite).
      assert.deepEqual(
        resolvePickSeam({ height: 650, topSelected: true, selectedContentHeight: 300, collapsedContentHeight: 60, ctaRoom: CTA }),
        [...PICK_SEAM_TOP_SELECTED],
      );
      // Absurd measurements are clamped rather than drawn off the screen.
      const wild = resolvePickSeam({ height: 300, topSelected: false, selectedContentHeight: 5000, collapsedContentHeight: 10, ctaRoom: CTA });
      for (const end of wild) {
        assert.ok(end >= 0.08 && end <= 0.92, String(end));
      }
    },
  },
  {
    /**
     * Owner's #3, iOS hunt 2026-10-17: the seam never came UP for a chosen
     * card with room to spare, so on a tall iPhone the purple ran 110-220
     * points past the week strip. The chosen box keeps at most
     * PICK_MAX_SLACK of empty room; the collapsed card takes the rest.
     */
    name: 'pick seam: on a tall phone the chosen card keeps little empty room, and the other card gets it',
    run() {
      for (const height of [720, 825, 900]) {
        const top = resolvePickSeam({ height, topSelected: true, selectedContentHeight: 290, collapsedContentHeight: 80, ctaRoom: CTA });
        const topRoom = boxes(top, height);
        const topSlack = topRoom.top - (290 + PICK_TOP_PADDING);
        assert.ok(topSlack >= -0.5, `${height}: the chosen card no longer fits (${topSlack})`);
        assert.ok(topSlack <= PICK_MAX_SLACK + 1, `${height}: ${topSlack} points empty under the chosen card`);
        assert.ok(topRoom.bottom >= 80 - 0.5, `${height}: collapsed name has ${topRoom.bottom}`);
        assert.ok(Math.abs((top[0] - top[1]) - (PICK_SEAM_TOP_SELECTED[0] - PICK_SEAM_TOP_SELECTED[1])) < 1e-9, 'the slant moved');

        const bottom = resolvePickSeam({ height, topSelected: false, selectedContentHeight: 200, collapsedContentHeight: 80, ctaRoom: CTA });
        const bottomRoom = boxes(bottom, height);
        const bottomSlack = bottomRoom.bottom - 200;
        assert.ok(bottomSlack >= -0.5, `${height}: the chosen lower card no longer fits (${bottomSlack})`);
        assert.ok(bottomSlack <= PICK_MAX_SLACK + 1, `${height}: ${bottomSlack} points empty over the chosen lower card`);
        assert.ok(bottomRoom.top >= 80 + PICK_TOP_PADDING - 0.5, `${height}: collapsed name has ${bottomRoom.top}`);
      }
      // Until both cards are measured nothing tightens, so the seam does not
      // move twice on the way in.
      assert.deepEqual(
        resolvePickSeam({ height: 900, topSelected: true, selectedContentHeight: 290, collapsedContentHeight: 0, ctaRoom: CTA }),
        [...PICK_SEAM_TOP_SELECTED],
      );
    },
  },
  {
    name: 'pick seam: the chosen card\'s second lines are white at 0.80 or more on its purple',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramPickScreen.tsx'), 'utf8');
      for (const key of ['statLabel', 'splitLabelLight', 'weekLabel', 'weekCellDay', 'weekNote']) {
        const block = new RegExp(`\\n  ${key}: \\{([^}]*)\\}`).exec(screen);
        assert.ok(block, `${key} not found`);
        const alpha = /color: 'rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)'/.exec(block[1]);
        assert.ok(alpha, `${key} is not white on the purple`);
        assert.ok(Number(alpha[1]) >= 0.8, `${key} at ${alpha[1]}`);
      }
      // And 0.80 is enough where the scrim is lightest: white at 0.80 over
      // #5B21B6 at 0.55 on #6D28D9.
      const { contrastRatio, WCAG_AA_TEXT } = require('../helpers/contrast.cjs');
      const mix = (top, bottom, alpha) => top.map((value, index) => Math.round(value * alpha + bottom[index] * (1 - alpha)));
      const hex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      const ground = mix([0x5b, 0x21, 0xb6], [0x6d, 0x28, 0xd9], 0.55);
      const text = mix([255, 255, 255], ground, 0.8);
      assert.ok(contrastRatio(hex(text), hex(ground)) >= WCAG_AA_TEXT, `${contrastRatio(hex(text), hex(ground))}`);
    },
  },
  {
    name: 'pick seam: the screen measures both cards and asks the rule where the seam goes',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramPickScreen.tsx'), 'utf8');
      assert.match(screen, /const \[l, r\] = resolvePickSeam\(\{/);
      assert.match(screen, /selectedContentHeight: chosen \? contentHeights\[`\$\{chosen\.id\}:selected`\]/);
      assert.match(screen, /collapsedContentHeight: collapsed \? contentHeights\[`\$\{collapsed\.id\}:collapsed`\]/);
      assert.match(screen, /onLayout=\{measureContent\(`\$\{option\.id\}:\$\{selected \? 'selected' : 'collapsed'\}`\)\}/);
      // The fixed fractions are no longer read by the screen itself.
      assert.doesNotMatch(screen, /CUT_TOP|CUT_BOTTOM/);
    },
  },
];
