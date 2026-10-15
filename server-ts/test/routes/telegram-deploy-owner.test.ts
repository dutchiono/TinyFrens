import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelegramDeployOwner } from '../../src/routes/telegram.js';

test('numeric Telegram ID overrides username and blocks impostors', () => {
  assert.equal(isTelegramDeployOwner({id: 12345, username: 'anything'}, '12345', 'other'), true);
  assert.equal(isTelegramDeployOwner({id: 99999, username: 'other'}, '12345', 'other'), false);
  assert.equal(isTelegramDeployOwner({username: 'other'}, '12345', 'other'), false);
});
test('legacy username authorization only applies without configured ID', () => {
  assert.equal(isTelegramDeployOwner({id: 123, username: 'Owner'}, undefined, '@owner'), true);
  assert.equal(isTelegramDeployOwner({id: 123, first_name: 'Owner'}, undefined, '@owner'), false);
  assert.equal(isTelegramDeployOwner({id: 123, username: 'not-owner'}, undefined, '@owner'), false);
});
