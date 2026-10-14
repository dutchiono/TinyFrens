import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  recoverPersonalSigner,
  isValidAddress,
  toChecksumAddress,
  verifyGithubWebhookSignature,
  validateTelegramInitData,
} from '../../src/crypto/signatures.js';

describe('Crypto: Signatures and Hashes', () => {
  test('recovers signer address from EIP-191 personal sign matching Python vector', async () => {
    // Vector generated with Python eth_account:
    // msg = 'Hello TinyFrens!'
    // sig = '0xcee6f34ea432287e31dea7d4afbde9a62a64e43f63e7f2676fabf6b7b7a24451297d2473a7513ceb6c48b7d20552a9ce9de6cbb3a54f4a0f5bad541dfa52f5171b'
    // signer = '0x490F02dce2f1B4b555959fbEE13b5Baa22140659'
    const message = 'Hello TinyFrens!';
    const signature =
      '0xcee6f34ea432287e31dea7d4afbde9a62a64e43f63e7f2676fabf6b7b7a24451297d2473a7513ceb6c48b7d20552a9ce9de6cbb3a54f4a0f5bad541dfa52f5171b';
    const recovered = await recoverPersonalSigner({ message, signature });
    assert.equal(recovered.toLowerCase(), '0x490F02dce2f1B4b555959fbEE13b5Baa22140659'.toLowerCase());
  });

  test('validates and checksums Ethereum addresses', () => {
    const raw = '0x490f02dce2f1b4b555959fbee13b5baa22140659';
    assert.ok(isValidAddress(raw));
    assert.equal(toChecksumAddress(raw), '0x490F02dce2f1B4b555959fbEE13b5Baa22140659');
    assert.ok(!isValidAddress('0xinvalid'));
    assert.ok(!isValidAddress('not-an-address'));
  });

  test('verifies GitHub webhook signature using HMAC-SHA256', () => {
    const secret = 'webhook-secret-123';
    const body = Buffer.from('{"action":"opened","issue":{"number":42}}');
    const hmac = createHmac('sha256', secret).update(body).digest('hex');

    assert.ok(verifyGithubWebhookSignature(secret, body, `sha256=${hmac}`));
    assert.ok(!verifyGithubWebhookSignature('wrong-secret', body, `sha256=${hmac}`));
    assert.ok(!verifyGithubWebhookSignature(secret, body, 'sha256=invalidhash'));
    assert.ok(!verifyGithubWebhookSignature(secret, body, `sha1=${hmac}`)); // SHA-1 rejected
  });

  test('validates Telegram initData and expires properly', () => {
    const botToken = '123456:ABC-token';
    const authDate = Math.floor(Date.now() / 1000);
    const pairs = [`auth_date=${authDate}`, 'query_id=AAHdF6IQAAAAAN0XohDhrOrc', 'user={"id":12345,"username":"frenny"}'];
    pairs.sort();
    const dataCheck = pairs.join('\n');

    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');

    const initData = `${pairs.join('&')}&hash=${hash}`;

    const validated = validateTelegramInitData(initData, botToken, 86400, authDate + 10);
    assert.equal(validated.auth_date, authDate);
    assert.equal(validated.user?.id, 12345);
    assert.equal(validated.user?.username, 'frenny');

    // Expired
    assert.throws(
      () => validateTelegramInitData(initData, botToken, 60, authDate + 100),
      /Telegram login has expired/
    );

    // Bad signature
    assert.throws(
      () => validateTelegramInitData(`${pairs.join('&')}&hash=badhash`, botToken),
      /Telegram signature does not match/
    );
  });
});
