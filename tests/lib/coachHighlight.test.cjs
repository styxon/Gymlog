const assert = require('node:assert/strict');

const { splitOnHighlights } = require('../../src/lib/coachHighlight');

function joined(parts) {
  return parts.map((part) => part.value).join('');
}

function emphasised(parts) {
  return parts.filter((part) => part.highlighted).map((part) => part.value);
}

module.exports = [
  {
    name: 'text with no highlights comes back whole',
    run() {
      assert.deepEqual(splitOnHighlights('Nothing to emphasise', []), [
        { value: 'Nothing to emphasise', highlighted: false },
      ]);
    },
  },
  {
    name: 'the highlighted substring is separated without losing any characters',
    run() {
      const parts = splitOnHighlights('Total volume +8% vs last time', ['+8%']);
      assert.equal(joined(parts), 'Total volume +8% vs last time');
      assert.deepEqual(emphasised(parts), ['+8%']);
    },
  },
  {
    name: 'a longer highlight wins over a shorter one nested inside it',
    run() {
      const parts = splitOnHighlights('Squat is 92.5 kg today', ['92.5', '92.5 kg']);
      assert.deepEqual(emphasised(parts), ['92.5 kg']);
      assert.equal(joined(parts), 'Squat is 92.5 kg today');
    },
  },
  {
    name: 'every occurrence of a highlight is emphasised',
    run() {
      const parts = splitOnHighlights('80 kg then 80 kg again', ['80 kg']);
      assert.equal(emphasised(parts).length, 2);
      assert.equal(joined(parts), '80 kg then 80 kg again');
    },
  },
  {
    name: 'a highlight that is not in the text is ignored rather than throwing',
    run() {
      const parts = splitOnHighlights('No figures here', ['+8%']);
      assert.equal(joined(parts), 'No figures here');
      assert.equal(emphasised(parts).length, 0);
    },
  },
  {
    name: 'Finnish word order still highlights the figure',
    run() {
      const parts = splitOnHighlights('Kokonaisvolyymi +8% edelliseen verrattuna', ['+8%']);
      assert.equal(joined(parts), 'Kokonaisvolyymi +8% edelliseen verrattuna');
      assert.deepEqual(emphasised(parts), ['+8%']);
    },
  },
];
