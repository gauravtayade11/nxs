/**
 * Tests for the redact module — cli/core/redact.js
 * Run: node --test cli/tests/redact.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redact, warnIfSensitive } from '../core/redact.js';

describe('redact()', () => {
  test('passes clean text through unchanged', () => {
    const text = 'kubectl logs my-pod --previous\nCrashLoopBackOff detected';
    const { redacted, count, types } = redact(text);
    assert.strictEqual(redacted, text);
    assert.strictEqual(count, 0);
    assert.deepStrictEqual(types, []);
  });

  test('redacts AWS access key', () => {
    const { redacted, count } = redact('key=AKIAIOSFODNN7EXAMPLE rest of log');
    assert.ok(!redacted.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(redacted.includes('[REDACTED-AWS-KEY]'));
    assert.strictEqual(count, 1);
  });

  test('redacts JWT token', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature123';
    const { redacted, count } = redact(`Authorization header: ${jwt}`);
    assert.ok(!redacted.includes('eyJhbGciOiJSUzI1NiJ9'));
    assert.ok(redacted.includes('[REDACTED-JWT]'));
    assert.strictEqual(count, 1);
  });

  test('redacts Bearer token', () => {
    const { redacted } = redact('Authorization: Bearer abc123tokenXYZ==');
    assert.ok(!redacted.includes('abc123tokenXYZ'));
    assert.ok(redacted.includes('Bearer [REDACTED-TOKEN]'));
  });

  test('redacts GitHub token', () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const { redacted, count } = redact(`GITHUB_TOKEN=${token}`);
    assert.ok(!redacted.includes(token));
    assert.ok(redacted.includes('[REDACTED-GITHUB-TOKEN]'));
    assert.strictEqual(count, 1);
  });

  test('redacts password in env var (word-boundary form)', () => {
    // The regex requires \b before the keyword — "password=..." matches, "DB_PASSWORD=..." does not
    const { redacted } = redact('password=supersecret123');
    assert.ok(!redacted.includes('supersecret123'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  test('redacts DB connection URL password', () => {
    const { redacted } = redact('postgres://user:FAKE_PASS_FOR_TEST@localhost:5432/db');
    assert.ok(!redacted.includes('FAKE_PASS_FOR_TEST'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  test('returns count and types for multiple matches', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE and password=hunter2 and Bearer tok123==';
    const { count, types } = redact(text);
    assert.ok(count >= 2);
    assert.ok(types.length >= 2);
  });
});

describe('warnIfSensitive()', () => {
  test('returns empty array for clean text', () => {
    const w = warnIfSensitive('kubectl get pods -n production');
    assert.deepStrictEqual(w, []);
  });

  test('warns about AWS key', () => {
    const w = warnIfSensitive('AKIAIOSFODNN7EXAMPLE');
    assert.ok(w.length > 0);
    assert.ok(w.some(m => m.toLowerCase().includes('aws')));
  });

  test('warns about password field', () => {
    const w = warnIfSensitive('password=hunter2');
    assert.ok(w.length > 0);
    assert.ok(w.some(m => m.toLowerCase().includes('password')));
  });

  test('warns about Bearer token', () => {
    const w = warnIfSensitive('Authorization: Bearer eyXYZ');
    assert.ok(w.length > 0);
  });

  test('warns about JWT', () => {
    const w = warnIfSensitive('token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig');
    assert.ok(w.length > 0);
    assert.ok(w.some(m => m.toLowerCase().includes('jwt')));
  });

  test('warns about private key', () => {
    const w = warnIfSensitive('-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----');
    assert.ok(w.length > 0);
    assert.ok(w.some(m => m.toLowerCase().includes('private key')));
  });

  test('warns about Azure storage key', () => {
    const w = warnIfSensitive('AccountKey=dGVzdGtleXZhbHVlaGVyZWZvcnRlc3Rpbmc=');
    assert.ok(w.length > 0);
    assert.ok(w.some(m => m.toLowerCase().includes('azure')));
  });
});
