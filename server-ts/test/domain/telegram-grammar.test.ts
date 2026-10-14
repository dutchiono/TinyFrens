import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFilterCommand,
  parseBlocklistCommand,
  parseBanCommand,
  matchesTrigger,
  matchesBlocklistPattern,
} from '../../src/domain/telegram-grammar.js';

describe('Domain: Telegram Moderation Grammar', () => {
  test('parses /filter list commands', () => {
    assert.deepEqual(parseFilterCommand('/filter'), { type: 'list' });
    assert.deepEqual(parseFilterCommand('/filters'), { type: 'list' });
    assert.deepEqual(parseFilterCommand('/filter@TinyFrensBot list'), { type: 'list' });
  });

  test('parses /filter set and remove commands', () => {
    assert.deepEqual(parseFilterCommand('/filter gm Good morning fren!'), {
      type: 'set',
      trigger: 'gm',
      response: 'Good morning fren!',
    });

    assert.deepEqual(parseFilterCommand('/filter remove gm'), {
      type: 'remove',
      trigger: 'gm',
    });

    assert.deepEqual(parseFilterCommand('/filter delete /gn'), {
      type: 'remove',
      trigger: 'gn',
    });
  });

  test('parses /blocklist commands', () => {
    assert.deepEqual(parseBlocklistCommand('/blocklist'), { type: 'list' });
    assert.deepEqual(parseBlocklistCommand('/blocklist add badword'), {
      type: 'add',
      pattern: 'badword',
    });
    assert.deepEqual(parseBlocklistCommand('/blocklist remove badword'), {
      type: 'remove',
      pattern: 'badword',
    });
  });

  test('parses /ban and /aiban commands', () => {
    assert.deepEqual(parseBanCommand('/ban spamming links'), {
      isBan: true,
      reason: 'spamming links',
    });
    assert.deepEqual(parseBanCommand('/aiban'), {
      isBan: true,
      reason: null,
    });
    assert.deepEqual(parseBanCommand('/othercommand'), {
      isBan: false,
      reason: null,
    });
  });

  test('matches triggers on whole-word or command forms', () => {
    assert.ok(matchesTrigger('gm everyone', 'gm'));
    assert.ok(matchesTrigger('/gm', 'gm'));
    assert.ok(matchesTrigger('/gm@TinyFrensBot', 'gm'));
    assert.ok(!matchesTrigger('segmentation', 'gm')); // Word interior does not match
  });

  test('matches blocklist patterns with boundary for words, substring for phrases/symbols', () => {
    // Alphanumeric word
    assert.ok(matchesBlocklistPattern('This is spam here', 'spam'));
    assert.ok(!matchesBlocklistPattern('antispam software', 'spam')); // Word interior not matched

    // Phrase / symbol / url
    assert.ok(matchesBlocklistPattern('visit t.me/scam link', 't.me/scam'));
    assert.ok(!matchesBlocklistPattern('visit example.com', 't.me/scam'));
  });
});
