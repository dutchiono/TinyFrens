import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelegramDeployOwner } from '../../src/routes/telegram.js';

test('only configured numeric Telegram user ID is privileged', () => {
  assert.equal(isTelegramDeployOwner({id: 969561894, username:'renamed'}, '969561894'), true);
  assert.equal(isTelegramDeployOwner({id: 123, username:'dutchiono'}, '969561894'), false);
  assert.equal(isTelegramDeployOwner({id: 123, username:'ionodutch'}, '969561894'), false);
  assert.equal(isTelegramDeployOwner({id: 969561894}, undefined), false);
});
