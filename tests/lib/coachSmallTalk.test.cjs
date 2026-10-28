const assert = require('node:assert/strict');

const { parseCoachSmallTalk, coachSmallTalkReplyKey } = require('../../src/lib/coachSmallTalk');

module.exports = [
  {
    name: 'small talk: a thank-you is recognised in both languages and in passing forms',
    run() {
      assert.equal(parseCoachSmallTalk('kiitos'), 'thanks');
      assert.equal(parseCoachSmallTalk('Kiitos paljon!'), 'thanks');
      assert.equal(parseCoachSmallTalk('kiitti :)'), 'thanks');
      assert.equal(parseCoachSmallTalk('thanks'), 'thanks');
      assert.equal(parseCoachSmallTalk('thank you'), 'thanks');

      assert.equal(parseCoachSmallTalk('moi'), 'greeting');
      assert.equal(parseCoachSmallTalk('Hei!'), 'greeting');
      assert.equal(parseCoachSmallTalk('hello'), 'greeting');

      assert.equal(parseCoachSmallTalk('ok'), 'acknowledgement');
      assert.equal(parseCoachSmallTalk('selvä'), 'acknowledgement');
      assert.equal(parseCoachSmallTalk('joo hyvä'), 'acknowledgement');

      assert.equal(parseCoachSmallTalk('heippa'), 'farewell');
      assert.equal(parseCoachSmallTalk('bye'), 'farewell');

      // A message that is nothing but a thumbs up is an acknowledgement.
      assert.equal(parseCoachSmallTalk('👍'), 'acknowledgement');
      assert.equal(parseCoachSmallTalk('🙏🏻'), 'acknowledgement');
    },
  },
  {
    name: 'small talk: a real question is never mistaken for one, however polite',
    run() {
      // This is the mistake that matters. Missing a "kiitos" costs one API
      // call; answering a question with "ole hyvä" reads as being ignored.
      const questions = [
        'kiitos, mutta miksi penkki ei nouse',
        'moi, voitko analysoida viime treenini',
        'ok mitä teen seuraavaksi',
        'hyvä ohjelma mutta liian raskas, mitä muutan',
        'kiitos!?',
        'hei mikä on paras liike hauikselle',
        'thanks, what should I eat after training',
        'ok 5x5 vai 3x8',
      ];
      for (const question of questions) {
        assert.equal(parseCoachSmallTalk(question), null, `must not swallow: ${question}`);
      }

      // Numbers mean the message is carrying data, even without a question.
      assert.equal(parseCoachSmallTalk('ok 82,5'), null);
      // Length alone rules a message out before any word is examined.
      assert.equal(parseCoachSmallTalk('kiitos kiitos kiitos kiitos kiitos'), null);
      // A keyword-free short message is not small talk either.
      assert.equal(parseCoachSmallTalk('penkki'), null);
      assert.equal(parseCoachSmallTalk(''), null);
      assert.equal(parseCoachSmallTalk('   '), null);
    },
  },
  {
    name: 'small talk: thanks wins over the goodbye it is said with, and replies alternate',
    run() {
      assert.equal(parseCoachSmallTalk('kiitos ja heippa'), 'thanks');
      assert.equal(parseCoachSmallTalk('moi ja kiitos'), 'thanks');

      // Two variants so that saying thanks twice does not echo the same
      // sentence back twice.
      assert.equal(coachSmallTalkReplyKey('thanks', 0), 'coach.smalltalk.thanks.a');
      assert.equal(coachSmallTalkReplyKey('thanks', 1), 'coach.smalltalk.thanks.b');
      assert.equal(coachSmallTalkReplyKey('thanks', 2), 'coach.smalltalk.thanks.a');
      assert.equal(coachSmallTalkReplyKey('greeting', 3), 'coach.smalltalk.greeting.b');
    },
  },
  {
    name: 'small talk: every reply key it can return exists in both languages',
    run() {
      // A key with no string renders as the key itself in the chat bubble.
      const { t } = require('../../src/lib/i18n');
      for (const kind of ['thanks', 'farewell', 'greeting', 'acknowledgement']) {
        for (const turn of [0, 1]) {
          const key = coachSmallTalkReplyKey(kind, turn);
          for (const language of ['en', 'fi']) {
            const text = t(language, key);
            assert.notEqual(text, key, `${key} missing in ${language}`);
            assert.ok(text.length > 0);
          }
        }
      }
    },
  },
  {
    name: 'small talk: the chat answers it locally, before the quota gate',
    run() {
      // The whole point is that it costs nothing. If this ever moved below
      // the `canAsk` check, being out of questions would stop the coach from
      // saying you are welcome; below the network call, it would cost one.
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');

      const smallTalkAt = screen.indexOf('parseCoachSmallTalk(trimmed)');
      const quotaAt = screen.indexOf('if (!canAsk && !force) {');
      const requestAt = screen.indexOf('await requestAiCoachAdvice(');
      assert.ok(smallTalkAt !== -1, 'the chat consults the small-talk parser');
      assert.ok(smallTalkAt < quotaAt, 'small talk is answered before the quota gate');
      assert.ok(smallTalkAt < requestAt, 'small talk never reaches the network');
    },
  },
];
