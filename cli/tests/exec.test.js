/**
 * Tests for cli/core/exec.js — run(), hasBin(), parseTable()
 * Run: node --test cli/tests/exec.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { run, hasBin, parseTable } from '../core/exec.js';

// ── run() ──────────────────────────────────────────────────────────────────

describe('run()', () => {
  test('successful command → ok=true, stdout trimmed', async () => {
    const r = await run('echo hello');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.stdout, 'hello');
    assert.strictEqual(r.stderr, '');
  });

  test('failed command (exit 1) → ok=false', async () => {
    const r = await run('sh -c "exit 1"');
    assert.strictEqual(r.ok, false);
  });

  test('command not found → ok=false', async () => {
    const r = await run('nonexistentbinaryxyz999');
    assert.strictEqual(r.ok, false);
  });

  test('stderr captured on error', async () => {
    const r = await run('cat /no/such/file/xyz 2>&1');
    assert.strictEqual(r.ok, false);
  });

  test('custom timeout option is accepted', async () => {
    const r = await run('echo fast', { timeout: 5000 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.stdout, 'fast');
  });

  test('stdout and stderr both returned on success', async () => {
    const r = await run('sh -c "echo out; echo err >&2"');
    assert.strictEqual(r.ok, true);
    assert.ok(r.stdout.includes('out'));
    assert.ok(r.stderr.includes('err'));
  });
});

// ── hasBin() ──────────────────────────────────────────────────────────────

describe('hasBin()', () => {
  test('echo is always available → true', async () => {
    assert.strictEqual(await hasBin('echo'), true);
  });

  test('sh is available → true', async () => {
    assert.strictEqual(await hasBin('sh'), true);
  });

  test('nonexistent binary → false', async () => {
    assert.strictEqual(await hasBin('definitelynotabinaryxyz99'), false);
  });
});

// ── parseTable() ────────────────────────────────────────────────────────────

describe('parseTable()', () => {
  test('parses kubectl-style multi-space output', () => {
    const output = 'NAME   STATUS   READY\npod1   Running  1/1\npod2   Pending  0/1';
    const result = parseTable(output);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'pod1');
    assert.strictEqual(result[0].status, 'Running');
    assert.strictEqual(result[0].ready, '1/1');
    assert.strictEqual(result[1].name, 'pod2');
    assert.strictEqual(result[1].status, 'Pending');
  });

  test('empty string → empty array', () => {
    assert.deepStrictEqual(parseTable(''), []);
  });

  test('single header line → empty array', () => {
    assert.deepStrictEqual(parseTable('NAME STATUS'), []);
  });

  test('normalizes header to lowercase with underscores', () => {
    const output = 'POD-NAME  STATUS\npod1      Running';
    const result = parseTable(output);
    assert.strictEqual(result.length, 1);
    // header normalization: non-alphanum chars → underscore
    const key = Object.keys(result[0]).find((k) => k.includes('name'));
    assert.ok(key, 'expected a key containing "name"');
    assert.ok(result[0][key].includes('pod1'));
  });

  test('tab-separated helm-style output', () => {
    const output = 'NAME\tNAMESPACE\tSTATUS\nmyapp\tdefault\tdeployed';
    const result = parseTable(output);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'myapp');
    assert.strictEqual(result[0].namespace, 'default');
    assert.strictEqual(result[0].status, 'deployed');
  });

  test('extra columns fill missing with empty string', () => {
    const output = 'A  B  C\n1  2';
    const result = parseTable(output);
    assert.strictEqual(result[0].a, '1');
    assert.strictEqual(result[0].b, '2');
    assert.strictEqual(result[0].c, '');
  });
});
