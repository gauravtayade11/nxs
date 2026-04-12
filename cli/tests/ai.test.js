/**
 * Tests for the analyze() decision tree — cli/core/ai.js
 * Only tests paths that don't make real API calls:
 *   - --fast mode (rules or mock, no network)
 *   - no-key mode (rules or mock fallback)
 * Run: node --test cli/tests/ai.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../core/ai.js';

const PROMPT = 'You are a DevOps expert. Analyze this log.';

const mockFn = (_log) => ({
  tool: 'mock-tool',
  severity: 'warning',
  summary: 'Mock analysis result',
  rootCause: 'Unknown',
  fixSteps: 'Check logs',
  commands: 'kubectl logs pod',
  confidence: 50,
});

// ── --fast mode ────────────────────────────────────────────────────────────

describe('analyze() — fast mode', () => {
  test('rule match → returns rule result, no mock called', async () => {
    const result = await analyze('CrashLoopBackOff detected', PROMPT, mockFn, { fast: true });
    assert.strictEqual(result.via, 'rules');
    assert.strictEqual(result.severity, 'critical');
    assert.strictEqual(result.confidence, 95);
    assert.ok(!result._mock);
  });

  test('OOMKilled → rule result', async () => {
    const result = await analyze('Reason: OOMKilled Exit Code: 137', PROMPT, mockFn, { fast: true });
    assert.strictEqual(result.via, 'rules');
    assert.strictEqual(result.confidence, 95);
  });

  test('no rule match → mock with _mock flag and via: mock', async () => {
    const result = await analyze('everything is healthy no issues', PROMPT, mockFn, { fast: true });
    assert.strictEqual(result._mock, true);
    assert.strictEqual(result.via, 'mock');
    assert.strictEqual(result.tool, 'mock-tool');
  });

  test('fast mode mock gets confidence set', async () => {
    const noConfMock = (_log) => ({ tool: 'x', severity: 'info', summary: '', rootCause: '', fixSteps: '', commands: '' });
    const result = await analyze('unrecognized log abc xyz', PROMPT, noConfMock, { fast: true });
    assert.ok(result.confidence != null);
    assert.strictEqual(result.confidence, 40);
  });
});

// ── no-key mode ────────────────────────────────────────────────────────────

describe('analyze() — no API keys', () => {
  let savedGroq, savedAnt;

  before(() => {
    savedGroq = process.env.GROQ_API_KEY;
    savedAnt  = process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  after(() => {
    if (savedGroq !== undefined) process.env.GROQ_API_KEY      = savedGroq;
    if (savedAnt  !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;
  });

  test('95%+ rule → returns rule directly, no _mock', async () => {
    const result = await analyze('CrashLoopBackOff', PROMPT, mockFn);
    assert.strictEqual(result.via, 'rules');
    assert.ok(result.confidence >= 95);
    assert.ok(!result._mock);
  });

  test('no rule match → calls mockFn, sets _mock + via: mock', async () => {
    const result = await analyze('totally unrecognized log xyzabc', PROMPT, mockFn);
    assert.strictEqual(result._mock, true);
    assert.strictEqual(result.via, 'mock');
    assert.strictEqual(result.tool, 'mock-tool');
  });

  test('low-confidence rule + no keys → rule result with _mock flag', async () => {
    // ci-timeout has confidence 78 — below 95 so falls through to no-key bottom
    const result = await analyze('Step exceeded the timeout limit of 30 minutes', PROMPT, mockFn);
    // Bottom of analyze(): ruleResult exists → returns rule with _mock=true
    assert.strictEqual(result._mock, true);
    assert.strictEqual(result.via, 'rules');
  });

  test('mock always gets confidence filled in', async () => {
    const noConfMock = (_log) => ({ tool: 'x', severity: 'info', summary: '', rootCause: '', fixSteps: '', commands: '' });
    const result = await analyze('unrecognized xyz', PROMPT, noConfMock);
    assert.strictEqual(result.confidence, 40);
  });
});

// ── result shape ───────────────────────────────────────────────────────────

describe('analyze() — result shape', () => {
  test('rule result always has required fields', async () => {
    const result = await analyze('ImagePullBackOff', PROMPT, mockFn, { fast: true });
    assert.ok(result.severity);
    assert.ok(result.summary);
    assert.ok(result.rootCause);
    assert.ok(result.fixSteps);
    assert.ok(result.commands);
    assert.ok(result.confidence);
    assert.ok(result.via);
    assert.ok(Array.isArray(result.suggestions));
  });
});
