const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = () =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'NewProgramSheet.tsx'), 'utf8');

module.exports = [
  {
    name: 'new programme sheet: Android back in the paste view steps to the menu, like the arrow (hunt 1.1.1 r2)',
    run() {
      const sheet = read();
      // The system back closed the whole sheet and dropped the pasted text,
      // while the header arrow #445 added went back to the menu.
      assert.match(sheet, /<Modal[^>]*onRequestClose=\{handleBack\}/);
      assert.match(sheet, /accessibilityLabel=\{t\(language, 'common\.back'\)\}\s*onPress=\{handleBack\}/);
      const body = sheet.match(/function handleBack\(\) \{([\s\S]*?)\n  \}/);
      assert.ok(body, 'handleBack exists');
      assert.match(body[1], /if \(view !== initialView\) \{\s*setView\('menu'\);\s*return;\s*\}\s*handleClose\(\);/);
    },
  },
  {
    name: 'new programme sheet: a spent or failed photo note does not survive closing the sheet (hunt 1.1.1 r2)',
    run() {
      const sheet = read();
      const reset = sheet.match(/function reset\(\) \{([\s\S]*?)\n  \}/);
      assert.ok(reset, 'reset exists');
      assert.match(reset[1], /setImageNote\(null\);/);
    },
  },
];
