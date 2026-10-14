import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FastifyRequest } from 'fastify';
import { getClientIp } from '../src/rate-limit.js';

function request(forwardedFor?: string): FastifyRequest {
  return {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    ip: '127.0.0.1',
  } as FastifyRequest;
}

describe('trusted proxy client IP parity', () => {
  test('ignores forwarded headers unless TRUST_PROXY is enabled', () => {
    assert.equal(getClientIp(request('203.0.113.10'), false), '127.0.0.1');
  });

  test('preserves Python full-header behavior when TRUST_PROXY is enabled', () => {
    assert.equal(getClientIp(request('203.0.113.10, 10.0.0.2'), true), '203.0.113.10, 10.0.0.2');
  });

  test('falls back to the socket address for an empty forwarded header', () => {
    assert.equal(getClientIp(request('  '), true), '127.0.0.1');
  });
});
